import type { StageName } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { Badge } from "./Badge";
import { formatDuration } from "./format";

export type StageState = { state: "running" | "done" | "failed"; duration_ms?: number };

/** 단계 진행 표시. 화면 읽기 프로그램 알림은 AskApp의 aria-live 상태 메시지가 맡는다(여기는 보이는 목록) */
export function StageProgress({ order, stages }: { order: StageName[]; stages: Partial<Record<StageName, StageState>> }) {
  const t = messages.stages;
  if (order.length === 0) return null;
  return (
    <section aria-labelledby="stages-heading" className="mt-6">
      <h2 id="stages-heading" className="sr-only">
        {t.heading}
      </h2>
      <ol className="flex flex-wrap gap-2">
        {order.map((name) => {
          const s = stages[name];
          const state = s?.state ?? "running";
          return (
            <li key={name}>
              <Badge
                tone={state === "done" ? "ok" : state === "failed" ? "danger" : "neutral"}
                icon={state === "done" ? "check" : state === "failed" ? "cross" : "clock"}
              >
                {t.names[name]} · {t.state[state]}
                {s?.duration_ms !== undefined && state === "done" ? ` (${formatDuration(s.duration_ms)})` : null}
              </Badge>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
