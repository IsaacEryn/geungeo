"use client";

import messages from "@/messages/ko.json";
import { CoveragePanel } from "./CoveragePanel";
import { GuidePanel } from "./GuidePanel";
import { ArrowRightIcon, LogoIcon } from "./icons";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { useDocTitle } from "./useDocTitle";

const ts = messages.status;

/**
 * 404·오류 화면의 공통 틀. 머리글·바닥글은 첫 화면과 같고, 가운데 카드에 무엇이 일어났는지와 다음 할 일(버튼)을 둔다.
 * 처음 화면 링크는 새로고침되는 일반 링크라 질문·결과가 비워진 상태로 돌아간다
 */
export function StatusScreen({
  title,
  body,
  code,
  action,
}: {
  title: string;
  body: string;
  /** 404 같은 짧은 코드. 보조 글로만 보인다 */
  code?: string;
  /** 처음 화면 링크 앞에 둘 주 버튼(예: 다시 시도) */
  action?: React.ReactNode;
}) {
  useDocTitle(title + messages.docTitle.suffix);

  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[65rem] flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <section
          aria-labelledby="status-heading"
          className="mx-auto max-w-[32rem] rounded-card border border-divider bg-bg p-6 text-center shadow-card sm:p-8"
        >
          <LogoIcon size={40} className="mx-auto text-primary" />
          {code ? <p className="mt-4 text-small font-semibold text-muted">{code}</p> : null}
          <h1 id="status-heading" className={`${code ? "mt-1" : "mt-4"} text-title font-bold`}>
            {title}
          </h1>
          <p className="mt-2 text-muted">{body}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {action}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-5 font-semibold ${
                action
                  ? "border border-line bg-bg text-fg hover:border-primary hover:bg-primary-soft active:bg-primary-soft"
                  : "bg-primary font-bold text-white shadow-card hover:bg-primary-strong active:shadow-none"
              }`}
            >
              {ts.home}
              <ArrowRightIcon size={16} />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
      <CoveragePanel />
      <GuidePanel />
    </>
  );
}
