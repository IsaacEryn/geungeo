import messages from "@/messages/ko.json";

const tf = messages.form;

/** 접근 코드 입력칸. 값은 화면 상태와 sessionStorage에만 있고 HTML로 렌더링되지 않는다(type=password, 서버 렌더링 때는 빈 값) */
export function AccessCodeField({
  id,
  inputRef,
  value,
  onChange,
  error,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const hintId = `${id}-c-hint`;
  const errorId = `${id}-c-error`;
  return (
    <div className="max-w-sm">
      <label htmlFor={`${id}-c`} className="block font-bold">
        {tf.accessCodeLabel}
      </label>
      <p id={hintId} className="mt-1 text-sm text-muted">
        {tf.accessCodeHint}
      </p>
      <input
        id={`${id}-c`}
        ref={inputRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        className="mt-2 block min-h-11 w-full rounded-md border border-line bg-bg px-3"
      />
      {error ? (
        <p id={errorId} className="mt-1 font-semibold text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
