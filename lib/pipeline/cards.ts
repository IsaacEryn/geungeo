// ⑤ 근거 카드 만들기(설계 2-5).
import type { LawCache } from "@/lib/cache/load";
import type { LawArticle, ManifestEntry } from "@/lib/cache/schema";
import { gradeWebResult } from "@/lib/grade";
import { formatKoreanDate, findNormalized } from "./text";
import type { ArticleCandidate, ChangeSignal, Citation, EvidenceCard, WebResult } from "./types";


/** 인용문이 놓인 항·호·목: "제15조제1항제1호 다목" */
export function locateQuote(article: Pick<LawArticle, "number" | "versions">, effectiveFrom: string, quote: string): string {
  const version = article.versions.find((v) => v.effective_from === effectiveFrom) ?? article.versions.at(-1);
  if (!version) return article.number;
  const at = findNormalized(version.text, quote);
  if (!at) return article.number;
  // 인용이 "② …"처럼 항 번호부터 시작하면 번호·공백을 건너뛴 자리로 위치를 정한다
  let start = at[0];
  while (start < at[1] && /[\s①-⑳]/.test(version.text[start])) start += 1;
  const within = (part: string) => {
    const r = findNormalized(version.text, part);
    return r !== null && r[0] <= start && start < r[1];
  };
  let location = article.number;
  for (const p of version.paragraphs) {
    const inParagraph = within(p.text) || p.items.some((i) => within(i.text) || i.subitems.some((s) => within(s.text)));
    if (!inParagraph) continue;
    if (p.no) location += `제${p.no}항`;
    for (const item of p.items) {
      const sub = item.subitems.find((s) => within(s.text));
      if (sub) return `${location}제${item.no}호 ${sub.no}목`;
      if (within(item.text)) return `${location}제${item.no}호`;
    }
    return location;
  }
  return location;
}

function manifestEntry(cache: LawCache, lawId: string): ManifestEntry | undefined {
  return cache.manifest.entries.find((e) => e.id === lawId);
}

function lawAttribution(cache: LawCache, cand: ArticleCandidate): string {
  const entry = manifestEntry(cache, cand.law_id);
  if (entry?.attribution) return entry.attribution;
  // 학칙은 대학명을 먼저(저작권법 제37조②, 설계 2-5)
  return cand.kind === "school_rule" ? `출처: ${cand.law_name}, 법제처 국가법령정보센터 게재본` : "출처: 법제처 국가법령정보센터";
}

function webAttribution(w: WebResult): string {
  if (w.hostname.endsWith("moe.go.kr")) return "출처: 교육부(moe.go.kr)";
  if (w.hostname.endsWith("moleg.go.kr") || w.hostname.endsWith("lawmaking.go.kr")) return `출처: 법제처(${w.hostname})`;
  if (w.hostname.endsWith("law.go.kr")) return "출처: 법제처 국가법령정보센터";
  return `출처: ${w.hostname}`;
}

export interface CardInput {
  citations: Citation[];
  candidates: ArticleCandidate[];
  web: WebResult[];
  signals: ChangeSignal[];
  cache: LawCache;
}

export function buildCards(input: CardInput): EvidenceCard[] {
  const candidates = new Map(input.candidates.map((c) => [c.id, c]));
  const web = new Map(input.web.map((w) => [w.id, w]));
  const signalByWeb = new Map(input.signals.map((s) => [s.web_id, s]));
  const changedLaws = new Set(input.signals.filter((s) => s.after_collection).map((s) => s.related_law));
  const cards: EvidenceCard[] = [];

  for (const c of input.citations) {
    const cand = candidates.get(c.id);
    if (cand) {
      const article = input.cache.articles.get(cand.id.split("@")[0]) ?? input.cache.laws.get(cand.law_id)?.articles.find((a) => a.id === cand.id.split("@")[0]);
      const version = article?.versions.find((v) => v.effective_from === cand.effective_from);
      const notes: string[] = [];
      if (cand.status === "not_yet") notes.push(`${formatKoreanDate(cand.effective_from)} 시행 예정 — 기준일 현재 적용 안 됨`);
      if (cand.status === "superseded") notes.push("이전 판");
      if (cand.delegated_to_school_rule) notes.push("학칙으로 위임 — 학교별 확인");
      const changed = changedLaws.has(cand.law_name);
      if (changed) notes.push("수집 뒤 변경 가능성 — 최근 변경 신호 확인");
      cards.push({
        id: c.id,
        grade: cand.grade,
        role: c.role,
        title: cand.law_name,
        kind: cand.kind,
        location: article ? locateQuote(article, cand.effective_from, c.quote) : cand.number,
        quote: c.quote,
        badge: cand.status,
        effective_from: cand.effective_from,
        amend_tags: version?.amend_tags ?? [],
        source_url: cand.source_url,
        collected_at: manifestEntry(input.cache, cand.law_id)?.collected_at ?? input.cache.collectedAt,
        attribution: lawAttribution(input.cache, cand),
        changed_after_collection: changed,
        notes,
      });
      continue;
    }
    const w = web.get(c.id);
    if (!w) continue;
    const signal = signalByWeb.get(w.id);
    const notes = [...gradeWebResult(w).notes.filter((n) => n !== "목록 페이지 제외")];
    if (signal?.kind === "legislative_notice") {
      notes.unshift(
        `입법예고(확정 전)${signal.opinion_deadline ? ` — 의견 제출 ~${formatKoreanDate(signal.opinion_deadline)}` : ""}`,
      );
    }
    notes.push("검색 결과 게시일(참고)");
    cards.push({
      id: c.id,
      grade: w.grade,
      role: c.role,
      title: w.title,
      quote: c.quote,
      badge: signal?.kind === "legislative_notice" ? "proposed" : "reference",
      amend_tags: [],
      source_url: w.url,
      posted_date: w.date,
      attribution: webAttribution(w),
      changed_after_collection: Boolean(signal?.after_collection),
      notes,
    });
  }
  return cards;
}
