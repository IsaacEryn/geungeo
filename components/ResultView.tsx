import type { AskResult } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge, StatusBadge, VerdictBadge } from "./Badge";
import { EvidenceCard } from "./EvidenceCard";
import { fmt, formatKoDate } from "./format";
import { ResultActions, type TocItem } from "./ResultActions";
import { ChangeSignals, Checklist, cssId, NoBasis, SourcesUsed } from "./ResultSections";
import { TraceDetails } from "./TraceDetails";

/**
 * 결과 화면. 1024px 이상은 2단(본문 + 곁 칸 동작·목차):
 * 결론 카드(판정·장면·시행 예정 배지) → 찾아본 범위 → 체크리스트 → 근거 카드 → 변경 신호 → 출처,
 * 그 아래 전체 폭으로 처리 과정(표가 넓어 한 줄에 다 들어가야 읽힌다)
 */
export function ResultView({
  result,
  question,
  headingRef,
  onNotify,
}: {
  result: AskResult;
  question: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNotify: (message: string) => void;
}) {
  const tr = messages.result;
  const ta = messages.actions;
  const noBasis = result.verdict === "no_basis" && result.searched_scope;

  const toc: TocItem[] = [{ href: "#result-heading", label: ta.tocConclusion }];
  if (noBasis) toc.push({ href: "#nobasis-heading", label: messages.noBasis.heading });
  if (result.checklist.length > 0) toc.push({ href: "#checklist-heading", label: ta.tocChecklist });
  if (result.cards.length > 0) toc.push({ href: "#cards-heading", label: ta.tocCards });
  if (result.change_signals.length > 0) toc.push({ href: "#signals-heading", label: ta.tocSignals });
  toc.push({ href: "#trace-details", label: ta.tocTrace });

  return (
    <div className="mt-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18.75rem] lg:gap-x-6">
        <section
          aria-labelledby="result-heading"
          className="rounded-card border border-divider bg-bg p-4 shadow-card sm:p-5 lg:col-start-1"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="result-heading" ref={headingRef} tabIndex={-1} className="text-title font-bold">
              {tr.heading}
            </h2>
            <p className="text-small font-semibold">{fmt(tr.asOf, { date: formatKoDate(result.request.asOf) })}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <VerdictBadge verdict={result.verdict} />
            <Badge tone="neutral">
              {tr.sceneLabel}: {tr.scenes[result.scene]}
            </Badge>
            {result.cards.some((c) => c.badge === "not_yet") ? <StatusBadge status="not_yet" /> : null}
          </div>
          <p className="mt-3 text-lead">{result.summary}</p>

          {result.warnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg p-3 text-warn-fg">
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

        <ResultActions result={result} question={question} toc={toc} onNotify={onNotify} />

        <div className="min-w-0 lg:col-start-1">
          {noBasis ? <NoBasis scope={result.searched_scope!} /> : null}

          {result.checklist.length > 0 ? <Checklist items={result.checklist} cards={result.cards} /> : null}

          {result.cards.length > 0 ? (
            <section aria-labelledby="cards-heading" className="mt-8">
              <h2 id="cards-heading" className="text-section font-bold">
                {tr.cardsHeading}{" "}
                <span className="text-base font-normal text-muted">{fmt(tr.cardsCount, { count: result.cards.length })}</span>
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
        </div>
      </div>

      <TraceDetails result={result} />
    </div>
  );
}
