"use client";

import { useId, useState } from "react";
import type { SchoolId } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { fmt, formatKoDate } from "./format";
import { ArrowRightIcon, ChevronDownIcon, RefreshIcon } from "./icons";

const tf = messages.form;
const SCHOOLS = Object.keys(tf.schools) as SchoolId[];

export interface QuestionFormProps {
  /** edit: 입력 카드(첫 화면·다시 묻기) / summary: 결과 모드의 한 줄 질문 */
  mode: "edit" | "summary";
  /** summary에서 보여 줄, 방금 보낸 질문 */
  asked: string;
  onAskAgain: () => void;
  question: string;
  onQuestionChange: (value: string) => void;
  questionError: string | null;
  questionRef: React.RefObject<HTMLTextAreaElement | null>;
  school: SchoolId | "";
  onSchoolChange: (value: SchoolId | "") => void;
  asOf: string;
  onAsOfChange: (value: string) => void;
  asOfError: string | null;
  asOfRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  /** 카드 맨 앞에 넣을 칸(접근 코드 입력칸 자리) */
  before?: React.ReactNode;
}

const CARD = "rounded-card border border-divider bg-bg shadow-card";

/** 질문 카드: 질문·검색 조건(학교·기준일, 접힘)·'근거 찾기' 버튼. 결과 모드에서는 질문 한 줄 + 다시 묻기. 검사와 실행은 AskApp이 맡는다 */
export function QuestionForm(props: QuestionFormProps) {
  return props.mode === "summary" ? <QuestionSummary {...props} /> : <QuestionEditor {...props} />;
}

function QuestionSummary({ asked, onAskAgain }: QuestionFormProps) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-1 p-3 sm:flex-row sm:gap-3 sm:px-5`}>
      <p className="min-w-0 flex-1 break-words py-2 leading-snug sm:overflow-hidden sm:[display:-webkit-box] sm:[-webkit-box-orient:vertical] sm:[-webkit-line-clamp:2]">
        <span className="font-bold">{tf.questionLine}: </span>
        {asked}
      </p>
      <button
        type="button"
        onClick={onAskAgain}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-bg px-3 font-semibold text-primary hover:border-primary hover:bg-primary-soft hover:text-primary-strong active:bg-primary-soft"
      >
        <RefreshIcon size={16} />
        {messages.actions.askAgain}
      </button>
    </div>
  );
}

function QuestionEditor({
  question,
  onQuestionChange,
  questionError,
  questionRef,
  school,
  onSchoolChange,
  asOf,
  onAsOfChange,
  asOfError,
  asOfRef,
  onSubmit,
  before,
}: QuestionFormProps) {
  const ids = useId();
  const questionHintId = `${ids}-q-hint`;
  const questionErrorId = `${ids}-q-error`;
  const asOfHintId = `${ids}-d-hint`;
  const asOfErrorId = `${ids}-d-error`;
  const [conditionsOpen, setConditionsOpen] = useState(false);

  const dateText = formatKoDate(asOf) || tf.conditionsNoDate;
  const schoolText = school ? tf.schools[school] : tf.schoolNone;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
      className={`${CARD} p-4 sm:p-5`}
    >
      {before ? <div className="mb-4">{before}</div> : null}
      <label htmlFor={`${ids}-q`} className="block text-card-title font-bold">
        {tf.questionLabel}
      </label>
      <p id={questionHintId} className="mt-0.5 text-small text-muted">
        {tf.questionHint}
      </p>
      <textarea
        id={`${ids}-q`}
        ref={questionRef}
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        rows={2}
        aria-invalid={questionError ? true : undefined}
        aria-describedby={questionError ? `${questionErrorId} ${questionHintId}` : questionHintId}
        className="mt-2 block min-h-24 w-full rounded-lg border border-line bg-bg px-3 py-2 text-base sm:min-h-[4.25rem]"
      />
      {questionError ? (
        <p id={questionErrorId} className="mt-1 font-semibold text-danger-fg">
          {questionError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <details
          className="group min-w-0 sm:flex-1"
          open={conditionsOpen || !!asOfError}
          onToggle={(e) => setConditionsOpen(e.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-small font-semibold text-fg [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon size={16} className="shrink-0 -rotate-90 group-open:rotate-0" />
            <span>
              {school
                ? fmt(tf.conditionsSummary, { date: dateText, school: schoolText })
                : fmt(tf.conditionsSummaryNoSchool, { date: dateText })}
            </span>
          </summary>
          <div className="flex flex-wrap items-start gap-4 pb-1 pt-2">
            <div>
              <label htmlFor={`${ids}-s`} className="block font-bold">
                {tf.schoolLabel}
              </label>
              <select
                id={`${ids}-s`}
                value={school}
                onChange={(e) => onSchoolChange(e.target.value as SchoolId | "")}
                aria-describedby={`${ids}-s-hint`}
                className="mt-2 block min-h-11 rounded-lg border border-line bg-bg px-3"
              >
                <option value="">{tf.schoolNone}</option>
                {SCHOOLS.map((id) => (
                  <option key={id} value={id}>
                    {tf.schools[id]}
                  </option>
                ))}
              </select>
              <p id={`${ids}-s-hint`} className="mt-1 max-w-xs text-small text-muted">
                {tf.schoolHint}
              </p>
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
                onChange={(e) => onAsOfChange(e.target.value)}
                aria-invalid={asOfError ? true : undefined}
                aria-describedby={asOfError ? `${asOfErrorId} ${asOfHintId}` : asOfHintId}
                className="mt-2 block min-h-11 rounded-lg border border-line bg-bg px-3"
              />
              <p id={asOfHintId} className="mt-1 text-small text-muted">
                {tf.asOfHint}
              </p>
              {asOfError ? (
                <p id={asOfErrorId} className="mt-1 font-semibold text-danger-fg">
                  {asOfError}
                </p>
              ) : null}
            </div>
          </div>
        </details>

        <button
          type="submit"
          className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-bold text-white shadow-card hover:bg-primary-strong active:bg-primary-strong active:shadow-none sm:w-auto"
        >
          {tf.submit}
          <ArrowRightIcon size={18} />
        </button>
      </div>
    </form>
  );
}
