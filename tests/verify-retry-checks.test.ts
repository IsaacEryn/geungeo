// ④ 재질문 조건: 근거 여부 판단을 미룬 결론, 근거로 든 조문을 스스로 부정한 결론, 조 번호 없이 조문을 가리킨 결론.
// 예문은 모두 가상 규정이다. 흔한 정상 답에서는 걸리지 않아야 한다(걸리면 ③을 한 번 더 불러 답이 느려진다).
import { describe, expect, it } from "vitest";
import { hasUnnumberedReference, isHedgedBasis, mentionsArticle, unnamedBasisArticles, verifyDraft } from "@/lib/pipeline/verify";
import type { ArticleCandidate, DraftAnswer } from "@/lib/pipeline/types";

/** verifyDraft가 두 검사로 재질문하는 조건과 같다(근거 없음 판정은 뺀다) */
function flagged(summary: string, basis: string[]): boolean {
  return isHedgedBasis(summary) || unnamedBasisArticles(summary, basis.map((number) => ({ number }))).length > 0;
}

/** 업무 여러 갈래의 정상 결론. 근거로 [업무 행위]를 할 수 있다, 다른 조문을 직접 근거 아님으로 밝힘, 조 번호 있는 단서 등 */
const NORMAL: [string, string[]][] = [
  ["휴학 신청은 학사 운영 규정 제12조를 근거로 학기 개시 30일 전까지 할 수 있습니다.", ["제12조"]],
  ["학생은 학사 운영 규정 제30조를 근거로 성적 정정을 요청할 수 있습니다.", ["제30조"]],
  ["장학금 지급 규정 제7조를 근거로 성적 우수 장학금을 지급할 수 있습니다.", ["제7조"]],
  ["물품 계약 규정 제15조를 근거로 수의계약을 체결할 수 있으며, 추정가격 2천만 원 이하일 때에 한합니다.", ["제15조"]],
  ["등록금 반환 규정 제5조를 근거로 반환 공문을 보낼 수 있습니다.", ["제5조"]],
  ["직원 인사 규정 제21조를 근거로 육아휴직을 허가해야 합니다. 제22조는 이 질문의 직접 근거는 아닙니다.", ["제21조"]],
  ["연구비 관리 규정 제9조를 근거로 판단합니다. 제11조는 직접적인 근거가 아닙니다.", ["제9조"]],
  [
    "기숙사 운영 규정 제4조를 근거로 퇴사 처리를 할 수 있습니다. 같은 규정 제6조는 입사 기간 자체를 정한 조항은 아니므로 참고로만 봅니다.",
    ["제4조"],
  ],
  ["등록금 반환 규정 제5조에 따라 반환해야 합니다. 제8조는 반환 금액 자체를 정한 조항은 아닙니다.", ["제5조"]],
  ["물품 계약 규정 제15조를 근거로 계약을 진행하되, 제20조의 하자 보수는 직접 근거가 아닙니다.", ["제15조"]],
  ["연구비 관리 규정 제12조의2를 근거로 연구비 지급을 중지할 수 있습니다. 제12조는 직접 근거가 아닙니다.", ["제12조의2"]],
  ["강사 위촉 규정 제3조 단서에 따라 겸임교원에게는 이 규정을 적용하지 않습니다.", ["제3조"]],
  ["직원 인사 규정 제2조의 적용 제외 단서에 따라 계약직 직원은 빠집니다.", ["제2조"]],
  ["장학금 지급 규정 제7조를 근거로 지급하고, 같은 조 단서에 따라 휴학생은 제외합니다.", ["제7조"]],
  [
    "학사 운영 규정 제12조에 따라 휴학할 수 있습니다. 이 조항에 따라 휴학 기간은 통산 3년을 넘을 수 없습니다. 복학은 제14조가 정합니다.",
    ["제12조", "제14조"],
  ],
  [
    "학사 운영 규정 제14조를 근거로 복학 신청을 받을 수 있습니다. 다만 입영 휴학은 제16조가 정하므로 그 조항에 따라 처리합니다.",
    ["제14조", "제16조"],
  ],
  ["판단할 단서가 자료에 없어 학과 사무실에 확인해야 합니다.", ["제5조"]],
  ["연구비 관리 규정 제18조를 근거로 사용 실적을 보고해야 합니다.", ["제18조"]],
  ["장학금은 장학금 지급 규정을 근거로 처리합니다.", ["제3조"]],
  ["물품 계약 규정 제10조를 근거로 계약 보증금을 면제할 수는 있지만, 계약 금액이 5천만 원 이하일 때만입니다.", ["제10조"]],
  ["기숙사 운영 규정 제9조를 근거로 삼을 수 없습니다. 이 조항은 직접 근거가 아닙니다.", ["제11조"]],
  ["직원 인사 규정 제21조를 근거로 들어 승진 심사를 진행하면 됩니다.", ["제21조"]],
  ["연구비 관리 규정 제12조를 근거로 볼 때 회의비는 집행할 수 있습니다.", ["제12조"]],
  ["직원 인사 규정 제30조를 근거로 징계위원회를 열어야 합니다. 이 규정의 세부 기준은 시행세칙에서 정합니다.", ["제30조"]],
  ["교원 연수 규정 제8조를 근거로 해외 연수를 승인할 수 있고, 승인 전에 학과장 의견을 들어야 합니다.", ["제8조"]],
  ["외부 강의는 겸직 규정 제4조에 따라 신고해야 하며, 사전 신고 없이 할 수 없습니다.", ["제4조"]],
];

