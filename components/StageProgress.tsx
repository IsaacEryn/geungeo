import type { StageName } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatDuration } from "./format";
import { CheckIcon, ClockIcon, XCircleIcon } from "./icons";

export type StageState = { state: "running" | "done" | "failed"; duration_ms?: number };

const ICON = { running: ClockIcon, done: CheckIcon, failed: XCircleIcon } as const;

/**
 * 진행 카드. 진행 중에는 시작된 단계를 세로 목록으로 보여 주고(글자 상태 + 아이콘, 회전 없음),
 * 결과가 오면 한 줄 요약으로 줄어든다. 화면 읽기 프로그램 알림은 AskApp의 상태 메시지가 맡는다.
 * 경과 시간처럼 계속 바뀌는 값은 넣지 않는다. 제목은 진행 중에 초점을 받는다(tabIndex -1).
 */
export function StageProgress({
  phase,
  order,
  stages,
  headingRef,
}: {
  phase: "running" | "done";
  order: StageName[];
  stages: Partial<Record<StageName, StageState>>;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  const t = messages.stages;

  if (phase === "done") {
    const doneCount = order.filter((name) => stages[name]?.state === "done").length;
    return (
      <p className="mt-3 flex items-center gap-2 text-small text-muted">
        <CheckIcon size={16} className="shrink-0 text-ok-line" />
        <span>{fmt(t.progressDone, { count: doneCount })}</span>
      </p>
    );
  }

  // 첫 단계 이벤트가 오기 전에도 '질문 분석'은 이미 시작한 것으로 보여 준다
  const shown: StageName[] = order.length > 0 ? order : ["analyze"];
  return (
    <section aria-labelledby="stages-heading" className="mt-4 rounded-card border border-divider bg-bg p-4 shadow-card sm:p-5">
      <h2 id="stages-heading" ref={headingRef} tabIndex={-1} className="text-section font-bold">
        {t.progressTitle}
      </h2>
      <p className="mt-0.5 text-small text-muted">{t.progressHint}</p>
      <ol className="mt-4 space-y-2">
        {shown.map((name) => {
          const s = stages[name];
          const state = s?.state ?? "running";
          const Icon = ICON[state];
          return (
            <li
              key={name}
              className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 ${
                state === "running" ? "border-primary bg-primary-soft" : "border-divider bg-bg"
              }`}
            >
              <Icon
                size={18}
                className={state === "done" ? "text-ok-line" : state === "failed" ? "text-danger-line" : "text-primary"}
              />
              <span className="font-semibold">{t.names[name]}</span>
              <span className="text-small text-muted">{t.state[state]}</span>
              {s?.duration_ms !== undefined && state === "done" ? (
                <span className="text-small text-muted">
                  {Math.round(s.duration_ms) === 0 ? t.noData : formatDuration(s.duration_ms)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
