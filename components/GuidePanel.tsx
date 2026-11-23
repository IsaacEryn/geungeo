"use client";

import messages from "@/messages/ko.json";
import { Dialog } from "./Dialog";
import { closePanel, useOpenPanel } from "./panel-store";

/** 사용 안내 패널(설계 4-3). 따라 하는 순서대로 짧게 */
export function GuidePanel() {
  const open = useOpenPanel() === "guide";
  return (
    <Dialog open={open} title={messages.guide.title} onClose={closePanel}>
      <ol role="list" className="space-y-3">
        {messages.guide.steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-small font-bold text-white"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <h3 className="mt-6 text-card-title font-bold">{messages.guide.terms.heading}</h3>
      <dl className="mt-2 space-y-3">
        {messages.guide.terms.items.map((item) => (
          <div key={item.term}>
            <dt className="font-bold">{item.term}</dt>
            <dd className="text-muted">{item.body}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
