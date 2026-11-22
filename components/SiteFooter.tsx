import messages from "@/messages/ko.json";
import { PanelButton } from "./PanelButton";

/** 바닥글(설계 4-4). 대학 이름·출처 줄은 두지 않고 수록 범위 패널로 안내한다 */
export function SiteFooter() {
  return (
    <footer className="border-t border-divider bg-bg">
      <div className="mx-auto flex max-w-[65rem] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 text-small text-muted sm:px-6">
        <p>{messages.footer.disclaimer}</p>
        <PanelButton
          panel="coverage"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2 hover:text-primary-strong"
        >
          {messages.footer.coverageButton}
        </PanelButton>
      </div>
    </footer>
  );
}
