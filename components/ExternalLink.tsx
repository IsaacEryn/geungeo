import messages from "@/messages/ko.json";
import { ExternalIcon } from "./icons";

/**
 * 새 창 링크. 링크 문구에 무엇의 원문인지 넣고 "(새 창)"을 붙인다.
 * variant "button"은 버튼 모양(테두리·아이콘)으로 눈에 띄게 한다. 둘 다 링크다
 */
export function ExternalLink({
  href,
  children,
  variant = "text",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "text" | "button";
}) {
  const className =
    variant === "button"
      ? "inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-small font-semibold text-primary hover:bg-primary-soft hover:text-primary-strong"
      : "inline-flex min-h-6 items-center text-primary underline underline-offset-2 hover:text-primary-strong";
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      <span>
        {children} <span className="whitespace-nowrap">{messages.card.newWindow}</span>
      </span>
      {variant === "button" ? <ExternalIcon size={16} className="shrink-0" /> : null}
    </a>
  );
}
