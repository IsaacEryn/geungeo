import type { StatusBadge as StatusBadgeKind, Verdict } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";

type Tone = "ok" | "warn" | "info" | "neutral" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg border-ok-line",
  warn: "bg-warn-bg text-warn-fg border-warn-line",
  info: "bg-info-bg text-info-fg border-info-line",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-line",
  danger: "bg-danger-bg text-danger-fg border-danger-line",
};

type Icon = "check" | "clock" | "dashed" | "info" | "minus" | "cross" | "half";

/** 색 말고도 모양으로 구분되게 아이콘을 붙인다(글자가 1차 정보, 아이콘은 보조) */
function BadgeIcon({ icon }: { icon: Icon }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (icon) {
    case "check":
      return (
        <svg {...common}>
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
      );
    case "dashed":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" strokeDasharray="3 2" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 4.5v.5" />
        </svg>
      );
    case "minus":
      return (
        <svg {...common}>
          <path d="M3 8h10" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case "half":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2v12" />
        </svg>
      );
  }
}

export function Badge({ tone, icon, children }: { tone: Tone; icon?: Icon; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm font-semibold leading-snug ${TONE_CLASS[tone]}`}
    >
      {icon ? <BadgeIcon icon={icon} /> : null}
      {children}
    </span>
  );
}

const STATUS: Record<StatusBadgeKind, { tone: Tone; icon: Icon }> = {
  in_force: { tone: "ok", icon: "check" },
  not_yet: { tone: "warn", icon: "clock" },
  proposed: { tone: "info", icon: "dashed" },
  reference: { tone: "neutral", icon: "info" },
  superseded: { tone: "neutral", icon: "minus" },
};

export function StatusBadge({ status, label }: { status: StatusBadgeKind; label?: string }) {
  const { tone, icon } = STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {label ?? messages.card.badges[status]}
    </Badge>
  );
}

const VERDICT: Record<Verdict, { tone: Tone; icon: Icon }> = {
  answered: { tone: "ok", icon: "check" },
  partial: { tone: "warn", icon: "half" },
  no_basis: { tone: "danger", icon: "cross" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { tone, icon } = VERDICT[verdict];
  return (
    <Badge tone={tone} icon={icon}>
      {messages.result.verdictLabel}: {messages.result.verdicts[verdict]}
    </Badge>
  );
}
