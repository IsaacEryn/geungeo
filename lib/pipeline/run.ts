// 파이프라인 진입점. 화면(app/api/ask)과 평가 실행기(scripts/eval)가 같은 함수를 부른다(설계 9-1).
import { loadCache, loadSchoolRules, type LawCache } from "@/lib/cache/load";
import type { LawDocument } from "@/lib/cache/schema";
import { getApiKey, type LinerCallOptions } from "@/lib/liner/client";
import { roundUsd } from "@/lib/liner/cost";
import { analyzeQuestion, ruleBasedAnalysis } from "./analyze";
import { answerQuestion, type AnswerInput } from "./answer";
import { buildCards } from "./cards";
import { collectFromCache, collectSignals, collectWeb, mergeWeb, planWebSearch, schoolRulesInCache, type SignalCollectOutcome } from "./collect";
import { PipelineError, badRequest, toPipelineError } from "./errors";
import { isIsoDate, todayKst } from "./text";
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
  /** 학칙 읽기: auto(기본) = 캐시에 없으면 manifest 방식대로(remote면 law.go.kr에서 받기), cache_only = 캐시에 실린 것만(오프라인 평가) */
  schoolRules?: "auto" | "cache_only";
}

const MAX_QUESTION_LENGTH = 1000;
const DEFAULT_WHERE_TO_CHECK = ["학교 학칙·규정", "학교법인 정관(사립)", "교육부 공고·안내"];

function nowIso(): string {
  return new Date().toISOString();
}

/** 점수 순 상위 법령 이름(L1만, 겹침 없이) */
function topLawNames(candidates: ArticleCandidate[]): string[] {
  const names: string[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (c.grade === "L1" && !names.includes(c.law_name)) names.push(c.law_name);
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

/** 변경 신호는 인용한 조의 법령과 관련된 것 중 최근 2건까지만(11/13 리더 결정) */
export const MAX_CHANGE_SIGNALS = 2;

export function relevantSignals(signals: ChangeSignal[], citations: Citation[], candidates: ArticleCandidate[]): ChangeSignal[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const citedLaws = new Set<string>();
  const citedWeb = new Set<string>();
  for (const c of citations) {
    const cand = byId.get(c.id);
    if (cand) citedLaws.add(cand.law_name.replace(/\s+/g, ""));
    else citedWeb.add(c.id);
  }
  const related = signals.filter((s) => {
    if (citedWeb.has(s.web_id)) return true;
    if (citedLaws.has(s.related_law.replace(/\s+/g, ""))) return true;
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

/** 답변 방식. tools 모드는 미구현(11/13 리더 결정: 만들지 않음) — 값이 와도 fixed 흐름으로 돌고 경고만 붙인다 */
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

  // ① 질문 분석과 그 결과가 필요 없는 일을 겹쳐 돌린다(응답 시간, 11/13 리더 결정).
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
      const missing = signalLaws.filter((name) => name !== preLaw || !keepEarly);
      const extra = missing.length ? await collectSignals(missing, webCtx) : null;
      const parts = [keepEarly, extra].filter((x): x is NonNullable<typeof x> => Boolean(x));
      if (early && !keepEarly) parts.push({ ...early, items: [] }); // 호출 기록·비용은 남긴다
      return combineSignals(parts);
    }),
  ]);
  if (!plan.run) calls.push({ stage: "collect_web", api: "search", duration_ms: 0, note: `건너뜀: ${plan.reason}` });
  calls.push(...web.calls, ...signals.calls);
  if (web.failed + signals.failed > 0) warnings.push("웹 검색 일부가 실패해 법령 데이터 위주로 답했습니다.");
  const merged = mergeWeb(web, signals, cache.collectedAt);
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
    verifyDraft({ draft: answered.draft!, candidates: cached.candidates, web: merged.results, signals: merged.signals, asOf }),
  );
  if (verified.needs_retry && !retried) {
    retried = true;
    const second = await stage("answer", () =>
      answerQuestion({ ...answerInput, feedback: verified.feedback }, { model: options.models?.answer, call }),
    );
    calls.push(second.call);
    if (second.draft) {
      const again = await stage("verify", () =>
        verifyDraft({ draft: second.draft!, candidates: cached.candidates, web: merged.results, signals: merged.signals, asOf }),
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

  const totalCost = roundUsd(calls.reduce((sum, c) => sum + (c.usage?.cost_usd ?? 0), 0));
  return {
    request: { question, asOf, school: requestedSchool, mode },
    data_collected_at: cache.collectedAt,
    scene: analysis.scene,
    verdict: draft.verdict,
    summary: draft.summary,
    cards,
    checklist: draft.checklist,
    caveats: draft.caveats,
    change_signals: relevantSignals(merged.signals, draft.citations, cached.candidates),
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
