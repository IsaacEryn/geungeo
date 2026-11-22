import messages from "@/messages/ko.json";
import { BookIcon, HelpIcon, LogoIcon } from "./icons";
import { PanelButton } from "./PanelButton";

const ta = messages.app;

const BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-bg px-3 text-small font-semibold text-fg hover:border-primary hover:text-primary";

/** 머리글(설계 4-1). 높이 56px 이상, sticky 아님. 로고+이름은 처음 화면으로 가는 링크 */
export function SiteHeader() {
  return (
    <header className="border-b border-divider bg-bg">
      <div className="mx-auto flex min-h-14 max-w-[65rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-1.5 sm:px-6">
        <div className="flex items-center gap-3">
          {/* 같은 주소로 가는 일반 링크: 누르면 새로고침되어 질문·결과가 비워진 처음 화면이 된다 */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            aria-label={ta.homeLabel}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-primary"
          >
            <LogoIcon size={28} />
            <span className="text-xl font-bold text-fg">{ta.title}</span>
          </a>
          <span className="hidden text-small text-muted sm:inline">{ta.subtitle}</span>
        </div>
        <nav aria-label={ta.helpNavLabel}>
          <ul className="flex flex-wrap items-center gap-2">
            <li>
              <PanelButton panel="coverage" className={BUTTON}>
                <BookIcon size={16} />
                {ta.coverageButton}
              </PanelButton>
            </li>
            <li>
              <PanelButton panel="guide" className={BUTTON}>
                <HelpIcon size={16} />
                {ta.guideButton}
              </PanelButton>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
