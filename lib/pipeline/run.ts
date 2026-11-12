// 파이프라인 진입점. 화면(app/api/ask)과 평가 실행기(scripts/eval)가 같은 함수를 부른다(설계 9-1).
import { loadCache, loadSchoolRules, type LawCache } from "@/lib/cache/load";
import type { LawDocument } from "@/lib/cache/schema";
import { getApiKey, type LinerCallOptions } from "@/lib/liner/client";
import { roundUsd } from "@/lib/liner/cost";
import { analyzeQuestion, ruleBasedAnalysis } from "./analyze";
import { answerQuestion, type AnswerInput } from "./answer";
import { buildCards } from "./cards";
import { collectFromCache, collectNotices, collectSignals, collectWeb, mergeWeb, planWebSearch, schoolRulesInCache, type MergedWeb, type SignalCollectOutcome } from "./collect";
import { PipelineError, badRequest, toPipelineError } from "./errors";
import { formatKoreanDate, isIsoDate, mentionsDate, todayKst } from "./text";
import type { AgentMode, ArticleCandidate, AskRequest, AskResult, ChangeSignal, Citation, SearchedScope, StageEvent, StageName, TraceCall } from "./types";
import { verifyDraft } from "./verify";

export interface RunOptions {
  /** 단계 이벤트(상태 메시지·스트리밍). 결과는 반환값으로도 온다 */
  onEvent?: (event: StageEvent) => void;
  /** 요청 취소 */
  signal?: AbortSignal;
  /** 미리 읽은 캐시. 생략하면 loadCache()로 읽는다 */
  cache?: LawCache;
  /** 평가 실행기용: Search 대신 tests/fixtures/search/의 고정 응답을 쓴다 */
  searchFixtureDir?: string;
  /** 평가 실행기용: 단계별 모델 덮어쓰기(비우면 LINER_MODEL_* 환경변수, 그다음 liner-mark-1.3) */
  models?: { analyze?: string; answer?: string };
  /** 요청의 mode보다 우선 */
  mode?: AgentMode;
  /** 시험용: Liner 호출의 fetch 바꿔 끼우기(계약 밖 선택 항목) */
  fetchImpl?: typeof fetch;
  /** 학칙 읽기: auto(기본) = 캐시에 없으면 data/rules/ 파일을 다시 읽기(law.go.kr은 부르지 않음), cache_only = 캐시에 실린 것만(오프라인 평가) */
  schoolRules?: "auto" | "cache_only";
}

const MAX_QUESTION_LENGTH = 1000;
const DEFAULT_WHERE_TO_CHECK = ["학교 학칙·규정", "학교법인 정관(사립)", "교육부 공고·안내"];

function nowIso(): string {
  return new Date().toISOString();
}

/** 부칙 문서("고등교육법 부칙 <법률 제20250호, …>")는 본법 이름으로 묶는다(변경 신호 검색어에 부칙 표기가 들어가지 않게) */
export function baseLawName(name: string): string {
  return name.replace(/\s*부칙\s*<.*$/, "").trim() || name;
}

