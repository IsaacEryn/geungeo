// ④ 재질문 조건: 에둘러 근거로 삼은 결론, 조 번호 없이 조문을 가리킨 결론. 정상 답에서는 걸리지 않아야 한다.
import { describe, expect, it } from "vitest";
import { hasUnnumberedReference, isHedgedBasis, mentionsArticle, unnamedBasisArticles, verifyDraft } from "@/lib/pipeline/verify";
import type { ArticleCandidate, DraftAnswer } from "@/lib/pipeline/types";

function cand(partial: Partial<ArticleCandidate> & Pick<ArticleCandidate, "id" | "number" | "text">): ArticleCandidate {
  return {
    law_id: partial.id.split(":")[0],
    law_name: "도서관 운영 규정",
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
  id: "lib_rule:002-00",
  number: "제2조",
  text: "제2조(적용 범위) 이 규정은 대학 도서관에 적용한다. 다만, 분관에는 제5조제1호를 적용하지 아니한다.",
});
const DUTY = cand({
  id: "lib_rule:005-00",
  number: "제5조",
  text: "제5조(운영 기준) 도서관은 다음 각 호의 사항을 정하여야 한다.\n1. 열람실 개방 시간\n2. 자료 대출 기간",
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
        { id: SCOPE.id, quote: "다만, 분관에는 제5조제1호를 적용하지 아니한다.", role: "basis" },
        { id: DUTY.id, quote: "도서관은 다음 각 호의 사항을 정하여야 한다.", role: "basis" },
      ],
    }),
    candidates: [SCOPE, DUTY],
    web: [],
    signals: [],
    asOf: "2026-11-05",
  });
}

describe("isHedgedBasis", () => {
  it("'근거로 …할 수 있다'처럼 판단을 미룬 결론은 잡는다", () => {
    expect(isHedgedBasis("주차장 관리 규정 제7조를 근거로 공문을 보낼 수 있습니다.")).toBe(true);
    expect(isHedgedBasis("이 조항을 근거로 내부 지침을 마련할 수 있습니다.")).toBe(true);
    expect(isHedgedBasis("제9조가 근거가 될 수 있습니다.")).toBe(true);
  });
  it("근거로 쓰면서 그 조문이 주제를 직접 정한 것은 아니라고 밝히면 잡는다", () => {
    expect(isHedgedBasis("제7조를 법령상 근거로 들되, 이 조항은 야간 개방 자체를 정한 규정은 아닙니다.")).toBe(true);
  });
  it("단정한 정상 답은 걸리지 않는다", () => {
    expect(isHedgedBasis("기준일 현재 열람실 개방 시간은 도서관 운영 규정 제5조에 따라 정해야 합니다.")).toBe(false);
    expect(isHedgedBasis("제3조에 따라 대출 기간은 14일 이내로 정할 수 있습니다.")).toBe(false);
    expect(isHedgedBasis("이 규정을 근거로 처리합니다.")).toBe(false);
  });
  it("참고 조문을 '직접 근거는 아니다'라고만 밝힌 정상 답은 걸리지 않는다", () => {
    expect(isHedgedBasis("제5조에 따라 정해야 합니다. 제8조는 대출 연체를 정한 조문으로 이 질문의 직접 근거는 아닙니다.")).toBe(false);
  });
});

describe("조 번호 없이 조문을 가리킨 결론", () => {
  it("번호 없는 '단서', '…조항에 따라'를 찾는다", () => {
    expect(hasUnnumberedReference("적용 범위의 단서에 따라 분관에는 적용되지 않습니다.")).toBe(true);
    expect(hasUnnumberedReference("관련 조항에 따라 정해야 합니다.")).toBe(true);
  });
  it("바로 앞에 조·항 번호가 있으면 번호를 쓴 것으로 본다", () => {
    expect(hasUnnumberedReference("제2조 단서에 따라 분관에는 적용되지 않습니다.")).toBe(false);
    expect(hasUnnumberedReference("제2조의 적용 제외 단서에 따라 분관은 빠집니다.")).toBe(false);
    expect(hasUnnumberedReference("같은 조 제1항 단서는 분관을 뺍니다.")).toBe(false);
  });
  it("조 번호는 '제11조'와 '제11조의2'를 구분한다", () => {
    expect(mentionsArticle("제11조의2에 따라", "제11조")).toBe(false);
    expect(mentionsArticle("제11조의2에 따라", "제11조의2")).toBe(true);
    expect(mentionsArticle("제 11 조에 따라", "제11조")).toBe(true);
    expect(mentionsArticle("제111조에 따라", "제11조")).toBe(false);
  });
  it("근거 조 번호가 결론에 모두 있으면 번호 없는 말이 있어도 걸리지 않는다", () => {
    expect(unnamedBasisArticles("이 조항에 따라 정합니다. 운영 규정 제5조가 그 조문입니다.", [{ number: "제5조" }])).toEqual([]);
  });
});

describe("verifyDraft 재질문", () => {
  it("단서를 번호 없이 말하고 그 조 번호가 결론에 없으면 한 번 다시 묻는다", () => {
    const out = run("분관은 열람실 개방 시간을 정하지 않아도 됩니다. 적용 범위의 단서에 따라 제5조제1호가 빠지기 때문입니다.");
    expect(out.issues.map((i) => i.kind)).toEqual(["unnamed_article"]);
    expect(out.issues[0].citation_id).toBe(SCOPE.id);
    expect(out.needs_retry).toBe(true);
    expect(out.feedback).toContain("도서관 운영 규정 제2조");
    expect(out.verdict_after).toBe("answered");
  });
  it("같은 내용이라도 조 번호를 쓰면 그대로 둔다", () => {
    const out = run("분관은 열람실 개방 시간을 정하지 않아도 됩니다. 제2조 단서에 따라 제5조제1호가 빠지기 때문입니다.");
    expect(out.issues).toEqual([]);
    expect(out.needs_retry).toBe(false);
  });
  it("번호 없는 말이 없으면 근거 조 번호가 결론에 없어도 묻지 않는다", () => {
    const out = run("분관은 열람실 개방 시간을 정하지 않아도 됩니다. 대출 기간은 정해야 합니다.");
    expect(out.needs_retry).toBe(false);
  });
  it("에둘러 근거로 삼은 결론은 hedged_basis로 다시 묻는다", () => {
    const out = run("제5조를 근거로 분관 운영 지침을 마련할 수 있습니다. 제2조도 함께 보세요.");
    expect(out.issues.map((i) => i.kind)).toContain("hedged_basis");
    expect(out.needs_retry).toBe(true);
  });
  it("근거 없음 판정에는 두 검사를 하지 않는다", () => {
    const out = run("직접 정한 조항은 아니어서 관련 조항에 따라 판단할 수 없습니다. 이를 근거로 기안할 수 있는 조문은 없습니다.", "no_basis");
    expect(out.needs_retry).toBe(false);
  });
});
