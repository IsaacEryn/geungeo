// 위임 사슬 따라가기(설계 2-2 ②-a). 수집 때 미리 만든 links를 따라 후보를 더한다.
import type { DelegationLink, LawArticle, LawDocument } from "./schema";
import type { ArticleIndex } from "./index";
import { bigrams } from "@/lib/pipeline/text";

export interface DelegationResult {
  /** 다른 법령 조로 이어진 것: 조 ID → 어디서 왔는지 */
  articles: Map<string, { from: string; phrase: string }>;
  /** 학칙으로 위임한 조 ID */
  schoolRuleDelegated: Set<string>;
  /** 학교가 지정됐을 때 그 학교 학칙에서 찾은 대응 조: 조 ID → 위임한 조 ID */
  schoolArticles: Map<string, { from: string; phrase: string }>;
  /** "교육부장관이 정하여 공고" 같은 공고 위임 */
  notices: { from: string; issuer: string; phrase: string }[];
}

export interface FollowOptions {
  /** 학교 학칙 문서(지정했고 읽었을 때만) */
  schoolRules?: LawDocument | null;
  /** 학칙 색인(schoolRules로 만든 것) */
  schoolIndex?: ArticleIndex | null;
  /** 한 단계만 따라간다(사슬이 길어 후보가 불어나지 않게). 기본 1 */
  depth?: number;
}

export function followDelegations(
  start: LawArticle[],
  lookup: (id: string) => LawArticle | undefined,
  options: FollowOptions = {},
): DelegationResult {
  const result: DelegationResult = {
    articles: new Map(),
    schoolRuleDelegated: new Set(),
    schoolArticles: new Map(),
    notices: [],
  };
  const depth = options.depth ?? 1;
  let frontier = start;
  const seen = new Set(start.map((a) => a.id));
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next: LawArticle[] = [];
    for (const article of frontier) {
      for (const link of article.links ?? []) handleLink(article, link, lookup, options, result, seen, next);
    }
    frontier = next;
  }
  return result;
}

function handleLink(
  article: LawArticle,
  link: DelegationLink,
  lookup: (id: string) => LawArticle | undefined,
  options: FollowOptions,
  result: DelegationResult,
  seen: Set<string>,
  next: LawArticle[],
) {
  const target = link.target;
  if (target.kind === "article") {
    const found = lookup(target.article_id);
    if (found && !seen.has(found.id)) {
      seen.add(found.id);
      result.articles.set(found.id, { from: article.id, phrase: link.phrase });
      next.push(found);
    }
    return;
  }
  if (target.kind === "notice") {
    result.notices.push({ from: article.id, issuer: target.issuer, phrase: link.phrase });
    return;
  }
  // 학칙 위임: 학교가 지정되면 그 학교 학칙에서 같은 주제의 조를 찾고, 아니면 "학교별 확인" 표시만
  result.schoolRuleDelegated.add(article.id);
  if (options.schoolRules && options.schoolIndex) {
    const query = `${article.title} ${link.phrase}`;
    const hits = options.schoolIndex.search(query, { limit: 2 });
    for (const hit of hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      result.schoolArticles.set(hit.id, { from: article.id, phrase: link.phrase });
    }
  }
}

// ───────── 위로 거슬러 올라가기 ─────────
// 검색으로 찾은 조가 하위 규범(학칙·훈령·시행령)이면, 그 조에 권한을 맡긴 상위 조를 함께 후보에 올린다.
//  - 법령 → 법령: 수집 때 만든 links를 거꾸로 본다(훈령 제4조 ← 시행령 제14조의2 ← 법 제22조)
//  - 학칙 → 법령: 같은 주제로 "학칙으로 정한다"고 맡긴 조(법 제23조의4 휴학 → 학칙 휴학 조)와,
//    학칙 기재사항을 열거한 조의 해당 호(시행령 제4조제1항 각 호)
//  - 행정규칙의 조가 후보면 같은 규칙의 적용 범위 조(적용 대상·제외를 정함)도 함께

