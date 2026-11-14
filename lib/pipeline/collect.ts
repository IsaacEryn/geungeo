// ② 근거 수집(설계 2-2). ②-a 캐시 조문 검색 → ②-b 공고·안내 검색과 ②-c 변경 신호를 병렬로.
import { checkedNotices, type LawCache, type NoticeEntry } from "@/lib/cache/load";
import type { LawArticle, LawDocument, SchoolId } from "@/lib/cache/schema";
import { ArticleIndex, expandSynonyms, type SearchHit } from "@/lib/cache/index";
import { followDelegations, followUpward } from "@/lib/cache/links";
import { resolveVersions } from "@/lib/cache/status";
import { duplicatesOfOriginals, gradeWebResult } from "@/lib/grade";
import { SEARCH_COST_USD } from "@/lib/liner/cost";
import { LinerError, type LinerCallOptions } from "@/lib/liner/client";
import { searchWeb, type RawSearchResult, type SearchQuery } from "@/lib/liner/search";
import type { ArticleCandidate, ChangeSignal, QuestionAnalysis, TraceCall, WebResult } from "./types";
import { bigrams } from "./text";
import { conceptHits, conceptTerms, mentionsAnyConcept, rareConceptTerms, restrictingArticles, type RestrictionArticle } from "./concepts";

// ───────── ②-a 캐시 ─────────

const lawIndexCache = new WeakMap<LawCache, ArticleIndex>();

/** 학칙을 뺀 법령 색인(캐시 객체마다 한 번 만든다) */
export function lawIndexFor(cache: LawCache): ArticleIndex {
  let index = lawIndexCache.get(cache);
  if (!index) {
    index = new ArticleIndex([...cache.laws.values()].filter((l) => l.kind !== "school_rule"));
    lawIndexCache.set(cache, index);
  }
  return index;
}

/** 캐시 안에 들어 있는 지정 학교 학칙(③이 data/rules/를 laws에 같이 올린 경우) */
export function schoolRulesInCache(cache: LawCache, school: SchoolId): LawDocument | null {
  return [...cache.laws.values()].find((l) => l.kind === "school_rule" && l.school === school) ?? null;
}

export interface CacheCollectInput {
  question: string;
  analysis: QuestionAnalysis;
  asOf: string;
  cache: LawCache;
  schoolRules: LawDocument | null;
  /** 조 후보 수 상한(판 펼치기 전, 위임 사슬로 더한 조는 따로). 기본 DEFAULT_CANDIDATE_LIMIT */
  limit?: number;
}

export interface CacheCollectOutcome {
  candidates: ArticleCandidate[];
  call: TraceCall;
  topScore: number;
  /** 공고 위임("교육부장관이 정하여 공고") */
  notices: { from: string; issuer: string; phrase: string }[];
  /** 검색에 쓴 말 */
  queries: string[];
}

/** ③에 넣는 조 후보 수(검색으로 고른 것). 8개에서 5개로 줄였다(③ 프롬프트를 줄여 응답 시간 단축) */
export const DEFAULT_CANDIDATE_LIMIT = 5;

/** 캐시 점수가 이보다 낮으면 ②-b 웹 검색을 부른다(설계 2-2: 캐시 상위 점수가 낮을 때) */
export const LOW_CACHE_SCORE = 8;

/**
 * 판 본문 머리("제11조의2(평가 등) ① …")에서 그 판의 조 제목을 읽는다. 못 읽으면 fallback(최신 판 제목).
 * 조 번호가 그대로인 채 내용이 바뀐 조(제11조의2: 평가 등 → 기숙사비 및 기숙사비심의위원회)에서 옛 판에 새 제목이 붙지 않게 한다.
 */
export function versionTitle(text: string, fallback: string): string {
  const m = /^\s*제\d+조(?:의\d+)?\((.+?)\)(?=\s|$)/.exec(text);
  return m ? m[1] : fallback;
}

/** 검색 점수와 상관없이 더 넣는 조(개념어가 원문에 나오는 조 + 적용 제외 조)의 상한 */
export const CONCEPT_EXTRA_LIMIT = 3;
/** 개념어가 이보다 많은 조에 나오면 그 개념어로는 조를 더 넣지 않는다(흔한 말이면 주제를 가르지 못한다) */
export const CONCEPT_DIRECT_MAX_ARTICLES = 3;

const restrictionArticleCache = new WeakMap<ArticleIndex, RestrictionArticle[]>();