/** 점수 순 상위 법령 이름(L1만, 부칙은 본법으로, 겹침 없이) */
export function topLawNames(candidates: ArticleCandidate[]): string[] {
  const names: string[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    const name = baseLawName(c.law_name);
    if (c.grade === "L1" && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 지정 학교 학칙: 캐시에 실려 있으면 그것, 아니면 loadSchoolRules(실패하면 null) */
async function readSchoolRules(
  cache: LawCache,
  school: NonNullable<AskRequest["school"]>,
  how: RunOptions["schoolRules"] = "auto",
): Promise<LawDocument | null> {
  const inCache = schoolRulesInCache(cache, school);
  if (inCache || how === "cache_only") return inCache;
  try {
    return await loadSchoolRules(school);
  } catch {
    return null;
  }
}

/** ②-c 결과 여럿을 하나로 */
function combineSignals(parts: SignalCollectOutcome[]): SignalCollectOutcome {
  const lawByQuery = new Map<string, string>();
  for (const p of parts) for (const [q, law] of p.lawByQuery) lawByQuery.set(q, law);
  return {
    items: parts.flatMap((p) => p.items),
    calls: parts.flatMap((p) => p.calls),
    queries: parts.flatMap((p) => p.queries),
    failed: parts.reduce((n, p) => n + p.failed, 0),
    lawByQuery,
  };
}

/** 같은 게시글인지: 주소가 같거나, 같은 호스트에서 게시글 번호(boardSeq 등)가 같으면 */
export function sameDocument(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.hostname.replace(/^www\./, "") !== ub.hostname.replace(/^www\./, "")) return false;
    for (const key of ["boardSeq", "lawSeq", "seq", "no"]) {
      const va = ua.searchParams.get(key);
      if (va && va === ub.searchParams.get(key)) return true;
    }
    return ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return false;
  }
}

/** 변경 신호는 인용한 조의 법령과 관련된 것 중 최근 2건까지만(화면이 길어지지 않게) */
export const MAX_CHANGE_SIGNALS = 2;

export function relevantSignals(signals: ChangeSignal[], citations: Citation[], candidates: ArticleCandidate[]): ChangeSignal[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const citedLaws = new Set<string>();
  const citedWeb = new Set<string>();
  for (const c of citations) {
    const cand = byId.get(c.id);
    if (cand) citedLaws.add(baseLawName(cand.law_name).replace(/\s+/g, ""));
    else citedWeb.add(c.id);
  }
  const related = signals.filter((s) => {
    if (citedWeb.has(s.web_id)) return true;
    if (citedLaws.has(s.related_law.replace(/\s+/g, ""))) return true;
    // 제목이 낫표로 법령 이름을 적었으면 그 이름과 똑같아야 한다(「고등교육법 시행령」 입법예고를 고등교육법 인용에 붙이지 않게)
    const quoted = [...s.title.matchAll(/[「｢『]([^」｣』]+)[」｣』]/g)].map((m) => m[1].replace(/\s+/g, ""));
    if (quoted.length) return [...citedLaws].some((law) => quoted.includes(law));
    const title = s.title.replace(/\s+/g, "");
    return [...citedLaws].some((law) => title.includes(law));
  });
  // 날짜가 있는 것을 최근 순으로, 날짜 모르는 것은 뒤로(같으면 원래 순서)
  return related
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.date ?? "").localeCompare(a.s.date ?? "") || a.i - b.i)
    .slice(0, MAX_CHANGE_SIGNALS)
    .map((x) => x.s);
}

/** 답변 방식. tools 모드는 만들지 않았다 — 값이 와도 fixed 흐름으로 돌고 경고만 붙인다 */
function resolveMode(request: AskRequest, options: RunOptions): AgentMode {
  const raw = options.mode ?? request.mode ?? process.env.AGENT_MODE;
  return raw === "tools" ? "tools" : "fixed";
}

/** 질문 하나를 ①~⑤ 단계로 처리해 결과를 돌려준다. 근거가 없으면 verdict "no_basis"로 끝난다(예외 아님) */
export async function runPipeline(request: AskRequest, options: RunOptions = {}): Promise<AskResult> {
  const emit = (event: StageEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // 화면 쪽 처리 오류가 파이프라인을 멈추지 않게
    }
  };
  try {
    return await run(request, options, emit);
  } catch (error) {
    const pe = toPipelineError(error);
    emit({ type: "error", code: pe.code, message: pe.message });
    throw pe;
  }
}

