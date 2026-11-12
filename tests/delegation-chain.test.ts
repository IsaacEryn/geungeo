// 위임 사슬 거슬러 올라가기·호 단위 색인·공고 캐시 연결·판정 정규화(④). 실제 data/를 읽고 네트워크·Liner 호출은 없다.
import { beforeAll, describe, expect, it } from "vitest";
import { loadCache, type LawCache } from "@/lib/cache/load";
import { ArticleIndex, listedItems } from "@/lib/cache/index";
import { delegationSentence, followUpward } from "@/lib/cache/links";
import { ruleBasedAnalysis } from "@/lib/pipeline/analyze";
import { collectFromCache, collectNotices, lawIndexFor, schoolRulesInCache, signalLawName, targetYear } from "@/lib/pipeline/collect";
import { verifyDraft } from "@/lib/pipeline/verify";
import { buildCards } from "@/lib/pipeline/cards";
import { relevantSignals, sameDocument } from "@/lib/pipeline/run";
import type { ArticleCandidate, DraftAnswer } from "@/lib/pipeline/types";

let cache: LawCache;
beforeAll(async () => {
  cache = await loadCache();
});

const ASOF = "2026-11-05";
const draft = (over: Partial<DraftAnswer>): DraftAnswer => ({
  verdict: "answered",
  summary: "",
  citations: [],
  checklist: [],
  caveats: [],
  searched_scope: null,
  ...over,
});
function collect(question: string, school: "snu" | null = null) {
  return collectFromCache({
    question,
    analysis: ruleBasedAnalysis(question, cache.synonyms),
    asOf: ASOF,
    cache,
    schoolRules: school ? schoolRulesInCache(cache, school) : null,
  });
}
const byId = (cands: ArticleCandidate[], id: string) => cands.find((c) => c.id === id);

describe("호 단위 색인", () => {
  it("학칙 기재사항처럼 사항을 열거한 긴 항만 호마다 문서를 더 만든다", () => {
    const decree = cache.laws.get("heaf_decree")!;
    const art4 = decree.articles.find((a) => a.id === "heaf_decree:004-00")!;
    const items = listedItems(art4);
    expect(items).toContain("교육과정의 운영, 교과의 이수단위 및 성적의 관리");
    expect(items.some((i) => i.startsWith("삭제"))).toBe(false);
    // "다음 각 호의 사항에 대하여 … 재검토"처럼 열거해도 담을 사항이 아닌 항은 나누지 않는다
    expect(listedItems(decree.articles.find((a) => a.id === "heaf_decree:074-00")!)).toEqual([]);
  });

  it("한 호에만 나오는 말로 긴 조를 찾고, 조 단위로 한 번만 돌려준다", () => {
    const index = new ArticleIndex([cache.laws.get("heaf_decree")!]);
    const hits = index.search("성적의 관리 학칙 기재", { limit: 5 });
    expect(hits[0].id).toBe("heaf_decree:004-00");
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
    expect(index.size).toBe(cache.laws.get("heaf_decree")!.articles.length);
  });
});

