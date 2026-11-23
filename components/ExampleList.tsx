"use client";

import { useId, useState } from "react";
import messages from "@/messages/ko.json";
import { ChevronDownIcon } from "./icons";

const tf = messages.form;
const FIRST_COUNT = 4;

/**
 * 예시 질문 버튼. 누르면 질문을 채우고 바로 실행한다(AskApp의 onExample).
 * 처음엔 네 개(E09·E19·E22·E28)만 보이고 나머지는 '더 보기'로 펼친다.
 * variant "other"는 결과 아래 '다른 예시'(새 질문 시작점)
 */
export function ExampleList({
  onExample,
  variant = "first",
}: {
  onExample: (question: string) => void;
  variant?: "first" | "other";
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const items = expanded ? messages.examples : messages.examples.slice(0, FIRST_COUNT);
  const hasMore = messages.examples.length > FIRST_COUNT;
  const other = variant === "other";
  return (
    <section aria-labelledby={`${id}-h`} className={other ? "mt-10" : "mt-6"}>
      <h2 id={`${id}-h`} className="text-base font-bold">
        {other ? tf.examplesOther : tf.examplesHeading}
      </h2>
      <p className="mt-0.5 text-small text-muted">{other ? tf.examplesOtherHint : tf.examplesHint}</p>
      <ul id={`${id}-list`} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => onExample(ex.question)}
              className="flex h-full min-h-28 w-full flex-col items-start gap-2 rounded-card border border-line bg-bg p-4 text-left shadow-card hover:border-primary hover:shadow-card-hover active:border-primary-strong active:bg-primary-soft"
            >
              <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-small font-bold text-primary-strong">
                {ex.tag}
              </span>
              <span className="text-[0.9375rem] leading-snug text-fg">{ex.question}</span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-small font-semibold text-primary hover:bg-primary-soft hover:text-primary-strong active:bg-primary-soft"
        >
          {expanded ? tf.examplesLess : tf.examplesMore}
          <ChevronDownIcon size={16} className={expanded ? "rotate-180" : undefined} />
        </button>
      ) : null}
    </section>
  );
}
