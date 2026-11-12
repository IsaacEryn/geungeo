"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AskResult, SchoolId, StageEvent, StageName } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { ask, AskError, demoExampleId } from "./ask-client";
import { StatusBadge, VerdictBadge, Badge } from "./Badge";
import { EvidenceCard } from "./EvidenceCard";
import { fmt, formatKoDate, isValidIsoDate, todayKst } from "./format";
import { ChangeSignals, Checklist, cssId, NoBasis, SourcesUsed } from "./ResultSections";
import { StageProgress, type StageState } from "./StageProgress";
import { TraceDetails } from "./TraceDetails";

const tf = messages.form;
const SCHOOLS = Object.keys(tf.schools) as SchoolId[];

type Phase = "idle" | "running" | "done" | "error";

export function AskApp() {
  const [question, setQuestion] = useState("");
  const [school, setSchool] = useState<SchoolId | "">("");
  const [asOf, setAsOf] = useState(todayKst);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [asOfError, setAsOfError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [stageOrder, setStageOrder] = useState<StageName[]>([]);
  const [stages, setStages] = useState<Partial<Record<StageName, StageState>>>({});
  const [result, setResult] = useState<AskResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [mock, setMock] = useState(false);

  const questionRef = useRef<HTMLTextAreaElement>(null);
  const asOfRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ids = useId();
  const questionHintId = `${ids}-q-hint`;
  const questionErrorId = `${ids}-q-error`;
  const asOfHintId = `${ids}-d-hint`;
  const asOfErrorId = `${ids}-d-error`;

  function handleEvent(event: StageEvent) {
    switch (event.type) {
      case "stage_start":
        setStageOrder((order) => (order.includes(event.stage) ? order : [...order, event.stage]));
        setStages((s) => ({ ...s, [event.stage]: { state: "running" } }));
        setLiveMessage(fmt(messages.stages.liveRunning, { stage: messages.stages.names[event.stage] }));
        break;
      case "stage_end":
        setStages((s) => ({
          ...s,
          [event.stage]: { state: event.ok ? "done" : "failed", duration_ms: event.duration_ms },
        }));
        break;
      case "result":
        setResult(event.result);
        setPhase("done");
        setLiveMessage(
          event.result.verdict === "no_basis"
            ? messages.stages.liveNoBasis
            : fmt(messages.stages.liveDone, { count: event.result.cards.length }),
        );
        // 결과 제목으로 초점을 옮겨 키보드·화면 읽기 사용자가 바로 이어 읽게 한다
        requestAnimationFrame(() => resultHeadingRef.current?.focus());
        break;
      case "error":
        showError(event.message || messages.errors[event.code]);
        break;
    }
  }

  function showError(message: string) {
    setErrorMessage(message);
    setPhase("error");
    setLiveMessage(fmt(messages.stages.liveError, { message }));
  }

  async function run(q: string) {
    const trimmed = q.trim();
    let invalid = false;
    if (!trimmed) {
      setQuestionError(tf.questionRequired);
      invalid = true;
    } else setQuestionError(null);
    if (!isValidIsoDate(asOf)) {
      setAsOfError(tf.asOfInvalid);
      invalid = true;
    } else setAsOfError(null);
    if (invalid) {
      (!trimmed ? questionRef : asOfRef).current?.focus();
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("running");
    setStageOrder([]);
    setStages({});
    setResult(null);
    setErrorMessage(null);
    setMock(false);
    setLiveMessage(fmt(messages.stages.liveRunning, { stage: messages.stages.names.analyze }));

    try {
      const outcome = await ask(
        { question: trimmed, asOf, school: school || null },
        (event) => {
          if (!controller.signal.aborted) handleEvent(event);
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setMock(outcome.mock);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AskError) {
        const key = error.code === "mock_unknown_question" ? "mockUnknownQuestion" : error.code;
        setMock(error.code === "mock_unknown_question");
        showError(messages.errors[key]);
      } else {
        showError(messages.errors.internal);
      }
    }
  }

  // 개발 서버 전용: ?demo=E22 등으로 열면 그 예시를 바로 실행한다(접근성 검사·영상 촬영)
  useEffect(() => {
    const id = demoExampleId();
    const example = id ? messages.examples.find((e) => e.id === id) : undefined;
    if (!example) return;
    const timer = setTimeout(() => onExample(example.question), 0);
    return () => clearTimeout(timer);
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(question);
  }

  function onExample(q: string) {
    setQuestion(q);
    void run(q);
  }

  const running = phase === "running";

  return (
    <>
      <section aria-labelledby="form-heading">
        <h2 id="form-heading" className="sr-only">
          {tf.heading}
        </h2>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor={`${ids}-q`} className="block font-bold">
              {tf.questionLabel}
            </label>
            <p id={questionHintId} className="mt-1 text-sm text-muted">
              {tf.questionHint}
            </p>
            <textarea
              id={`${ids}-q`}
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              aria-invalid={questionError ? true : undefined}
              aria-describedby={questionError ? `${questionErrorId} ${questionHintId}` : questionHintId}
              className="mt-2 block w-full rounded-md border border-line bg-bg px-3 py-2 text-base"
            />
            {questionError ? (
              <p id={questionErrorId} className="mt-1 font-semibold text-danger-fg">
                {questionError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div>
              <label htmlFor={`${ids}-s`} className="block font-bold">
                {tf.schoolLabel}
              </label>
              <select
                id={`${ids}-s`}
                value={school}
                onChange={(e) => setSchool(e.target.value as SchoolId | "")}
                className="mt-2 block min-h-11 rounded-md border border-line bg-bg px-3"
              >
                <option value="">{tf.schoolNone}</option>
                {SCHOOLS.map((id) => (
                  <option key={id} value={id}>
                    {tf.schools[id]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 max-w-sm">
              <label htmlFor={`${ids}-d`} className="block font-bold">
                {tf.asOfLabel}
              </label>
              <input
                id={`${ids}-d`}
                ref={asOfRef}
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                aria-invalid={asOfError ? true : undefined}
                aria-describedby={asOfError ? `${asOfErrorId} ${asOfHintId}` : asOfHintId}
                className="mt-2 block min-h-11 rounded-md border border-line bg-bg px-3"
              />
              <p id={asOfHintId} className="mt-1 text-sm text-muted">
                {tf.asOfHint}
              </p>
              {asOfError ? (
                <p id={asOfErrorId} className="mt-1 font-semibold text-danger-fg">
                  {asOfError}
                </p>
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={running}
            className="min-h-11 rounded-md bg-primary px-6 font-bold text-white hover:bg-primary-strong disabled:cursor-wait disabled:opacity-80"
          >
            {running ? tf.submitting : tf.submit}
          </button>
        </form>

        <div className="mt-6">
          <h3 className="font-bold">{tf.examplesHeading}</h3>
          <p className="text-sm text-muted">{tf.examplesHint}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {messages.examples.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => onExample(ex.question)}
                  disabled={running}
                  className="flex h-full min-h-11 w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-primary disabled:cursor-wait"
                >
                  <span className="text-sm font-bold text-primary-strong">{ex.tag}</span>
                  <span>{ex.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 상태 메시지(4.1.3): 처음부터 DOM에 두고 내용만 바꾼다 */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      <StageProgress order={stageOrder} stages={stages} />

      {mock && (phase === "done" || phase === "error") ? (
        <p className="mt-6 rounded-md border border-mock-line bg-mock-bg px-3 py-2 text-sm text-mock-fg">
          {messages.mock.banner}
        </p>
      ) : null}

      {phase === "error" && errorMessage ? (
        <p className="mt-6 rounded-md border-2 border-danger-line bg-danger-bg px-3 py-2 font-semibold text-danger-fg">
          {errorMessage}
        </p>
      ) : null}

      {result ? <ResultView result={result} headingRef={resultHeadingRef} /> : null}
    </>
  );
}

function ResultView({
  result,
  headingRef,
}: {
  result: AskResult;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const tr = messages.result;
  return (
    <div className="mt-6">
      <section aria-labelledby="result-heading">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="result-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
            {tr.heading}
          </h2>
          <p className="font-semibold">{fmt(tr.asOf, { date: formatKoDate(result.request.asOf) })}</p>
          <p className="text-sm text-muted">{fmt(tr.collectedAt, { date: formatKoDate(result.data_collected_at) })}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <VerdictBadge verdict={result.verdict} />
          <Badge tone="neutral">
            {tr.sceneLabel}: {tr.scenes[result.scene]}
          </Badge>
          {result.cards.some((c) => c.badge === "not_yet") ? <StatusBadge status="not_yet" /> : null}
        </div>
        <p className="mt-3 text-lg leading-relaxed">{result.summary}</p>

        {result.warnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-warn-line bg-warn-bg p-3 text-warn-fg">
            <h3 className="font-bold">{tr.warningsHeading}</h3>
            <ul className="list-disc pl-5">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.caveats.length > 0 ? (
          <div className="mt-3">
            <h3 className="font-bold">{tr.caveatsHeading}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {result.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {result.verdict === "no_basis" && result.searched_scope ? <NoBasis scope={result.searched_scope} /> : null}

      {result.checklist.length > 0 ? <Checklist items={result.checklist} cards={result.cards} /> : null}

      {result.cards.length > 0 ? (
        <section aria-labelledby="cards-heading" className="mt-8">
          <h2 id="cards-heading" className="text-xl font-bold">
            {tr.cardsHeading} <span className="text-base font-normal text-muted">{fmt(tr.cardsCount, { count: result.cards.length })}</span>
          </h2>
          <ul className="mt-3 space-y-4">
            {result.cards.map((card) => (
              <li key={card.id} id={`card-${cssId(card.id)}`} tabIndex={-1}>
                <EvidenceCard card={card} headingId={`card-title-${cssId(card.id)}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.change_signals.length > 0 ? <ChangeSignals signals={result.change_signals} /> : null}

      <SourcesUsed result={result} />

      <TraceDetails result={result} />
    </div>
  );
}
