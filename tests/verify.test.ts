// ④ 코드 검증: 지어낸 인용 제거, 인용문 교정, 시행 예정 조문, 숫자 대조, 근거 없음 전환.
import { describe, expect, it } from "vitest";
import { checkQuote, NO_BASIS_SUMMARY, verifyDraft } from "@/lib/pipeline/verify";
import { collectFromCache } from "@/lib/pipeline/collect";
import { ruleBasedAnalysis } from "@/lib/pipeline/analyze";
import type { ArticleCandidate, DraftAnswer, WebResult } from "@/lib/pipeline/types";
import { usageCost } from "@/lib/liner/cost";
import { buildTestCache } from "./support/cache";

const cache = buildTestCache();

function candidates(question: string, asOf = "2026-11-05"): ArticleCandidate[] {
  return collectFromCache({ question, analysis: ruleBasedAnalysis(question, cache.synonyms), asOf, cache, schoolRules: null }).candidates;
}

const E22 = candidates("기숙사비심의위원회를 만들어야 한다는 법이 생겼다던데, 지금 당장 설치해야 하나요?");
const QUOTE_22 = "학교는 기숙사비와 관련한 다음 각 호의 사항을 심의하기 위하여";

const web: WebResult[] = [
  {
    id: "web:1",
    title: "2026학년도 등록금 인상 한도 3.19%",
    url: "https://www.yna.co.kr/view/1",
    hostname: "yna.co.kr",
    date: "2025-12-30",
    description: "교육부는 2026학년도 대학 등록금 법정 인상 한도를 3.19%로 공고했다.",
    grade: "W3",
    query: "q",
  },
  {
    id: "web:2",
    title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙」 입법예고",
    url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=107492",
    hostname: "moe.go.kr",
    date: "2026-10-27",
    description: "10월 27일(화)부터 12월 7일(월)까지 41일간 입법 예고",
    grade: "W1",
    query: "q",
  },
];

function draft(partial: Partial<DraftAnswer>): DraftAnswer {
  return { verdict: "answered", summary: "", citations: [], checklist: [], caveats: [], searched_scope: null, ...partial };
}

describe("checkQuote", () => {
  const source = "② 학교는 교직원ㆍ학생 등으로 구성되는 위원회를 설치ㆍ운영하여야 한다.\n③ 그 밖에 필요한 사항은 학칙으로 정한다.";
  it("공백·가운뎃점 차이는 원문 그대로로 돌려준다", () => {
    expect(checkQuote(source, "교직원·학생 등으로  구성되는 위원회를")).toEqual({ status: "exact", quote: "교직원ㆍ학생 등으로 구성되는 위원회를" });
  });
  it("조금 바꿔 쓴 인용은 가장 비슷한 문장으로 교정", () => {
    const res = checkQuote(source, "학교는 교직원과 학생 등으로 구성되는 위원회를 설치ㆍ운영해야 한다.");
    expect(res.status).toBe("corrected");
    if (res.status === "corrected") expect(source).toContain(res.quote);
  });
  it("원문에 없는 말은 missing", () => {
    expect(checkQuote(source, "총장은 매년 연구년 교원을 선발한다.").status).toBe("missing");
  });
  it("…로 이은 인용은 조각이 모두 있으면 가장 긴 조각만", () => {
    const res = checkQuote(source, "교직원ㆍ학생 등으로 구성되는 위원회를 … 학칙으로 정한다");
    expect(res).toEqual({ status: "corrected", quote: "교직원ㆍ학생 등으로 구성되는 위원회를" });
  });
});

