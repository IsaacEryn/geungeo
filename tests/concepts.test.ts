// 질문 개념어와 조문 원문 대조: ② 후보 보강(개념어가 나오는 조·적용 제외 조)과 ④ 재질문 조건.
// 법령·조문은 모두 가상이다.
import { describe, expect, it } from "vitest";
import { ArticleIndex } from "@/lib/cache/index";
import type { LawArticle, LawDocument, Synonyms } from "@/lib/cache/schema";
import { conceptExtras, CONCEPT_DIRECT_MAX_ARTICLES } from "@/lib/pipeline/collect";
import { conceptHits, conceptTerms, mentionsAnyConcept, rareConceptTerms, RARE_CONCEPT_MAX_ARTICLES, restrictingArticles, restrictsArticle, sameLawRefs } from "@/lib/pipeline/concepts";
import { verifyDraft } from "@/lib/pipeline/verify";
import type { ArticleCandidate, DraftAnswer, QuestionAnalysis } from "@/lib/pipeline/types";

const SYN: Synonyms = { schema_version: 1, groups: [["안식 학기", "강의 면제 학기"]] };

function article(law_id: string, n: number, title: string, body: string): LawArticle {
  const number = `제${n}조`;
  const text = `${number}(${title}) ${body}`;
  return {
    id: `${law_id}:${String(n).padStart(3, "0")}-00`,
    law_id,
    law_name: law_id === "staff" ? "교직원 복무법" : "학사 운영법",
    number,
    title,
    versions: [
      {
        effective_from: "2020-01-01",
        effective_to: null,
        promulgated: "2019-12-01",
        promulgation_no: "법률 제1호",
        text,
        paragraphs: [{ no: "", text, items: [] }],
        amend_tags: [],
        source_url: "https://example.org/",
      },
    ],
    links: [],
  };
}

function law(law_id: string, articles: LawArticle[]): LawDocument {
  return { law_id, law_name: articles[0].law_name, kind: "act", articles } as unknown as LawDocument;
}

// 교직원 복무법: 제3조 연수 허용(질문 개념어 없음), 제7조 강의 면제 학기 언급(개념어 있음), 제9조 제3조 적용 제외, 나머지는 흔한 말 '교원'
const STAFF = law("staff", [
  article("staff", 1, "목적", "이 법은 교원의 복무에 관한 사항을 정한다."),
  article("staff", 2, "정의", "교원이란 학교에 근무하는 교수를 말한다."),
  article("staff", 3, "연수", "교원은 소속 학교의 장의 승인을 받아 근무장소 외의 시설에서 연수를 받을 수 있다."),
  article("staff", 4, "복무", "교원은 성실히 근무하여야 한다."),
  article("staff", 5, "휴직", "교원은 질병으로 휴직할 수 있다."),
  article("staff", 6, "보수", "교원의 보수는 대통령령으로 정한다."),
  article("staff", 7, "대체 강사", "학기 중 교원의 병가ㆍ강의 면제 학기로 대체할 강사가 필요한 경우 강사를 임용할 수 있다."),
  article("staff", 8, "징계", "교원의 징계는 징계위원회의 의결을 거친다. 제55조와 제3조의2는 이 조에 준용한다."),
  article("staff", 9, "특례", "대학의 교원에 대해서는 제3조를 적용하지 아니한다."),
  article("staff", 10, "준용", "「다른 법」 제3조는 교원에게 적용하지 아니한다."),
  article("staff", 11, "기간제", "기간제교원에 대해서는 제2조, 제3조, 제4조, 제5조 및 제6조를 적용하지 아니한다."),
]);
const ACADEMIC = law("academic", [article("academic", 1, "학사", "교원은 학사 운영에 참여한다. 안식 학기는 학칙으로 정한다.")]);

const index = new ArticleIndex([STAFF, ACADEMIC]);
const asArticles = (doc: LawDocument) => doc.articles.map((a) => ({ id: a.id, law_id: a.law_id, number: a.number, text: a.versions[0].text }));

