#!/usr/bin/env node
// 평가 실행기(설계 9-1·9-3). 앱과 같은 runPipeline(lib/pipeline/run.ts)을 문항마다 부르고 코드로 채점한다.
//
//   npm run eval -- [옵션]
//   --asof 2026-11-05        기준일(기본: 평가 세트 기준일)
//   --ids E01,E22            일부 문항만
//   --repeat 3               반복 수
//   --mode fixed             답변 방식(tools는 미구현 — 받기만 하고 fixed로 돈다)
//   --offline                Liner Search 대신 tests/fixtures/search/의 고정 응답(Router는 실제로 부른다)
//   --model-analyze <id>     ① 모델(기본 LINER_MODEL_ANALYZE, 없으면 liner-mark-1.3)
//   --model-answer <id>      ③ 모델(기본 LINER_MODEL_ANSWER, 없으면 liner-mark-1.3)
//   --model-judge <id>       보조 채점 모델(기본 LINER_MODEL_JUDGE). --judge일 때만 의미가 있다
//   --compare a,b,c          ③ 모델 후보를 차례로 돌려 비교(9-3)
//   --credit-limit 5         이 실행 전체 비용 상한(USD). 넘거나 처음 3문항으로 낸 예상이 넘으면 멈춘다
//   --compare-stop 4         --compare에서 후보 하나가 끝났을 때 누적이 이 값을 넘으면 다음 후보 전에 멈춘다
//   --strict-school          학칙 조 일치도 통과 조건에 넣는다(학칙을 캐시에 실었을 때)
//   --mock                   Liner를 부르지 않는 오프라인 실행. 실제 파이프라인(lib/pipeline/run.ts)에 Search 고정 응답과
//                            Router 대역(scripts/eval/offline-liner.mjs: 규칙 기반 분석 + 추출식 답)을 끼워 끝까지 돈다.
//                            키가 필요 없고, 통과율은 모델 없이 검색·검증·카드 경로가 정답 조를 내놓는지의 하한이다
//   --mock-runner            실행기 자체 시험용 가짜 파이프라인(scripts/eval/mock-pipeline.mjs). 파이프라인을 안 거친다
//   --out <dir>              결과 폴더(기본 eval/runs/<시각>, .gitignore됨)
//
// .env는 있으면 읽는다(process.loadEnvFile, 이미 있는 환경변수는 덮지 않음). 키 값은 출력·저장하지 않는다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreOne } from "./score.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MODEL = "liner-mark-1.3";
const TRAP_IDS = ["E10", "E11", "E22", "E23", "E24"];