/** 색인한 법령 조 전부(모든 판의 원문을 합침) */
function restrictionArticles(index: ArticleIndex): RestrictionArticle[] {
  let list = restrictionArticleCache.get(index);
  if (!list) {
    list = [...index.byId.values()].map(({ article, law }) => ({
      id: article.id,
      law_id: law.law_id,
      number: article.number,
      text: [...new Set(article.versions.map((v) => v.text))].join("\n"),
    }));
    restrictionArticleCache.set(index, list);
  }
  return list;
}

export interface ConceptExtra {
  id: string;
  /** 적용 제외 조로 넣었으면 그 제외가 가리키는 조 ID */
  restricts?: string;
}

/**
 * 개념어 직접 등장 조가 담아야 하는 ① 개념어 수(흔한 말 포함, 서로 다른 개념어). 드문 낱말 하나만 우연히 들어 있는 조
 * (다른 위원회의 '위원 구성', 다른 절차의 '회의 소집')가 들어오지 않게 한다
 */
export const CONCEPT_DIRECT_MIN_CONCEPTS = 2;
/** 개념어 직접 등장 조끼리 질문 관련도를 견줄 때의 하한(가장 높은 조 점수 대비) */
export const CONCEPT_DIRECT_RELATIVE = 0.5;
/** 더 넣는 조 가운데 개념어 직접 등장 조의 몫(나머지는 적용 제외 조) */
export const CONCEPT_DIRECT_SLOT = 2;

/**
 * ① 검색어가 매번 달라 후보가 흔들리지 않게, 검색 점수와 상관없이 두 가지 조를 더 넣는다.
 *  1) ①이 뽑은 개념어(동의어 포함)가 원문에 직접 나오는 조. 개념어가 CONCEPT_DIRECT_MAX_ARTICLES개 넘는 조에 나오면
 *     그 개념어로는 넣지 않는다. 그 조에 ① 개념어가 CONCEPT_DIRECT_MIN_CONCEPTS개 이상 함께 나와야 한다. 여럿이면 질문과 더 가까운(검색 점수가 높은) 조부터 CONCEPT_DIRECT_SLOT개(CONCEPT_DIRECT_RELATIVE 하한).
 *  2) 검색으로 고른 조와 1)의 조를 같은 법령 안에서 가리키며 "적용하지 아니한다", "…는 제외한다"고 한 조.
 * 합쳐 CONCEPT_EXTRA_LIMIT개까지. 규칙 기반 대체 분석(질문 낱말을 그대로 자른 것)에는 쓰지 않는다.
 */
export function conceptExtras(input: {
  analysis: QuestionAnalysis;
  index: ArticleIndex;
  /** 질문(관련도 순위에 쓴다) */
  question: string;
  searched: string[];
  exclude: Set<string>;
  synonyms?: LawCache["synonyms"];
  limit?: number;
}): ConceptExtra[] {
  const limit = input.limit ?? CONCEPT_EXTRA_LIMIT;
  if (input.analysis.fallback || limit <= 0) return [];
  const all = restrictionArticles(input.index);
  const out: ConceptExtra[] = [];
  const taken = new Set(input.exclude);
  const push = (e: ConceptExtra, cap: number) => {
    if (out.length >= cap || taken.has(e.id)) return;
    taken.add(e.id);
    out.push(e);
  };
  const hitIds = new Set<string>();
  const termGroups = [...new Map(input.analysis.concepts.map((c) => conceptTerms(c, input.synonyms)).filter((t) => t.length).map((t) => [t[0], t])).values()];
  const textOf = new Map(all.map((a) => [a.id, a.text]));
  for (const hit of conceptHits(input.analysis.concepts, all, input.synonyms)) {
    if (hit.ids.length < 1 || hit.ids.length > CONCEPT_DIRECT_MAX_ARTICLES) continue;
    for (const id of hit.ids) {
      const text = textOf.get(id) ?? "";
      if (termGroups.filter((t) => mentionsAnyConcept(text, [t])).length >= CONCEPT_DIRECT_MIN_CONCEPTS) hitIds.add(id);
    }
  }
  const query = expandSynonyms([input.question, ...input.analysis.concepts].join(" "), input.synonyms);
  // 질문과 가까운 순. 가장 가까운 조 점수의 CONCEPT_DIRECT_RELATIVE 배에 못 미치면 넣지 않는다(흔한 수식어가 든 엉뚱한 조)
  const scored = input.index.search(query, { limit: hitIds.size || 1, filter: (id) => hitIds.has(id) });
  const floor = (scored[0]?.score ?? 0) * CONCEPT_DIRECT_RELATIVE;
  const direct = scored.filter((h) => h.score >= floor).map((h) => h.id);
  for (const id of direct) push({ id }, Math.min(limit, CONCEPT_DIRECT_SLOT));
  const byId = new Map(all.map((a) => [a.id, a]));
  for (const targetId of [...input.searched, ...out.map((e) => e.id)]) {
    const target = byId.get(targetId);
    if (!target) continue;
    const sameLaw = all.filter((a) => a.law_id === target.law_id);
    for (const id of restrictingArticles(target, sameLaw)) push({ id, restricts: target.id }, limit);
  }
  return out;
}

