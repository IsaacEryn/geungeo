// 웹 검색 결과의 근거 등급(설계 2-2 등급표와 제외 규칙, 11/13 시험 뒤 조정판).
import type { EvidenceGrade, WebResult } from "@/lib/pipeline/types";
import { dice } from "@/lib/pipeline/text";

export interface GradeInput {
  title: string;
  url: string;
  hostname: string;
  description: string;
  date: string | null;
}

export interface GradeOutcome {
  grade: EvidenceGrade;
  excluded?: WebResult["excluded"];
  /** 게시일로 쓸 값(fileDown.do 첨부는 날짜를 비운다) */
  date: string | null;
  notes: string[];
}

// 정부 문서 표지: *.ac.kr 결과가 이걸 담으면 학교 자료가 아니라 재게시본으로 본다
const GOV_DOC_MARKERS = ["교육부", "입법예고", "보도자료", "고등교육법", "시행령", "시행규칙", "교육부령", "훈령", "법제처"];

function cleanHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www|m)\./, "");
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** 교육부 목록·메뉴 URL 제외 규칙 */
function moeExclusion(url: URL | null, title: string): WebResult["excluded"] | undefined {
  if (url) {
    if (/listRenew\.do/i.test(url.pathname)) return "list_page";
    if (/\/boardCnts\//i.test(url.pathname) && !url.searchParams.has("boardSeq")) return "list_page";
  }
  // "교육부 > 교육부 소식 > 공지사항" 같은 메뉴 경로 제목
  if (/^\s*교육부\s*>/.test(title) || (title.match(/>/g)?.length ?? 0) >= 2) return "menu_page";
  return undefined;
}

export function gradeWebResult(input: GradeInput): GradeOutcome {
  const host = cleanHost(input.hostname);
  const url = parseUrl(input.url);
  const notes: string[] = [];
  let date = input.date;

  if (host === "go.kr" || host.endsWith(".go.kr") || host === "korea.kr" || host.endsWith(".korea.kr")) {
    let excluded: WebResult["excluded"] | undefined;
    if (host === "moe.go.kr" || host.endsWith(".moe.go.kr")) excluded = moeExclusion(url, input.title);
    if (url && /fileDown\.do/i.test(url.pathname)) {
      date = null; // 첨부 내려받기 URL의 날짜는 게시일이 아니다
      notes.push("첨부 파일 — 게시일 확인 필요");
    }
    if (excluded) notes.push("목록 페이지 제외");
    return { grade: "W1", excluded, date: excluded ? null : date, notes };
  }

  if (host === "blog.naver.com") {
    const first = url?.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (first === "moeblog") {
      notes.push("교육부 공식 블로그 재게시(참고)");
      return { grade: "W1_aux", date, notes };
    }
    return { grade: "W3", date, notes: ["근거 아님 — 원문 확인 필요"] };
  }

  if (host.endsWith(".ac.kr")) {
    const hay = `${input.title} ${input.description}`;
    if (GOV_DOC_MARKERS.some((m) => hay.includes(m))) {
      notes.push("대학 게시판 재게시본(원 출처: 교육부 등) — 원문 확인 필요");
      return { grade: "W2_repost", date, notes };
    }
    notes.push("해당 학교 공개 자료 — 다른 학교로 일반화 금지");
    return { grade: "W2", date, notes };
  }

  return { grade: "W3", date, notes: ["근거 아님 — 원문 확인 필요"] };
}

/** 등급 순위(작을수록 강함). 정렬·중복 정리에 쓴다 */
export const GRADE_RANK: Record<EvidenceGrade, number> = {
  L1: 0,
  L2: 1,
  W1: 2,
  W1_aux: 3,
  W2: 4,
  W2_repost: 5,
  W3: 6,
};

/** 근거 카드로 쓸 수 있는 등급(W3는 '원문 확인 필요' 표시용) */
export function isBasisGrade(grade: EvidenceGrade): boolean {
  return grade !== "W3";
}

function titleKey(title: string): string {
  return title.replace(/[「」｢｣『』"“”'‘’()\[\]]/g, "").replace(/\s+/g, "");
}

/**
 * 같은 문서의 W1 원문이 결과에 있으면 W1_aux(교육부 블로그)·W2_repost(대학 재게시본)는 뺀다.
 * 돌려주는 값은 뺄 결과의 인덱스.
 */
export function duplicatesOfOriginals(results: { title: string; grade: EvidenceGrade; excluded?: string }[]): Set<number> {
  const originals = results.filter((r) => r.grade === "W1" && !r.excluded).map((r) => titleKey(r.title));
  const drop = new Set<number>();
  results.forEach((r, i) => {
    if (r.grade !== "W1_aux" && r.grade !== "W2_repost") return;
    const key = titleKey(r.title);
    if (originals.some((o) => o === key || dice(o, key) >= 0.7)) drop.add(i);
  });
  return drop;
}
