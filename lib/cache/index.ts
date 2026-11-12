// 캐시 조문 색인: 한글 문자 2-gram BM25(설계 2-2 ②-a) + 법령명·조번호 직접 조회.
// 색인 단위는 조. 판이 여럿이면 모든 판의 글을 합쳐 한 문서로 본다(시행 예정 조문도 찾히게).
// 호가 아주 많은 항(시행령 제4조① 학칙 기재사항처럼 열거만 하는 항)은 호마다 작은 문서를 따로 더 만든다.
// 긴 조 전체로는 한 호에만 나오는 말("성적의 관리")의 점수가 길이에 눌려 낮게 나오기 때문이다. 점수는 조 단위로 가장 높은 것을 쓴다.
import type { LawArticle, LawDocument, Synonyms } from "./schema";
import { bigrams } from "@/lib/pipeline/text";

export interface IndexedArticle {
  article: LawArticle;
  law: LawDocument;
}

export interface SearchHit {
  id: string;
  score: number;
  via: "direct" | "search";
}

interface Doc {
  id: string;
  tf: Map<string, number>;
  length: number;
}

const K1 = 1.2;
const B = 0.75;
// 제목은 본문보다 무겁게(제목 2-gram을 세 번 넣는다)
const TITLE_WEIGHT = 3;
/** 호 단위 문서를 따로 만드는 항의 최소 호 수 */
export const ITEM_DOC_MIN_ITEMS = 10;

export class ArticleIndex {
  private readonly docs: Doc[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;
  readonly byId = new Map<string, IndexedArticle>();
  private readonly lawNames: { law: LawDocument; names: string[] }[] = [];

  constructor(laws: Iterable<LawDocument>) {
    let total = 0;
    const addDoc = (id: string, grams: string[]) => {
      const tf = new Map<string, number>();
      for (const g of grams) tf.set(g, (tf.get(g) ?? 0) + 1);
      for (const g of tf.keys()) this.df.set(g, (this.df.get(g) ?? 0) + 1);
      this.docs.push({ id, tf, length: grams.length });
      total += grams.length;
    };
    for (const law of laws) {
      this.lawNames.push({ law, names: lawAliases(law) });
      for (const article of law.articles) {
        this.byId.set(article.id, { article, law });
        const texts = new Set(article.versions.map((v) => v.text));
        const titleGrams: string[] = [];
        for (let i = 0; i < TITLE_WEIGHT; i += 1) titleGrams.push(...bigrams(article.title));
        addDoc(article.id, [...bigrams([...texts].join(" ")), ...titleGrams]);
        for (const itemText of listedItems(article)) addDoc(article.id, [...bigrams(itemText), ...bigrams(article.title)]);
      }
    }
    this.avgLength = this.docs.length ? total / this.docs.length : 1;
  }

  /** 색인한 조 수(호 단위 문서는 세지 않는다) */
  get size(): number {
    return this.byId.size;
  }

  /** BM25 점수 상위 limit개. weights로 개념어 가중(설계 2-2 (3)) */
  search(query: string, options: { limit?: number; boost?: string[]; filter?: (id: string) => boolean } = {}): SearchHit[] {
    const q = new Map<string, number>();
    for (const g of bigrams(query)) q.set(g, (q.get(g) ?? 0) + 1);
    for (const term of options.boost ?? []) for (const g of bigrams(term)) q.set(g, (q.get(g) ?? 0) + 1);
    if (!q.size) return [];
    const n = this.docs.length;
    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      if (options.filter && !options.filter(doc.id)) continue;
      let score = 0;
      for (const [g, qtf] of q) {
        const tf = doc.tf.get(g);
        if (!tf) continue;
        const df = this.df.get(g) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += qtf * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / this.avgLength)));
      }
      if (score > 0) hits.push({ id: doc.id, score, via: "search" });
    }
    // 같은 조의 호 단위 문서가 여럿 맞으면 가장 높은 점수 하나만
    const best = new Map<string, SearchHit>();
    for (const h of hits) if ((best.get(h.id)?.score ?? -1) < h.score) best.set(h.id, h);
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, options.limit ?? 20);
  }

  /**
   * "시행령 제15조", "고등교육법 제11조의2", "학칙 제66조" 같은 직접 지칭을 찾는다.
   * 법령명이 없으면 조번호가 맞는 모든 법령의 조를 돌려준다(점수는 검색 결과보다 높게).
   */
  direct(query: string, filter?: (id: string) => boolean): SearchHit[] {
    const re = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;
    const hits: SearchHit[] = [];
    for (const m of query.matchAll(re)) {
      const suffix = `:${m[1].padStart(3, "0")}-${(m[2] ?? "0").padStart(2, "0")}`;
      const before = query.slice(Math.max(0, m.index - 20), m.index).replace(/\s+/g, "");
      const named = this.lawNames.filter(({ names }) => names.some((name) => before.endsWith(name) || before.includes(name)));
      // 가장 긴 이름이 맞은 법령을 고른다("고등교육법 시행령" > "고등교육법")
      const best = named.sort(
        (a, b) => Math.max(...b.names.filter((x) => before.includes(x)).map((x) => x.length)) - Math.max(...a.names.filter((x) => before.includes(x)).map((x) => x.length)),
      );
      const targets = best.length ? [best[0].law] : this.lawNames.map((x) => x.law);
      for (const law of targets) {
        const id = `${law.law_id}${suffix}`;
        if (this.byId.has(id) && (!filter || filter(id))) hits.push({ id, score: 1000, via: "direct" });
      }
    }
    return hits;
  }
}

/** 담을 사항을 열거하는 항의 머리("다음 각 호의 사항을 기재하여야 한다", "…사항을 포함한다", "…사항을 적은") */
const CONTENTS_LIST = /다음\s*각\s*호의\s*사항(?:을|이)\s*(?:기재|포함|적)/;

/** 사항을 열거하는 항(호 ITEM_DOC_MIN_ITEMS개 이상)의 호 글(최신 판). 삭제된 호는 뺀다 */
export function listedItems(article: Pick<LawArticle, "versions">): string[] {
  const latest = article.versions.at(-1);
  if (!latest) return [];
  const out: string[] = [];
  for (const p of latest.paragraphs) {
    if (p.items.length < ITEM_DOC_MIN_ITEMS || !CONTENTS_LIST.test(p.text)) continue;
    for (const item of p.items) {
      if (/^삭제(?:\s*<|$)/.test(item.text.trim())) continue;
      out.push([item.text, ...item.subitems.map((s) => s.text)].join(" "));
    }
  }
  return out;
}

/** 법령 이름 변형: "고등교육법 시행령" → ["고등교육법시행령", "시행령"], 학칙 → ["학칙"] */
export function lawAliases(law: Pick<LawDocument, "law_name" | "kind">): string[] {
  const name = law.law_name.replace(/\s+/g, "");
  const aliases = new Set([name]);
  if (name.endsWith("시행령")) aliases.add("시행령");
  if (name.endsWith("시행규칙")) aliases.add("시행규칙");
  if (law.kind === "school_rule") aliases.add("학칙");
  return [...aliases];
}

/** 동의어 사전으로 검색어를 넓힌다("등심위" → "등록금심의위원회" 추가) */
export function expandSynonyms(query: string, synonyms: Synonyms | undefined): string {
  if (!synonyms) return query;
  const extra: string[] = [];
  const flat = query.replace(/\s+/g, "");
  for (const group of synonyms.groups) {
    if (group.some((w) => flat.includes(w.replace(/\s+/g, "")))) extra.push(...group);
  }
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}