describe("위로 거슬러 올라가기", () => {
  it("훈령 조 → 시행령 → 법률, 같은 훈령의 적용 범위 조", () => {
    const idx = lawIndexFor(cache);
    const up = followUpward([idx.byId.get("remote_class_rule:004-00")!], idx.byId);
    expect([...up.articles.keys()]).toEqual(["heaf_decree:014-02", "heaf:022-00"]);
    expect(up.scope.get("remote_class_rule:003-00")).toBe("remote_class_rule:004-00");
    const decree = up.relations.find((r) => r.upper === "heaf_decree:014-02")!;
    expect(decree.quote).toContain("교육부장관이 정하는 기준");
  });

  it("학칙 조 → 같은 주제로 학칙에 맡긴 법률 조, 학칙 기재사항의 해당 호", () => {
    const idx = lawIndexFor(cache);
    const snu = schoolRulesInCache(cache, "snu")!;
    const ref = (id: string) => ({ article: snu.articles.find((a) => a.id === id)!, law: snu });
    const up = followUpward([ref("snu_rule:066-00"), ref("snu_rule:085-00"), ref("snu_rule:118-00")], idx.byId);
    const rel = (from: string) => up.relations.filter((r) => r.from === from).map((r) => [r.upper, r.quote]);
    expect(rel("snu_rule:066-00").map((r) => r[0])).toContain("heaf:023-04");
    expect(rel("snu_rule:085-00")).toContainEqual(["heaf_decree:004-00", "교육과정의 운영, 교과의 이수단위 및 성적의 관리"]);
    expect(rel("snu_rule:118-00")).toContainEqual(["heaf_decree:004-00", "학칙개정절차"]);
    // 시행령 제4조에서 한 단계 더: 법 제6조
    expect(up.articles.has("heaf:006-00")).toBe(true);
    // 뜻이 다른 학칙 조(등록금심의위원회)를 "등록 및 수강 신청" 호에 붙이지 않는다
    const fee = followUpward([ref("snu_rule:113-00")], idx.byId);
    expect(fee.relations.some((r) => r.upper === "heaf_decree:004-00")).toBe(false);
  });

  it("위임 문장은 원문 그대로 꺼낸다", () => {
    const heaf6 = cache.articles.get("heaf:006-00")!;
    const s = delegationSentence(heaf6, { phrase: "대통령령으로 정한다", paragraph_no: "2" });
    expect(heaf6.versions.at(-1)!.text.replace(/\s+/g, "")).toContain(s.replace(/\s+/g, ""));
  });

  it("②: 학칙 조 후보에 상위 조(upper)와 일부 수록 안내(excerpt_note)가 붙는다", () => {
    const out = collect("출석이 모자란 학생 성적 처리 기준이 법에 있나요? 서울대는 어떻게 하나요?", "snu");
    const rule = byId(out.candidates, "snu_rule:085-00")!;
    expect(rule.excerpt_note).toContain("제3항만 수록");
    expect(rule.upper?.map((u) => u.id)).toContain("heaf_decree:004-00");
    expect(byId(out.candidates, "heaf_decree:004-00")?.upper_of).toContain("snu_rule:085-00");
  });
});

describe("공고 캐시", () => {
  it("질문의 학년도: 숫자 학년도, '내년'은 기준일 다음 해", () => {
    expect(targetYear("2026학년도 등록금 한도", ASOF)).toBe(2026);
    expect(targetYear("내년 등록금 인상안", ASOF)).toBe(2027);
    expect(targetYear("휴학은 몇 년까지", ASOF)).toBeUndefined();
  });

  function notices(question: string) {
    const out = collect(question);
    const lawNames = [...new Set(out.candidates.filter((c) => c.grade === "L1").sort((a, b) => b.score - a.score).map((c) => c.law_name))];
    return collectNotices({
      cache,
      question,
      analysis: ruleBasedAnalysis(question, cache.synonyms),
      asOf: ASOF,
      candidates: out.candidates,
      delegations: out.notices,
      signalLaws: lawNames.slice(0, 2),
    });
  }

  it("확인 못 한 공고는 숫자 없이 '원문 확인 필요'로, 확인한 공고는 원문 위치와 함께", () => {
    const out = notices("2026학년도 등록금 법정 인상 한도는 몇 %였나요?");
    const pending = out.results.find((r) => r.notice?.status === "needs_source_check")!;
    expect(pending.notice!.figures).toEqual([]);
    expect(pending.description).toContain("원문 확인 필요");
    expect(pending.description).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    const checked = out.results.filter((r) => r.notice?.status === "checked");
    for (const r of checked) expect(r.notice!.figures.every((f) => f.checked_url.startsWith("https://www.moe.go.kr/"))).toBe(true);
    // 다른 학년도 공고는 붙이지 않는다
    expect(out.results.some((r) => r.notice?.id.includes("2027"))).toBe(false);
  });

  it("입법예고 공고는 다루는 법령이 상위 법령이면 의견 제출 기한과 함께 변경 신호로", () => {
    const out = notices("등심위 규정을 손보는 중인데 위원 임기는 학칙으로 정하나요?");
    const sig = out.signals.find((s) => s.kind === "legislative_notice")!;
    expect(sig.opinion_deadline).toBe("2026-12-07");
    expect(out.results.find((r) => r.id === sig.web_id)?.notice?.status).toBe("checked");
  });

  it("관계없는 질문에는 붙이지 않는다", () => {
    expect(notices("사립대인데 교원 연구년 제도를 새로 만들려고 해요. 법령상 근거 조항이 뭐예요?").results).toEqual([]);
  });

  it("신호의 법령 이름: 낫표 안 이름과 같거나 품은 것만", () => {
    const t = "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙」 입법예고";
    expect(signalLawName("고등교육법", t, "")).toBe("고등교육법 시행령");
    expect(signalLawName("대학 등록금에 관한 규칙", t, "")).toBe("대학 등록금에 관한 규칙");
    expect(signalLawName("사립학교법", t, "")).toBeNull();
    expect(signalLawName("고등교육법", "고등교육법 일부개정법률 공포", "")).toBe("고등교육법");
  });

  it("같은 게시글: 게시글 번호가 같으면 주소 순서가 달라도 같다", () => {
    expect(
      sameDocument(
        "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=107492&lev=0&m=020402&s=moe&opType=N",
        "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=107492&lev=0&searchType=null&page=1&s=moe&m=020402&opType=N",
      ),
    ).toBe(true);
    expect(sameDocument("https://www.moe.go.kr/x?boardSeq=1", "https://www.moe.go.kr/x?boardSeq=2")).toBe(false);
  });

  it("「고등교육법 시행령」 입법예고는 고등교육법만 인용한 답에 붙지 않는다", () => {
    const signal = {
      web_id: "notice:1",
      title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙」 입법예고",
      url: "https://www.moe.go.kr/x?boardSeq=1",
      hostname: "moe.go.kr",
      date: "2026-10-27",
      kind: "legislative_notice" as const,
      related_law: "고등교육법 시행령",
      after_collection: false,
    };
    const cands = collect("육아휴학 대상").candidates;
    const heaf = cands.find((c) => c.law_id === "heaf")!;
    expect(relevantSignals([signal], [{ id: heaf.id, quote: "x", role: "basis" }], cands)).toEqual([]);
  });
});

