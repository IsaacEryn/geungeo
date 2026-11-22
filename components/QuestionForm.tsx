import { useId } from "react";
import type { SchoolId } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";

const tf = messages.form;
const SCHOOLS = Object.keys(tf.schools) as SchoolId[];

export interface QuestionFormProps {
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
  running: boolean;
  onSubmit: () => void;
  /** 폼 맨 앞에 넣을 칸(접근 코드 입력칸 자리) */
  before?: React.ReactNode;
}

/** 질문 입력 폼: 질문·학교(학칙)·기준일·'근거 찾기' 버튼. 검사와 실행은 AskApp이 맡는다 */
export function QuestionForm({
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
  running,
  onSubmit,
  before,
}: QuestionFormProps) {
  const ids = useId();
  const questionHintId = `${ids}-q-hint`;
  const questionErrorId = `${ids}-q-error`;
  const asOfHintId = `${ids}-d-hint`;
  const asOfErrorId = `${ids}-d-error`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
      className="space-y-4"
    >
      {before}
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
          onChange={(e) => onQuestionChange(e.target.value)}
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
            onChange={(e) => onSchoolChange(e.target.value as SchoolId | "")}
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
            onChange={(e) => onAsOfChange(e.target.value)}
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
  );
}
