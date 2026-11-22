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
  it("질문·기준일·판정·장면·결론·근거·면책을 차례로 적는다", () => {
    const text = resultToText(makeResult(), "등심위 첫 회의 소집 공문은 며칠 전까지 보내나요?");
    expect(text.split("\n")).toEqual([
      "[근거] 질문: 등심위 첫 회의 소집 공문은 며칠 전까지 보내나요?",
      "기준일 2026. 11. 23. · 판정: 근거 있음 · 장면: 업무 시작",
      "결론: 회의 7일 전까지 소집 공문을 보냅니다.",
      "근거: 대학 등록금에 관한 규칙 제2조제5항~제7항 (시행 2022. 2. 7.) https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=240223&efYd=20220207",
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
    expect(text).toContain("\n근거:\n- 대학 등록금에 관한 규칙 제2조제5항~제7항 (시행 2022. 2. 7.) https://");
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
});
