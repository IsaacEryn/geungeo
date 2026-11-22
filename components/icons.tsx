import type { ReactNode, SVGProps } from "react";

/*
 * 인라인 SVG 아이콘(설계 8-4). 20×20 기준, 선 굵기 2, 색은 currentColor.
 * 아이콘만으로 뜻을 전하지 않는다. 항상 글자와 함께 쓰고 스크린 리더에는 숨긴다.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "width" | "height"> {
  /** 화면에 그리는 크기(px). 기본 20, 글줄 안에서는 16 */
  size?: number;
}

function Base({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 조문 기호 '§'를 둥근 사각형 안에 넣은 로고. 사각형은 채워지고 기호는 배경색으로 비어 보인다 */
export function LogoIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      <rect width="28" height="28" rx="7" fill="currentColor" />
      <path
        d="M17.4 9C16.9 7.7 15.6 7 13.9 7C12 7 10.6 8.1 10.6 9.4C10.6 10.9 11.8 11.2 14 11.5C16.2 11.8 17.4 12.1 17.4 13.6C17.4 14.9 16 16 14.1 16C12.3 16 11 15.3 10.5 14M17.4 14C16.9 12.7 15.6 12 13.9 12C12 12 10.6 13.1 10.6 14.4C10.6 15.9 11.8 16.2 14 16.5C16.2 16.8 17.4 17.1 17.4 18.6C17.4 19.9 16 21 14.1 21C12.3 21 11 20.3 10.5 19"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="9" cy="9" r="6" />
      <path d="m17 17-3.7-3.7" />
    </Base>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </Base>
  );
}

export function ExternalIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h9a1.5 1.5 0 0 0 1.5-1.5V12M11 3.5h5.5V9M16.5 3.5 9 11" />
    </Base>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.8" />
      <path d="M13 7V5.3A1.8 1.8 0 0 0 11.2 3.5H5.3A1.8 1.8 0 0 0 3.5 5.3v5.9A1.8 1.8 0 0 0 5.3 13H7" />
    </Base>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m4 10.5 4 4 8-9" />
    </Base>
  );
}

/** 다시 묻기 */
export function RefreshIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v4h-4" />
    </Base>
  );
}

/** 수록 범위 */
export function BookIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M10 5.5C8.6 4.4 6.6 4 3.5 4v11c3.1 0 5.1.4 6.5 1.5 1.4-1.1 3.4-1.5 6.5-1.5V4c-3.1 0-5.1.4-6.5 1.5ZM10 5.5v11" />
    </Base>
  );
}

/** 사용 안내 */
export function HelpIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.9 7.8a2.2 2.2 0 1 1 3.1 2c-.7.4-1 .8-1 1.6M10 14h.01" />
    </Base>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Base>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m5 7.5 5 5 5-5" />
    </Base>
  );
}

/** 진행 중(회전하지 않는 시계) */
export function ClockIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.8V10l2.8 1.7" />
    </Base>
  );
}

/** 실패·근거 없음 */
export function XCircleIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.3 7.3 5.4 5.4M12.7 7.3l-5.4 5.4" />
    </Base>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M10 3.2 17.5 16.2h-15L10 3.2ZM10 8v3.6M10 14h.01" />
    </Base>
  );
}

/** 대기(아직 시작하지 않은 단계) */
export function CircleIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10" cy="10" r="7.5" />
    </Base>
  );
}
