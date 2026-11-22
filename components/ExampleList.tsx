import messages from "@/messages/ko.json";

const tf = messages.form;

/** 예시 질문 버튼. 누르면 질문을 채우고 바로 실행한다(AskApp의 onExample) */
export function ExampleList({ running, onExample }: { running: boolean; onExample: (question: string) => void }) {
  return (
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
  );
}
