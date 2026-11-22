"use client";

import { useEffect, useRef, useState } from "react";
import type { AskResult } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatKoDate } from "./format";
import { CheckIcon, CopyIcon } from "./icons";
import { resultToText } from "./resultText";

const t = messages.actions;

export interface TocItem {
  href: string;
  label: string;
}

/**
 * 결과 곁 칸: 결과 복사 버튼(보조 모양; 다시 묻기는 질문 줄에 한 번만 둔다), 이 답의 목차, 법령 데이터 수집일.
 * 1024px 이상에서는 오른쪽에 붙어 따라오고, 좁은 화면에서는 결론 아래 버튼 한 줄이 되며 목차는 숨긴다.
 * 복사 결과는 AskApp의 상태 메시지(aria-live)로 알린다(onNotify)
 */
export function ResultActions({
  result,
  question,
  toc,
  onNotify,
}: {
  result: AskResult;
  question: string;
  toc: TocItem[];
  onNotify: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(resultToText(result, question));
      setCopied(true);
      onNotify(t.liveCopied);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      onNotify(t.liveCopyFailed);
    }
  }

  const buttonBase =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 font-semibold";

  return (
    <aside aria-label={t.sideLabel} className="lg:sticky lg:top-[4.5rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
      <div className="flex flex-wrap gap-3 lg:flex-col">
        <button
          type="button"
          onClick={() => void copy()}
          className={`${buttonBase} border-line bg-bg text-primary hover:border-primary hover:bg-primary-soft hover:text-primary-strong active:bg-primary-soft lg:w-full`}
        >
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? t.copied : t.copy}
        </button>
      </div>

      <nav aria-label={t.tocLabel} className="mt-5 hidden rounded-card border border-divider bg-bg p-4 shadow-card lg:block">
        <p className="text-small font-bold">{t.tocLabel}</p>
        <ul className="mt-2 space-y-1">
          {toc.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="inline-flex min-h-8 items-center text-small text-primary underline underline-offset-2 hover:text-primary-strong"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <p className="mt-4 text-small text-muted">
        {fmt(messages.result.collectedAt, { date: formatKoDate(result.data_collected_at) })}
      </p>
    </aside>
  );
}
