// 통합 시험: 실제 data/(loadCache)와 실제 파이프라인을 오프라인 Liner 대역으로 끝까지 돌리고, 평가 채점과 맞물리는지 본다.
// 네트워크를 쓰지 않는다(Search는 고정 응답 폴더, Router는 scripts/eval/offline-liner.mjs, 학칙은 캐시에 실린 것만).
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCache, type LawCache } from "@/lib/cache/load";
import { locateQuote } from "@/lib/pipeline/cards";
import { findNormalized } from "@/lib/pipeline/text";
import { DEFAULT_CANDIDATE_LIMIT } from "@/lib/pipeline/collect";
import { baseLawName, relevantSignals, runPipeline, topLawNames } from "@/lib/pipeline/run";
import type { ArticleCandidate, ChangeSignal, StageEvent } from "@/lib/pipeline/types";
import { createOfflineLiner, extractiveAnswer } from "../scripts/eval/offline-liner.mjs";
import { loadQuestions } from "../scripts/eval/run.mjs";
import { articleIdOf, scoreOne } from "../scripts/eval/score.mjs";

const FIXTURES = path.join(process.cwd(), "tests/fixtures/search");
const questions = loadQuestions();
const q = (id: string) => questions.find((x: { id: string }) => x.id === id)!;
let cache: LawCache;

beforeAll(async () => {
  cache = await loadCache();
});
beforeEach(() => {
  vi.stubEnv("LINER_API_KEY", "offline-no-network");
  vi.stubEnv("LINER_MODEL_ANALYZE", "");
  vi.stubEnv("LINER_MODEL_ANSWER", "");
});
afterEach(() => vi.unstubAllEnvs());

async function runOffline(id: string, events?: StageEvent[]) {
  const offline = createOfflineLiner();
  const item = q(id);
  const result = await runPipeline(
    { question: item.question, asOf: "2026-11-05", school: item.school ?? null },
    { cache, searchFixtureDir: FIXTURES, fetchImpl: offline.fetchImpl, schoolRules: "cache_only", onEvent: (e) => events?.push(e) },
  );
  return { result, offline };
}

describe("실제 data/ 읽기", () => {
  it("loadCache가 법령 6종과 조 ID 색인을 올린다", () => {
    // 본문 6종 + 부칙 문서(heaf_a21423 등). 학칙은 처리 방식 결정 전이라 캐시에 없다(storage remote)
    for (const id of ["edu_official_act", "heaf", "heaf_decree", "private_school_act", "remote_class_rule", "tuition_rule"]) {
      expect(cache.laws.has(id)).toBe(true);
    }
    expect([...cache.laws.values()].some((l) => l.kind === "school_rule")).toBe(false);
    expect(cache.articles.get("heaf:011-02")?.versions.at(-1)?.effective_from).toBe("2027-03-11");
    expect(cache.collectedAt).toMatch(/^2026-11-13T/);
  });

  it("원문의 CJK 호환 한자(年 U+F98E)와 모델이 쓴 통합 한자를 같은 글자로 본다", () => {
    const art = cache.articles.get("heaf_decree:015-00")!;
    expect(art.versions.at(-1)!.text).toContain("\uF98E");
    expect(findNormalized(art.versions.at(-1)!.text, "연(\u5E74) 12학점 이내")).not.toBeNull();
  });

  it("목 번호부터 인용해도 위치를 '제15조제1항제1호 다목'으로 찾는다(11/13 실제 응답에서 '제15조'로만 나오던 것)", () => {
    const art = cache.articles.get("heaf_decree:015-00")!;
    const v = art.versions.at(-1)!.effective_from;
    expect(locateQuote(art, v, "다. 가목 및 나목 외의 경우: 졸업에 필요한 학점의 2분의 1 이내")).toBe("제15조제1항제1호 다목");
    expect(locateQuote(art, v, "2. 법 제23조제1항제4호에 해당하는 경우: 학기당 6학점 이내, 연(年) 12학점 이내")).toBe("제15조제1항제2호");
    const heaf23 = cache.articles.get("heaf:023-00")!;
    const head = heaf23.versions.at(-1)!.text.split("\n")[0].slice(0, 30);
    expect(locateQuote(heaf23, heaf23.versions.at(-1)!.effective_from, head)).toMatch(/^제23조제1항/);
  });
});

