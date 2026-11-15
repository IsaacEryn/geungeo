// 학교 선택지에 더한 학칙(경북대학교·서울과학기술대학교·대구교육대학교·대구사이버대학교): 실제 data/에서 읽히는지,
// 학교를 고르면 그 학교 학칙만 후보가 되는지, 질문에 적힌 학교 이름을 알아보는지. 네트워크·Liner 호출은 없다.
import { beforeAll, describe, expect, it } from "vitest";
import { loadCache, loadSchoolRules, type LawCache } from "@/lib/cache/load";
import { SCHOOL_IDS, SCHOOL_NAMES, type SchoolId } from "@/lib/cache/schema";
import { buildAnswerUserMessage } from "@/lib/pipeline/answer";
import { detectSchool, ruleBasedAnalysis } from "@/lib/pipeline/analyze";
import { collectFromCache, schoolRulesInCache } from "@/lib/pipeline/collect";
import messages from "@/messages/ko.json";

let cache: LawCache;
beforeAll(async () => {
  cache = await loadCache();
});

const NEW: { school: SchoolId; id: string; name: string; effective: string; count: number }[] = [
  { school: "knu", id: "knu_rule", name: "경북대학교 학칙", effective: "2026-08-31", count: 10 },
  { school: "seoultech", id: "seoultech_rule", name: "서울과학기술대학교 학칙", effective: "2026-09-01", count: 10 },
  { school: "dnue", id: "dnue_rule", name: "대구교육대학교 학칙", effective: "2024-08-06", count: 10 },
  { school: "dcu", id: "dcu_rule", name: "대구사이버대학교 학칙", effective: "2026-10-15", count: 10 },
];

describe("새로 더한 학교 학칙", () => {
  it("화면 학교 목록·API 허용 목록·manifest가 같은 학교를 가리킨다", () => {
    expect(Object.keys(messages.form.schools).sort()).toEqual([...SCHOOL_IDS].sort());
    const inManifest = cache.manifest.entries.filter((e) => e.kind === "school_rule").map((e) => e.school);
    expect([...inManifest].sort()).toEqual([...SCHOOL_IDS].sort());
  });

  it.each(NEW)("$name: 현행 판의 쓰는 조만 파일로 읽힌다", async ({ school, id, name, effective, count }) => {
    const doc = schoolRulesInCache(cache, school)!;
    expect(doc.law_id).toBe(id);
    expect(doc.law_name).toBe(name);
    expect(doc.articles).toHaveLength(count);
    for (const a of doc.articles) {
      expect(a.versions).toHaveLength(1);
      expect(a.versions[0].effective_from).toBe(effective);
      expect(a.versions[0].effective_to).toBeNull();
    }
    expect((await loadSchoolRules(school))?.law_id).toBe(id);
    const entry = cache.manifest.entries.find((e) => e.id === id)!;
    expect(entry.attribution.startsWith(name)).toBe(true);
    expect(entry.editions.at(-1)?.effective_from).toBe(effective);
  });

  it("대구사이버대학교 학칙은 수동 출처로 표시되고 학교 공식 규정 웹사이트 URL을 출처로 둔다", () => {
    const entry = cache.manifest.entries.find((e) => e.id === "dcu_rule")!;
    expect(entry.method).toBe("manual");
    expect(entry.source_url).toBe("https://rule.dcu.ac.kr/lmxsrv/law/lawFullView.srv?SEQ=141");
    expect(entry.limitations?.length).toBeGreaterThan(0);
    const doc = schoolRulesInCache(cache, "dcu")!;
    expect(doc.articles.every((a) => a.versions[0].source_url === entry.source_url)).toBe(true);
    // 원문 그대로: 휴학 통산 10학기, 다른 대학 학점은 졸업학점의 2분의 1
    expect(doc.articles.find((a) => a.number === "제35조")!.versions[0].text).toContain("재학 중 통산하여 10 학기를 초과할 수 없다.");
    expect(doc.articles.find((a) => a.number === "제50조")!.versions[0].text).toContain("졸업학점의 2분의 1 범위 내에서");
    const a58 = doc.articles.find((a) => a.number === "제58조")!;
    expect(a58.excerpt?.paragraphs).toEqual(["3", "5", "7"]);
    expect(a58.versions[0].text).not.toContain("95∼100");
  });

  it.each(NEW)("$name을 고르면 학칙 후보는 그 학교 것만 나온다", ({ school, id }) => {
    const question = "휴학은 통산 몇 학기까지 할 수 있나요?";
    const out = collectFromCache({
      question,
      analysis: ruleBasedAnalysis(question, cache.synonyms),
      asOf: "2026-11-15",
      cache,
      schoolRules: schoolRulesInCache(cache, school),
    });
    const rules = out.candidates.filter((c) => c.kind === "school_rule");
    expect(rules.length).toBeGreaterThan(0);
    for (const c of rules) expect(c.law_id).toBe(id);
  });

  it("학교를 고르지 않으면 학칙은 후보에 오르지 않는다", () => {
    const question = "휴학은 통산 몇 학기까지 할 수 있나요?";
    const out = collectFromCache({ question, analysis: ruleBasedAnalysis(question, cache.synonyms), asOf: "2026-11-15", cache, schoolRules: null });
    expect(out.candidates.filter((c) => c.kind === "school_rule")).toEqual([]);
  });

  it("질문에 적힌 새 학교 이름을 알아본다", () => {
    expect(detectSchool("경북대 휴학 기간")).toBe("knu");
    expect(detectSchool("서울과기대 졸업학점")).toBe("seoultech");
    expect(detectSchool("서울과학기술대학교 학칙 개정")).toBe("seoultech");
    expect(detectSchool("대구교대 재학연한")).toBe("dnue");
    expect(detectSchool("대구사이버대학교 휴학")).toBe("dcu");
    expect(detectSchool("서울대 휴학")).toBe("snu");
  });
});

describe("답변 단계에 넘기는 학교", () => {
  it("정식 학교명이 화면 문구와 같다", () => {
    expect(SCHOOL_NAMES).toEqual(messages.form.schools);
  });

  it("학교 id 대신 정식 학교명을 넘긴다", () => {
    const msg = buildAnswerUserMessage({
      question: "휴학은 통산 몇 학기까지?",
      asOf: "2026-11-15",
      school: "dcu",
      analysis: ruleBasedAnalysis("휴학은 통산 몇 학기까지?"),
      candidates: [],
      web: [],
      signals: [],
      notices: [],
    } as Parameters<typeof buildAnswerUserMessage>[0]);
    expect(msg).toContain("학교: 대구사이버대학교");
    expect(msg).not.toMatch(/\(dcu\)|학교: dcu/);
  });
});
