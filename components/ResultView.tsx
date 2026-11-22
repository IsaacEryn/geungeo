import type { AskResult } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge, StatusBadge, VerdictBadge } from "./Badge";
import { EvidenceCard } from "./EvidenceCard";
import { fmt, formatKoDate } from "./format";
import { ChangeSignals, Checklist, cssId, NoBasis, SourcesUsed } from "./ResultSections";
import { TraceDetails } from "./TraceDetails";

/** 결과 화면: 결론·판정·장면 → 찾아본 범위 → 체크리스트 → 근거 카드 → 변경 신호 → 출처 → 처리 과정 */
export function ResultView({
  result,
  headingRef,
}: {
  result: AskResult;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const tr = messages.result;
  return (
    <div className="mt-6">
      <section aria-labelledby="result-heading">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="result-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
            {tr.heading}
          </h2>
          <p className="font-semibold">{fmt(tr.asOf, { date: formatKoDate(result.request.asOf) })}</p>
          <p className="text-sm text-muted">{fmt(tr.collectedAt, { date: formatKoDate(result.data_collected_at) })}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <VerdictBadge verdict={result.verdict} />
          <Badge tone="neutral">
            {tr.sceneLabel}: {tr.scenes[result.scene]}
          </Badge>
          {result.cards.some((c) => c.badge === "not_yet") ? <StatusBadge status="not_yet" /> : null}
        </div>
        <p className="mt-3 text-lg leading-relaxed">{result.summary}</p>

        {result.warnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-warn-line bg-warn-bg p-3 text-warn-fg">
            <h3 className="font-bold">{tr.warningsHeading}</h3>
            <ul className="list-disc pl-5">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.caveats.length > 0 ? (
          <div className="mt-3">
            <h3 className="font-bold">{tr.caveatsHeading}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {result.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {result.verdict === "no_basis" && result.searched_scope ? <NoBasis scope={result.searched_scope} /> : null}

      {result.checklist.length > 0 ? <Checklist items={result.checklist} cards={result.cards} /> : null}

      {result.cards.length > 0 ? (
        <section aria-labelledby="cards-heading" className="mt-8">
          <h2 id="cards-heading" className="text-xl font-bold">
            {tr.cardsHeading} <span className="text-base font-normal text-muted">{fmt(tr.cardsCount, { count: result.cards.length })}</span>
          </h2>
          <ul className="mt-3 space-y-4">
            {result.cards.map((card, index) => {
              // 같은 조를 근거·위임으로 두 번 인용하면 카드 ID가 겹친다. 체크리스트 링크는 첫 카드로 가고, 뒤 카드는 번호를 붙여 HTML id가 겹치지 않게 한다
              const nth = result.cards.slice(0, index).filter((c) => c.id === card.id).length;
              const suffix = nth ? `-${nth + 1}` : "";
              return (
                <li key={`${card.id}#${index}`} id={`card-${cssId(card.id)}${suffix}`} tabIndex={-1}>
                  <EvidenceCard card={card} headingId={`card-title-${cssId(card.id)}${suffix}`} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {result.change_signals.length > 0 ? <ChangeSignals signals={result.change_signals} /> : null}

      <SourcesUsed result={result} />

      <TraceDetails result={result} />
    </div>
  );
}
