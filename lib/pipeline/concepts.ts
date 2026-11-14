// 질문 핵심 개념어와 조문 원문의 대조(② 후보 보강, ④ 재질문 조건에 함께 쓴다).
// 개념어는 ① 분석이 뽑은 concepts다. 문항마다 다른 말을 코드에 넣지 않고, 조문 원문에 나오는 횟수로만 판단한다.
import type { Synonyms } from "@/lib/cache/schema";
import { normalizeForMatch } from "./text";

/** 원문 대조용 정규화(공백 제거·문자 변형 통일) */
function flat(s: string): string {
  return normalizeForMatch(s).text;
}

/**
 * 개념어 하나와 그 동의어. 동의어 사전 묶음 가운데 낱말 하나가 개념어 안에 들어 있으면 묶음 전체를 더한다
 * (검색어 넓히기 expandSynonyms와 같은 규칙). 두 글자 미만은 뺀다.
 */
export function conceptTerms(concept: string, synonyms?: Synonyms): string[] {
  const c = flat(concept);
  if (c.length < 2) return [];
  const terms = new Set([c]);
  for (const group of synonyms?.groups ?? []) {
    if (group.some((w) => c.includes(flat(w)))) for (const w of group) if (flat(w).length >= 2) terms.add(flat(w));
  }
  return [...terms];
}

export interface ConceptArticle {
  id: string;
  text: string;
}

export interface ConceptHits {
  concept: string;
  terms: string[];
  /** 개념어(동의어 포함)가 원문에 나오는 조 ID */
  ids: string[];
}

/** 개념어마다 원문에 그 말이 나오는 조를 찾는다. 같은 개념어가 겹치면 한 번만 */
export function conceptHits(concepts: string[], articles: ConceptArticle[], synonyms?: Synonyms): ConceptHits[] {
  const texts = articles.map((a) => ({ id: a.id, text: flat(a.text) }));
  const out: ConceptHits[] = [];
  const seen = new Set<string>();
  for (const concept of concepts) {
    const terms = conceptTerms(concept, synonyms);
    if (!terms.length || seen.has(terms[0])) continue;
    seen.add(terms[0]);
    const ids = texts.filter((t) => terms.some((term) => t.text.includes(term))).map((t) => t.id);
    out.push({ concept, terms, ids });
  }
  return out;
}

/**
 * ④ 재질문에 쓰는 '드문 개념어'의 상한. 법령 조문 이만큼 넘게 나오는 말(교원·대학·학칙 같은 말)은
 * 어느 조에나 있어 대조해도 뜻이 없으므로 뺀다. 조문 어디에도 없는 말(①이 풀어 쓴 말)도 뺀다.
 */
export const RARE_CONCEPT_MAX_ARTICLES = 10;

/** 드문 개념어(조문 1~RARE_CONCEPT_MAX_ARTICLES개에 나오는 말)의 대조어 묶음 */
export function rareConceptTerms(hits: ConceptHits[]): string[][] {
  return hits.filter((h) => h.ids.length >= 1 && h.ids.length <= RARE_CONCEPT_MAX_ARTICLES).map((h) => h.terms);
}

/** 원문에 대조어 묶음 가운데 하나라도 나오는지 */
export function mentionsAnyConcept(text: string, termGroups: string[][]): boolean {
  const t = flat(text);
  return termGroups.some((terms) => terms.some((term) => t.includes(term)));
}

// ───────── 적용 제외 조 ─────────

/** 그 조를 적용하지 않는다는 말 */
const APPLY_EXCLUSION = /적용하지\s*아니|적용되지\s*아니|적용하지\s*않|적용을\s*배제/;
/** 지칭 바로 뒤 "(제N조)는 제외한다", "(제N조)를 제외하고": 그 조를 적용 대상에서 뺀다 */
const EXCLUDED_AFTER = /^(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?\s*(?:은|는|을|를)\s*제외/;
/** 한 문장이 같은 법령 조를 이보다 많이 가리키면(적용 제외 목록을 길게 늘어놓은 특례 조) 넣지 않는다 */
export const MAX_REFS_IN_EXCLUSION = 3;

interface ArticleRef {
  main: string;
  branch: string | null;
  end: number;
}

/**
 * 문장에서 같은 법령 조 지칭을 찾는다. "제5조"가 "제55조"에 맞지 않고 "제5조의2"와 구별된다.
 * 낫표로 다른 법령 이름을 앞에 붙인 지칭(「고등교육법」 제2조와 그 뒤로 이어지는 목록), "같은 법 제2조",
 * 시행령·규칙의 "법 제2조"·"영 제2조"는 다른 법령의 조라 뺀다. "이 법 제2조"는 같은 법령이다.
 */
export function sameLawRefs(sentence: string): ArticleRef[] {
  const out: ArticleRef[] = [];
  for (const m of sentence.matchAll(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)) {
    const head = sentence.slice(0, m.index);
    const before = head.slice(-8);
    if (/같은\s*법(?:\s*시행령)?\s*$/.test(before)) continue;
    if (/(?:법|영)\s*$/.test(before) && !/이\s*(?:법|영)\s*$/.test(before)) continue;
    const lastQuote = head.lastIndexOf("」");
    if (lastQuote >= 0 && !/이\s*법/.test(head.slice(lastQuote))) continue;
    out.push({ main: m[1], branch: m[2] ?? null, end: m.index + m[0].length });
  }
  return out;
}

function articleNumberParts(number: string): { main: string; branch: string | null } | null {
  const m = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?$/.exec(number.trim());
  return m ? { main: m[1], branch: m[2] ?? null } : null;
}

/** 문장이 같은 법령의 그 조를 가리키며 그 조를 적용하지 않거나 적용 대상에서 빼는지 */
export function restrictsArticle(sentence: string, number: string): boolean {
  const parts = articleNumberParts(number);
  if (!parts) return false;
  const refs = sameLawRefs(sentence);
  const distinct = new Set(refs.map((r) => `${r.main}-${r.branch ?? ""}`));
  if (distinct.size > MAX_REFS_IN_EXCLUSION) return false;
  const hits = refs.filter((r) => r.main === parts.main && r.branch === parts.branch);
  if (!hits.length) return false;
  return APPLY_EXCLUSION.test(sentence) || hits.some((r) => EXCLUDED_AFTER.test(sentence.slice(r.end)));
}

/** 원문을 문장 단위로 나눈다 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.다])\s+|\n/).filter(Boolean);
}

export interface RestrictionArticle extends ConceptArticle {
  law_id: string;
  number: string;
}

/** 같은 법령 안에서 대상 조를 가리키며 그 조를 적용하지 않거나 적용 대상에서 뺀 조 */
export function restrictingArticles(target: RestrictionArticle, sameLaw: RestrictionArticle[]): string[] {
  const out: string[] = [];
  for (const a of sameLaw) {
    if (a.id === target.id || a.law_id !== target.law_id) continue;
    if (sentences(a.text).some((s) => restrictsArticle(s, target.number))) out.push(a.id);
  }
  return out;
}
