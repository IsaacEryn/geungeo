"use client";

import { useEffect, useId, useRef } from "react";
import messages from "@/messages/ko.json";
import { CloseIcon } from "./icons";

/**
 * 네이티브 <dialog> 틀. showModal()이 초점 가두기·Esc 닫기·배경 비활성을 맡는다.
 * 열 때 제목(h2)으로 초점을 옮기고, 닫을 때의 초점 복귀는 onClose를 부르는 쪽이 한다.
 * 닫혀 있는 동안에는 내용을 그리지 않는다(첫 화면 글에 패널 내용이 섞이지 않게).
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="gg-panel"
      onClose={onClose}
      onClick={(e) => {
        // 배경(::backdrop)을 눌러도 닫힌다. 내용 안쪽 클릭은 제외
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {open ? (
        <div className="flex min-h-full flex-col px-5 pb-8 pt-4 sm:px-6">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-bg px-3 text-small font-semibold hover:border-primary hover:text-primary"
            >
              <CloseIcon size={16} />
              {messages.app.close}
            </button>
          </div>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="mt-2 text-title font-bold">
            {title}
          </h2>
          <div className="mt-4 flex-1">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
