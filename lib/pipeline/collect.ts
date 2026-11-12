// ② 근거 수집(설계 2-2). ②-a 캐시 조문 검색 → ②-b 공고·안내 검색과 ②-c 변경 신호를 병렬로.
import type { LawCache } from "@/lib/cache/load";
import type { LawArticle, LawDocument, SchoolId } from "@/lib/cache/schema";
import { ArticleIndex, expandSynonyms, type SearchHit } from "@/lib/cache/index";
import { followDelegations } from "@/lib/cache/links";
import { resolveVersions } from "@/lib/cache/status";
import { duplicatesOfOriginals, gradeWebResult } from "@/lib/grade";
import { SEARCH_COST_USD } from "@/lib/liner/cost";
import { LinerError, type LinerCallOptions } from "@/lib/liner/client";
import { searchWeb, type RawSearchResult, type SearchQuery } from "@/lib/liner/search";
import type { ArticleCandidate, ChangeSignal, QuestionAnalysis, TraceCall, WebResult } from "./types";

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

export function collectFromCache(input: CacheCollectInput): CacheCollectOutcome {
  const started = Date.now();
  const { cache, analysis, asOf } = input;
  const lawIndex = lawIndexFor(cache);
  const schoolIndex = input.schoolRules ? new ArticleIndex([input.schoolRules]) : null;
  const lookup = (id: string): { article: LawArticle; law: LawDocument } | undefined =>
    lawIndex.byId.get(id) ?? schoolIndex?.byId.get(id);

  const queries = [...new Set([input.question, ...analysis.queries_cache])];
  const scores = new Map<string, SearchHit & { hitsCount: number }>();
  const add = (hit: SearchHit) => {
    const prev = scores.get(hit.id);
    if (!prev) scores.set(hit.id, { ...hit, hitsCount: 1 });
    else {
      prev.score = Math.max(prev.score, hit.score);
      prev.hitsCount += 1;
      if (hit.via === "direct") prev.via = "direct";
    }
  };
  for (const index of [lawIndex, schoolIndex]) {
    if (!index) continue;
    for (const hit of index.direct(input.question)) add(hit);
    for (const q of queries) {
      const expanded = expandSynonyms(q, cache.synonyms);
      for (const hit of index.search(expanded, { limit: 20, boost: analysis.concepts })) add(hit);
    }
  }
  // 여러 검색어에서 함께 나온 조를 조금 올린다
  const ranked = [...scores.values()]
    .map((h) => ({ ...h, score: h.score * (1 + 0.1 * Math.min(h.hitsCount - 1, 3)) }))
    .sort((a, b) => b.score - a.score);
  const topScore = ranked.find((h) => h.via === "search")?.score ?? (ranked.length ? ranked[0].score : 0);
  // 상위 점수의 25% 미만은 버린다(관계 적은 조가 프롬프트를 채우지 않게)
  const floor = topScore * 0.25;
  const chosen = ranked.filter((h) => h.via === "direct" || h.score >= floor).slice(0, input.limit ?? DEFAULT_CANDIDATE_LIMIT);

  const startArticles = chosen.map((h) => lookup(h.id)?.article).filter((a): a is LawArticle => Boolean(a));
  const delegation = followDelegations(startArticles.slice(0, 5), (id) => lookup(id)?.article, {
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

  const candidates: ArticleCandidate[] = [];
  for (const entry of entries) {
    const found = lookup(entry.id);
    if (!found) continue;
    const { article, law } = found;
    const versions = resolveVersions(article, asOf);
    const hasCurrent = versions.some((v) => v.status === "in_force");
    for (const { version, status } of versions) {
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
      note: `조 ${chosen.length}개, 위임 ${delegation.articles.size + delegation.schoolArticles.size}개`,
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
    if (p.signalLaw && !p.outcome.excluded && mentionsLaw(p.signalLaw, `${p.raw.title} ${p.raw.description}`)) {
      const kind = signalKind(p.raw.title, p.raw.description, p.signalLaw);
      if (kind === "other") return;
      out.push({
        web_id: result.id,
        title: result.title,
        url: result.url,
        hostname: result.hostname,
        date: result.date,
        kind,
        related_law: p.signalLaw,
        opinion_deadline: kind === "legislative_notice" ? parseOpinionDeadline(p.raw.description, result.date) : undefined,
        after_collection: Boolean(result.date && collectedDate && result.date > collectedDate),
      });
    }
  });
  return { results, signals: out.slice(0, 6) };
}
