"use client";

import { useEffect, useId, useRef, useState } from "react";
import messages from "@/messages/ko.json";
import { AccessCodeField } from "./AccessCodeField";
import { loadAccessCode, saveAccessCode } from "./ask-client";

const tf = messages.form;

/** 질문 화면이 접근 코드에 대해 아는 것. 값 보관·입력 화면은 이 훅과 AccessCodeField가 맡는다 */
export interface AccessCodeState {
  /** 지금 보낼 코드(앞뒤 공백 뺌). 없으면 빈 문자열 */
  code: string;
  /** 보내기 전 확인. 코드가 필요한데 비어 있으면 오류를 띄우고 true를 돌려준다 */
  checkMissing(): boolean;
  /** 입력 칸으로 초점을 옮긴다 */
  focus(): void;
  /** 서버가 받아 준 코드를 이 탭에 기억한다 */
  remember(code: string): void;
  /** 서버가 401로 거절했을 때: 기억한 코드를 지우고 입력 칸을 다시 띄운다 */
  reject(code: string): void;
  /** 질문 폼 안에 넣을 입력 칸(필요 없으면 null) */
  field: React.ReactNode;
}

export function useAccessCode(required: boolean): AccessCodeState {
  // 입력칸은 서버가 필요하다고 알렸거나(배포에 ACCESS_CODE 설정), 서버가 401로 거절했을 때만 보인다
  const [needed, setNeeded] = useState(required);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // 이 탭에서 이미 맞았던 접근 코드가 있으면 채워 둔다(서버 렌더링과 어긋나지 않게 마운트 뒤에 읽는다)
  useEffect(() => {
    const saved = loadAccessCode();
    if (!saved) return;
    const timer = setTimeout(() => setValue(saved), 0);
    return () => clearTimeout(timer);
  }, []);

  const code = value.trim();

  return {
    code,
    checkMissing() {
      const missing = needed && !code;
      setError(missing ? tf.accessCodeRequired : null);
      return missing;
    },
    focus() {
      inputRef.current?.focus();
    },
    remember(accepted) {
      saveAccessCode(accepted);
    },
    reject(sent) {
      saveAccessCode(null);
      setNeeded(true);
      setError(sent ? tf.accessCodeInvalid : tf.accessCodeRequired);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    field: needed ? (
      <AccessCodeField id={id} inputRef={inputRef} value={value} onChange={setValue} error={error} />
    ) : null,
  };
}