/** 걸려야 하는 결론: 근거 여부 판단을 미룸, 근거로 든 그 조문을 스스로 부정, 조 번호 없는 지칭 */
const SHOULD_FLAG: [string, string[]][] = [
  ["학사 운영 규정 제12조를 근거로 제시할 수 있습니다.", ["제12조"]],
  ["기숙사 운영 규정 제4조가 퇴사 처리의 근거가 될 수 있습니다.", ["제4조"]],
  ["장학금 지급 규정 제7조를 근거로 삼을 수 있습니다.", ["제7조"]],
  ["물품 계약 규정 제15조를 근거로 볼 여지가 있습니다.", ["제15조"]],
  ["연구비 관리 규정 제9조를 근거로 회의비를 집행할 수 있습니다. 다만 이 조항은 회의비 집행 자체를 정한 규정은 아닙니다.", ["제9조"]],
  ["직원 인사 규정 제21조를 근거로 처리하되, 육아휴직 기간을 직접 정한 조항은 아닙니다.", ["제21조"]],
  ["등록금 반환 규정 제5조를 근거로 반환합니다. 제5조는 이 질문의 직접 근거는 아닙니다.", ["제5조"]],
  ["휴학생은 적용 범위의 단서에 따라 이 규정을 적용받지 않습니다.", ["제3조"]],
  ["신설 조항에 따라 연구비를 정산해야 합니다.", ["제11조의2"]],
  ["학사 운영 규정 제12조에 따라 휴학할 수 있습니다. 적용 범위 단서에 따라 시간제 학생은 제외됩니다.", ["제12조", "제2조"]],
];

describe("정상 결론 반례 세트", () => {
  it(`정상 결론 ${NORMAL.length}개는 하나도 걸리지 않는다`, () => {
    expect(NORMAL.length).toBeGreaterThanOrEqual(20);
    expect(NORMAL.filter(([s, b]) => flagged(s, b)).map(([s]) => s)).toEqual([]);
  });
  it(`걸려야 하는 결론 ${SHOULD_FLAG.length}개는 모두 걸린다`, () => {
    expect(SHOULD_FLAG.length).toBeGreaterThanOrEqual(8);
    expect(SHOULD_FLAG.filter(([s, b]) => !flagged(s, b)).map(([s]) => s)).toEqual([]);
  });
});