// ───────── 옵션 ─────────
export function parseArgs(argv) {
  const o = { asof: "2026-11-05", repeat: 1, mode: "fixed", offline: false, mock: false, mockRunner: false, strictSchool: false, judge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--asof") o.asof = next();
    else if (a === "--ids") o.ids = next().split(",").map((s) => s.trim());
    else if (a === "--repeat") o.repeat = Math.max(1, Number(next()) || 1);
    else if (a === "--mode") o.mode = next();
    else if (a === "--offline") o.offline = true;
    else if (a === "--mock") o.mock = true;
    else if (a === "--mock-runner") o.mockRunner = true;
    else if (a === "--strict-school") o.strictSchool = true;
    else if (a === "--judge") o.judge = true;
    else if (a === "--model-analyze") o.modelAnalyze = next();
    else if (a === "--model-answer") o.modelAnswer = next();
    else if (a === "--model-judge") o.modelJudge = next();
    else if (a === "--compare") o.compare = next().split(",").map((s) => s.trim());
    else if (a === "--credit-limit") o.creditLimit = Number(next());
    else if (a === "--compare-stop") o.compareStop = Number(next());
    else if (a === "--out") o.out = next();
    else throw new Error(`모르는 옵션: ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.asof)) throw new Error("--asof는 YYYY-MM-DD");
  if (!["fixed", "tools"].includes(o.mode)) throw new Error("--mode는 fixed|tools");
  return o;
}

export function loadQuestions(path = join(ROOT, "eval/questions.jsonl")) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
    .map((l) => JSON.parse(l));
}

// ───────── 비용 ─────────
/**
 * 라우터 호출 단가: 요청 모델(router) → 응답의 실제 모델(served) → 모르면 확인된 최고 단가를 임시로 쓴 대용값(unpriced_router_ceiling, 상한 보장 없음).
 * 대용값이나 trace 금액을 쓰면 estimated:true(결과에 '단가 미확인 포함'으로 적는다)
 */
export function routerPrice(pricing, call) {
  const byRequest = pricing.router?.[call.model];
  if (byRequest) return { price: byRequest, estimated: false };
  const byServed = call.served_model ? pricing.served?.[call.served_model] : undefined;
  if (byServed) return { price: byServed, estimated: false };
  const ceiling = pricing.unpriced_router_ceiling;
  if (ceiling?.input_per_million !== undefined) return { price: ceiling, estimated: true };
  return { price: null, estimated: true };
}

export function makeCoster(pricing) {
  return function costOf(result) {
    let usd = 0;
    let unpriced = false;
    let prompt = 0;
    let completion = 0;
    let reasoning = 0;
    const calls = { router: 0, search: 0, cache: 0 };
    for (const c of result?.trace?.calls ?? []) {
      calls[c.api] = (calls[c.api] ?? 0) + 1;
      // 고정 응답·건너뜀 기록은 과금이 없다(usage가 있는 것만 실제 호출)
      if (c.api === "search" && c.usage) usd += pricing.search_per_call;
      if (c.api === "router" && c.usage) {
        prompt += c.usage.prompt_tokens;
        completion += c.usage.completion_tokens;
        reasoning += c.usage.reasoning_tokens ?? 0;
        const { price, estimated } = routerPrice(pricing, c);
        if (estimated) unpriced = true;
        // 늦어서 겹쳐 보낸 요청은 취소해도 과금됐을 수 있다 → 같은 크기로 한 번 더 센다(보수적)
        const times = 1 + (c.duplicate_requests ?? 0);
        if (price) usd += (times * (c.usage.prompt_tokens * price.input_per_million + c.usage.completion_tokens * price.output_per_million)) / 1e6;
        else usd += times * (c.usage.cost_usd ?? 0);
      }
    }
    return { usd, unpriced, tokens: { prompt, completion, reasoning }, calls };
  };
}

// ───────── 비밀 검사 ─────────
/**
 * @param {string} text
 * @param {Record<string, string | undefined>} [env]
 */
export function findSecrets(text, env = process.env) {
  const hits = [];
  for (const name of ["LINER_API_KEY", "LAW_OC"]) {
    const v = env[name];
    if (v && v.length >= 8 && text.includes(v)) hits.push(name);
  }
  if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(text)) hits.push("Bearer 토큰 모양");
  if (/\bsk-[A-Za-z0-9_-]{20,}/.test(text)) hits.push("sk- 키 모양");
  return hits;
}

// ───────── 실행 조건 기록 ─────────
/**
 * summary.json의 추론 강도 칸. 실제로 보낸 값(sent)과 환경변수 원문(env)을 함께 남긴다.
 * 모르는 값은 파이프라인이 무시하므로 두 값이 다를 수 있다. sent를 모르면(대역 파이프라인) null
 * @param {{ analyze?: string, answer?: string } | null | undefined} sent
 * @param {Record<string, string | undefined>} [env]
 */
export function reasoningRecord(sent, env = process.env) {
  const shown = (v) => (sent ? v ?? "(보내지 않음)" : null);
  return {
    analyze: shown(sent?.analyze),
    answer: shown(sent?.answer),
    env: { analyze: env.LINER_REASONING_ANALYZE ?? null, answer: env.LINER_REASONING_ANSWER ?? null },
  };
}

/**
 * 실행한 코드의 커밋 해시와 작업 중 변경 여부. git이 없거나 실패하면 undefined(기록에서 뺀다)
 * @param {string} [cwd]
 * @param {typeof execFileSync} [exec]
 */
export function codeVersion(cwd = ROOT, exec = execFileSync) {
  const git = (args) => String(exec("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).trim();
  try {
    const commit = git(["rev-parse", "--short", "HEAD"]);
    if (!commit) return undefined;
    let dirty;
    try {
      dirty = git(["status", "--porcelain", "--untracked-files=no"]) !== "";
    } catch {
      dirty = undefined;
    }
    return dirty === undefined ? { commit } : { commit, dirty };
  } catch {
    return undefined;
  }
}

// ───────── 파이프라인 불러오기 ─────────
async function loadPipeline(opts) {
  if (opts.mockRunner) {
    const m = await import(pathToFileURL(join(ROOT, "scripts/eval/mock-pipeline.mjs")).href);
    return { runPipeline: m.runPipeline, cache: undefined, close: async () => {} };
  }
  // 앱 코드는 TypeScript + "@/" 경로라 Vite의 SSR 로더로 읽는다(새 의존성 없이 devDependency인 vite 사용)
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    resolve: { alias: { "@": ROOT } },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const run = await server.ssrLoadModule("/lib/pipeline/run.ts");
  const load = await server.ssrLoadModule("/lib/cache/load.ts");
  const analyze = await server.ssrLoadModule("/lib/pipeline/analyze.ts");
  const answer = await server.ssrLoadModule("/lib/pipeline/answer.ts");
  const reasoning = () => ({ analyze: analyze.analyzeReasoning(), answer: answer.answerReasoning() });
  const cache = await load.loadCache();
  if (opts.mock) {
    const { createOfflineLiner } = await import(pathToFileURL(join(ROOT, "scripts/eval/offline-liner.mjs")).href);
    const offline = createOfflineLiner();
    // 파이프라인은 키가 있어야 시작한다. 오프라인 대역은 키를 어디에도 보내지 않는다
    if (!process.env.LINER_API_KEY) process.env.LINER_API_KEY = "offline-no-network";
    return { runPipeline: run.runPipeline, cache, reasoning, fetchImpl: offline.fetchImpl, offlineCalls: offline.calls, close: () => server.close() };
  }
  return { runPipeline: run.runPipeline, cache, reasoning, close: () => server.close() };
}

// ───────── 한 후보 실행 ─────────
async function runCandidate({ questions, opts, models, pipeline, costOf, spentBefore, log }) {
  const rows = [];
  let spent = spentBefore;
  let stopped = null;
  const total = questions.length * opts.repeat;
  let n = 0;
  outer: for (let r = 1; r <= opts.repeat; r += 1) {
    for (const q of questions) {
      if (opts.creditLimit !== undefined && spent >= opts.creditLimit) {
        stopped = `크레딧 상한 $${opts.creditLimit} 도달(누적 $${spent.toFixed(4)})`;
        break outer;
      }
      const started = Date.now();
      let result = null;
      let error = null;
      try {
        result = await pipeline.runPipeline(
          { question: q.question, asOf: opts.asof, school: q.school ?? null, mode: opts.mode },
          {
            cache: pipeline.cache,
            mode: opts.mode,
            models: { analyze: models.analyze, answer: models.answer },
            searchFixtureDir: opts.offline || opts.mock ? join(ROOT, "tests/fixtures/search") : undefined,
            ...(pipeline.fetchImpl ? { fetchImpl: pipeline.fetchImpl, schoolRules: "cache_only" } : {}),
          },
        );
      } catch (err) {
        error = err?.name ?? "Error"; // 예외 메시지는 남기지 않는다(키·요청이 섞일 수 있음, 설계 5-3)
      }
      const ms = Date.now() - started;
      const score = result ? scoreOne(q, result, { strictSchool: opts.strictSchool }) : { pass: false, format_error: true, problems: [`예외 ${error}`], checks: {} };
      const cost = costOf(result);
      spent += cost.usd;
      n += 1;
      const answerMs = (result?.trace?.calls ?? []).filter((c) => c.stage === "answer").reduce((s, c) => s + c.duration_ms, 0);
      rows.push({
        id: q.id,
        repeat: r,
        model_answer: models.answer,
        pass: score.pass,
        format_error: score.format_error,
        problems: score.problems,
        checks: score.checks,
        verdict: result?.verdict ?? null,
        summary: result?.summary ?? null,
        card_ids: (result?.cards ?? []).map((c) => c.id),
        // ② 캐시 단계가 ③에 넘긴 후보 조 ID(카드에 안 나온 조가 후보에 있었는지 가르는 데 쓴다)
        candidate_ids: (result?.trace?.calls ?? []).find((c) => c.stage === "collect_cache")?.candidate_ids ?? [],
        removed_citations: result?.verification?.removed_citations ?? null,
        // ④ 검증이 고친 것(종류·인용 ID만, 설명 문구는 뺀다)
        issues: (result?.verification?.issues ?? []).map((i) => (i.citation_id ? `${i.kind}:${i.citation_id}` : i.kind)),
        retried: result?.verification?.retried ?? null,
        duration_ms: ms,
        answer_ms: answerMs,
        // 단계별 실제 소요(ms)와 답한 모델(응답 model, 없으면 요청 모델만 남는다)
        stage_ms: result?.trace?.stage_ms ?? null,
        served_models: [...new Set((result?.trace?.calls ?? []).filter((c) => c.api === "router").map((c) => `${c.stage}:${c.served_model ?? c.model}`))],
        duplicate_requests: (result?.trace?.calls ?? []).reduce((n, c) => n + (c.duplicate_requests ?? 0), 0),
        // 겹쳐 보낸 호출에서 쓴 요청 번호(단계:1 = 처음 요청, 단계:2 = 겹친 요청)
        hedge_winners: (result?.trace?.calls ?? []).filter((c) => c.hedge_winner).map((c) => `${c.stage}:${c.hedge_winner}`),
        // 최종 결과의 필드별 글자 수(출력 길이가 어디서 나오는지 보려는 것. ④가 덧붙인 주의·상위 조 카드 포함)
        output_chars: result ? outputChars(result) : null,
        calls: cost.calls,
        tokens: cost.tokens,
        cost_usd: cost.usd,
        unpriced: cost.unpriced,
      });
      log(`  ${q.id}#${r} ${score.pass ? "통과" : score.format_error ? "형식오류" : "실패"} ${(ms / 1000).toFixed(1)}s $${cost.usd.toFixed(5)}`);

      // 처음 3문항으로 전체 예상액을 내 상한을 넘으면 멈춘다(9-3 진행 규칙 2)
      if (opts.creditLimit !== undefined && n === 3 && total > 3) {
        const projected = spentBefore + ((spent - spentBefore) / 3) * total;
        if (projected > opts.creditLimit) {
          stopped = `처음 3문항 기준 예상액 $${projected.toFixed(4)}가 상한 $${opts.creditLimit}을 넘음`;
          break outer;
        }
      }
    }
  }
  return { rows, spent, stopped };
}

