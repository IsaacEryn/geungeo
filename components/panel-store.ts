import { useSyncExternalStore } from "react";

/** 머리글·바닥글 버튼이 같은 패널을 열 수 있게 하는 아주 작은 공유 상태 */
export type PanelName = "coverage" | "guide";

let current: PanelName | null = null;
let trigger: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function openPanel(name: PanelName, from: HTMLElement | null) {
  current = name;
  trigger = from;
  emit();
}

export function closePanel() {
  const back = trigger;
  current = null;
  trigger = null;
  emit();
  // 연 버튼으로 초점을 돌려준다(패널 닫힘이 화면에 반영된 뒤)
  if (back && back.isConnected) requestAnimationFrame(() => back.focus());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOpenPanel(): PanelName | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
