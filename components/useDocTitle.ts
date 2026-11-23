"use client";

import { useEffect } from "react";
import messages from "@/messages/ko.json";

/** 기본 탭 제목(layout metadata의 기본 제목과 같다) */
export const BASE_TITLE = `${messages.app.title} - ${messages.app.subtitle}`;

/**
 * 화면 상태에 맞춰 탭 제목을 바꾼다. title이 null이면 손대지 않는다.
 * Next가 metadata의 <title>을 하이드레이션 뒤에 다시 쓰는 일이 있어, 맡은 동안은 head를 지켜보다 되돌린다.
 * 맡기를 그만두면(값이 바뀌거나 사라질 때) 기본 제목으로 돌려놓는다
 */
export function useDocTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = BASE_TITLE;
    };
  }, [title]);
}
