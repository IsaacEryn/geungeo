import messages from "@/messages/ko.json";
import { AlertIcon, RefreshIcon } from "./icons";

/** 목 데이터 안내 띠 */
export function MockNotice() {
  return (
    <p className="mt-4 rounded-lg border border-mock-line bg-mock-bg px-3 py-2 text-small text-mock-fg">
      {messages.mock.banner}
    </p>
  );
}

/**
 * 요청 오류 카드. 제목이 초점을 받고(tabIndex -1), 다음에 할 일을 버튼으로 준다.
 * 화면 읽기 알림은 AskApp의 상태 메시지가 맡는다
 */
export function ErrorNotice({
  message,
  headingRef,
  onRetry,
  onFix,
}: {
  message: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onRetry: () => void;
  onFix: () => void;
}) {
  const t = messages.actions;
  return (
    <section
      aria-labelledby="error-heading"
      className="mt-4 rounded-card border-2 border-danger-line bg-danger-bg p-4 sm:p-5"
    >
      <h2
        id="error-heading"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-section font-bold text-danger-fg"
      >
        <AlertIcon size={20} className="shrink-0" />
        {t.errorTitle}
      </h2>
      <p className="mt-2 font-semibold text-danger-fg">{message}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 font-bold text-white hover:bg-primary-strong"
        >
          <RefreshIcon size={16} />
          {t.retry}
        </button>
        <button
          type="button"
          onClick={onFix}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-bg px-5 font-semibold text-fg hover:bg-primary-soft"
        >
          {t.fixQuestion}
        </button>
      </div>
    </section>
  );
}