function analysis(concepts: string[], partial: Partial<QuestionAnalysis> = {}): QuestionAnalysis {
  return {
    scene: "initiating",
    task: "",
    concepts,
    queries_cache: [],
    queries_web: [],
    needs_external: false,
    needs_external_reason: "",
    school: null,
    fallback: false,
    ...partial,
  };
}

describe("개념어와 동의어", () => {
  it("동의어 사전 묶음의 낱말이 개념어 안에 있으면 묶음 전체를 대조어로 쓴다", () => {
    expect(conceptTerms("안식 학기 제도", SYN)).toEqual(["안식학기제도", "안식학기", "강의면제학기"]);
    expect(conceptTerms("교원", SYN)).toEqual(["교원"]);
    expect(conceptTerms("가", SYN)).toEqual([]);
  });

  it("조문 수로 드문 개념어만 고른다(흔한 말·조문에 없는 말은 뺀다)", () => {
    const hits = conceptHits(["교원", "안식 학기", "없는 말"], asArticles(STAFF).concat(asArticles(ACADEMIC)), SYN);
    expect(hits.find((h) => h.concept === "교원")!.ids.length).toBeGreaterThan(RARE_CONCEPT_MAX_ARTICLES);
    expect(hits.find((h) => h.concept === "안식 학기")!.ids).toEqual(["staff:007-00", "academic:001-00"]);
    expect(rareConceptTerms(hits)).toEqual([["안식학기", "강의면제학기"]]);
  });

  it("원문 대조는 공백·가운뎃점 변형을 무시한다", () => {
    expect(mentionsAnyConcept("강의 면제  학기를 둔다", [["강의면제학기"]])).toBe(true);
    expect(mentionsAnyConcept("연수를 받을 수 있다", [["강의면제학기"]])).toBe(false);
  });
});

describe("적용 제외 조", () => {
  it("같은 법령 조 지칭만 센다(다른 법령·조 번호 겹침 제외)", () => {
    expect(sameLawRefs("제55조와 제3조의2는").map((r) => `${r.main}-${r.branch}`)).toEqual(["55-null", "3-2"]);
    expect(sameLawRefs("「다른 법」 제3조 및 제4조")).toEqual([]);
    expect(sameLawRefs("법 제3조에 따라")).toEqual([]);
    expect(sameLawRefs("이 법 제3조에 따라").length).toBe(1);
  });

  it("그 조를 적용하지 않거나 적용 대상에서 빼는 문장만 잡는다", () => {
    expect(restrictsArticle("대학의 교원에 대해서는 제3조를 적용하지 아니한다.", "제3조")).toBe(true);
    expect(restrictsArticle("제3조는 제외한다", "제3조")).toBe(true);
    expect(restrictsArticle("제33조를 적용하지 아니한다.", "제3조")).toBe(false);
    expect(restrictsArticle("제3조의2를 적용하지 아니한다.", "제3조")).toBe(false);
    expect(restrictsArticle("제3조에 따라 연수를 받는다.", "제3조")).toBe(false);
    // 적용 제외 목록을 길게 늘어놓은 특례 조는 넣지 않는다
    expect(restrictsArticle("기간제교원에 대해서는 제2조, 제3조, 제4조, 제5조 및 제6조를 적용하지 아니한다.", "제3조")).toBe(false);
  });

  it("같은 법령에서 대상 조의 적용을 뺀 조를 찾는다", () => {
    const all = asArticles(STAFF);
    expect(restrictingArticles(all.find((a) => a.number === "제3조")!, all)).toEqual(["staff:009-00"]);
  });
});

