// 학칙 문항이 캐시(data/rules/)에서 정답 조를 찾는지 오프라인으로 보고, 앱 경로가 law.go.kr을 부르지 않는지 네트워크 목으로 본다.
// 네트워크·Liner 호출 없음.
// 학칙 색인 검색과 ②의 캐시 검색(collectFromCache)에 규칙 기반 분석을 넣고, 평가 세트의 school_article_ids가 나오는지 본다.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCache, type LawCache } from "@/lib/cache/load";
import { ruleBasedAnalysis } from "@/lib/pipeline/analyze";
import { collectFromCache, SCHOOL_RULE_SLOT, schoolRulesInCache } from "@/lib/pipeline/collect";
import { ArticleIndex, expandSynonyms } from "@/lib/cache/index";
import { runPipeline } from "@/lib/pipeline/run";
import type { Manifest } from "@/lib/cache/schema";
import { createOfflineLiner } from "../scripts/eval/offline-liner.mjs";
import { loadQuestions } from "../scripts/eval/run.mjs";

const FIXTURES = join(process.cwd(), "tests/fixtures/search");

type Q = { id: string; question: string; school: "snu" | "pnu" | "knou" | null; school_article_ids: string[] };
const questions = (loadQuestions() as Q[]).filter((q) => q.school && q.school_article_ids.length);
let cache: LawCache;

beforeAll(async () => {
  cache = await loadCache();
});

describe("학칙 문항 → 캐시 후보", () => {
  it("평가 세트의 학칙 문항이 있다", () => {
    expect(questions.map((q) => q.id)).toEqual(["E05", "E07", "E08", "E11", "E17", "E18", "E21"]);
  });

  // 학칙 색인 안에서: 정답 조가 상위(정답 수 + 1)에 든다 — 데이터(담은 조·항)가 질문에 맞는지
  for (const id of ["E05", "E07", "E08", "E11", "E17", "E18", "E21"]) {
    it(`${id}: 학칙 색인 상위에 정답 조가 있다`, () => {
      const q = questions.find((x) => x.id === id)!;
      const schoolRules = schoolRulesInCache(cache, q.school!);
      expect(schoolRules, `${q.school} 학칙이 캐시에 있어야 함`).not.toBeNull();
      const analysis = ruleBasedAnalysis(q.question, cache.synonyms);
      const index = new ArticleIndex([schoolRules!]);
      const top = new Set<string>();
      for (const text of [q.question, ...analysis.queries_cache]) {
        for (const h of index.search(expandSynonyms(text, cache.synonyms), { limit: q.school_article_ids.length + 1, boost: analysis.concepts })) top.add(h.id);
      }
      for (const want of q.school_article_ids) expect(top.has(want), `${want} / 상위 ${[...top].join(",")}`).toBe(true);
    });
  }

  // 파이프라인 ② 후보: 학교를 지정하면 학칙 색인 상위 SCHOOL_RULE_SLOT개를 법령 상위 5개와 따로 넣는다.
  // 학칙 색인은 문서 몇 개짜리라 BM25 점수가 법령 색인과 비교되지 않아, 한 줄로 세우면 E08·E21의 학칙 조가 밀려났다.
  for (const id of ["E05", "E07", "E08", "E11", "E17", "E18", "E21"]) {
    it(`${id}: 정답 학칙 조가 ② 후보에 든다`, () => {
      const q = questions.find((x) => x.id === id)!;
      const schoolRules = schoolRulesInCache(cache, q.school!);
      const out = collectFromCache({ question: q.question, analysis: ruleBasedAnalysis(q.question, cache.synonyms), asOf: "2026-11-05", cache, schoolRules });
      const ids = new Set(out.candidates.map((c) => c.id.split("@")[0]));
      for (const want of q.school_article_ids) expect(ids.has(want), `${want} 후보 ${[...ids].join(",")}`).toBe(true);
    });
  }

  it("학칙 몫은 법령 후보 수를 줄이지 않는다(검색으로 고른 법령 조는 학교를 지정해도 그대로)", () => {
    const q = questions.find((x) => x.id === "E21")!;
    const analysis = ruleBasedAnalysis(q.question, cache.synonyms);
    const without = collectFromCache({ question: q.question, analysis, asOf: "2026-11-05", cache, schoolRules: null });
    const withSchool = collectFromCache({ question: q.question, analysis, asOf: "2026-11-05", cache, schoolRules: schoolRulesInCache(cache, "snu") });
    const searched = (o: typeof without) => o.candidates.filter((c) => c.via !== "delegation" && c.grade === "L1").map((c) => c.id);
    expect(searched(withSchool)).toEqual(searched(without));
    expect(withSchool.candidates.filter((c) => c.grade === "L2" && c.via !== "delegation").length).toBeLessThanOrEqual(SCHOOL_RULE_SLOT);
  });

  it("E13(화면 예시 질문, 서울대 지정): 제113조가 후보에 든다", () => {
    const question = "내년도 등록금심의위원회를 새로 꾸려야 해요. 위원 수와 구성 비율 조건이 뭐예요?";
    const out = collectFromCache({ question, analysis: ruleBasedAnalysis(question, cache.synonyms), asOf: "2026-11-05", cache, schoolRules: schoolRulesInCache(cache, "snu") });
    expect(out.candidates.map((c) => c.id)).toContain("snu_rule:113-00");
  });

  it("E11: 학과명 변경 경과조치는 2026-11-05에 시행 예정(not_yet)으로 나온다", () => {
    const q = questions.find((x) => x.id === "E11")!;
    const out = collectFromCache({ question: q.question, analysis: ruleBasedAnalysis(q.question, cache.synonyms), asOf: "2026-11-05", cache, schoolRules: schoolRulesInCache(cache, "knou") });
    const c = out.candidates.find((x) => x.id.startsWith("knou_rule_a1315:002-00"));
    expect(c?.status).toBe("not_yet");
    expect(c?.effective_from).toBe("2027-03-01");
  });
});

