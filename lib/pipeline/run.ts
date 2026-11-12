// 파이프라인 진입점. 화면(app/api/ask)과 평가 실행기(scripts/eval)가 같은 함수를 부른다(설계 9-1).
import { loadCache, loadSchoolRules, type LawCache } from "@/lib/cache/load";
import type { LawDocument } from "@/lib/cache/schema";
import { getApiKey, type LinerCallOptions } from "@/lib/liner/client";
import { roundUsd } from "@/lib/liner/cost";
import { analyzeQuestion } from "./analyze";
import { answerQuestion, type AnswerInput } from "./answer";
import { buildCards } from "./cards";
import { collectFromCache, collectSignals, collectWeb, mergeWeb, planWebSearch, schoolRulesInCache } from "./collect";
import { PipelineError, badRequest, toPipelineError } from "./errors";
import { isIsoDate, todayKst } from "./text";
import type { AgentMode, AskRequest, AskResult, SearchedScope, StageEvent, StageName, TraceCall } from "./types";
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
}

const MAX_QUESTION_LENGTH = 1000;
const DEFAULT_WHERE_TO_CHECK = ["학교 학칙·규정", "학교법인 정관(사립)", "교육부 공고·안내"];

function nowIso(): string {
  return new Date().toISOString();
}

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

  // ① 질문 분석
  const analyzed = await stage("analyze", () =>
    analyzeQuestion({ ...request, question }, asOf, { synonyms: cache.synonyms, model: options.models?.analyze, call }),
  );
  calls.push(analyzed.call);
  const analysis = analyzed.analysis;
  const school = requestedSchool ?? analysis.school ?? null;

  let schoolRules: LawDocument | null = null;
  if (school) {
    schoolRules = schoolRulesInCache(cache, school);
    if (!schoolRules) {
      try {
        schoolRules = await loadSchoolRules(school);
      } catch {
        schoolRules = null;
      }
    }
    if (!schoolRules) warnings.push("지정한 학교의 학칙을 읽지 못했습니다. 학칙은 학교 원문에서 확인해 주세요.");
  }

  // ②-a 캐시 조문
  const cached = await stage("collect_cache", () =>
    collectFromCache({ question, analysis, asOf, cache, schoolRules }),
  );
  calls.push(cached.call);

  // ②-b·②-c 병렬
  const plan = planWebSearch(analysis, cached.topScore, cached.candidates.length);
  const lawNames: string[] = [];
  for (const c of [...cached.candidates].sort((a, b) => b.score - a.score)) {
    if (c.grade === "L1" && !lawNames.includes(c.law_name)) lawNames.push(c.law_name);
  }
  const signalLaws = lawNames.slice(0, analysis.needs_external ? 2 : 1);
  const [web, signals] = await Promise.all([
    stage("collect_web", () => collectWeb(plan, { searchFixtureDir: options.searchFixtureDir, call })),
    stage("collect_signals", () => collectSignals(signalLaws, { searchFixtureDir: options.searchFixtureDir, call })),
  ]);
  if (!plan.run) calls.push({ stage: "collect_web", api: "search", duration_ms: 0, note: `건너뜀: ${plan.reason}` });
  calls.push(...web.calls, ...signals.calls);
  if (web.failed + signals.failed > 0) warnings.push("웹 검색 일부가 실패해 법령 데이터 위주로 답했습니다.");
  const merged = mergeWeb(web, signals, cache.collectedAt);
  if (mode === "tools") warnings.push("심화 찾기(tools) 모드는 준비 중이라 기본 흐름으로 답했습니다.");

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
    change_signals: merged.signals,
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
