// 결과 복사 버튼이 만드는 글(components/resultText.ts)의 모양을 본다.
import { describe, expect, it } from "vitest";
import type { AskResult, EvidenceCard } from "@/lib/pipeline/types";
import { resultToText } from "@/components/resultText";

const CARD: EvidenceCard = {
  id: "tuition_2_5",
  grade: "L1",
  role: "basis",
  title: "대학 등록금에 관한 규칙",
  kind: "ministerial_ordinance",
  location: "제2조제5항~제7항",
  quote: "원문",
  badge: "in_force",
  effective_from: "2022-02-07",
  amend_tags: [],
  source_url: "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=240223&efYd=20220207",
  attribution: "출처: 법제처 국가법령정보센터",
  changed_after_collection: false,
  notes: [],
};

function makeResult(patch: Partial<AskResult> = {}): AskResult {
  return {
    request: { question: "q", asOf: "2026-11-23", school: null, mode: "fixed" },
    data_collected_at: "2026-11-20T00:00:00+09:00",
    scene: "initiating",
    verdict: "answered",
    summary: "회의 7일 전까지 소집 공문을 보냅니다.",
    cards: [CARD],
    checklist: [],
    caveats: [],
    change_signals: [],
    searched_scope: null,
    warnings: [],
    verification: {} as AskResult["verification"],
    trace: {} as AskResult["trace"],
    ...patch,
  };
}