describe("④ 판정 정규화", () => {
  const E26Q = "법적으로 휴학은 최대 몇 년까지 할 수 있어요?";

  it("법령이 학칙에 맡기기만 하고 묻는 숫자가 없으면 근거 없음, 위임 조는 위임으로 남긴다", () => {
    const cands = collect(E26Q).candidates;
    const quote = "학칙으로 정하는 바에 따라 휴학하게 할 수 있다";
    const out = verifyDraft({
      draft: draft({ verdict: "partial", summary: "법은 최대 연수를 정하지 않고 학칙에 맡깁니다. 학교별 학칙 확인이 필요합니다.", citations: [{ id: "heaf:023-04", quote, role: "basis" }] }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
      question: E26Q,
    });
    expect(out.verdict_after).toBe("no_basis");
    expect(out.issues.map((i) => i.kind)).toContain("delegation_only");
    expect(out.draft.citations).toEqual([expect.objectContaining({ id: "heaf:023-04", role: "delegation" })]);
    expect(out.draft.summary).toContain("학칙에 맡깁니다");
  });

  it("숫자를 묻지 않는 질문이나 학칙 조를 근거로 든 답은 그대로", () => {
    const cands = collect(E26Q, "snu").candidates;
    const out = verifyDraft({
      draft: draft({
        summary: "서울대는 학사과정 휴학연한을 6개 학기 또는 3년으로 둡니다.",
        citations: [{ id: "snu_rule:066-00", quote: "학사과정 : 6개 학기 또는 3년", role: "basis" }],
      }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
      question: "서울대 학칙 기준으로 휴학은 최대 몇 학기까지 할 수 있어요?",
    });
    expect(out.verdict_after).toBe("answered");
    // 학칙 조에 맡긴 상위 법률 조를 위임 인용으로 덧붙인다
    const upper = out.draft.citations.find((c) => c.id === "heaf:023-04");
    expect(upper?.role).toBe("delegation");
    expect(out.issues.map((i) => i.kind)).toContain("upper_added");
    expect(out.removed_citations).toBe(0);
  });

  it("이미 인용한 상위 조 위로도 올라간다(학칙 → 시행령 제4조(인용함) → 법 제6조)", () => {
    const q = "학칙 개정안을 올리려고 해요. 서울대 기준으로 절차를 기안 체크리스트로 정리해 주세요.";
    const cands = collect(q, "snu").candidates;
    const out = verifyDraft({
      draft: draft({
        summary: "총장이 7일 이상 공고한 뒤 심의를 거칩니다.",
        citations: [
          { id: "snu_rule:118-00", quote: "총장이 7일 이상 공고한 후", role: "basis" },
          { id: "heaf_decree:004-00", quote: "학칙개정절차", role: "delegation" },
        ],
      }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
      question: q,
    });
    expect(out.draft.citations.map((c) => c.id)).toContain("heaf:006-00");
  });

  it("결론이 조문을 '근거로 제시할 수 있다'고 에둘러 쓰면 한 번 다시 묻는다", () => {
    const cands = collect("사립대인데 교원 연구년 제도를 새로 만들려고 해요. 법령상 근거 조항이 뭐예요?").candidates;
    const c = cands.find((x) => x.id === "private_school_act:055-03")!;
    const out = verifyDraft({
      draft: draft({ verdict: "partial", summary: "사립학교법 제55조의3을 근거로 제시할 수 있습니다.", citations: [{ id: c.id, quote: c.text.split(/\n/)[0].slice(0, 30), role: "basis" }] }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
    });
    expect(out.needs_retry).toBe(true);
    expect(out.feedback).toContain("직접 근거는 아니다");
  });

  it("인접 조문만 참고로 든 답은 근거 없음으로 바꾸되 모델이 쓴 결론은 남긴다", () => {
    const cands = collect("사립대인데 교원 연구년 제도를 새로 만들려고 해요. 법령상 근거 조항이 뭐예요?").candidates;
    const c = cands.find((x) => x.id === "private_school_act:055-03");
    expect(c, "인접 조문이 후보에 있어야 함").toBeDefined();
    const quote = c!.text.split(/\n/)[0].slice(0, 30);
    const summary = "연구년을 직접 정한 법령 조항은 없습니다. 제55조의3은 직접 근거는 아닙니다. 정관과 학교 자체 규정으로 정합니다.";
    const out = verifyDraft({
      draft: draft({ verdict: "partial", summary, citations: [{ id: c!.id, quote, role: "reference" }] }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
    });
    expect(out.verdict_after).toBe("no_basis");
    expect(out.draft.summary).toBe(summary);
  });

  it("공고에 맡긴 사항은 공고(원문 확인 필요 포함)가 있으면 근거 없음 대신 일부 답", () => {
    const q = "2026학년도 등록금 법정 인상 한도는 몇 %였나요?";
    const out0 = collect(q);
    const lawNames = [...new Set(out0.candidates.filter((x) => x.grade === "L1").map((x) => x.law_name))];
    const n = collectNotices({ cache, question: q, analysis: ruleBasedAnalysis(q, cache.synonyms), asOf: ASOF, candidates: out0.candidates, delegations: out0.notices, signalLaws: lawNames.slice(0, 2) });
    const delegated = out0.notices.map((x) => x.from);
    expect(delegated).toContain("tuition_rule:002-02");
    const out = verifyDraft({
      draft: draft({
        verdict: "no_basis",
        summary: "언론 보도 수치는 원문 확인 필요입니다. 산정방법은 교육부장관이 공고합니다.",
        citations: [{ id: "tuition_rule:002-02", quote: "교육부장관이 정하여 공고한다", role: "delegation" }],
      }),
      candidates: out0.candidates,
      web: n.results,
      signals: n.signals,
      asOf: ASOF,
      question: q,
      noticeDelegated: delegated,
    });
    expect(out.verdict_after).toBe("partial");
    expect(out.draft.caveats.join(" ")).toContain("원문 확인 필요");
  });

  it("최근 개정된 조를 근거로 들고 시행일을 안 쓰면 확인 사항에 시행일을 붙인다", () => {
    const q = "초등학교 4학년 아이를 키우는 학생이 육아휴학을 신청했어요. 법적으로 대상이 되나요?";
    const cands = collect(q).candidates;
    const art = cands.find((c) => c.id === "heaf:023-04")!;
    expect(art.amended).toBe(true);
    const quote = art.text.match(/12세 이하[^.]*/)![0].slice(0, 20);
    const out = verifyDraft({
      draft: draft({ summary: "대상이 됩니다.", citations: [{ id: "heaf:023-04", quote, role: "basis" }] }),
      candidates: cands,
      web: [],
      signals: [],
      asOf: ASOF,
      question: q,
    });
    expect(out.draft.caveats.join(" ")).toContain("2025. 4. 23.부터 시행");
  });
});

describe("⑤ 카드", () => {
  it("일부 항만 담은 학칙 조 카드에 수록 범위 안내가 붙는다", () => {
    const out = collect("출석이 모자란 학생 성적 처리 기준이 법에 있나요? 서울대는 어떻게 하나요?", "snu");
    const quote = "출석일수는 매 학기 수업일수의 3분의 2 이상으로 하며";
    const cards = buildCards({ citations: [{ id: "snu_rule:085-00", quote, role: "basis" }], candidates: out.candidates, web: [], signals: [], cache });
    expect(cards[0].notes.some((n) => n.includes("제3항만 수록"))).toBe(true);
  });
});
