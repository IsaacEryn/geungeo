"use client";

import { RefreshIcon } from "@/components/icons";
import { StatusScreen } from "@/components/StatusScreen";
import messages from "@/messages/ko.json";

const ts = messages.status;

/**
 * 화면을 그리다 생긴 예기치 않은 오류. 질문 처리 오류(API)는 이 화면이 아니라 AskApp의 오류 카드가 맡는다.
 * 오류 내용은 화면에 보이지 않는다(내부 정보 노출 방지). digest는 서버 기록과 맞춰 볼 수 있게 보조 글로만 둔다
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusScreen
      code={error.digest ? ts.code.replace("{code}", error.digest) : undefined}
      title={ts.errorTitle}
      body={ts.errorBody}
      action={
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 font-bold text-white shadow-card hover:bg-primary-strong active:shadow-none"
        >
          <RefreshIcon size={16} />
          {ts.retry}
        </button>
      }
    />
  );
}