describe("resultToText", () => {
  it("질문·기준일·판정·업무 상황·결론·근거·면책을 차례로 적는다", () => {
    const text = resultToText(makeResult(), "등심위 첫 회의 소집 공문은 며칠 전까지 보내나요?");
    expect(text.split("\n")).toEqual([
      "[근거] 질문: 등심위 첫 회의 소집 공문은 며칠 전까지 보내나요?",
      "기준일 2026. 11. 23. · 판정: 근거 있음 · 업무 상황: 새로 시작하는 업무",
      "결론: 회의 7일 전까지 소집 공문을 보냅니다.",
      "근거: 대학 등록금에 관한 규칙 제2조제5항~제7항 (시행 2022. 2. 7. · 법령 데이터 수집 2026. 11. 20.) https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=240223&efYd=20220207",
      "법률 자문이 아닙니다. 원문을 확인해 주세요.",
    ]);
  });

  it("질문의 줄바꿈과 겹친 공백은 한 칸으로 줄인다", () => {
    const text = resultToText(makeResult(), "  첫째 줄\n  둘째   줄 ");
    expect(text.split("\n")[0]).toBe("[근거] 질문: 첫째 줄 둘째 줄");
  });

  it("확인할 점·주의·체크리스트(기한 포함)를 목록으로 적는다", () => {
    const text = resultToText(
      makeResult({
        warnings: ["숫자를 원문과 다시 확인하세요."],
        caveats: ["학칙은 학교별로 다릅니다."],
        checklist: [
          { step: "소집 공문 기안", deadline: "회의 7일 전", basis_ids: ["tuition_2_5"] },
          { step: "위원 명단 확정", basis_ids: [] },
        ],
      }),
      "q",
    );
    expect(text).toContain("주의:\n- 숫자를 원문과 다시 확인하세요.");
    expect(text).toContain("확인할 점:\n- 학칙은 학교별로 다릅니다.");
    expect(text).toContain("체크리스트:\n1. 소집 공문 기안 (기한: 회의 7일 전)\n2. 위원 명단 확정");
  });

  it("근거가 여러 장이면 목록으로, 웹 카드는 게시일을 적는다", () => {
    const web: EvidenceCard = {
      ...CARD,
      id: "w1",
      grade: "W1",
      title: "교육부 보도자료",
      location: undefined,
      effective_from: undefined,
      posted_date: "2026-10-01",
      source_url: "https://www.moe.go.kr/x",
    };
    const text = resultToText(makeResult({ cards: [CARD, web] }), "q");
    expect(text).toContain("\n근거:\n- 대학 등록금에 관한 규칙 제2조제5항~제7항 (시행 2022. 2. 7. · 법령 데이터 수집 2026. 11. 20.) https://");
    expect(text).toContain("\n- 교육부 보도자료 (게시 2026. 10. 1.) https://www.moe.go.kr/x\n");
  });

  it("근거 없음이면 찾아본 범위를 적고 근거 줄은 없다", () => {
    const text = resultToText(
      makeResult({
        verdict: "no_basis",
        cards: [],
        searched_scope: { laws: ["고등교육법"], queries: ["참석 수당"], where_to_check: ["학칙", "교육부 공고"] },
      }),
      "q",
    );
    expect(text).toContain("판정: 근거 없음");
    expect(text).toContain("찾아본 범위:\n- 본 법령: 고등교육법\n- 쓴 검색어: 참석 수당\n- 확인할 곳: 학칙, 교육부 공고");
    expect(text).not.toContain("\n근거:");
    expect(text.endsWith("원문을 확인해 주세요.")).toBe(true);
  });

  it("업무 상황을 분류하지 못했으면 그 항목을 빼고 적는다", () => {
    const text = resultToText(makeResult({ scene: "unknown" }), "q");
    expect(text.split("\n")[1]).toBe("기준일 2026. 11. 23. · 판정: 근거 있음");
  });

  it("카드마다 시행일과 법령 데이터 수집일을 따로 적고, 카드에 수집일이 있으면 그것을 쓴다", () => {
    const own: EvidenceCard = { ...CARD, id: "x", collected_at: "2026-11-13T02:17:37+09:00" };
    const text = resultToText(makeResult({ cards: [CARD, own] }), "q");
    expect(text).toContain("(시행 2022. 2. 7. · 법령 데이터 수집 2026. 11. 20.)");
    expect(text).toContain("(시행 2022. 2. 7. · 법령 데이터 수집 2026. 11. 13.)");
  });

  it("입법예고 카드와 변경 신호는 근거 목록에서 빼고 '변경 신호(미확정)'에 한 번씩만 적는다", () => {
    const notice: EvidenceCard = {
      ...CARD,
      id: "n1",
      grade: "W1",
      badge: "proposed",
      title: "고등교육법 시행령 일부개정령안 입법예고",
      location: undefined,
      effective_from: undefined,
      posted_date: "2026-11-10",
      source_url: "https://opinion.lawmaking.go.kr/n1",
    };
    const dup: EvidenceCard = { ...notice, id: "n2", location: "2쪽" };
    const text = resultToText(
      makeResult({
        cards: [CARD, notice, dup],
        change_signals: [
          {
            web_id: "w1",
            title: "고등교육법 시행령 일부개정령안",
            url: "https://opinion.lawmaking.go.kr/n1",
            hostname: "opinion.lawmaking.go.kr",
            date: "2026-11-10",
            kind: "legislative_notice",
            related_law: "고등교육법 시행령",
            opinion_deadline: "2026-12-20",
            after_collection: true,
          },
        ],
      }),
      "q",
    );
    const [basisPart, signalPart] = text.split("\n변경 신호(미확정):\n");
    expect(basisPart).toContain("근거: 대학 등록금에 관한 규칙");
    expect(basisPart).not.toContain("opinion.lawmaking.go.kr");
    expect(signalPart.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(signalPart).toContain("입법예고 고등교육법 시행령 일부개정령안 (관련 법령 고등교육법 시행령 · 게시 2026. 11. 10. · 의견 제출 마감 2026. 12. 20.) https://opinion.lawmaking.go.kr/n1");
    expect(text.indexOf("변경 신호(미확정):")).toBeLessThan(text.indexOf("법률 자문이 아닙니다"));
  });

  it("카드가 입법예고뿐이면 근거 줄 없이 변경 신호만 남는다", () => {
    const notice: EvidenceCard = { ...CARD, id: "n1", grade: "W1", badge: "proposed", effective_from: undefined, posted_date: "2026-11-10", source_url: "https://x/1" };
    const text = resultToText(makeResult({ cards: [notice] }), "q");
    expect(text).not.toContain("\n근거:");
    expect(text).toContain("변경 신호(미확정):\n- 입법예고(미확정) ");
  });
});