describe("isHedgedBasis", () => {
  it("근거 여부 판단을 미룬 표현을 잡는다", () => {
    expect(isHedgedBasis("제9조가 근거가 될 수 있습니다.")).toBe(true);
    expect(isHedgedBasis("이 조항을 근거로 원용할 수도 있습니다.")).toBe(true);
    expect(isHedgedBasis("제3조를 근거로 해석할 여지가 있습니다.")).toBe(true);
  });
  it("근거로 [업무 행위]를 할 수 있다는 결론은 잡지 않는다", () => {
    expect(isHedgedBasis("주차장 관리 규정 제7조를 근거로 주차 위반 차량에 경고장을 붙일 수 있습니다.")).toBe(false);
    expect(isHedgedBasis("이 규정을 근거로 처리합니다.")).toBe(false);
  });
  it("근거로 든 조문을 같은 문장이나 바로 다음 문장에서 부정하면 잡는다", () => {
    expect(isHedgedBasis("제7조를 근거로 들되 이 조항은 야간 개방 자체를 정한 규정은 아닙니다.")).toBe(true);
    expect(isHedgedBasis("제7조를 근거로 공지합니다. 그러나 해당 규정은 공지 기간을 직접 정한 조항은 아닙니다.")).toBe(true);
  });
  it("다른 참고 조문만 부정했으면 잡지 않는다", () => {
    expect(isHedgedBasis("제5조를 근거로 처리합니다. 제8조는 대출 연체를 정한 조문으로 이 질문의 직접 근거는 아닙니다.")).toBe(false);
    expect(isHedgedBasis("제5조를 근거로 처리합니다. 대출 기간은 정해야 합니다. 이 조항은 직접 근거가 아닙니다.")).toBe(false);
  });
});

describe("조 번호 없이 조문을 가리킨 결론", () => {
  it("번호 없는 단서 조항, '…조항에 따라'를 찾는다", () => {
    expect(hasUnnumberedReference("적용 범위의 단서에 따라 단기 숙박 시설에는 적용되지 않습니다.")).toBe(true);
    expect(hasUnnumberedReference("관련 조항에 따라 정해야 합니다.")).toBe(true);
    expect(hasUnnumberedReference("단서 조항이 있어 예외가 인정됩니다.")).toBe(true);
  });
  it("'실마리' 뜻의 단서는 잡지 않는다", () => {
    expect(hasUnnumberedReference("판단할 단서가 자료에 없습니다.")).toBe(false);
    expect(hasUnnumberedReference("단서를 찾으려면 학과에 문의하세요.")).toBe(false);
  });
  it("바로 앞에 조·항 번호가 있거나 앞에서 번호를 든 조문을 '이 조항'으로 가리키면 번호를 쓴 것으로 본다", () => {
    expect(hasUnnumberedReference("제2조 단서에 따라 단기 숙박 시설은 빠집니다.")).toBe(false);
    expect(hasUnnumberedReference("제2조의 적용 제외 단서에 따라 단기 숙박 시설은 빠집니다.")).toBe(false);
    expect(hasUnnumberedReference("같은 조 제1항 단서는 단기 숙박 시설을 뺍니다.")).toBe(false);
    expect(hasUnnumberedReference("제4조가 점호를 정합니다. 이 조항에 따라 점호는 매일 합니다.")).toBe(false);
    expect(hasUnnumberedReference("이 조항에 따라 점호는 매일 합니다.")).toBe(true);
  });
  it("조 번호는 '제11조'와 '제11조의2'를 구분한다", () => {
    expect(mentionsArticle("제11조의2에 따라", "제11조")).toBe(false);
    expect(mentionsArticle("제11조의2에 따라", "제11조의2")).toBe(true);
    expect(mentionsArticle("제 11 조에 따라", "제11조")).toBe(true);
    expect(mentionsArticle("제111조에 따라", "제11조")).toBe(false);
  });
  it("근거 조 번호가 결론에 모두 있으면 번호 없는 말이 있어도 걸리지 않는다", () => {
    expect(unnamedBasisArticles("관련 조항에 따라 정합니다. 운영 규정 제5조가 그 조문입니다.", [{ number: "제5조" }])).toEqual([]);
  });
});

function cand(partial: Partial<ArticleCandidate> & Pick<ArticleCandidate, "id" | "number" | "text">): ArticleCandidate {
  return {
    law_id: partial.id.split(":")[0],
    law_name: "기숙사 운영 규정",
    kind: "admin_rule",
    title: "",
    effective_from: "2020-01-01",
    effective_to: null,
    status: "in_force",
    grade: "L1",
    source_url: "https://example.org/",
    score: 1,
    via: "search",
    delegated_to_school_rule: false,
    ...partial,
  } as ArticleCandidate;
}