describe("실행 중 law.go.kr 호출 0건(네트워크 목)", () => {
  const seen: string[] = [];
  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv("LINER_API_KEY", "offline-no-network");
    vi.stubEnv("LINER_MODEL_ANALYZE", "");
    vi.stubEnv("LINER_MODEL_ANSWER", "");
    // 전역 fetch로 나가는 것은 모두 기록하고 실패시킨다(Liner는 오프라인 대역 fetchImpl로 따로 받는다)
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      seen.push(String(input instanceof Request ? input.url : input));
      throw new TypeError("network blocked in test");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const run = (id: string, c: LawCache) => {
    const q = (loadQuestions() as Q[]).find((x) => x.id === id)!;
    const offline = createOfflineLiner();
    // schoolRules는 기본값(auto) — 앱과 같은 경로
    return runPipeline({ question: q.question, asOf: "2026-11-05", school: q.school }, { cache: c, searchFixtureDir: FIXTURES, fetchImpl: offline.fetchImpl });
  };

  it("학교를 지정한 질문(E05·E07·E11·E18)을 앱 경로로 돌려도 전역 fetch 호출이 없다", async () => {
    for (const id of ["E05", "E07", "E11", "E18"]) await run(id, cache);
    expect(seen).toEqual([]);
  });

  it("manifest가 remote로 되어 있어도(학칙이 캐시에 없음) law.go.kr을 부르지 않는다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "geungeo-remote-"));
    cpSync(join(process.cwd(), "data"), dir, { recursive: true });
    const p = join(dir, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8")) as Manifest;
    for (const e of m.entries) if (e.kind === "school_rule") e.storage = "remote";
    writeFileSync(p, JSON.stringify(m));
    const remoteCache = await loadCache({ dataDir: dir, reload: true });
    expect([...remoteCache.laws.values()].some((l) => l.kind === "school_rule")).toBe(false);
    const cwd = process.cwd();
    // loadSchoolRules는 기본 data 폴더(<cwd>/data)를 읽으므로 임시 폴더를 cwd로 둔다
    const fake = mkdtempSync(join(tmpdir(), "geungeo-cwd-"));
    cpSync(dir, join(fake, "data"), { recursive: true });
    process.chdir(fake);
    try {
      await run("E05", remoteCache);
    } finally {
      process.chdir(cwd);
    }
    expect(seen.filter((u) => u.includes("law.go.kr"))).toEqual([]);
    expect(seen).toEqual([]);
  });
});