async function run(request: AskRequest, options: RunOptions, emit: (e: StageEvent) => void): Promise<AskResult> {
  const started = Date.now();
  const question = typeof request?.question === "string" ? request.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) throw badRequest("질문을 1~1000자로 입력해 주세요.");
  if (request.asOf !== undefined && request.asOf !== null && !isIsoDate(request.asOf)) {
    throw badRequest("기준일은 YYYY-MM-DD 형식으로 입력해 주세요.");
  }
  const asOf = request.asOf || todayKst();
  const requestedSchool = request.school ?? null;
  const mode = resolveMode(request, options);
  getApiKey(); // 키가 없으면 여기서 missing_api_key

  const call: LinerCallOptions = { signal: options.signal, fetchImpl: options.fetchImpl };
  const calls: TraceCall[] = [];
  const warnings: string[] = [];

  async function stage<T>(name: StageName, fn: () => Promise<T> | T): Promise<T> {
    const t = Date.now();
    emit({ type: "stage_start", stage: name, at: nowIso() });
    try {
      const value = await fn();
      emit({ type: "stage_end", stage: name, at: nowIso(), duration_ms: Date.now() - t, ok: true });
      return value;
    } catch (error) {
      emit({ type: "stage_end", stage: name, at: nowIso(), duration_ms: Date.now() - t, ok: false });
      throw error;
    }
  }

  let cache: LawCache;
  try {
    cache = options.cache ?? (await loadCache());
  } catch {
    throw new PipelineError("internal", "법령 데이터를 읽지 못했습니다. data/ 폴더를 확인해 주세요.");
  }

  // ① 질문 분석과 그 결과가 필요 없는 일을 겹쳐 돌린다(응답 시간 단축).
  //  - 질문 글만으로 캐시를 미리 찾아(규칙 기반 검색어, 로컬이라 수 ms) 상위 법령의 변경 신호 검색(②-c)을 먼저 띄운다
  //  - 화면에서 학교를 골랐으면 학칙 읽기도 먼저 띄운다
  // 단계 이벤트(화면 진행 표시)는 예전 순서 그대로 보낸다. 실제 소요 시간은 처리 과정(trace)에 남는다.
  const webCtx = { searchFixtureDir: options.searchFixtureDir, call };
  const preAnalysis = ruleBasedAnalysis(question, cache.synonyms);
  const preCache = collectFromCache({ question, analysis: preAnalysis, asOf, cache, schoolRules: null });
  const preLaw = topLawNames(preCache.candidates)[0];
  const earlySignals = preLaw ? collectSignals([preLaw], webCtx) : null;
  earlySignals?.catch(() => undefined); // ①이 먼저 실패해도 처리 안 된 거부가 남지 않게
  const earlyRules = requestedSchool ? readSchoolRules(cache, requestedSchool, options.schoolRules) : null;

  const analyzed = await stage("analyze", () =>
    analyzeQuestion({ ...request, question }, asOf, { synonyms: cache.synonyms, model: options.models?.analyze, call }),
  );
  calls.push(analyzed.call);
  const analysis = analyzed.analysis;
  // 모델 호출이 실패했거나 형식이 맞지 않아 규칙으로 대신했으면 화면에도 알린다(처리 과정 기록만으로는 구별이 어렵다)
  if (analysis.fallback) warnings.push("질문 분석은 규칙으로 대신했습니다.");
  const school = requestedSchool ?? analysis.school ?? null;

  let schoolRules: LawDocument | null = null;
  if (school) {
    schoolRules = await (school === requestedSchool && earlyRules ? earlyRules : readSchoolRules(cache, school, options.schoolRules));
    if (!schoolRules) warnings.push("지정한 학교의 학칙을 읽지 못했습니다. 학칙은 학교 원문에서 확인해 주세요.");
  }

  // ②-a 캐시 조문
  const cached = await stage("collect_cache", () =>
    collectFromCache({ question, analysis, asOf, cache, schoolRules }),
  );
  calls.push(cached.call);

  // ②-b·②-c 병렬. ②-c는 먼저 띄운 검색을 받고, 모자란 법령만 더 부른다
  const plan = planWebSearch(analysis, cached.topScore, cached.candidates.length);
  const lawNames = topLawNames(cached.candidates);
  const signalLaws = lawNames.slice(0, analysis.needs_external ? 2 : 1);
  const [web, signals] = await Promise.all([
    stage("collect_web", () => collectWeb(plan, webCtx)),
    stage("collect_signals", async () => {
      const early = earlySignals ? await earlySignals : null;
      // 먼저 찾은 법령이 상위 두 법령 안이면 쓰고, 아니면 버린다(호출 1회 손해)
      const keepEarly = early && preLaw && lawNames.slice(0, 2).includes(preLaw) ? early : null;
      // 먼저 받은 법령도 한 자리로 센다(호출 수가 예전보다 늘지 않게)
      const missing = keepEarly
        ? signalLaws.filter((name) => name !== preLaw).slice(0, Math.max(0, signalLaws.length - 1))
        : signalLaws;
      const extra = missing.length ? await collectSignals(missing, webCtx) : null;
      const parts = [keepEarly, extra].filter((x): x is NonNullable<typeof x> => Boolean(x));
      if (early && !keepEarly) parts.push({ ...early, items: [] }); // 호출 기록·비용은 남긴다
      return combineSignals(parts);
    }),
  ]);
  if (!plan.run) calls.push({ stage: "collect_web", api: "search", duration_ms: 0, note: `건너뜀: ${plan.reason}` });
  calls.push(...web.calls, ...signals.calls);
  if (web.failed + signals.failed > 0) warnings.push("웹 검색 일부가 실패해 법령 데이터 위주로 답했습니다.");
  const mergedWeb = mergeWeb(web, signals, cache.collectedAt);
  // 공고 캐시: 원문에서 확인한 공고(와 확인 못 한 공고의 "원문 확인 필요")를 웹 근거에 붙인다. 같은 게시글의 검색 결과는 뺀다
  const noticeOut = collectNotices({
    cache,
    question,
    analysis,
    asOf,
    candidates: cached.candidates,
    delegations: cached.notices,
    signalLaws: lawNames.slice(0, 2),
  });
  const merged: MergedWeb = {
    results: [...noticeOut.results, ...mergedWeb.results.filter((w) => !noticeOut.results.some((n) => sameDocument(n.url, w.url)))],
    signals: [],
  };
  merged.signals = [...noticeOut.signals, ...mergedWeb.signals.filter((s) => merged.results.some((w) => w.id === s.web_id))];
  if (noticeOut.results.length) {
    calls.push({ stage: "collect_web", api: "cache", query: "공고 캐시", duration_ms: 0, note: `공고 ${noticeOut.results.length}건` });
  }
  if (mode === "tools") warnings.push("tools 모드는 미구현이라 기본 흐름(fixed)으로 답했습니다.");

  // ③ 대조·답변 → ④ 검증(위반이 크면 ③을 한 번 더)
  const answerInput: AnswerInput = {
    question,
    asOf,
    school,
    analysis,
    candidates: cached.candidates,
    web: merged.results,
    signals: merged.signals,
    notices: cached.notices,
  };
  const noticeDelegated = cached.notices.map((n) => n.from);
  let answered = await stage("answer", () => answerQuestion(answerInput, { model: options.models?.answer, call }));
  calls.push(answered.call);
  let retried = false;
  if (!answered.draft) {
    retried = true;
    answered = await stage("answer", () =>
      answerQuestion({ ...answerInput, feedback: "앞 답이 JSON 형식에 맞지 않았습니다. 스키마대로 다시 답하세요." }, { model: options.models?.answer, call }),
    );
    calls.push(answered.call);
  }
  if (!answered.draft) {
    throw new PipelineError("liner_unavailable", "모델 응답 형식이 맞지 않아 답을 만들지 못했습니다. 다시 시도해 주세요.");
  }

  let verified = await stage("verify", () =>
    verifyDraft({ draft: answered.draft!, candidates: cached.candidates, web: merged.results, signals: merged.signals, asOf, question, noticeDelegated }),
  );
  if (verified.needs_retry && !retried) {
    retried = true;
    const second = await stage("answer", () =>
      answerQuestion({ ...answerInput, feedback: verified.feedback }, { model: options.models?.answer, call }),
    );
    calls.push(second.call);
    if (second.draft) {
      const again = await stage("verify", () =>
        verifyDraft({ draft: second.draft!, candidates: cached.candidates, web: merged.results, signals: merged.signals, asOf, question, noticeDelegated }),
      );
      // 재시도 결과는 지어낸 인용이 줄었을 때만 쓴다. 평가 채점 4번을 위해 처음 제거 수도 합산한다
      if (again.removed_citations <= verified.removed_citations) {
        verified = { ...again, removed_citations: again.removed_citations + verified.removed_citations, verdict_before: verified.verdict_before };
      }
    }
  }

  const draft = verified.draft;
  let searchedScope: SearchedScope | null = null;
  if (draft.verdict === "no_basis") {
    const laws = [...new Set([...(draft.searched_scope?.laws ?? []), ...cached.candidates.map((c) => c.law_name)])];
    const queries = [...new Set([...cached.queries.slice(1), ...web.queries, ...signals.queries])];
    const where = [...new Set([...(draft.searched_scope?.where_to_check ?? []), ...DEFAULT_WHERE_TO_CHECK])];
    searchedScope = { laws, queries, where_to_check: where };
  }

  const cards = buildCards({
    citations: draft.citations,
    candidates: cached.candidates,
    web: merged.results,
    signals: merged.signals,
    cache,
  });

  // 인용한 법령에 입법예고(확정 전)가 걸려 있는데 결론이 말하지 않았으면 확인 사항에 붙인다
  const changeSignals = relevantSignals(merged.signals, draft.citations, cached.candidates);
  const caveats = [...draft.caveats];
  for (const s of changeSignals) {
    if (s.kind !== "legislative_notice" || caveats.some((c) => c.includes(s.title))) continue;
    if (s.opinion_deadline ? mentionsDate(draft.summary, s.opinion_deadline) : /입법\s*예고/.test(draft.summary)) continue;
    caveats.push(
      `${s.title}${s.date ? `(${formatKoreanDate(s.date)})` : ""}이 진행 중입니다. 확정·시행 전이며${s.opinion_deadline ? ` 의견 제출은 ${formatKoreanDate(s.opinion_deadline)}까지입니다` : " 의견 제출 기한은 원문을 확인해 주세요"}. 인용한 조가 바뀌는지 원문을 확인해 주세요.`,
    );
    break;
  }

  const totalCost = roundUsd(calls.reduce((sum, c) => sum + (c.usage?.cost_usd ?? 0), 0));
  return {
    request: { question, asOf, school: requestedSchool, mode },
    data_collected_at: cache.collectedAt,
    scene: analysis.scene,
    verdict: draft.verdict,
    summary: draft.summary,
    cards,
    checklist: draft.checklist,
    caveats,
    change_signals: changeSignals,
    searched_scope: searchedScope,
    warnings: [...warnings, ...verified.warnings],
    verification: {
      issues: verified.issues,
      removed_citations: verified.removed_citations,
      retried,
      verdict_before: verified.verdict_before,
      verdict_after: verified.verdict_after,
    },
    trace: {
      calls,
      total_duration_ms: Date.now() - started,
      total_cost_usd: totalCost,
      models: { analyze: analyzed.model, answer: answered.model },
    },
  };
}
