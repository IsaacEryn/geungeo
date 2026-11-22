import messages from "@/messages/ko.json";

const tf = messages.form;

/**
 * 접근 코드 입력란(비제어). 값은 화면 상태에 묶지 않고 제출할 때 ref로만 읽는다.
 * 그래서 서버 HTML에도 브라우저 DOM의 value 속성에도 코드가 남지 않는다(type=password).
 */
export function AccessCodeField({
  id,
  inputRef,
  error,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  error: string | null;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block font-bold">
        {tf.accessCodeLabel}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-bg px-3"
      />
      {error ? (
        <p id={errorId} className="mt-2 font-semibold text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
