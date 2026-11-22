import type { AskResult, EvidenceCard } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatKoDate } from "./format";

const t = messages.actions.text;

function isLaw(card: EvidenceCard): boolean {
  return card.grade === "L1" || card.grade === "L2";
}

/** 카드 한 장을 "제목 위치 (시행·수집 날짜) 주소" 한 줄로. 법령 카드는 시행일과 법령 데이터 수집일을 나란히 적는다 */
function cardLine(card: EvidenceCard, fallbackCollected: string): string {
  const name = [card.title, card.location].filter(Boolean).join(" ").replace(/\s+/g, " ");
  const dates: string[] = [];
  if (isLaw(card)) {
    if (card.effective_from) dates.push(fmt(t.effective, { date: formatKoDate(card.effective_from) }));
    const collected = formatKoDate(card.collected_at || fallbackCollected);
    if (collected) dates.push(fmt(t.collected, { date: collected }));
  } else {
    if (card.posted_date) dates.push(fmt(t.posted, { date: formatKoDate(card.posted_date) }));
    if (card.collected_at) dates.push(fmt(t.collectedWeb, { date: formatKoDate(card.collected_at) }));
  }
  return [name, dates.length ? `(${dates.join(" · ")})` : "", card.source_url].filter(Boolean).join(" ");
}

/** 변경 신호 한 줄: 입법예고 같은 미확정 정보. 확정 법령 근거와 섞이지 않게 따로 적는다 */
function signalLines(result: AskResult): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (url: string, line: string) => {
    const key = url.trim();
    if (key && seen.has(key)) return;
    seen.add(key);
    lines.push(`- ${line}`);
  };
  for (const s of result.change_signals) {
    const parts = [
      fmt(t.signalRelated, { law: s.related_law }),
      s.date ? fmt(t.posted, { date: formatKoDate(s.date) }) : "",
      s.opinion_deadline ? fmt(t.signalDeadline, { date: formatKoDate(s.opinion_deadline) }) : "",
    ].filter(Boolean);
    add(s.url, `${messages.signals.kinds[s.kind]} ${s.title} (${parts.join(" · ")}) ${s.url}`);
  }
  for (const c of result.cards.filter((c) => c.badge === "proposed")) {
    const name = [c.title, c.location].filter(Boolean).join(" ").replace(/\s+/g, " ");
    const date = c.posted_date ? ` (${fmt(t.posted, { date: formatKoDate(c.posted_date) })})` : "";
    add(c.source_url, `${messages.card.badges.proposed} ${name}${date} ${c.source_url}`);
  }
  return lines;
}

/**
 * 결과를 붙여 넣기 좋은 글로 바꾼다(결과 복사 버튼용).
 * 질문·기준일·판정·업무 상황 → 결론 → 주의·확인할 점 → 체크리스트 → 근거(원문 주소·시행일·수집일 포함)
 * → 변경 신호(미확정) → 면책 한 줄 순서다. 입법예고 같은 미확정 정보는 근거 목록에 넣지 않는다.
 */
export function resultToText(result: AskResult, question: string): string {
  const lines: string[] = [];
  lines.push(fmt(t.question, { question: question.trim().replace(/\s+/g, " ") }));
  lines.push(
    fmt(result.scene === "unknown" ? t.meta : t.metaScene, {
      date: formatKoDate(result.request.asOf),
      verdict: messages.result.verdicts[result.verdict],
      scene: messages.result.scenes[result.scene],
    }),
  );
  lines.push(fmt(t.summary, { summary: result.summary.trim() }));

  if (result.warnings.length > 0) {
    lines.push(t.warnings, ...result.warnings.map((w) => `- ${w}`));
  }
  if (result.caveats.length > 0) {
    lines.push(t.caveats, ...result.caveats.map((c) => `- ${c}`));
  }
  if (result.checklist.length > 0) {
    lines.push(
      t.checklist,
      ...result.checklist.map((item, i) => {
        const deadline = item.deadline ? ` (${fmt(t.deadline, { deadline: item.deadline })})` : "";
        return `${i + 1}. ${item.step}${deadline}`;
      }),
    );
  }
  if (result.verdict === "no_basis" && result.searched_scope) {
    const s = result.searched_scope;
    lines.push(
      t.scope,
      `- ${fmt(t.scopeLaws, { values: s.laws.join(", ") })}`,
      `- ${fmt(t.scopeQueries, { values: s.queries.join(", ") })}`,
      `- ${fmt(t.scopeWhere, { values: s.where_to_check.join(", ") })}`,
    );
  }
  const basis = result.cards.filter((c) => c.badge !== "proposed");
  const collected = result.data_collected_at;
  if (basis.length === 1) {
    lines.push(`${t.basis} ${cardLine(basis[0], collected)}`);
  } else if (basis.length > 1) {
    lines.push(t.basis, ...basis.map((c) => `- ${cardLine(c, collected)}`));
  }
  const signals = signalLines(result);
  if (signals.length > 0) lines.push(t.signals, ...signals);
  lines.push(t.disclaimer);
  return lines.join("\n");
}
