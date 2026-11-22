"use client";

import { useEffect, useRef, useState } from "react";
import type { AskResult, SchoolId, StageEvent, StageName } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { ask, AskError, demoExampleId } from "./ask-client";
import { ErrorNotice, MockNotice } from "./AskNotices";
import { ExampleList } from "./ExampleList";
import { fmt, isValidIsoDate, todayKst } from "./format";
import { Hero, HeroFeatures } from "./Hero";
import { QuestionForm } from "./QuestionForm";
import { ResultView } from "./ResultView";
import { ResultSkeleton, StageProgress, type StageState } from "./StageProgress";
import { useAccessCode } from "./useAccessCode";
import { useDocTitle } from "./useDocTitle";

const tf = messages.form;

type Phase = "idle" | "running" | "done" | "error";

/**
 * 질문 → 진행 → 결과 흐름의 상태와 실행을 맡는다. 화면 조각은 Hero·QuestionForm·ExampleList·StageProgress·ResultView.
 * 질문을 보내면 결과 모드가 된다: 소개·예시는 숨고 질문은 한 줄(다시 묻기)로 줄며 진행 카드가 그 아래에 뜬다.
 */
export function AskApp({ accessCodeRequired = false }: { accessCodeRequired?: boolean }) {
  const access = useAccessCode(accessCodeRequired);
  const [question, setQuestion] = useState("");
  /** 방금 보낸 질문(결과 모드의 질문 줄·복사·다시 시도에 쓴다) */
  const [asked, setAsked] = useState("");
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
  const progressHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 입력 상태로 돌아간 뒤 초점을 줄 칸 */
  const pendingFocus = useRef<"question" | "asOf" | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 상태가 바뀐 뒤(칸이 화면에 생긴 다음) 초점을 옮긴다: 진행 카드·오류 카드 제목, 입력 상태의 칸
  useEffect(() => {
    if (phase === "running") progressHeadingRef.current?.focus();
    // 결과 제목으로 초점을 옮겨 키보드·화면 읽기 사용자가 바로 이어 읽게 한다
    else if (phase === "done") resultHeadingRef.current?.focus();
    else if (phase === "error") errorHeadingRef.current?.focus();
    else if (phase === "idle" && pendingFocus.current) {
      (pendingFocus.current === "asOf" ? asOfRef : questionRef).current?.focus();
      pendingFocus.current = null;
    }
  }, [phase]);

  // 탭 제목에 지금 상태를 적는다(찾는 중·결과·오류). 첫 화면에서는 손대지 않아 기본 제목이 남는다
  const td = messages.docTitle;
  const shortAsked = asked.length > 24 ? `${asked.slice(0, 24)}…` : asked;
  useDocTitle(
    phase === "running"
      ? fmt(td.running, { question: shortAsked }) + td.suffix
      : phase === "done"
        ? fmt(td.done, { question: shortAsked }) + td.suffix
        : phase === "error"
          ? td.error + td.suffix
          : null,
  );

  /** 상태 메시지를 다시 알린다(같은 문구여도 읽히게 한 번 비웠다가 넣는다) */
  function announce(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setLiveMessage("");
    noticeTimer.current = setTimeout(() => setLiveMessage(message), 50);
  }

  /** 입력 상태(첫 화면 구성)로 돌아간다. 질문은 그대로 두고 결과·진행은 지운다 */
  function toEdit(target: "question" | "asOf" = "question") {
    abortRef.current?.abort();
    setStageOrder([]);
    setStages({});
    setResult(null);
    setErrorMessage(null);
    setMock(false);
    setLiveMessage("");
    if (phase === "idle") {
      (target === "asOf" ? asOfRef : questionRef).current?.focus();
    } else {
      pendingFocus.current = target;
      setPhase("idle");
    }
  }

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
    const code = access.code;
    let invalid = false;
    const problems: string[] = [];
    const codeMissing = access.checkMissing();
    if (codeMissing) invalid = true;
    if (!trimmed) {
      setQuestionError(tf.questionRequired);
      problems.push(tf.questionRequired);
      invalid = true;
    } else setQuestionError(null);
    if (!isValidIsoDate(asOf)) {
      setAsOfError(tf.asOfInvalid);
      problems.push(tf.asOfInvalid);
      invalid = true;
    } else setAsOfError(null);
    if (invalid) {
      if (problems.length > 0) announce(problems.join(" "));
      if (codeMissing) access.focus();
      else if (phase === "idle") (!trimmed ? questionRef : asOfRef).current?.focus();
      else toEdit("asOf"); // 결과 모드에는 기준일 칸이 없다: 입력 상태로 돌아가 그 칸에서 고치게 한다
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAsked(trimmed);
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
        { accessCode: code || undefined },
      );
      // 서버가 받아 준 코드만 이 탭에 기억한다(틀린 코드는 401로 아래 catch에 간다)
      if (code && !outcome.mock) access.remember(code);
      if (!controller.signal.aborted) setMock(outcome.mock);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AskError && error.code === "access_denied") {
        // 접근 코드 화면으로 돌아간다(안내 글은 그 화면이 보인다). 묻던 질문은 입력 상태에 남겨 둔다
        access.reject(code);
        setPhase("idle");
        setLiveMessage("");
        return;
      }
      if (error instanceof AskError) {
        const key = error.code === "mock_unknown_question" ? "mockUnknownQuestion" : error.code;
        setMock(error.code === "mock_unknown_question");
        // 서버가 보낸 사용자용 문구가 있으면 그것을(예: 질문 길이), 없으면 코드별 기본 문구
        showError(error.message && error.message !== error.code ? error.message : messages.errors[key]);
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

  function onExample(q: string) {
    setQuestion(q);
    void run(q);
  }

  const running = phase === "running";
  const idle = phase === "idle";

  return (
    <>
      <Hero compact={!idle} />

      <section aria-labelledby="form-heading" className={idle ? "mt-5" : undefined}>
        <h2 id="form-heading" className="sr-only">
          {tf.heading}
        </h2>
        <QuestionForm
          mode={idle ? "edit" : "summary"}
          asked={asked}
          onAskAgain={() => toEdit("question")}
          before={access.field}
          question={question}
          onQuestionChange={setQuestion}
          questionError={questionError}
          questionRef={questionRef}
          school={school}
          onSchoolChange={setSchool}
          asOf={asOf}
          onAsOfChange={setAsOf}
          asOfError={asOfError}
          asOfRef={asOfRef}
          onSubmit={() => void run(question)}
        />
      </section>

      {/* 상태 메시지(4.1.3): 처음부터 DOM에 두고 내용만 바꾼다. 경과 시간처럼 계속 바뀌는 값은 넣지 않는다 */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      {idle ? (
        <>
          <ExampleList onExample={onExample} />
          <HeroFeatures />
        </>
      ) : null}

      {running ? (
        <>
          <StageProgress phase="running" order={stageOrder} stages={stages} headingRef={progressHeadingRef} />
          <ResultSkeleton />
        </>
      ) : null}

      {mock && (phase === "done" || phase === "error") ? <MockNotice /> : null}

      {phase === "error" && errorMessage ? (
        <ErrorNotice
          message={errorMessage}
          headingRef={errorHeadingRef}
          onRetry={() => void run(asked)}
          onFix={() => toEdit("question")}
        />
      ) : null}

      {result ? (
        <ResultView
          result={result}
          question={asked}
          headingRef={resultHeadingRef}
          onNotify={announce}
          onAskAgain={() => toEdit("question")}
          progress={<StageProgress phase="done" order={stageOrder} stages={stages} />}
        />
      ) : null}

      {phase === "done" || (phase === "error" && mock) ? (
        <ExampleList onExample={onExample} variant="other" />
      ) : null}
    </>
  );
}
