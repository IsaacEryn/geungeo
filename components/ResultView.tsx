import type { AskResult } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge, StatusBadge, VerdictBadge } from "./Badge";
import { EvidenceCard } from "./EvidenceCard";
import { fmt, formatKoDate } from "./format";
import { ResultActions, type TocItem } from "./ResultActions";
import { cardAnchor, ChangeSignals, Checklist, MainBasisLine, NoBasis, SourcesUsed } from "./ResultSections";
import { RefreshIcon } from "./icons";
import { TraceDetails } from "./TraceDetails";

/**
 * 결과 화면. 1024px 이상은 2단(본문 + 곁 칸 동작·목차):
 * 결론 카드(판정·업무 상황·시행 예정 배지, 끝에 주된 근거 한 줄) → 찾아본 범위 → 체크리스트 → 근거 카드 → 변경 신호 → 출처,
 * 그 아래 전체 폭으로 처리 과정(표가 넓어 한 줄에 다 들어가야 읽힌다)
 */
export function ResultView({
  result,
  question,
  headingRef,
  onNotify,
  onAskAgain,
  progress,
}: {
  result: AskResult;
  question: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNotify: (message: string) => void;
  /** 결과 맨 아래 '새 질문하기'. 머리의 다시 묻기와 같은 동작 */
  onAskAgain: () => void;
  /** 결론 카드 바로 아래에 둘 처리 단계 요약 줄('처리 과정 보기에서 자세히' 버튼 포함). 키보드로 결론 다음에 닿게 여기에 둔다 */
  progress?: React.ReactNode;
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
            {result.scene !== "unknown" ? (
              <Badge tone="neutral">
                {tr.sceneLabel}: {tr.scenes[result.scene]}
              </Badge>
            ) : null}
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

          <MainBasisLine cards={result.cards} />
        </section>

        <ResultActions result={result} question={question} toc={toc} onNotify={onNotify} />

        <div className="min-w-0 lg:col-start-1">
          {progress}
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
                  const anchor = cardAnchor(result.cards, index);
                  return (
                    <li key={`${card.id}#${index}`} id={anchor} tabIndex={-1}>
                      <EvidenceCard card={card} headingId={anchor.replace("card-", "card-title-")} />
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

      <div className="mt-6">
        <button
          type="button"
          onClick={onAskAgain}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-bg px-4 font-semibold text-primary hover:border-primary hover:bg-primary-soft hover:text-primary-strong active:bg-primary-soft"
        >
          <RefreshIcon size={16} />
          {messages.actions.askNew}
        </button>
      </div>
    </div>
  );
}