/** 결론·인용·체크리스트·주의·찾아본 범위의 글자 수 */
export function outputChars(result) {
  const len = (xs) => xs.reduce((n, x) => n + (x ?? "").length, 0);
  const scope = result.searched_scope;
  return {
    summary: (result.summary ?? "").length,
    quotes: len((result.cards ?? []).map((c) => c.quote)),
    checklist: len((result.checklist ?? []).flatMap((c) => [c.step, c.deadline])),
    caveats: len(result.caveats ?? []),
    searched_scope: scope ? len([...scope.laws, ...scope.queries, ...scope.where_to_check]) : 0,
  };
}

// ───────── 집계 ─────────
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 단계별 소요 중앙값(stage_ms가 있는 행만) */
export function medianStages(rows) {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r.stage_ms ?? {})))];
  return Object.fromEntries(names.map((n) => [n, median(rows.map((r) => r.stage_ms?.[n]).filter((x) => typeof x === "number"))]));
}

export function summarize(rows, questions) {
  const runs = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const formatErrors = rows.filter((r) => r.format_error).length;
  const fabricated = rows.filter((r) => (r.removed_citations ?? 0) > 0).length;
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const passOf = (ids) => ids.filter((id) => (byId.get(id) ?? []).length && byId.get(id).every((r) => r.pass)).length;
  const noBasisIds = questions.filter((q) => q.expected_verdict === "no_basis").map((q) => q.id).filter((id) => byId.has(id));
  const trapIds = TRAP_IDS.filter((id) => byId.has(id));
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return {
    runs,
    passed,
    pass_rate: runs ? passed / runs : 0,
    format_error_rate: runs ? formatErrors / runs : 0,
    fabricated_rate: runs ? fabricated / runs : 0,
    no_basis: { passed: passOf(noBasisIds), of: noBasisIds.length },
    traps: { passed: passOf(trapIds), of: trapIds.length },
    avg_router_calls: runs ? sum((r) => r.calls.router ?? 0) / runs : 0,
    avg_search_calls: runs ? sum((r) => r.calls.search ?? 0) / runs : 0,
    avg_tokens: runs ? sum((r) => r.tokens.prompt + r.tokens.completion) / runs : 0,
    total_cost_usd: sum((r) => r.cost_usd),
    cost_per_question_usd: runs ? sum((r) => r.cost_usd) / runs : 0,
    avg_duration_ms: runs ? sum((r) => r.duration_ms) / runs : 0,
    median_duration_ms: median(rows.map((r) => r.duration_ms)),
    max_duration_ms: rows.reduce((m, r) => Math.max(m, r.duration_ms), 0),
    median_stage_ms: medianStages(rows),
    duplicate_requests: sum((r) => r.duplicate_requests ?? 0),
    median_answer_ms: median(rows.map((r) => r.answer_ms).filter((x) => x > 0)),
    unpriced: rows.some((r) => r.unpriced),
    by_id: [...byId.entries()].map(([id, rs]) => ({ id, passed: rs.filter((r) => r.pass).length, of: rs.length })),
  };
}

