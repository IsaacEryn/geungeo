"use client";

import { createContext, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import messages from "@/messages/ko.json";
import { AccessCodeField } from "./AccessCodeField";
import { accessCodeFromHash, loadAccessCode, saveAccessCode } from "./ask-client";
import { useDocTitle } from "./useDocTitle";

const tf = messages.form;
const ta = messages.access;

/** 질문 화면이 접근 코드에 대해 아는 것. useAccessCode가 이 값을 읽어 돌려준다 */
export interface AccessContextValue {
  /** 지금 보낼 코드(앞뒤 공백 뺌). 접근 코드 화면을 지나지 않았으면 빈 문자열 */
  code: string;
  /** 접근 코드 화면이 떠 있는 동안 true */
  locked: boolean;
  checkMissing(): boolean;
  focus(): void;
  remember(code: string): void;
  reject(sent: string): void;
}

export const AccessContext = createContext<AccessContextValue | null>(null);

/**
 * 접근 코드 화면(설계 6절). 코드가 필요한 배포에서 처음 한 번 보이고, 값은 메모리와 sessionStorage에만 둔다.
 * 질문 화면(children)은 접근 코드 화면이 떠 있는 동안에도 마운트된 채 숨겨 둬서, 묻던 질문이 그대로 남는다.
 */
export function AccessGate({ required, children }: { required: boolean; children: React.ReactNode }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const afterEntry = useRef(false);
  const id = useId();
  const locked = required && !code;

  // 주소에 #code=…가 있거나 이 탭에서 이미 맞았던 코드가 있으면 화면을 건너뛴다(서버 렌더링과 어긋나지 않게
  // 마운트 뒤에 읽는다). 주소의 코드는 읽자마자 주소창과 방문 기록에서 지우고, 새로 고쳐도 다시 묻지 않게 이 탭에
  // 기억해 둔다. 틀린 코드면 첫 질문의 401에서 reject가 지우고 접근 코드 화면을 다시 띄운다.
  // 이미 열린 탭에서 #code=…만 바꿔 넣으면 다시 로드되지 않으므로 hashchange도 듣는다.
  // 되살린 코드는 입력란에 넣지 않고 메모리에만 둔다
  useEffect(() => {
    function takeFromUrl(): string | null {
      const { code: fromUrl, rest } = accessCodeFromHash(window.location.hash);
      if (rest !== window.location.hash) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + rest);
      }
      if (fromUrl && required) saveAccessCode(fromUrl);
      return fromUrl;
    }
    const fromUrl = takeFromUrl();
    if (!required) return;
    function onHashChange() {
      const next = takeFromUrl();
      if (!next) return;
      setError(null);
      setCode(next);
    }
    window.addEventListener("hashchange", onHashChange);
    const next = fromUrl ?? loadAccessCode()?.trim();
    const timer = next ? setTimeout(() => setCode(next), 0) : undefined;
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [required]);

  // 접근 코드 화면이 떠 있는 동안 탭 제목을 바꾼다. 풀리면 기본 제목으로 돌아간다
  useDocTitle(locked ? messages.docTitle.access + messages.docTitle.suffix : null);

  // 코드를 넣고 질문 화면으로 넘어온 직후에는 질문 입력란으로 초점을 옮긴다
  useEffect(() => {
    if (locked || !afterEntry.current) return;
    afterEntry.current = false;
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus());
  }, [locked]);

  // 오류를 띄울 때마다 수를 올려, 접근 코드 화면이 다시 그려진 뒤(effect) 입력란으로 초점을 옮긴다.
  // 401로 화면이 새로 마운트되는 경우에도 입력란이 생긴 다음에 초점이 가도록 rAF 대신 effect를 쓴다
  const [errorSeq, setErrorSeq] = useState(0);
  useEffect(() => {
    if (errorSeq > 0 && locked) inputRef.current?.focus();
  }, [errorSeq, locked]);

  const showError = useCallback((message: string) => {
    setError(message);
    setErrorSeq((n) => n + 1);
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      code,
      locked,
      checkMissing() {
        if (locked) showError(tf.accessCodeRequired);
        return locked;
      },
      focus() {
        inputRef.current?.focus();
      },
      remember(accepted) {
        saveAccessCode(accepted);
      },
      reject(sent) {
        saveAccessCode(null);
        setCode("");
        showError(sent ? tf.accessCodeInvalid : tf.accessCodeRequired);
      },
    }),
    [code, locked, showError],
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const entered = input.value.trim();
    input.value = "";
    if (!entered) {
      showError(tf.accessCodeRequired);
      return;
    }
    setError(null);
    afterEntry.current = true;
    setCode(entered);
  }

  return (
    <AccessContext.Provider value={value}>
      {locked ? (
        <section className="mx-auto max-w-[25rem] rounded-card border border-divider bg-bg p-5 shadow-card sm:p-6">
          <h1 className="text-title font-bold">{ta.title}</h1>
          <p className="mt-2 text-muted">{ta.description}</p>
          <form onSubmit={submit} noValidate className="mt-5 space-y-4">
            <AccessCodeField id={`${id}-code`} inputRef={inputRef} error={error} />
            <button
              type="submit"
              className="min-h-12 w-full rounded-lg bg-primary px-4 font-bold text-white shadow-card hover:bg-primary-strong active:shadow-none"
            >
              {ta.submit}
            </button>
          </form>
        </section>
      ) : null}
      <div hidden={locked}>{children}</div>
    </AccessContext.Provider>
  );
}