describe("verifyDraft", () => {
  it("후보에 없는 ID와 원문에 없는 인용은 빼고, 남는 근거가 없으면 근거 없음", () => {
    const out = verifyDraft({
      draft: draft({
        summary: "사립학교법 제99조에 따라 연구년을 둘 수 있습니다.",
        citations: [
          { id: "pslaw:099-00", quote: "연구년을 둘 수 있다", role: "basis" },
          { id: "heaf:011-02", quote: "교원은 연구년을 신청할 수 있다", role: "basis" },
        ],
      }),
      candidates: E22,
      web,
      signals: [],
      asOf: "2026-11-05",
    });
    expect(out.issues.map((i) => i.kind)).toEqual(["unknown_id", "quote_not_found", "no_citations_left"]);
    expect(out.removed_citations).toBe(2);
    expect(out.verdict_before).toBe("answered");
    expect(out.verdict_after).toBe("no_basis");
    expect(out.draft.summary).toBe(NO_BASIS_SUMMARY);
    expect(out.needs_retry).toBe(true);
  });

  it("E22: 시행 예정 조문을 시행일 없이 말하면 partial로 낮추고 시행일 문구를 붙인다", () => {
    const out = verifyDraft({
      draft: draft({ summary: "기숙사비심의위원회를 설치해야 합니다.", citations: [{ id: "heaf:011-02", quote: QUOTE_22, role: "basis" }] }),
      candidates: E22,
      web,
      signals: [],
      asOf: "2026-11-05",
    });
    expect(out.verdict_after).toBe("partial");
    expect(out.issues.map((i) => i.kind)).toContain("not_yet_as_current");
    expect(out.draft.caveats.join(" ")).toContain("2027. 3. 11.부터 시행");
  });

  it("E22: 시행일을 말했으면 그대로 둔다", () => {
    const out = verifyDraft({
      draft: draft({
        summary: "아직 의무가 아닙니다. 제11조의2는 2027. 3. 11.부터 시행되며 학생 위원은 10분의 3 이상이어야 합니다.",
        citations: [{ id: "heaf:011-02", quote: QUOTE_22, role: "basis" }],
      }),
      candidates: E22,
      web,
      signals: [],
      asOf: "2026-11-05",
    });
    expect(out.verdict_after).toBe("answered");
    expect(out.issues).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("인용 원문에 없는 숫자는 경고, 언론에만 있는 숫자는 w3_number", () => {
    const out = verifyDraft({
      draft: draft({
        summary: "2027. 3. 11.부터 시행되며 학생 위원은 3분의 1 이상, 인상 한도는 3.19%입니다.",
        citations: [
          { id: "heaf:011-02", quote: QUOTE_22, role: "basis" },
          { id: "web:1", quote: "3.19%로 공고했다", role: "basis" },
        ],
      }),
      candidates: E22,
      web,
      signals: [],
      asOf: "2026-11-05",
    });
    const kinds = out.issues.map((i) => i.kind);
    expect(kinds).toContain("number_unsupported");
    expect(kinds).toContain("w3_number");
    expect(out.warnings.some((w) => w.includes("3.19%") && w.includes("원문 확인"))).toBe(true);
    // W3는 근거가 될 수 없어 참고로 낮춘다
    expect(out.draft.citations.find((c) => c.id === "web:1")?.role).toBe("reference");
  });

  it("입법예고 웹 결과는 참고로만 남는다", () => {
    const out = verifyDraft({
      draft: draft({
        summary: "입법예고 중이며 확정 전입니다.",
        citations: [{ id: "web:2", quote: "12월 7일(월)까지 41일간 입법 예고", role: "basis" }],
      }),
      candidates: E22,
      web,
      signals: [
        {
          web_id: "web:2",
          title: "",
          url: "",
          hostname: "moe.go.kr",
          date: "2026-10-27",
          kind: "legislative_notice",
          related_law: "고등교육법",
          after_collection: true,
        },
      ],
      asOf: "2026-11-05",
    });
    expect(out.draft.citations[0].role).toBe("reference");
    expect(out.verdict_after).toBe("no_basis");
  });

  it("모델이 스스로 근거 없음이라 하면 참고 조문을 남긴 채 그대로", () => {
    const pslaw = candidates("사립대 교원 연구년 근무장소 외 연수");
    const out = verifyDraft({
      draft: draft({
        verdict: "no_basis",
        summary: "법령상 직접 근거는 없습니다.",
        citations: [{ id: "pslaw:055-03", quote: "소속 학교의 장의 승인을 받아 연수기관이나 근무장소 외의 시설 또는 장소에서 연수를 받을 수 있다", role: "reference" }],
        searched_scope: { laws: ["사립학교법"], queries: ["연구년"], where_to_check: ["학교법인 정관"] },
      }),
      candidates: pslaw,
      web: [],
      signals: [],
      asOf: "2026-11-05",
    });
    expect(out.verdict_after).toBe("no_basis");
    expect(out.issues).toEqual([]);
    expect(out.draft.citations).toHaveLength(1);
    expect(out.draft.searched_scope?.where_to_check).toEqual(["학교법인 정관"]);
  });
});

describe("usageCost", () => {
  it("11/13 시험의 실제 차감액과 같은 계산(입력 338·출력 495 → $0.002813)", () => {
    const c = usageCost("liner-mark-1.3", { prompt_tokens: 338, completion_tokens: 495, completion_tokens_details: { reasoning_tokens: 297 } });
    expect(c.cost_usd).toBeCloseTo(0.002813, 9);
    expect(c.priced).toBe(true);
  });
  it("단가 모르는 모델은 0과 priced:false", () => {
    expect(usageCost("liner-claude-router", { prompt_tokens: 10, completion_tokens: 10 })).toMatchObject({ cost_usd: 0, priced: false });
  });
});
