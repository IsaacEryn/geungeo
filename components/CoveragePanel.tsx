"use client";

import messages from "@/messages/ko.json";
import { Dialog } from "./Dialog";
import { closePanel, useOpenPanel } from "./panel-store";

const tc = messages.coverage;

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-card-title font-bold">{heading}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** 수록 범위·출처 패널(설계 4-2). 글은 messages.coverage의 정적 글이고 데이터를 다시 모으면 같이 고친다 */
export function CoveragePanel() {
  const open = useOpenPanel() === "coverage";
  return (
    <Dialog open={open} title={tc.title} onClose={closePanel}>
      <Section heading={tc.lawsHeading}>
        <ul className="list-disc space-y-1 pl-5">
          {tc.laws.map((law) => (
            <li key={law}>
              {law} <span className="text-small text-muted">· {tc.lawsSource}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section heading={tc.rulesHeading}>
        <p>{tc.rulesIntro}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {tc.schools.map((school) => (
            <li key={school}>{school}</li>
          ))}
        </ul>
        <p className="mt-2 text-small text-muted">{tc.rulesNote}</p>
      </Section>
      <Section heading={tc.webHeading}>
        <p>{tc.webBody}</p>
      </Section>
      <Section heading={tc.dateHeading}>
        <p>{tc.dateBody}</p>
      </Section>
      <Section heading={tc.sourcesHeading}>
        <ul className="list-disc space-y-1 pl-5">
          {tc.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>
    </Dialog>
  );
}
