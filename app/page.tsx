import messages from "@/messages/ko.json";

// 화면 뼈대. 질문 입력·결과 표시는 화면 작업자가 components/에서 채운다.
export default function Home() {
  return (
    <>
      <header className="mx-auto max-w-3xl px-4 pt-8">
        <h1 className="text-2xl font-bold">{messages.app.title}</h1>
        <p className="mt-1 text-muted">{messages.app.description}</p>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <p>{messages.app.wip}</p>
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-sm text-muted">
        <p>{messages.footer.source}</p>
        <p>{messages.footer.disclaimer}</p>
      </footer>
    </>
  );
}
