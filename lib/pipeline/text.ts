// 문자열 도구: 대조용 정규화(원문 위치 되찾기 포함), 2-gram, 날짜 표기, 숫자 뽑기.

/** 대조용 문자 바꾸기: 가운뎃점·따옴표·괄호 변형을 하나로 */
const CHAR_MAP: Record<string, string> = {
  "ㆍ": "·",
  "･": "·",
  "・": "·",
  "‧": "·",
  "“": '"',
  "”": '"',
  "„": '"',
  "‘": "'",
  "’": "'",
  "「": "「",
  "｢": "「",
  "」": "」",
  "｣": "」",
  "（": "(",
  "）": ")",
  "〈": "<",
  "〉": ">",
  "＜": "<",
  "＞": ">",
  "～": "~",
};

export interface NormalizedText {
  text: string;
  /** 정규화 문자열의 i번째 글자가 원문 몇 번째 글자에서 왔는지 */
  map: number[];
}

/** 공백을 모두 지우고 문자 변형을 맞춘다. 원문 위치 표(map)를 같이 돌려준다 */
export function normalizeForMatch(source: string): NormalizedText {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (/\s/.test(ch)) continue;
    // 법령 원문의 한자는 CJK 호환 한자(예 年 U+F98E)로 들어 있는 일이 많다. 모델은 보통 통합 한자(U+5E74)로 옮겨 쓰므로 맞춘다
    const code = ch.charCodeAt(0);
    const unified = code >= 0xf900 && code <= 0xfaff ? ch.normalize("NFKC") : ch;
    text += CHAR_MAP[ch] ?? (unified.length === 1 ? unified : ch);
    map.push(i);
  }
  return { text, map };
}

/** needle이 haystack에 (정규화 뒤) 들어 있으면 원문에서의 [시작, 끝) 위치. 없으면 null */
export function findNormalized(haystack: string, needle: string): [number, number] | null {
  const h = normalizeForMatch(haystack);
  const n = normalizeForMatch(needle).text;
  if (!n) return null;
  const at = h.text.indexOf(n);
  if (at < 0) return null;
  return [h.map[at], h.map[at + n.length - 1] + 1];
}

/** 한글·영숫자 2-gram(공백·문장부호 제외) */
export function bigrams(s: string): string[] {
  const clean = s.replace(/[^0-9A-Za-z가-힣]+/g, " ").trim();
  const out: string[] = [];
  for (const word of clean.split(/\s+/)) {
    if (!word) continue;
    if (word.length === 1) {
      out.push(word);
      continue;
    }
    for (let i = 0; i < word.length - 1; i += 1) out.push(word.slice(i, i + 2));
  }
  return out;
}

/** 2-gram 다이스 계수(0~1) */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const count = new Map<string, number>();
  for (const g of A) count.set(g, (count.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of B) {
    const c = count.get(g) ?? 0;
    if (c > 0) {
      hit += 1;
      count.set(g, c - 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

/** 'YYYY-MM-DD' → '2027. 3. 11.' */
export function formatKoreanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
}

/** 요약문 등에 날짜가 어떤 표기로든 들어 있는지(2027. 3. 11. / 2027-03-11 / 2027년 3월 11일 / 2027.3.11) */
export function mentionsDate(text: string, iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const flat = text.replace(/\s+/g, "");
  const forms = [
    `${y}.${m}.${d}`,
    `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`,
    iso,
    `${y}년${m}월${d}일`,
  ];
  return forms.some((f) => flat.includes(f));
}

/** 오늘 날짜(KST) 'YYYY-MM-DD' */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 결론 문장 속 '숫자 + 단위' 표현을 뽑는다(설계 2-4의 4번: %, 일, 학기, 학점, 분의 …).
 * 날짜(2026. 12. 3.)·조 번호(제11조)는 대상이 아니다.
 */
export function extractClaimNumbers(text: string): string[] {
  const withoutDates = text
    .replace(/\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.?/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, " ")
    .replace(/제\s*\d+\s*(조|항|호)(의\s*\d+)?/g, " ");
  const re = /(\d+\s*분의\s*\d+|\d+(?:\.\d+)?\s*(?:%|퍼센트|배|일|학기|학점|개월|년|명|회|시간|주))/g;
  const found = new Set<string>();
  for (const m of withoutDates.matchAll(re)) found.add(m[1].replace(/\s+/g, ""));
  return [...found];
}
