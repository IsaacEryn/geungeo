// 위임 사슬 따라가기(설계 2-2 ②-a). 수집 때 미리 만든 links를 따라 후보를 더한다.
import type { DelegationLink, LawArticle, LawDocument } from "./schema";
import type { ArticleIndex } from "./index";

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
