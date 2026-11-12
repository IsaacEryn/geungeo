// 캐시 조문 색인(2-gram BM25)·직접 조회·동의어·위임 사슬.
import { describe, expect, it } from "vitest";
import { ArticleIndex, expandSynonyms, lawAliases } from "@/lib/cache/index";
import { followDelegations } from "@/lib/cache/links";
import { buildTestCache, TEST_SYNONYMS } from "./support/cache";

const cache = buildTestCache();
const index = new ArticleIndex([...cache.laws.values()]);

describe("ArticleIndex.search", () => {
  it("구어체 질문에서 제목·본문이 맞는 조를 맨 위로", () => {
    expect(index.search("기숙사비심의위원회를 지금 당장 설치해야 하나요?")[0].id).toBe("heaf:011-02");
    expect(index.search("수시 면접 외부 평가위원이 지원자와 친족이면 빼야 하나요")[0].id).toBe("heaf:034-02");
  });

  it("시행 예정 판의 글도 색인한다(⑤의 '외부 위원')", () => {
    const hit = index.search("외부 위원 준용");
    expect(hit[0].id).toBe("heaf:034-02");
  });

  it("관계없는 말에는 결과가 없다", () => {
    expect(index.search("qwerty zzz")).toEqual([]);
  });

  it("filter로 범위를 좁힌다", () => {
    const hits = index.search("위원회", { filter: (id) => id.startsWith("tuition:") });
    expect(hits.every((h) => h.id.startsWith("tuition:"))).toBe(true);
  });
});

describe("동의어", () => {
  it("등심위 → 등록금심의위원회로 넓혀 등록금 규칙을 찾는다", () => {
    const q = expandSynonyms("등심위 위원 임기 제한", TEST_SYNONYMS);
    expect(q).toContain("등록금심의위원회");
    expect(index.search(q)[0].id).toBe("tuition:002-00");
  });
  it("사전이 없으면 그대로", () => {
    expect(expandSynonyms("등심위", undefined)).toBe("등심위");
  });
});

describe("ArticleIndex.direct", () => {
  it("법령명 + 조번호를 바로 찾는다", () => {
    expect(index.direct("고등교육법 제34조의2 제5항이 궁금")).toEqual([{ id: "heaf:034-02", score: 1000, via: "direct" }]);
    expect(index.direct("사립학교법 제55조의3")).toEqual([{ id: "pslaw:055-03", score: 1000, via: "direct" }]);
  });
  it("법령명이 없으면 조번호가 맞는 조를 모두", () => {
    expect(index.direct("제2조 내용").map((h) => h.id)).toEqual(["tuition:002-00"]);
  });
  it("없는 조는 빈 배열", () => {
    expect(index.direct("고등교육법 제99조")).toEqual([]);
  });
});

describe("lawAliases", () => {
  it("시행령·학칙 줄임 이름", () => {
    expect(lawAliases({ law_name: "고등교육법 시행령", kind: "presidential_decree" })).toEqual(["고등교육법시행령", "시행령"]);
    expect(lawAliases({ law_name: "서울대학교 학칙", kind: "school_rule" })).toContain("학칙");
  });
});

describe("followDelegations", () => {
  const lookup = (id: string) => cache.articles.get(id);
  it("학칙 위임 문구가 있으면 '학교별 확인' 표시", () => {
    const res = followDelegations([cache.articles.get("heaf:011-02")!], lookup);
    expect(res.schoolRuleDelegated.has("heaf:011-02")).toBe(true);
    expect(res.schoolArticles.size).toBe(0);
  });
  it("학교를 지정하면 그 학칙에서 대응 조를 찾는다", () => {
    const rules = cache.laws.get("knou_rule")!;
    const res = followDelegations([cache.articles.get("tuition:002-00")!], lookup, {
      schoolRules: rules,
      schoolIndex: new ArticleIndex([rules]),
    });
    expect(res.schoolRuleDelegated.has("tuition:002-00")).toBe(true);
  });
  it("다른 법령 조로 이어진 위임을 따라간다", () => {
    const from = structuredClone(cache.articles.get("heaf:011-02")!);
    from.links = [{ phrase: "대통령령으로 정한다", target: { kind: "article", article_id: "pslaw:055-03" } }];
    const res = followDelegations([from], lookup);
    expect(res.articles.get("pslaw:055-03")).toEqual({ from: "heaf:011-02", phrase: "대통령령으로 정한다" });
  });
});
