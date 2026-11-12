// 근거 카드 위치 찾기와 질문 분석 보조 함수.
import { describe, expect, it } from "vitest";
import { locateQuote } from "@/lib/pipeline/cards";
import { coerceAnalysis, detectSchool, ruleBasedAnalysis, stripDates } from "@/lib/pipeline/analyze";
import { parseOpinionDeadline } from "@/lib/pipeline/collect";
import { buildTestCache } from "./support/cache";

const cache = buildTestCache();

describe("locateQuote", () => {
  const dorm = cache.articles.get("heaf:011-02")!;
  const tuition = cache.articles.get("tuition:002-00")!;

  it("항 번호부터 시작하는 인용도 그 항으로", () => {
    expect(locateQuote(dorm, "2027-03-11", "② 학교는 기숙사비와 관련한 다음 각 호의 사항을 심의하기 위하여")).toBe("제11조의2제2항");
    expect(locateQuote(dorm, "2027-03-11", "③ 그 밖에 기숙사비심의위원회의 구성ㆍ운영에 필요한 사항은 학칙으로 정한다.")).toBe("제11조의2제3항");
    expect(locateQuote(tuition, "2022-02-07", "④ 위원회의 구성단위별 위원 수")).toBe("제2조제4항");
  });

  it("호까지 찾는다", () => {
    expect(locateQuote(dorm, "2027-03-11", "기숙사비 납부에 관한 사항")).toBe("제11조의2제2항제2호");
    expect(locateQuote(tuition, "2022-02-07", "회의 개최 5일(토요일 및 공휴일은 제외한다) 전까지 송부")).toBe("제2조제6항제2호");
  });

  it("호·목 번호나 조 머리부터 시작하는 인용도 그 호·목으로", () => {
    expect(locateQuote(dorm, "2027-03-11", "2. 기숙사비 납부에 관한 사항")).toBe("제11조의2제2항제2호");
    expect(locateQuote(tuition, "2022-02-07", "2. 회의 자료: 회의 개최 5일(토요일 및 공휴일은 제외한다) 전까지 송부")).toBe("제2조제6항제2호");
    const head = dorm.versions.at(-1)!.text.split("\n")[0].slice(0, 40);
    expect(locateQuote(dorm, "2027-03-11", head)).toMatch(/^제11조의2제1항/);
  });

  it("못 찾으면 조 번호만", () => {
    expect(locateQuote(dorm, "2027-03-11", "없는 문장")).toBe("제11조의2");
  });

  it("판마다 다른 글을 본다(E23 ⑤는 2026-12-03 판에만)", () => {
    const art = cache.articles.get("heaf:034-02")!;
    const quote = "해당 외부 위원에 대하여 제3항 및 제4항을 준용한다";
    expect(locateQuote(art, "2026-12-03", quote)).toBe("제34조의2제5항");
    expect(locateQuote(art, "2026-09-11", quote)).toBe("제34조의2");
  });
});

describe("질문 분석 보조", () => {
  it("검색어의 기준일 날짜를 지운다", () => {
    expect(stripDates("부칙 시행일 2026년 11월 5일 기준")).toBe("부칙 시행일 기준");
    expect(stripDates("기숙사비 2026-11-13")).toBe("기숙사비");
    expect(stripDates("2026학년도 등록금 인상 한도")).toBe("2026학년도 등록금 인상 한도");
  });

  it("모델 출력의 학교 none은 null, 검색어가 없으면 형식 오류", () => {
    const base = { scene: "processing", task: "t", concepts: [], queries_cache: ["휴학"], queries_web: [], needs_external: false, needs_external_reason: "" };
    expect(coerceAnalysis({ ...base, school: "none" })?.school).toBeNull();
    expect(coerceAnalysis({ ...base, school: "knou" })?.school).toBe("knou");
    expect(coerceAnalysis({ ...base, queries_cache: [] })).toBeNull();
    expect(coerceAnalysis(null)).toBeNull();
  });

  it("규칙 기반 대체: 장면·학교·동의어", () => {
    const a = ruleBasedAnalysis("등심위 규정을 새로 만들려고 해요", cache.synonyms);
    expect(a.scene).toBe("initiating");
    expect(a.fallback).toBe(true);
    expect(a.queries_cache.join(" ")).toContain("등록금심의위원회");
    expect(detectSchool("방송대 교육학과 학과명")).toBe("knou");
    expect(ruleBasedAnalysis("등록금 인상 한도 공고가 나왔나요").needs_external).toBe(true);
  });
});

describe("parseOpinionDeadline", () => {
  it("'12월 7일(월)까지'를 게시 연도로", () => {
    expect(parseOpinionDeadline("10월 27일(화)부터 12월 7일(월)까지 41일간", "2026-10-27")).toBe("2026-12-07");
  });
  it("게시 월보다 앞 달이면 다음 해", () => {
    expect(parseOpinionDeadline("1월 5일까지 의견 제출", "2026-12-10")).toBe("2027-01-05");
  });
  it("없으면 undefined", () => {
    expect(parseOpinionDeadline("입법예고 안내", "2026-10-27")).toBeUndefined();
  });
});
