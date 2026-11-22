import messages from "@/messages/ko.json";

/** 목 데이터 안내 띠 */
export function MockNotice() {
  return (
    <p className="mt-6 rounded-md border border-mock-line bg-mock-bg px-3 py-2 text-sm text-mock-fg">
      {messages.mock.banner}
    </p>
  );
}

/** 요청 오류 안내(글로 알린다. 화면 읽기 알림은 AskApp의 상태 메시지가 맡는다) */
export function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="mt-6 rounded-md border-2 border-danger-line bg-danger-bg px-3 py-2 font-semibold text-danger-fg">
      {message}
    </p>
  );
}
