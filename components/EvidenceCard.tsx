import type { EvidenceCard as EvidenceCardData, IsoDate } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge, StatusBadge } from "./Badge";
import { ExternalLink } from "./ExternalLink";
import { fmt, formatKoDate } from "./format";

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
  return (
    <article aria-labelledby={headingId} className="rounded-lg border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={card.badge} label={statusLabel(card, card.effective_from)} />
        <Badge tone="neutral">
          <span className="sr-only">{t.gradeLabel}: </span>
          {t.grades[card.grade]}
        </Badge>
        <span className="text-sm text-muted">{t.roles[card.role]}</span>
        {card.changed_after_collection ? (
          <Badge tone="warn" icon="info">
            {t.changedAfterCollection}
          </Badge>
        ) : null}
      </div>

      <h3 id={headingId} className="mt-3 text-lg font-bold">
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
        <blockquote className="whitespace-pre-line border-l-4 border-line bg-surface px-3 py-2 text-[0.95rem]">
          {card.quote}
        </blockquote>
      </figure>

      {card.amend_tags.length > 0 ? (
        <p className="mt-2 text-sm text-muted">{card.amend_tags.join(" ")}</p>
      ) : null}

      {card.notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {card.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-col gap-1 text-sm">
        <ExternalLink href={card.source_url}>
          {fmt(t.sourceLink, { title: card.title, location }).replace(/\s+/g, " ")}
        </ExternalLink>
        <p className="text-muted">{card.attribution}</p>
      </div>
    </article>
  );
}
