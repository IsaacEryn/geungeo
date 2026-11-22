import type { AskResult, TraceCall } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatDuration, formatNumber, formatUsd } from "./format";

const t = messages.trace;

function detail(call: TraceCall): string {
  if (call.model) return call.model;
  if (call.query) return `“${call.query}”`;
  return t.none;
}

function tokens(call: TraceCall): string {
  if (!call.usage || call.api !== "router") return t.none;
  const u = call.usage;
  return `${formatNumber(u.prompt_tokens)} / ${formatNumber(u.completion_tokens)} / ${formatNumber(u.reasoning_tokens)}`;
}

/** 처리 과정 펼치기 — Liner API 호출 지점·소요 시간·토큰·금액(설계 1-1, 영상 ⑥) */
export function TraceDetails({ result }: { result: AskResult }) {
  const { trace, verification } = result;
  const linerCalls = trace.calls.filter((c) => c.api !== "cache").length;
  return (
    <details id="trace-details" className="mt-8 rounded-card border border-divider bg-bg shadow-card">
      <summary className="flex min-h-11 flex-wrap items-center gap-x-3 px-4 py-2 font-bold">
        <span>{t.summary}</span>
        <span className="text-sm font-normal text-muted">
          {fmt(t.summaryTotals, {
            count: linerCalls,
            duration: formatDuration(trace.total_duration_ms),
            cost: formatUsd(trace.total_cost_usd),
          })}
        </span>
      </summary>
      <div className="border-t border-divider px-4 py-3">
        <p className="text-sm">{t.intro}</p>

        <p className="mt-2 text-sm">
          <span className="font-semibold">{t.models}: </span>
          {t.modelAnalyze} {trace.models.analyze ?? t.none} · {t.modelAnswer} {trace.models.answer ?? t.none}
        </p>

        {/* 좁은 화면·200% 확대에서도 페이지 전체가 가로로 밀리지 않게 표만 가로 스크롤 */}
        <div className="mt-3 overflow-x-auto" role="region" aria-labelledby="trace-caption" tabIndex={0}>
          <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <caption id="trace-caption" className="pb-2 text-left font-semibold">
              {t.caption}
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="whitespace-nowrap py-1 pr-3">{t.cols.stage}</th>
                <th scope="col" className="py-1 pr-3">{t.cols.api}</th>
                <th scope="col" className="py-1 pr-3">{t.cols.detail}</th>
                <th scope="col" className="whitespace-nowrap py-1 pr-3">{t.cols.status}</th>
                <th scope="col" className="whitespace-nowrap py-1 pr-3 text-right">{t.cols.duration}</th>
                <th scope="col" className="whitespace-nowrap py-1 pr-3 text-right">{t.cols.tokens}</th>
                <th scope="col" className="whitespace-nowrap py-1 pr-3 text-right">{t.cols.cost}</th>
                <th scope="col" className="py-1">{t.cols.results}</th>
              </tr>
            </thead>
            <tbody>
              {trace.calls.map((call, i) => (
                <tr key={i} className="border-b border-divider align-top">
                  <td className="whitespace-nowrap py-1 pr-3">{messages.stages.names[call.stage]}</td>
                  <th scope="row" className={`whitespace-nowrap py-1 pr-3 ${call.api === "cache" ? "font-normal text-muted" : "font-bold"}`}>
                    {t.apis[call.api]}
                  </th>
                  <td className="py-1 pr-3">
                    {detail(call)}
                    {call.note ? <span className="block text-muted">{call.note}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3">{call.http_status ?? t.none}</td>
                  <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{formatDuration(call.duration_ms)}</td>
                  <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{tokens(call)}</td>
                  <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">
                    {call.usage ? formatUsd(call.usage.cost_usd) : t.none}
                  </td>
                  <td className="py-1">
                    {call.results && call.results.length > 0 ? (
                      <ul>
                        {call.results.map((r, j) => (
                          <li key={j}>
                            {r.hostname} ({r.grade}){r.excluded ? ` · ${t.excluded}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      t.none
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <th scope="row" colSpan={4} className="py-1 pr-3">
                  {t.total}
                </th>
                <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{formatDuration(trace.total_duration_ms)}</td>
                <td className="py-1 pr-3" />
                <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{formatUsd(trace.total_cost_usd)}</td>
                <td className="py-1" />
              </tr>
            </tfoot>
          </table>
        </div>

        <h3 className="mt-4 font-bold">{t.verification}</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li>{fmt(t.removedCitations, { count: verification.removed_citations })}</li>
          {verification.retried ? <li>{t.retried}</li> : null}
          {verification.verdict_before !== verification.verdict_after ? (
            <li>
              {fmt(t.verdictChange, {
                before: messages.result.verdicts[verification.verdict_before],
                after: messages.result.verdicts[verification.verdict_after],
              })}
            </li>
          ) : null}
          {verification.issues.map((issue, i) => (
            <li key={i}>{issue.detail}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