export interface UpwardLink {
  /** 이 상위 조가 맡긴 하위 조 ID */
  from: string;
  /** 위임 문구 또는 열거한 호 이름 */
  phrase: string;
  /** 상위 조 원문에서 위임을 보여 주는 부분(원문 그대로) */
  quote: string;
}

export interface UpwardResult {
  /** 상위 조 ID → 어느 하위 조의 상위인지 */
  articles: Map<string, UpwardLink>;
  /** 적용 범위 조 ID → 어느 조 때문에 넣었는지 */
  scope: Map<string, string>;
  /** 찾은 위아래 관계 전부(상위 조가 이미 후보에 있던 경우 포함) */
  relations: (UpwardLink & { upper: string })[];
}

interface ArticleRef {
  article: LawArticle;
  law: LawDocument;
}

interface UpwardTables {
  reverse: Map<string, { from: LawArticle; link: DelegationLink }[]>;
  schoolDelegators: { article: LawArticle; link: DelegationLink }[];
  listings: { article: LawArticle; items: string[] }[];
  scopeByLaw: Map<string, string>;
}

/** 학칙에 적을 사항을 열거한 항("학칙에는 다음 각 호의 사항을 기재하여야 한다") */
const SCHOOL_RULE_CONTENTS = /학칙[^.]{0,20}다음\s*각\s*호의\s*사항(?:을|이)\s*(?:기재|포함|적)/;
const SCOPE_TITLE = /^적용\s*범위$/;
/** 학칙 조 제목과 상위 조 제목이 이만큼 겹쳐야 같은 주제로 본다(학칙 제목 2-gram 기준) */
const TITLE_MATCH = 0.5;
/** 학칙 조 제목이 기재사항 호와 이만큼 겹쳐야 그 호로 본다 */
const ITEM_MATCH = 0.3;
/** 거슬러 올라가 더하는 조의 상한(프롬프트가 길어지지 않게) */
export const MAX_UPWARD = 6;

const tableCache = new WeakMap<object, UpwardTables>();

function buildTables(refs: Iterable<ArticleRef>): UpwardTables {
  const t: UpwardTables = { reverse: new Map(), schoolDelegators: [], listings: [], scopeByLaw: new Map() };
  for (const { article, law } of refs) {
    if (law.kind === "school_rule") continue;
    for (const link of article.links ?? []) {
      if (link.target.kind === "article") {
        const list = t.reverse.get(link.target.article_id) ?? [];
        list.push({ from: article, link });
        t.reverse.set(link.target.article_id, list);
      } else if (link.target.kind === "school_rule") {
        t.schoolDelegators.push({ article, link });
      }
    }
    const latest = article.versions.at(-1);
    for (const p of latest?.paragraphs ?? []) {
      if (p.items.length && SCHOOL_RULE_CONTENTS.test(p.text)) {
        // 삭제된 호와 "그 밖에 …" 같은 나머지 호는 주제를 가리키지 않으므로 뺀다
        t.listings.push({ article, items: p.items.map((i) => i.text).filter((x) => !/^(?:삭제(?:\s*<|$)|그\s*밖에)/.test(x.trim())) });
      }
    }
    if (law.kind === "administrative_rule" && SCOPE_TITLE.test(article.title) && !t.scopeByLaw.has(law.law_id)) {
      t.scopeByLaw.set(law.law_id, article.id);
    }
  }
  return t;
}

function gramSet(s: string): Set<string> {
  return new Set(bigrams(s));
}

/** 학칙 조와 상위 조의 주제를 견줄 때 빼는 말(어느 조에나 나와 주제를 가리지 못함) */
const GENERIC_GRAMS = new Set(["학칙", "사항", "규정"]);

/** a의 2-gram 가운데 b에 있는 비율(GENERIC_GRAMS 제외) */
function coverage(a: string, b: string): number {
  const A = new Set([...gramSet(a)].filter((g) => g.length === 2 && !GENERIC_GRAMS.has(g)));
  if (!A.size) return 0;
  const B = gramSet(b);
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n / A.size;
}

