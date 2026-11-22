import type { EvidenceCard as EvidenceCardData, IsoDate } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge, StatusBadge } from "./Badge";
import { ExternalLink } from "./ExternalLink";
import { fmt, formatKoDate, splitAmendTags } from "./format";

const t = messages.card;

function isLawCard(card: EvidenceCardData): boolean {
  return card.grade === "L1" || card.grade === "L2";
}

function statusLabel(card: EvidenceCardData, effective?: IsoDate): string | undefined {
  if (card.badge === "not_yet" && effective) return fmt(t.notYetFrom, { date: formatKoDate(effective) });
  return undefined;
}

/** 근거 카드(설계 2-5). 제목은 h3 — 결론·근거 목록(h2) 아래 */
export function EvidenceCard({ card, headingId }: { card: EvidenceCardData; headingId: string }) {
  const law = isLawCard(card);
  const location = card.location ?? "";
  // 이력 꼬리표는 화면에서만 본문과 떼어 접는다(원문 데이터는 그대로)
  const { body: quoteBody, tags: quoteTags } = splitAmendTags(card.quote);
  const history = Array.from(new Set([...quoteTags, ...card.amend_tags]));
  // 등급 표기는 "L1 법령·행정규칙"처럼 코드가 앞에 있다. 사람이 읽는 말을 앞에 두고 코드는 뒤에 작게 붙인다
  const gradeText = t.grades[card.grade];
  const gradeSplit = gradeText.indexOf(" ");
  const gradeCode = gradeSplit > 0 ? gradeText.slice(0, gradeSplit) : "";
  const gradeName = gradeSplit > 0 ? gradeText.slice(gradeSplit + 1) : gradeText;
  return (
    <article aria-labelledby={headingId} className="rounded-card border border-divider bg-bg p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={card.badge} label={statusLabel(card, card.effective_from)} />
        <Badge tone="neutral">
          <span className="sr-only">{t.gradeLabel}: </span>
          {gradeName}
          {gradeCode ? <span className="ml-1 text-xs font-normal opacity-80">{gradeCode}</span> : null}
        </Badge>
        <span className="text-sm text-muted">{t.roles[card.role]}</span>
        {card.changed_after_collection ? (
          <Badge tone="warn" icon="info">
            {t.changedAfterCollection}
          </Badge>
        ) : null}
      </div>

      <h3 id={headingId} className="mt-3 text-card-title font-bold">
        {card.title}
        {location ? <span className="font-bold"> {location}</span> : null}
        {card.kind ? <span className="ml-1 text-base font-normal text-muted">({t.kinds[card.kind]})</span> : null}
      </h3>

      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {law && card.effective_from ? <span>{fmt(t.effectiveFrom, { date: formatKoDate(card.effective_from) })}</span> : null}
        {!law && card.posted_date ? <span>{fmt(t.postedDate, { date: formatKoDate(card.posted_date) })}</span> : null}
        {card.collected_at ? <span>{fmt(t.collectedAt, { date: formatKoDate(card.collected_at) })}</span> : null}
      </p>

      <figure className="mt-3">
        <figcaption className="sr-only">{t.quote}</figcaption>
        <blockquote className="whitespace-pre-line border-l-4 border-primary bg-canvas px-3 py-2 text-[0.95rem]">
          {quoteBody}
        </blockquote>
      </figure>

      {history.length > 0 ? (
        <details className="mt-2 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg font-semibold text-primary hover:text-primary-strong">
            {t.amendHistory}
          </summary>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {history.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {card.notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {card.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExternalLink href={card.source_url} variant="button">
          {fmt(t.sourceLink, { title: card.title, location }).replace(/\s+/g, " ")}
        </ExternalLink>
        <p className="text-small text-muted">{card.attribution}</p>
      </div>
    </article>
  );
}