describe("오프라인 통합 실행", () => {
  it("E22: 시행 예정 조가 카드로 나오고 채점과 맞물린다(Liner 요청은 대역만, 네트워크 0)", async () => {
    const events: StageEvent[] = [];
    const { result, offline } = await runOffline("E22", events);
    expect(offline.calls.every((p: string) => p === "/chat/completions")).toBe(true); // Search는 고정 응답 폴더
    const card = result.cards.find((c) => articleIdOf(c.id) === "heaf:011-02")!;
    expect(card).toMatchObject({ badge: "not_yet", effective_from: "2027-03-11" });
    expect(card.location).toMatch(/^제11조의2/);
    expect(scoreOne(q("E22"), result).checks.article.pass).toBe(true);
    // 진행 표시 이벤트 순서는 그대로
    const order = events.filter((e) => e.type === "stage_start").map((e) => (e as { stage: string }).stage);
    expect(order.slice(0, 4)).toEqual(["analyze", "collect_cache", "collect_web", "collect_signals"]);
  });

  it("E23: 같은 조의 시행 예정 판은 '<조ID>@<시행일>' 카드이고 채점은 조 ID로 받는다", async () => {
    const { result } = await runOffline("E23");
    const ids = result.cards.map((c) => c.id);
    expect(ids.some((x) => x.startsWith("heaf:034-02"))).toBe(true);
    const versioned = ids.filter((x) => x.includes("@"));
    for (const x of versioned) expect(x).toMatch(/^[a-z_]+:\d{3}-\d{2}@\d{4}-\d{2}-\d{2}$/);
    expect(scoreOne(q("E23"), result).checks.article.pass).toBe(true);
  });

  it("③에 넣는 검색 후보는 5개까지(위임 사슬로 더한 조는 따로)", async () => {
    const { result } = await runOffline("E01");
    const note = result.trace.calls.find((c) => c.stage === "collect_cache")?.note ?? "";
    const n = Number(note.match(/조 (\d+)개/)?.[1]);
    expect(DEFAULT_CANDIDATE_LIMIT).toBe(5);
    expect(n).toBeLessThanOrEqual(5);
    expect(result.verification.removed_citations).toBe(0);
    for (const c of result.trace.calls) if (c.usage) expect(typeof c.usage.cost_usd).toBe("number");
  });
});

describe("변경 신호 정리(인용한 조의 법령, 최근 2건)", () => {
  const cand = (id: string, law: string) => ({ id, law_name: law }) as ArticleCandidate;
  const sig = (web_id: string, law: string, date: string | null, title = "개정 입법예고"): ChangeSignal => ({
    web_id,
    title,
    url: `https://www.moe.go.kr/${web_id}`,
    hostname: "moe.go.kr",
    date,
    kind: "legislative_notice",
    related_law: law,
    after_collection: false,
  });

  it("인용하지 않은 법령의 신호는 빼고 최근 2건만", () => {
    const signals = [
      sig("web:1", "고등교육법", "2026-09-01"),
      sig("web:2", "고등교육법", "2026-10-27"),
      sig("web:3", "고등교육법", null),
      sig("web:4", "고등교육법", "2026-11-10"),
      sig("web:5", "사립학교법", "2026-11-12"),
    ];
    const out = relevantSignals(signals, [{ id: "heaf:011-02", quote: "", role: "basis" }], [cand("heaf:011-02", "고등교육법")]);
    expect(out.map((s) => s.web_id)).toEqual(["web:4", "web:2"]);
  });

  it("인용이 없으면(근거 없음) 신호도 없다. 인용한 웹 신호는 남긴다", () => {
    const signals = [sig("web:1", "사립학교법", "2026-10-01")];
    expect(relevantSignals(signals, [], [])).toEqual([]);
    expect(relevantSignals(signals, [{ id: "web:1", quote: "", role: "reference" }], [])).toHaveLength(1);
  });
});

describe("변경 신호 검색 법령", () => {
  it("부칙 문서는 본법 이름으로 묶는다(11/13 실제 호출에서 '고등교육법 부칙 <…> 개정 입법예고'를 검색한 일)", () => {
    expect(baseLawName("고등교육법 부칙 <법률 제20250호, 2024. 2. 13.>")).toBe("고등교육법");
    expect(baseLawName("고등교육법 시행령")).toBe("고등교육법 시행령");
    const c = (law: string, score: number) => ({ law_name: law, grade: "L1", score }) as ArticleCandidate;
    expect(topLawNames([c("고등교육법", 10), c("고등교육법 부칙 <법률 제20250호, 2024. 2. 13.>", 9), c("고등교육법 시행령", 5)])).toEqual([
      "고등교육법",
      "고등교육법 시행령",
    ]);
  });
});

describe("오프라인 Router 대역", () => {
  it("후보가 없으면 근거 없음, 있으면 원문 줄을 그대로 인용", () => {
    expect(extractiveAnswer("질문: 휴학\n기준일: 2026-11-05\n## 후보 조문 (0개)\n(없음)").verdict).toBe("no_basis");
    const a = extractiveAnswer(
      "질문: 학점 인정 범위\n기준일: 2026-11-05\n장면: 처리 중 / 업무: x\n\n## 후보 조문 (1개)\n[heaf:023-00] 고등교육법 제23조(학점의 인정 등) | 시행 중(2026. 9. 11. 시행) | 법령\n제23조(학점의 인정 등) ① 학교는 학점을 인정할 수 있다.\n\n## 웹 자료 (0개)\n(없음)",
    );
    expect(a.citations[0]).toMatchObject({ id: "heaf:023-00", role: "basis" });
  });
});
