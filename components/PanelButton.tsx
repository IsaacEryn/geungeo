"use client";

import { useRef } from "react";
import { openPanel, type PanelName } from "./panel-store";

/** 패널을 여는 버튼. 닫을 때 이 버튼으로 초점이 돌아온다 */
export function PanelButton({
  panel,
  className,
  children,
}: {
  panel: PanelName;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      onClick={() => openPanel(panel, ref.current)}
      className={className}
    >
      {children}
    </button>
  );
}