describe("conceptExtras(② 후보 보강)", () => {
  const question = "우리 대학에 안식 학기를 새로 두려고 해요. 근거 조항이 뭐예요?";

  it("검색으로 고른 조와 상관없이 개념어가 나오는 조와 적용 제외 조를 더한다", () => {
    const extras = conceptExtras({ analysis: analysis(["교원", "안식 학기"]), index, question, searched: ["staff:003-00"], exclude: new Set(["staff:003-00"]), synonyms: SYN });
    expect(extras.map((e) => e.id).sort()).toEqual(["academic:001-00", "staff:007-00", "staff:009-00"]);
    expect(extras.find((e) => e.id === "staff:009-00")!.restricts).toBe("staff:003-00");
  });

  it("이미 후보에 있는 조는 다시 넣지 않고 상한을 지킨다", () => {
    const extras = conceptExtras({ analysis: analysis(["안식 학기"]), index, question, searched: ["staff:003-00"], exclude: new Set(["staff:003-00", "staff:007-00"]), synonyms: SYN, limit: 1 });
    expect(extras.map((e) => e.id)).toEqual(["academic:001-00"]);
  });

  it(`개념어가 ${CONCEPT_DIRECT_MAX_ARTICLES}개 넘는 조에 나오는 흔한 말이면 넣지 않는다`, () => {
    expect(conceptExtras({ analysis: analysis(["교원"]), index, question, searched: [], exclude: new Set(), synonyms: SYN })).toEqual([]);
  });

  it("규칙 기반 대체 분석이면 아무것도 넣지 않는다", () => {
    expect(conceptExtras({ analysis: analysis(["안식 학기"], { fallback: true }), index, question, searched: ["staff:003-00"], exclude: new Set(), synonyms: SYN })).toEqual([]);
  });
});

describe("④ 근거 조문에 개념어가 없을 때 재질문", () => {
  const permit: ArticleCandidate = {
    id: "staff:003-00",
    law_id: "staff",
    law_name: "교직원 복무법",
    kind: "act",
    number: "제3조",
    title: "연수",
    text: STAFF.articles[2].versions[0].text,
    effective_from: "2020-01-01",
    effective_to: null,
    status: "in_force",
    grade: "L1",
    source_url: "https://example.org/",
    score: 5,
    via: "search",
    delegated_to_school_rule: false,
  };
  const mention: ArticleCandidate = { ...permit, id: "staff:007-00", number: "제7조", title: "대체 강사", text: STAFF.articles[6].versions[0].text };
  const draft = (basisId: string, verdict: DraftAnswer["verdict"] = "answered"): DraftAnswer => {
    const c = basisId === permit.id ? permit : mention;
    return {
      verdict,
      summary: `교직원 복무법 ${c.number}에 따라 기안할 수 있습니다.`,
      citations: [{ id: c.id, quote: c.text.slice(0, 20), role: "basis" }],
      checklist: [],
      caveats: [],
      searched_scope: null,
    };
  };
  const terms = [["안식학기", "강의면제학기"]];
  const run = (d: DraftAnswer, scene: QuestionAnalysis["scene"] = "initiating") =>
    verifyDraft({ draft: d, candidates: [permit, mention], web: [], signals: [], asOf: "2026-11-05", question: "안식 학기를 새로 두려는데 근거 조항은?", scene, conceptTerms: terms });

  it("업무 시작 장면에서 근거 조문 원문에 개념어(동의어 포함)가 없으면 재질문하고 판정은 그대로 둔다", () => {
    const out = run(draft(permit.id));
    expect(out.needs_retry).toBe(true);
    expect(out.retry_reasons).toEqual(["basis_lacks_concept"]);
    expect(out.verdict_after).toBe("answered");
    expect(out.feedback).toContain("교직원 복무법 제3조");
  });

  it("partial도 같다", () => {
    expect(run(draft(permit.id, "partial")).retry_reasons).toEqual(["basis_lacks_concept"]);
  });

  it("근거 조문에 동의어가 있으면 걸리지 않는다", () => {
    expect(run(draft(mention.id)).needs_retry).toBe(false);
  });

  it("처리 중 장면, 근거 없음 판정, 대조어가 없을 때는 보지 않는다", () => {
    expect(run(draft(permit.id), "processing").needs_retry).toBe(false);
    expect(run({ ...draft(permit.id, "no_basis"), citations: [{ id: permit.id, quote: permit.text.slice(0, 20), role: "reference" }] }).needs_retry).toBe(false);
    const none = verifyDraft({ draft: draft(permit.id), candidates: [permit], web: [], signals: [], asOf: "2026-11-05", scene: "initiating", conceptTerms: [] });
    expect(none.needs_retry).toBe(false);
  });
});