function summaryMarkdown({ opts, models, results, stoppedAll, startedAt }) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const lines = [];
  lines.push(`# 평가 결과 ${startedAt}`, "");
  lines.push(`- 기준일 ${opts.asof}, 반복 ${opts.repeat}, 방식 ${opts.mode}${opts.offline || opts.mock ? ", Search 고정 응답" : ""}${opts.mock ? ", **오프라인(Router 대역: 규칙 기반 분석 + 추출식 답, 모델 호출 없음)**" : ""}${opts.mockRunner ? ", **목 파이프라인(실행기 시험)**" : ""}`);
  lines.push(`- 모델: ① ${models.analyze}, 보조 채점 ${opts.judge ? models.judge : "안 함"}`);
  if (stoppedAll) lines.push(`- **멈춤**: ${stoppedAll}`);
  lines.push("");
  lines.push("| ③ 모델 | 통과율 | 근거 없음 | 시행일 함정 | 형식 오류율 | 인용 삭제 발생 | ③ 시간 중앙값 | 문항당 비용 | 평균 호출(Router/Search) |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const { model, s, stopped } of results) {
    lines.push(
      `| ${model}${stopped ? " (중단)" : ""} | ${pct(s.pass_rate)} (${s.passed}/${s.runs}) | ${s.no_basis.passed}/${s.no_basis.of} | ${s.traps.passed}/${s.traps.of} | ${pct(s.format_error_rate)} | ${pct(s.fabricated_rate)} | ${(s.median_answer_ms / 1000).toFixed(1)}s | $${s.cost_per_question_usd.toFixed(5)}${s.unpriced ? " (단가 미확인 포함)" : ""} | ${s.avg_router_calls.toFixed(1)}/${s.avg_search_calls.toFixed(1)} |`,
    );
  }
  lines.push("", "| ③ 모델 | 문항당 시간 평균 / 중앙값 / 최대 | 단계별 중앙값 | 겹쳐 보낸 요청 |", "|---|---|---|---|");
  for (const { model, s } of results) {
    const stages = Object.entries(s.median_stage_ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(", ");
    lines.push(`| ${model} | ${(s.avg_duration_ms / 1000).toFixed(1)}s / ${(s.median_duration_ms / 1000).toFixed(1)}s / ${(s.max_duration_ms / 1000).toFixed(1)}s | ${stages || "-"} | ${s.duplicate_requests} |`);
  }
  for (const { model, rows } of results) {
    lines.push("", `## ${model} 문항별`, "", "| 문항 | 통과 | 판정 | 근거 조 | 세부 위치 | 함정 | 지어낸 인용 | 빠진 표현 |", "|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const c = r.checks ?? {};
      const mark = (k) => (!c[k] ? "-" : !c[k].applicable ? "·" : c[k].pass ? "O" : "X");
      lines.push(
        `| ${r.id}#${r.repeat} | ${r.pass ? "O" : r.format_error ? "형식" : "X"} | ${r.verdict ?? "-"} ${mark("verdict")} | ${mark("article")}${c.article?.missing?.length ? ` 빠짐 ${c.article.missing.join(", ")}` : ""} | ${c.location?.applicable ? `${c.location.hit}/${c.location.of}` : "·"} | ${mark("trap")} | ${r.removed_citations ?? "-"} | ${(c.must_include?.missing ?? []).join(", ")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

// ───────── 실행 ─────────
export async function main(argv = process.argv.slice(2), log = console.log) {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
  const opts = parseArgs(argv);
  const pricing = JSON.parse(readFileSync(join(ROOT, "config/pricing.json"), "utf8"));
  const costOf = makeCoster(pricing);

  let questions = loadQuestions();
  if (opts.ids) {
    const unknown = opts.ids.filter((id) => !questions.some((q) => q.id === id));
    if (unknown.length) throw new Error(`없는 문항: ${unknown.join(",")}`);
    questions = questions.filter((q) => opts.ids.includes(q.id));
  }
  const env = process.env;
  const base = {
    analyze: opts.modelAnalyze ?? env.LINER_MODEL_ANALYZE ?? DEFAULT_MODEL,
    answer: opts.modelAnswer ?? env.LINER_MODEL_ANSWER ?? DEFAULT_MODEL,
    judge: opts.modelJudge ?? env.LINER_MODEL_JUDGE ?? DEFAULT_MODEL,
  };
  const candidates = opts.compare ?? [base.answer];
  if (opts.judge) {
    for (const m of candidates) if (m === base.judge) log(`경고: 보조 채점 모델(${base.judge})이 답 모델과 같음 — 결과에 '자기 채점'으로 표시`);
    log("참고: 보조 채점(모델 판정)은 ①의 Router 호출 모듈이 생기면 붙인다. 지금은 코드 자동 채점만 한다.");
  }
  if (!opts.mock && !opts.mockRunner && !env.LINER_API_KEY) log("경고: LINER_API_KEY가 없음 — 파이프라인이 missing_api_key로 끝날 수 있음");

  // 폴더 이름은 한국 시각(KST)
  const startedAt = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(opts.out ?? join(ROOT, "eval/runs", `${opts.compare ? "compare-" : ""}${startedAt}`));
  const pipeline = await loadPipeline(opts);
  const reasoning = reasoningRecord(pipeline.reasoning?.(), env);
  const code = codeVersion();
  log(`평가 시작: 문항 ${questions.length} × 반복 ${opts.repeat}, ③ 후보 ${candidates.join(", ")}, 기준일 ${opts.asof}${opts.mock ? " (오프라인: Liner 호출 없음)" : opts.mockRunner ? " (목 파이프라인)" : ""}`);

  const results = [];
  let spent = 0;
  let stoppedAll = null;
  try {
    for (const model of candidates) {
      if (opts.compareStop !== undefined && results.length > 0 && spent > opts.compareStop) {
        stoppedAll = `후보 ${results.length}개를 마친 뒤 누적 $${spent.toFixed(4)}가 $${opts.compareStop}을 넘어 다음 후보 전에 멈춤`;
        break;
      }
      log(`- ③ ${model}`);
      const models = { ...base, answer: model };
      const { rows, spent: after, stopped } = await runCandidate({ questions, opts, models, pipeline, costOf, spentBefore: spent, log });
      spent = after;
      results.push({ model, rows, stopped, s: summarize(rows, questions) });
      if (stopped) {
        stoppedAll = `${model}: ${stopped}`;
        break;
      }
    }
  } finally {
    await pipeline.close();
  }
  if (opts.mock) log(`오프라인 대역이 받은 Liner 요청 ${pipeline.offlineCalls.length}건(네트워크로 나간 것 0건)`);

  const allRows = results.flatMap((r) => r.rows);
  const resultsJsonl = allRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const md = summaryMarkdown({ opts, models: base, results, stoppedAll, startedAt });
  const summaryJson = JSON.stringify(
    { started_at: startedAt, ...(code ? { code } : {}), options: { ...opts }, models: base, reasoning, spent_usd: spent, stopped: stoppedAll, candidates: results.map(({ model, s, stopped }) => ({ model, stopped, ...s })) },
    null,
    2,
  );
  const secrets = findSecrets(resultsJsonl + md + summaryJson);
  if (secrets.length) {
    log(`저장 중단: 결과에 비밀로 보이는 문자열이 있음(${secrets.join(", ")}). 값은 출력하지 않음`);
    process.exitCode = 4;
    return { results, spent, stoppedAll, outDir: null };
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "results.jsonl"), resultsJsonl);
  writeFileSync(join(outDir, "summary.md"), md);
  writeFileSync(join(outDir, "summary.json"), summaryJson);

  for (const { model, s } of results) {
    log(
      `결과 ${model}: 통과율 ${(s.pass_rate * 100).toFixed(1)}% (${s.passed}/${s.runs}), 근거 없음 ${s.no_basis.passed}/${s.no_basis.of}, 함정 ${s.traps.passed}/${s.traps.of}, 형식 오류율 ${(s.format_error_rate * 100).toFixed(1)}%, 문항당 $${s.cost_per_question_usd.toFixed(5)}`,
    );
  }
  log(`누적 비용(토큰×단가) $${spent.toFixed(5)}. 결과: ${outDir}`);
  if (stoppedAll) {
    log(`멈춤: ${stoppedAll} — 문항을 줄이거나 비교할 모델을 빼고 다시 돌리세요`);
    process.exitCode = 3;
  }
  return { results, spent, stoppedAll, outDir };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`평가 실행기 오류: ${err?.message ?? err}`);
    process.exitCode = 1;
  });
}
