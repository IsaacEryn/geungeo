import messages from "@/messages/ko.json";

/** 새 창 링크. 링크 문구에 무엇의 원문인지 넣고 "(새 창)"을 붙인다 */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 items-center text-primary underline underline-offset-2 hover:text-primary-strong"
    >
      <span>
        {children} <span className="whitespace-nowrap">{messages.card.newWindow}</span>
      </span>
    </a>
  );
}
