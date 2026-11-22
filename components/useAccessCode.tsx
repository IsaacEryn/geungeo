"use client";

import { useContext } from "react";
import { AccessContext } from "./AccessGate";

/** 질문 화면이 접근 코드에 대해 아는 것. 값 보관·입력 화면은 AccessGate가 맡는다 */
export interface AccessCodeState {
  /** 지금 보낼 코드(앞뒤 공백 뺌). 없으면 빈 문자열 */
  code: string;
  /** 보내기 전 확인. 접근 코드 화면을 지나지 않았으면 그 화면으로 돌려보내고 true를 돌려준다 */
  checkMissing(): boolean;
  /** 접근 코드 입력란으로 초점을 옮긴다(화면이 떠 있을 때) */
  focus(): void;
  /** 서버가 받아 준 코드를 이 탭에 기억한다 */
  remember(code: string): void;
  /** 서버가 401로 거절했을 때: 기억한 코드를 지우고 접근 코드 화면으로 돌려보낸다 */
  reject(code: string): void;
  /** 예전에 질문 폼 안에 넣던 입력란. 이제 별도 화면이라 늘 null */
  field: React.ReactNode;
}

const NOOP: AccessCodeState = {
  code: "",
  checkMissing: () => false,
  focus: () => {},
  remember: () => {},
  reject: () => {},
  field: null,
};

export function useAccessCode(required: boolean): AccessCodeState {
  void required; // 필요 여부는 page에서 AccessGate가 받는다. 반환 모양을 유지하려고 인자는 남겨 둔다
  const ctx = useContext(AccessContext);
  if (!ctx) return NOOP;
  return {
    code: ctx.code,
    checkMissing: ctx.checkMissing,
    focus: ctx.focus,
    remember: ctx.remember,
    reject: ctx.reject,
    field: null,
  };
}
