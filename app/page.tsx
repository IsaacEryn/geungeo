import { AskApp } from "@/components/AskApp";
import messages from "@/messages/ko.json";

// 한 화면(설계 7절). 질문·결과는 components/AskApp이 맡고, 파이프라인 연결은 components/ask-client.ts 한 곳이다.
export default function Home() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto max-w-4xl px-4 py-6">
          <h1 className="text-3xl font-bold">{messages.app.title}</h1>
          <p className="mt-1">{messages.app.description}</p>
          <p className="mt-1 text-sm text-muted">{messages.app.tagline}</p>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8">
        <AskApp />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-muted">
          <p>{messages.footer.source}</p>
          <p>{messages.footer.disclaimer}</p>
        </div>
      </footer>
    </>
  );
}