/** 위임 문구가 든 항의 문장(원문 그대로). 못 찾으면 문구 자체 */
export function delegationSentence(article: LawArticle, link: Pick<DelegationLink, "phrase" | "paragraph_no">): string {
  const latest = article.versions.at(-1);
  if (!latest) return link.phrase;
  const paragraphs = latest.paragraphs.filter((p) => !link.paragraph_no || p.no === link.paragraph_no);
  const flat = (s: string) => s.replace(/\s+/g, "");
  const phrase = flat(link.phrase);
  for (const p of paragraphs.length ? paragraphs : latest.paragraphs) {
    const sentences = p.text.split(/(?<=다\.)\s+/);
    const hit = sentences.find((s) => flat(s).includes(phrase));
    if (hit) return hit.trim();
    for (const item of p.items) if (flat(item.text).includes(phrase)) return item.text.trim();
  }
  return link.phrase;
}

/**
 * start 조들에서 위로 거슬러 올라간다(depth 단계까지, 모두 합쳐 MAX_UPWARD개까지).
 * refs는 학칙을 뺀 법령 조 전체(색인의 byId 값)이고, 표는 refs 객체마다 한 번 만든다.
 */
export function followUpward(
  start: ArticleRef[],
  refs: { values(): Iterable<ArticleRef> } & object,
  options: { depth?: number; exclude?: Set<string> } = {},
): UpwardResult {
  let tables = tableCache.get(refs);
  if (!tables) {
    tables = buildTables(refs.values());
    tableCache.set(refs, tables);
  }
  const byId = new Map<string, ArticleRef>();
  for (const r of refs.values()) byId.set(r.article.id, r);
  const result: UpwardResult = { articles: new Map(), scope: new Map(), relations: [] };
  const seen = new Set([...(options.exclude ?? []), ...start.map((s) => s.article.id)]);
  const add = (id: string, link: UpwardLink, next: ArticleRef[]) => {
    const ref = byId.get(id);
    if (!ref || id === link.from) return;
    if (!result.relations.some((r) => r.upper === id && r.from === link.from)) result.relations.push({ upper: id, ...link });
    if (seen.has(id) || result.articles.size >= MAX_UPWARD) return;
    seen.add(id);
    result.articles.set(id, link);
    next.push(ref);
  };

  let frontier = start;
  for (let level = 0; level < (options.depth ?? 2) && frontier.length; level += 1) {
    const next: ArticleRef[] = [];
    for (const { article, law } of frontier) {
      if (law.kind === "school_rule") {
        // 같은 주제로 학칙에 맡긴 조
        for (const d of tables.schoolDelegators) {
          if (coverage(article.title, d.article.title) < TITLE_MATCH) continue;
          add(d.article.id, { from: article.id, phrase: d.link.phrase, quote: delegationSentence(d.article, d.link) }, next);
        }
        // 학칙 기재사항의 해당 호
        for (const l of tables.listings) {
          let best = { score: 0, item: "" };
          for (const item of l.items) {
            const s = coverage(article.title, item);
            if (s > best.score) best = { score: s, item };
          }
          if (best.score >= ITEM_MATCH) add(l.article.id, { from: article.id, phrase: best.item, quote: best.item }, next);
        }
        continue;
      }
      // 맡긴 조가 여럿이면 이 조 본문이 조 번호로 가장 많이 가리키는 하나만("법 제6조에 따른 …")
      const sources = tables.reverse.get(article.id) ?? [];
      const text = article.versions.at(-1)?.text ?? "";
      const mentions = (a: LawArticle) => text.split(a.number).length - 1;
      const best = [...sources].sort((a, b) => mentions(b.from) - mentions(a.from))[0];
      if (best) add(best.from.id, { from: article.id, phrase: best.link.phrase, quote: delegationSentence(best.from, best.link) }, next);
      const scopeId = tables.scopeByLaw.get(law.law_id);
      if (scopeId && !seen.has(scopeId)) {
        seen.add(scopeId);
        result.scope.set(scopeId, article.id);
      }
    }
    frontier = next;
  }
  return result;
}
