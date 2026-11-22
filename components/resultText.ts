import type { AskResult, EvidenceCard } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatKoDate } from "./format";

const t = messages.actions.text;

/** 카드 한 장을 "제목 위치 (시행 날짜) 주소" 한 줄로 */
function cardLine(card: EvidenceCard): string {
  const name = [card.title, card.location].filter(Boolean).join(" ").replace(/\s+/g, " ");
  const date =
    card.effective_from && (card.grade === "L1" || card.grade === "L2")
      ? fmt(t.effective, { date: formatKoDate(card.effective_from) })
      : card.posted_date
        ? fmt(t.posted, { date: formatKoDate(card.posted_date) })
        : "";
  return [name, date ? `(${date})` : "", card.source_url].filter(Boolean).join(" ");
}

/**
 * 결과를 붙여 넣기 좋은 글로 바꾼다(결과 복사 버튼용).
 * 질문·기준일·판정·장면 → 결론 → 주의·확인할 점 → 체크리스트 → 근거(원문 주소 포함) → 면책 한 줄 순서다.
 */
export function resultToText(result: AskResult, question: string): string {
  const lines: string[] = [];
  lines.push(fmt(t.question, { question: question.trim().replace(/\s+/g, " ") }));
  lines.push(
    fmt(t.meta, {
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
  if (result.cards.length === 1) {
    lines.push(`${t.basis} ${cardLine(result.cards[0])}`);
  } else if (result.cards.length > 1) {
    lines.push(t.basis, ...result.cards.map((c) => `- ${cardLine(c)}`));
  }
  lines.push(t.disclaimer);
  return lines.join("\n");
}
