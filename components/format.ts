// 화면 표시용 작은 도우미. 문구는 messages/ko.json에만 둔다.

/** "{name}" 자리를 값으로 바꾼다 */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** 'YYYY-MM-DD' 또는 ISO 시각 → "2026. 11. 13." */
export function formatKoDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
}

/** 오늘 날짜(KST) 'YYYY-MM-DD' */
export function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** 1234 → "1.2초", 40 → "40ms" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}초`;
}

/** 0.0123 → "$0.0123" */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

/** 조문 원문 끝의 이력 꼬리표 "<개정 2024. 2. 20.>", "[본조신설 …]" 등 */
const AMEND_TAG = /\s*[<[]\s*(?:전문|전부|제목|본조)?(?:개정|신설|삭제|이동|종전|시행)[^>\]\n]*[>\]]/g;

/** 화면 표시용: 이력 꼬리표를 본문에서 떼어 따로 돌려준다. 원문 데이터는 바꾸지 않는다 */
export function splitAmendTags(quote: string): { body: string; tags: string[] } {
  const tags: string[] = [];
  const body = quote
    .replace(AMEND_TAG, (m) => {
      tags.push(m.trim());
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return { body, tags };
}
