import type { AskResult, ChangeSignal, ChecklistItem, EvidenceCard, SearchedScope } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge } from "./Badge";
import { ExternalLink } from "./ExternalLink";
import { XCircleIcon } from "./icons";
import { fmt, formatKoDate } from "./format";

/** 체크리스트의 근거 ID → 카드 안 이름(같은 화면 안 링크) */
function cardLabel(cards: EvidenceCard[], id: string): { href: string; label: string } | null {
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  return { href: `#card-${cssId(id)}`, label: [card.title, card.location].filter(Boolean).join(" ") };
}

export function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function Checklist({ items, cards }: { items: ChecklistItem[]; cards: EvidenceCard[] }) {
  const t = messages.checklist;
  return (
    <section aria-labelledby="checklist-heading" className="mt-8">
      <h2 id="checklist-heading" className="text-section font-bold">
        {t.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{t.intro}</p>
      <ol className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={`${index}-${item.step}`} className="flex gap-3 rounded-card border border-divider bg-bg p-3 shadow-card sm:p-4">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{item.step}</p>
              {item.deadline ? (
                <p className="mt-1 text-small">
                  <span className="font-bold">{t.deadline}: </span>
                  <span className="font-semibold text-warn-fg">{item.deadline}</span>
                </p>
              ) : null}
              {item.basis_ids.length > 0 ? (
                <p className="mt-1 text-sm text-muted">
                  <span className="font-semibold">{t.basis}: </span>
                  {item.basis_ids.map((id, i) => {
                    const target = cardLabel(cards, id);
                    return (
                      <span key={id}>
                        {i > 0 ? ", " : null}
                        {target ? (
                          <a href={target.href} className="text-primary underline underline-offset-2">
                            {target.label}
                          </a>
                        ) : (
                          id
                        )}
                      </span>
                    );
                  })}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ChangeSignals({ signals }: { signals: ChangeSignal[] }) {
  const t = messages.signals;
  return (
    <section aria-labelledby="signals-heading" className="mt-8">
      <h2 id="signals-heading" className="text-section font-bold">
        {t.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{t.intro}</p>
      <ul className="mt-3 space-y-3">
        {signals.map((signal) => (
          <li key={signal.web_id} className="rounded-card border border-dashed border-info-line bg-bg p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" icon="dashed">
                {t.kinds[signal.kind]}
              </Badge>
              {signal.after_collection ? (
                <Badge tone="warn" icon="info">
                  {t.afterCollection}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 font-semibold">{signal.title}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">
              <span>
                {t.relatedLaw}: {signal.related_law}
              </span>
              {signal.date ? <span>{fmt(t.posted, { date: formatKoDate(signal.date) })}</span> : null}
              {signal.opinion_deadline ? (
                <span>{fmt(t.deadline, { date: formatKoDate(signal.opinion_deadline) })}</span>
              ) : null}
              <span>{signal.hostname}</span>
            </p>
            <p className="mt-1 text-sm">
              <ExternalLink href={signal.url}>{fmt(t.linkLabel, { title: signal.title })}</ExternalLink>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NoBasis({ scope }: { scope: SearchedScope }) {
  const t = messages.noBasis;
  const groups: [string, string[]][] = [
    [t.laws, scope.laws],
    [t.queries, scope.queries],
    [t.whereToCheck, scope.where_to_check],
  ];
  return (
    <section aria-labelledby="nobasis-heading" className="mt-6 rounded-card border-2 border-danger-line bg-bg p-4 sm:p-5">
      <h2 id="nobasis-heading" className="flex items-center gap-2 text-section font-bold text-danger-fg">
        <XCircleIcon size={20} className="shrink-0" />
        {t.heading}
      </h2>
      <p className="mt-1">{t.intro}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {groups.map(([label, values]) => (
          <div key={label} className="rounded-lg bg-canvas p-3">
            <h3 className="font-bold">{label}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {values.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 카드에 나온 출처 표기를 모아 보여 준다(학칙은 대학명 먼저 — 카드의 attribution을 그대로) */
export function SourcesUsed({ result }: { result: AskResult }) {
  const attributions = Array.from(new Set(result.cards.map((c) => c.attribution)));
  if (attributions.length === 0) return null;
  return (
    <section aria-labelledby="sources-heading" className="mt-8">
      <h2 id="sources-heading" className="text-section font-bold">
        {messages.result.sourcesHeading}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {attributions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </section>
  );
}