/** ④ 대조용: ①이 뽑은 개념어 가운데 법령 조문에 드물게 나오는 말과 그 동의어. 규칙 기반 대체 분석이면 빈 배열 */
export function rareConceptTermsFor(cache: LawCache, analysis: QuestionAnalysis): string[][] {
  if (analysis.fallback) return [];
  return rareConceptTerms(conceptHits(analysis.concepts, restrictionArticles(lawIndexFor(cache)), cache.synonyms));
}

/** 학교를 지정했을 때 학칙 색인에서 따로 넣는 조 수(법령 상위 조와 점수를 겨루지 않게) */
export const SCHOOL_RULE_SLOT = 3;

type Ranked = SearchHit & { hitsCount: number };

/** 여러 검색어 결과를 합쳐 순위를 매기고, 상위 점수의 25% 미만은 버린 뒤 limit개 */
function rankHits(scores: Map<string, Ranked>, limit: number): { chosen: Ranked[]; top: number } {
  // 여러 검색어에서 함께 나온 조를 조금 올린다
  const ranked = [...scores.values()]
    .map((h) => ({ ...h, score: h.score * (1 + 0.1 * Math.min(h.hitsCount - 1, 3)) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.find((h) => h.via === "search")?.score ?? (ranked.length ? ranked[0].score : 0);
  // 상위 점수의 25% 미만은 버린다(관계 적은 조가 프롬프트를 채우지 않게)
  const floor = top * 0.25;
  return { chosen: ranked.filter((h) => h.via === "direct" || h.score >= floor).slice(0, limit), top };
}

export function collectFromCache(input: CacheCollectInput): CacheCollectOutcome {
  const started = Date.now();
  const { cache, analysis, asOf } = input;
  const lawIndex = lawIndexFor(cache);
  const schoolIndex = input.schoolRules ? new ArticleIndex([input.schoolRules]) : null;
  const lookupRef = (id: string): { article: LawArticle; law: LawDocument } | undefined =>
    lawIndex.byId.get(id) ?? schoolIndex?.byId.get(id);

  const queries = [...new Set([input.question, ...analysis.queries_cache])];
  const searchIndex = (index: ArticleIndex): Map<string, Ranked> => {
    const scores = new Map<string, Ranked>();
    const add = (hit: SearchHit) => {
      const prev = scores.get(hit.id);
      if (!prev) scores.set(hit.id, { ...hit, hitsCount: 1 });
      else {
        prev.score = Math.max(prev.score, hit.score);
        prev.hitsCount += 1;
        if (hit.via === "direct") prev.via = "direct";
      }
    };
    for (const hit of index.direct(input.question)) add(hit);
    for (const q of queries) {
      const expanded = expandSynonyms(q, cache.synonyms);
      for (const hit of index.search(expanded, { limit: 20, boost: analysis.concepts })) add(hit);
    }
    return scores;
  };

  // 법령 상위 limit개와 학칙 상위 SCHOOL_RULE_SLOT개를 따로 고른다.
  // 학칙 색인은 조 몇 개짜리라 BM25 점수가 법령 색인과 견줄 수 없어서, 한 줄로 세우면 학칙 조가 밀려난다.
  const law = rankHits(searchIndex(lawIndex), input.limit ?? DEFAULT_CANDIDATE_LIMIT);
  const school = schoolIndex ? rankHits(searchIndex(schoolIndex), SCHOOL_RULE_SLOT) : { chosen: [], top: 0 };
  const chosen = [...law.chosen, ...school.chosen];
  const topScore = Math.max(law.top, school.top);

  const lawStart = law.chosen.map((h) => lookupRef(h.id)?.article).filter((a): a is LawArticle => Boolean(a));
  const schoolStart = school.chosen.map((h) => lookupRef(h.id)?.article).filter((a): a is LawArticle => Boolean(a));
  const delegation = followDelegations([...lawStart.slice(0, 5), ...schoolStart], (id) => lookupRef(id)?.article, {
    schoolRules: input.schoolRules,
    schoolIndex,
  });

  const entries: { id: string; score: number; via: ArticleCandidate["via"] }[] = chosen.map((h) => ({
    id: h.id,
    score: h.score,
    via: h.via,
  }));
  for (const id of [...delegation.articles.keys(), ...delegation.schoolArticles.keys()]) {
    if (!entries.some((e) => e.id === id)) entries.push({ id, score: 0, via: "delegation" });
  }

  // 위로 거슬러 올라가기: 학칙·훈령·시행령 조에서 그 조에 맡긴 상위 조로
  // 학칙 쪽은 검색으로 고른 조에서만 올라간다(법령 위임 문구로 끌려온 학칙 조는 주제가 느슨하다)
  const upwardStart = entries
    .filter((e) => !delegation.schoolArticles.has(e.id))
    .map((e) => lookupRef(e.id))
    .filter((r): r is { article: LawArticle; law: LawDocument } => Boolean(r));
  const upward = followUpward(upwardStart, lawIndex.byId, { exclude: new Set(entries.map((e) => e.id)) });
  for (const id of [...upward.articles.keys(), ...upward.scope.keys()]) {
    if (!entries.some((e) => e.id === id)) entries.push({ id, score: 0, via: "delegation" });
  }
  // 개념어가 원문에 나오는 조와 적용 제외 조(검색 점수와 상관없이)
  const extras = conceptExtras({
    analysis,
    index: lawIndex,
    question: input.question,
    searched: law.chosen.map((h) => h.id),
    exclude: new Set(entries.map((e) => e.id)),
    synonyms: cache.synonyms,
  });
  const restrictsOf = new Map(extras.filter((e) => e.restricts).map((e) => [e.id, e.restricts!]));
  for (const e of extras) entries.push({ id: e.id, score: 0, via: "concept" });
  const entryIds = new Set(entries.map((e) => e.id));
  const upperOf = (id: string) =>
    upward.relations.filter((r) => r.from === id && entryIds.has(r.upper)).map((r) => ({ id: r.upper, phrase: r.phrase, quote: r.quote }));
  const lowerOf = (id: string) => [...new Set(upward.relations.filter((r) => r.upper === id && entryIds.has(r.from)).map((r) => r.from))];
  const lookup = lookupRef;

  const candidates: ArticleCandidate[] = [];
  for (const entry of entries) {
    const found = lookup(entry.id);
    if (!found) continue;
    const { article, law } = found;
    const versions = resolveVersions(article, asOf);
    const hasCurrent = versions.some((v) => v.status === "in_force");
    for (const { version, status } of versions) {
      const amended = article.versions.some((v) => v.effective_from < version.effective_from);
      // 시행 중인 판이 따로 있으면 예정 판은 "<조 ID>@<시행일>"로 구분한다(같은 조의 두 판을 따로 인용하게)
      const id = hasCurrent && status === "not_yet" ? `${article.id}@${version.effective_from}` : article.id;
      candidates.push({
        id,
        law_id: law.law_id,
        law_name: law.law_name,
        kind: law.kind,
        number: article.number,
        title: versionTitle(version.text, article.title),
        text: version.text,
        effective_from: version.effective_from,
        effective_to: version.effective_to,
        status,
        grade: law.kind === "school_rule" ? "L2" : "L1",
        source_url: version.source_url,
        score: Math.round(entry.score * 100) / 100,
        via: entry.via,
        delegated_to_school_rule: delegation.schoolRuleDelegated.has(article.id),
        ...(article.excerpt?.note ? { excerpt_note: article.excerpt.note } : {}),
        ...(amended ? { amended } : {}),
        ...(upperOf(article.id).length ? { upper: upperOf(article.id) } : {}),
        ...(lowerOf(article.id).length ? { upper_of: lowerOf(article.id) } : {}),
        ...(upward.scope.has(article.id) ? { scope_of: upward.scope.get(article.id) } : {}),
        ...(restrictsOf.has(article.id) ? { restricts: restrictsOf.get(article.id) } : {}),
      });
    }
  }

  return {
    candidates,
    topScore,
    notices: delegation.notices,
    queries,
    call: {
      stage: "collect_cache",
      api: "cache",
      query: queries.slice(1).join(" | ") || queries[0],
      duration_ms: Date.now() - started,
      note: `조 ${chosen.length}개(학칙 ${school.chosen.length}), 위임 ${delegation.articles.size + delegation.schoolArticles.size}개, 상위 ${upward.articles.size + upward.scope.size}개${extras.length ? `, 개념 ${extras.length}개` : ""}`,
      candidate_ids: candidates.map((c) => c.id),
    },
  };
}

// ───────── ②-b·②-c 웹 ─────────

export interface WebContext {
  searchFixtureDir?: string;
  call?: LinerCallOptions;
}

interface GradedRaw extends RawSearchResult {
  query: string;
}

async function runSearch(q: SearchQuery, stage: TraceCall["stage"], ctx: WebContext) {
  const started = Date.now();
  try {
    const res = await searchWeb(q, { ...ctx.call, fixtureDir: ctx.searchFixtureDir });
    const graded = res.results.map((r) => ({ raw: { ...r, query: q.query } as GradedRaw, outcome: gradeWebResult(r) }));
    const call: TraceCall = {
      stage,
      api: "search",
      query: q.date_range ? `${q.query} (${q.date_range})` : q.query,
      http_status: res.status,
      duration_ms: res.duration_ms,
      usage:
        res.source === "live"
          ? { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cost_usd: SEARCH_COST_USD }
          : undefined,
      results: graded.map((g) => ({ hostname: g.raw.hostname, grade: g.outcome.grade, excluded: g.outcome.excluded })),
      note:
        [
          res.source === "fixture" ? "고정 응답" : res.source === "fixture_missing" ? "고정 응답 없음" : "",
          graded.some((g) => g.outcome.excluded) ? "목록 페이지 제외" : "",
        ]
          .filter(Boolean)
          .join(", ") || undefined,
    };
    return { graded, call, ok: true };
  } catch (error) {
    if (error instanceof LinerError && (error.code === "missing_api_key" || error.code === "aborted")) throw error;
    return {
      graded: [] as { raw: GradedRaw; outcome: ReturnType<typeof gradeWebResult> }[],
      call: {
        stage,
        api: "search",
        query: q.query,
        http_status: error instanceof LinerError ? error.status : undefined,
        duration_ms: Date.now() - started,
        note: "검색 실패",
      } as TraceCall,
      ok: false,
    };
  }
}

export interface WebPlan {
  run: boolean;
  queries: SearchQuery[];
  reason: string;
}

/** ②-b를 부를지와 검색어. needs_external이거나 캐시 점수가 낮을 때만(비용·속도) */
export function planWebSearch(analysis: QuestionAnalysis, topScore: number, candidateCount: number): WebPlan {
  const low = candidateCount === 0 || topScore < LOW_CACHE_SCORE;
  if (!analysis.needs_external && !low) return { run: false, queries: [], reason: "법령 밖 정보 불필요" };
  const base = analysis.queries_web.length
    ? analysis.queries_web.slice(0, 2)
    : [`교육부 ${analysis.task || analysis.concepts.slice(0, 3).join(" ")}`.trim()];
  return {
    run: true,
    queries: base.map((query) => ({ query })),
    reason: analysis.needs_external ? "법령 밖 정보 필요" : "캐시 점수 낮음",
  };
}

export interface WebCollectOutcome {
  items: { raw: GradedRaw; outcome: ReturnType<typeof gradeWebResult> }[];
  calls: TraceCall[];
  queries: string[];
  failed: number;
}

/** ②-b: 검색어를 병렬로 부르고, W1이 0건이면 site:moe.go.kr 보조 검색을 한 번 더(설계 2-2) */
export async function collectWeb(plan: WebPlan, ctx: WebContext): Promise<WebCollectOutcome> {
  if (!plan.run) return { items: [], calls: [], queries: [], failed: 0 };
  const first = await Promise.all(plan.queries.map((q) => runSearch(q, "collect_web", ctx)));
  const items = first.flatMap((r) => r.graded);
  const calls = first.map((r) => r.call);
  let failed = first.filter((r) => !r.ok).length;
  const queries = plan.queries.map((q) => q.query);
  const hasW1 = items.some((i) => i.outcome.grade === "W1" && !i.outcome.excluded);
  if (!hasW1 && plan.queries.length && failed < plan.queries.length) {
    const q: SearchQuery = { query: `${plan.queries[0].query} site:moe.go.kr`, date_range: "past_year" };
    const extra = await runSearch(q, "collect_web", ctx);
    items.push(...extra.graded);
    calls.push(extra.call);
    queries.push(q.query);
    if (!extra.ok) failed += 1;
  }
  return { items, calls, queries, failed };
}

export type SignalCollectOutcome = WebCollectOutcome & { lawByQuery: Map<string, string> };

/** ②-c: 상위 법령 1~2개의 "개정 입법예고" 검색. W1만 남긴다 */
export async function collectSignals(lawNames: string[], ctx: WebContext): Promise<SignalCollectOutcome> {
  const lawByQuery = new Map<string, string>();
  const qs: SearchQuery[] = lawNames.slice(0, 2).map((name) => {
    const query = `${name} 개정 입법예고`;
    lawByQuery.set(query, name);
    return { query, date_range: "past_year" };
  });
  if (!qs.length) return { items: [], calls: [], queries: [], failed: 0, lawByQuery };
  const res = await Promise.all(qs.map((q) => runSearch(q, "collect_signals", ctx)));
  const items = res.flatMap((r) => r.graded).filter((i) => i.outcome.grade === "W1" && !i.outcome.excluded);
  return {
    items,
    calls: res.map((r) => r.call),
    queries: qs.map((q) => q.query),
    failed: res.filter((r) => !r.ok).length,
    lawByQuery,
  };
}

// ───────── 웹 결과 정리 ─────────

export interface MergedWeb {
  results: WebResult[];
  signals: ChangeSignal[];
}

/** 신호 종류. 제목으로 먼저 정하고, 제목에 없으면 설명에 입법예고와 법령 이름이 함께 있을 때만 입법예고로 본다 */
function signalKind(title: string, description: string, lawName: string): ChangeSignal["kind"] {
  if (/입법예고|개정령안|개정법률안|개정안/.test(title)) return "legislative_notice";
  if (/개정|공포/.test(title)) return "amendment_news";
  if (description.includes("입법예고") && mentionsLaw(lawName, description)) return "legislative_notice";
  return "other";
}

/** "12월 7일(월)까지", "~ 12. 7." 같은 의견 제출 마감 */
export function parseOpinionDeadline(text: string, postedDate: string | null): string | undefined {
  const m =
    text.match(/(\d{1,2})월\s*(\d{1,2})일\s*(?:\([^)]*\))?\s*까지/) ??
    text.match(/~\s*(?:\d{4}\s*\.\s*)?(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/);
  if (!m) return undefined;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return undefined;
  let year = postedDate ? Number(postedDate.slice(0, 4)) : new Date().getFullYear();
  if (postedDate && month < Number(postedDate.slice(5, 7))) year += 1; // 게시 월보다 앞이면 다음 해
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 신호 결과가 그 법령을 실제로 말하는지(띄어쓰기를 무시한 법령 이름 전체) */
function mentionsLaw(lawName: string, text: string): boolean {
  const name = lawName.replace(/\s+/g, "");
  return text.replace(/\s+/g, "").includes(name);
}

/**
 * 신호가 다루는 법령 이름. 제목이 낫표로 법령 이름을 적었으면(「고등교육법 시행령」) 그 가운데 검색한 법령과 같은 것,
 * 없으면 검색한 법령 이름을 품은 것(고등교육법으로 찾았는데 「고등교육법 시행령」 입법예고면 시행령)을 돌려준다.
 * 낫표가 없으면 제목·설명에 법령 이름 전체가 있을 때 그 이름. 관계없으면 null
 */
export function signalLawName(lawName: string, title: string, description: string): string | null {
  const flat = (x: string) => x.replace(/\s+/g, "");
  const quoted = [...title.matchAll(/[「｢『]([^」｣』]+)[」｣』]/g)].map((m) => m[1].trim());
  if (quoted.length) {
    if (quoted.some((q) => flat(q) === flat(lawName))) return lawName;
    return quoted.find((q) => flat(q).includes(flat(lawName))) ?? null;
  }
  return mentionsLaw(lawName, `${title} ${description}`) ? lawName : null;
}

/**
 * ②-b·②-c 결과를 합쳐 요청 안 ID(web:1…)를 매기고, W1 원문이 있는 재게시본은 뺀다.
 * 목록·메뉴 페이지는 결과에 남기되 excluded 표시(처리 과정용, 프롬프트·카드에는 안 씀).
 */
export function mergeWeb(
  web: WebCollectOutcome,
  signals: WebCollectOutcome & { lawByQuery: Map<string, string> },
  collectedAt: string,
): MergedWeb {
  const seen = new Set<string>();
  const pool: { raw: GradedRaw; outcome: ReturnType<typeof gradeWebResult>; signalLaw?: string }[] = [];
  for (const item of signals.items) {
    if (seen.has(item.raw.url)) continue;
    seen.add(item.raw.url);
    pool.push({ ...item, signalLaw: signals.lawByQuery.get(item.raw.query) });
  }
  for (const item of web.items) {
    if (seen.has(item.raw.url)) continue;
    seen.add(item.raw.url);
    pool.push(item);
  }
  const drop = duplicatesOfOriginals(pool.map((p) => ({ title: p.raw.title, grade: p.outcome.grade, excluded: p.outcome.excluded })));
  const results: WebResult[] = [];
  const out: ChangeSignal[] = [];
  const collectedDate = collectedAt.slice(0, 10);
  let n = 0;
  pool.forEach((p, i) => {
    if (drop.has(i)) return;
    n += 1;
    const result: WebResult = {
      id: `web:${n}`,
      title: p.raw.title,
      url: p.raw.url,
      hostname: p.raw.hostname,
      date: p.outcome.date,
      description: p.raw.description,
      grade: p.outcome.grade,
      query: p.raw.query,
      ...(p.outcome.excluded ? { excluded: p.outcome.excluded } : {}),
    };
    results.push(result);
    const signalLaw = p.signalLaw ? signalLawName(p.signalLaw, p.raw.title, p.raw.description) : null;
    if (signalLaw && !p.outcome.excluded) {
      const kind = signalKind(p.raw.title, p.raw.description, signalLaw);
      if (kind === "other") return;
      out.push({
        web_id: result.id,
        title: result.title,
        url: result.url,
        hostname: result.hostname,
        date: result.date,
        kind,
        related_law: signalLaw,
        opinion_deadline: kind === "legislative_notice" ? parseOpinionDeadline(p.raw.description, result.date) : undefined,
        after_collection: Boolean(result.date && collectedDate && result.date > collectedDate),
      });
    }
  });
  return { results, signals: out.slice(0, 6) };
}

// ───────── 공고 캐시(data/notices.json) ─────────
// 교육부 공고·안내 가운데 원문에서 수치를 확인한 것(checked)과, 찾았지만 수치를 확인하지 못한 것(needs_source_check)을
// 웹 근거 단계에 "notice:N"으로 붙인다. 확인 못 한 공고는 숫자 없이 "원문 확인 필요"로만 보낸다.
// 입법예고 공고는 후보 조의 법령 이름이 제목에 있으면 변경 신호로도 올린다.

/** 질문이 가리키는 학년도(없으면 undefined). "내년"은 기준일 다음 해 */
export function targetYear(question: string, asOf: string): number | undefined {
  const m = question.match(/(20\d{2})\s*학년도/) ?? question.match(/(20\d{2})\s*년/);
  if (m) return Number(m[1]);
  const y = Number(asOf.slice(0, 4));
  if (/내년|다음\s*학년도|다음\s*해/.test(question)) return y + 1;
  if (/올해|금년|이번\s*학년도/.test(question)) return y;
  return undefined;
}

/** 질문과 공고가 겹치는 정도(질문 2-gram 가운데 공고 제목·수치 이름에 있는 비율) */
export function noticeRelevance(question: string, concepts: string[], notice: NoticeEntry): number {
  const q = new Set(bigrams([question, ...concepts].join(" ")).filter((g) => g.length === 2));
  if (!q.size) return 0;
  const n = new Set(bigrams([notice.title, ...(notice.figures ?? []).map((f) => f.label)].join(" ")));
  let hit = 0;
  for (const g of q) if (n.has(g)) hit += 1;
  return hit / q.size;
}

/** 이보다 겹치면 공고를 붙인다. 공고 위임 조("교육부장관이 정하여 공고")가 후보에 있으면 낮은 쪽 */
export const NOTICE_MIN_RELEVANCE = 0.3;
export const NOTICE_MIN_RELEVANCE_DELEGATED = 0.15;
const MAX_NOTICES = 3;
const NOTICE_RELATIVE = 0.75;
const LEGISLATIVE = /입법\s*예고/;

function noticeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function noticeDescription(n: NoticeEntry): string {
  if ((n.status ?? "checked") === "needs_source_check") {
    return `${n.issuer} 공고. 원문 확인 필요 — 이 공고의 수치는 원문에서 확인하지 못했다.`;
  }
  return [`${n.issuer} 게시${n.posted ? ` ${n.posted}` : ""}.`, ...(n.figures ?? []).map((f) => `${f.label}: ${f.value}${f.unit && !f.value.endsWith(f.unit) ? f.unit : ""}.`)].join(" ");
}

/** "2026년 12월 7일까지" 같은 수치에서 의견 제출 마감일 */
function noticeDeadline(n: NoticeEntry): string | undefined {
  for (const f of n.figures ?? []) {
    if (!/의견/.test(f.label)) continue;
    const m = f.value.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? f.value.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const d = parseOpinionDeadline(f.value, n.posted);
    if (d) return d;
  }
  return undefined;
}

export interface NoticeCollectInput {
  cache: LawCache;
  question: string;
  analysis: QuestionAnalysis;
  asOf: string;
  candidates: ArticleCandidate[];
  /** 후보 조의 공고 위임(collectFromCache의 notices) */
  delegations: { from: string; issuer: string; phrase: string }[];
  /** 변경 신호를 볼 법령(점수 순 상위 법령 이름). 입법예고 공고는 이 법령을 다룰 때만 붙인다 */
  signalLaws: string[];
}

export interface NoticeCollectOutcome {
  results: WebResult[];
  signals: ChangeSignal[];
}

export function collectNotices(input: NoticeCollectInput): NoticeCollectOutcome {
  const { cache, question, analysis, asOf } = input;
  const all = (cache.notices?.notices ?? []).filter((n) => !n.posted || n.posted <= asOf);
  const year = targetYear(question, asOf);
  const checked = new Set(checkedNotices(cache, year).map((n) => n.id));
  const unchecked = all.filter((n) => n.status === "needs_source_check" && (year === undefined || n.year === year));
  const delegated = input.delegations.length > 0;
  const threshold = delegated ? NOTICE_MIN_RELEVANCE_DELEGATED : NOTICE_MIN_RELEVANCE;

  const flat = (x: string) => x.replace(/\s+/g, "");
  const picked: { n: NoticeEntry; law?: string }[] = [];
  for (const n of all) {
    if (LEGISLATIVE.test(n.title)) {
      // 입법예고: 후보 조의 법령을 다루면(제목에 법령 이름) 관련성과 상관없이 신호로 올린다.
      // 공고 캐시에 개정 대상 조(articles)가 적혀 있으면 그 조가 후보에 있을 때만(같은 법령의 다른 조를 묻는 질문에는 잡음)
      // 낫표로 법령 이름을 적었으면 그 이름과 똑같아야 한다(「고등교육법 시행령」을 고등교육법으로 잡지 않게)
      const quoted = [...n.title.matchAll(/[「｢『]([^」｣』]+)[」｣』]/g)].map((m) => flat(m[1]));
      const title = flat(n.title);
      const law = quoted.length
        ? input.signalLaws.find((name) => quoted.includes(flat(name)))
        : input.signalLaws.filter((name) => title.includes(flat(name))).sort((a, b) => b.length - a.length)[0];
      const touches = !n.articles?.length || input.candidates.some((c) => n.articles!.includes(c.id.split("@")[0]));
      if (law && touches && (n.status ?? "checked") === "checked") picked.push({ n, law });
      continue;
    }
    if (!checked.has(n.id) && !unchecked.includes(n)) continue;
    if (noticeRelevance(question, analysis.concepts, n) >= threshold) picked.push({ n });
  }
  // 공고는 가장 많이 겹친 것의 NOTICE_RELATIVE 배 이상만(비슷한 주제의 다른 공고가 끼지 않게)
  const scored = picked
    .filter((p) => !p.law)
    .map((p) => ({ ...p, score: noticeRelevance(question, analysis.concepts, p.n) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const ranked = [...picked.filter((p) => p.law), ...scored.filter((p) => p.score >= best * NOTICE_RELATIVE).slice(0, MAX_NOTICES)];

  const results: WebResult[] = [];
  const signals: ChangeSignal[] = [];
  ranked.forEach(({ n, law }, i) => {
    const status = n.status ?? "checked";
    const hostname = noticeHost(n.url);
    const result: WebResult = {
      id: `notice:${i + 1}`,
      title: n.title,
      url: n.url,
      hostname,
      date: n.posted,
      description: noticeDescription(n),
      grade: "W1",
      query: "공고 캐시",
      notice: { id: n.id, issuer: n.issuer, status, figures: status === "checked" ? (n.figures ?? []) : [] },
    };
    results.push(result);
    if (law) {
      signals.push({
        web_id: result.id,
        title: n.title,
        url: n.url,
        hostname,
        date: n.posted,
        kind: "legislative_notice",
        related_law: law,
        opinion_deadline: noticeDeadline(n),
        after_collection: Boolean(n.posted && n.posted > cache.collectedAt.slice(0, 10)),
        ...(n.articles?.length ? { articles: n.articles } : {}),
      });
    }
  });
  return { results, signals };
}