const SCOPE = cand({
  id: "dorm_rule:002-00",
  number: "제2조",
  text: "제2조(적용 범위) 이 규정은 학생 기숙사에 적용한다. 다만, 단기 숙박 시설은 제외한다.",
});
const DUTY = cand({
  id: "dorm_rule:005-00",
  number: "제5조",
  text: "제5조(운영 기준) 기숙사는 다음 각 호의 사항을 정하여야 한다.\n1. 점호 시간\n2. 외박 신고 절차",
});

function draft(partial: Partial<DraftAnswer>): DraftAnswer {
  return { verdict: "answered", summary: "", citations: [], checklist: [], caveats: [], searched_scope: null, ...partial };
}

function run(summary: string, verdict: DraftAnswer["verdict"] = "answered") {
  return verifyDraft({
    draft: draft({
      verdict,
      summary,
      citations: [
        { id: SCOPE.id, quote: "다만, 단기 숙박 시설은 제외한다.", role: "basis" },
        { id: DUTY.id, quote: "기숙사는 다음 각 호의 사항을 정하여야 한다.", role: "basis" },
      ],
    }),
    candidates: [SCOPE, DUTY],
    web: [],
    signals: [],
    asOf: "2026-11-05",
  });
}

describe("verifyDraft 재질문", () => {
  it("단서를 번호 없이 말하고 그 조 번호가 결론에 없으면 한 번 다시 묻고 이유를 남긴다", () => {
    const out = run("단기 숙박 시설은 점호 시간을 정하지 않아도 됩니다. 적용 범위의 단서에 따라 제5조가 적용되지 않기 때문입니다.");
    expect(out.issues.map((i) => i.kind)).toEqual(["unnamed_article"]);
    expect(out.issues[0].citation_id).toBe(SCOPE.id);
    expect(out.needs_retry).toBe(true);
    expect(out.retry_reasons).toEqual(["unnamed_article"]);
    expect(out.feedback).toContain("기숙사 운영 규정 제2조");
    expect(out.verdict_after).toBe("answered");
  });
  it("같은 내용이라도 조 번호를 쓰면 그대로 둔다", () => {
    const out = run("단기 숙박 시설은 점호 시간을 정하지 않아도 됩니다. 제2조 단서에 따라 제5조가 적용되지 않기 때문입니다.");
    expect(out.issues).toEqual([]);
    expect(out.needs_retry).toBe(false);
    expect(out.retry_reasons).toEqual([]);
  });
  it("번호 없는 말이 없으면 근거 조 번호가 결론에 없어도 묻지 않는다", () => {
    const out = run("단기 숙박 시설은 점호 시간을 정하지 않아도 됩니다. 외박 신고 절차는 정해야 합니다.");
    expect(out.needs_retry).toBe(false);
  });
  it("근거 여부 판단을 미룬 결론은 hedged_basis로 다시 묻는다", () => {
    const out = run("제5조를 근거로 제시할 수 있습니다. 제2조도 함께 보세요.");
    expect(out.issues.map((i) => i.kind)).toContain("hedged_basis");
    expect(out.needs_retry).toBe(true);
    expect(out.retry_reasons).toEqual(["hedged_basis"]);
  });
  it("근거로 [업무 행위]를 할 수 있다는 결론에 다른 조문의 직접 근거 아님을 덧붙여도 묻지 않는다", () => {
    const out = run("제5조를 근거로 점호 시간을 정할 수 있습니다. 제2조는 점호의 직접 근거는 아닙니다.");
    expect(out.needs_retry).toBe(false);
  });
  it("근거 없음 판정에는 두 검사를 하지 않는다", () => {
    const out = run("직접 정한 조항은 아니어서 관련 조항에 따라 판단할 수 없습니다. 이를 근거로 제시할 수 있는 조문은 없습니다.", "no_basis");
    expect(out.needs_retry).toBe(false);
  });
});
