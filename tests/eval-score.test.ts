// 평가 채점(scripts/eval/score.mjs)과 실행기 집계·비밀 검사 시험. Liner를 부르지 않는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSecrets, loadQuestions, makeCoster, parseArgs, summarize } from "../scripts/eval/run.mjs";
import { includesAny, scoreOne } from "../scripts/eval/score.mjs";
import { runPipeline as mockPipeline } from "../scripts/eval/mock-pipeline.mjs";

const questions = loadQuestions();
const byId = (id: string) => questions.find((q) => q.id === id)!;
const pricing = JSON.parse(readFileSync("config/pricing.json", "utf8"));

function result(over: Record<string, unknown> = {}) {
  return {
    verdict: "answered",
    summary: "",
    cards: [] as { id: string; location: string; quote: string }[],
    checklist: [],
    caveats: [],
    warnings: [],
    verification: { removed_citations: 0 },
    trace: { calls: [] },
    ...over,
  };
}

describe("eval/questions.jsonl", () => {
  it("머리 주석을 건너뛰고 28문항을 읽는다", () => {
    expect(questions).toHaveLength(28);
    expect(new Set(questions.map((q) => q.id)).size).toBe(28);
  });
  it("문항마다 채점에 쓰는 칸이 있다", () => {
    for (const q of questions) {
      expect(Array.isArray(q.article_ids)).toBe(true);
      expect(Array.isArray(q.must_include)).toBe(true);
      expect(["answered", "no_basis"]).toContain(q.expected_verdict);
      for (const l of q.locations) expect(q.article_ids.concat(q.school_article_ids)).toContain(l.id);
    }
  });
  it("근거 없음 4문항, 시행일·입법예고 함정 5문항", () => {
    expect(questions.filter((q) => q.expected_verdict === "no_basis").map((q) => q.id)).toEqual(["E25", "E26", "E27", "E28"]);
    expect(questions.filter((q) => q.trap).map((q) => q.id).sort()).toEqual(["E10", "E11", "E22", "E23", "E24"]);
  });
});

describe("scoreOne", () => {
  it("공백을 무시하고 대안 중 하나만 있으면 된다", () => {
    expect(includesAny("인상 한도는 3.19 %", "3.19%|3.19퍼센트")).toBe(true);
    expect(includesAny("인상 한도", "3.19%")).toBe(false);
  });

  it("모양이 틀리면 형식 오류", () => {
    const s = scoreOne(byId("E01"), { summary: 1 });
    expect(s.format_error).toBe(true);
    expect(s.pass).toBe(false);
  });

  it("근거 조가 빠지면 실패", () => {
    const q = byId("E01");
    const s = scoreOne(q, result({ summary: q.answer_summary, cards: [] }));
    expect(s.checks.article.pass).toBe(false);
    expect(s.pass).toBe(false);
  });

  it("지어낸 인용을 지웠으면 실패", () => {
    const q = byId("E01");
    const cards = q.article_ids.map((id: string) => ({ id, location: "", quote: "" }));
    const s = scoreOne(q, result({ summary: q.answer_summary, cards, verification: { removed_citations: 1 } }));
    expect(s.checks.fabricated.pass).toBe(false);
    expect(s.pass).toBe(false);
  });

  it("근거 없음 문항은 no_basis 또는 '직접 근거 없음'을 밝힌 partial이면 판정 통과", () => {
    const q = byId("E25");
    expect(scoreOne(q, result({ verdict: "no_basis" })).checks.verdict.pass).toBe(true);
    expect(scoreOne(q, result({ verdict: "partial", summary: "법령에는 직접 근거가 없습니다." })).checks.verdict.pass).toBe(true);
    expect(scoreOne(q, result({ verdict: "answered" })).checks.verdict.pass).toBe(false);
  });

  it("법령이 주어로 '정하지 않는다'고 밝힌 partial도 근거 없음 취지로 본다(학칙이 주어인 문장은 아님)", () => {
    const q = byId("E26");
    const partial = (summary: string) => scoreOne(q, result({ verdict: "partial", summary })).checks.verdict.pass;
    expect(partial("법은 최대 연수를 정하지 않고 학칙으로 정하게 합니다.")).toBe(true);
    expect(partial("법령에는 기간 상한을 두지 않았습니다.")).toBe(true);
    expect(partial("고등교육법 휴학 조항은 최대 휴학 연수를 정하지 않고 학칙에 맡깁니다.")).toBe(true);
    expect(partial("시행령은 일률적인 최소 기간을 정하지 않고 학칙이 정하는 바에 따릅니다.")).toBe(true);
    expect(partial("학칙에서 정하지 않은 사항은 총장이 정합니다.")).toBe(false);
    expect(partial("공고 방법은 학교가 정하지 않아도 됩니다.")).toBe(false);
    expect(partial("고등교육법 제23조의4에 따라 휴학할 수 있습니다.")).toBe(false);
    // 법령 이름 뒤에 학칙이 주어로 오는 문장, 뒤 명사를 꾸미는 '정하지 않은'은 잡지 않는다
    expect(partial("고등교육법에 따라 학칙에서 정하지 않은 사항은 총장이 정합니다.")).toBe(false);
    expect(partial("고등교육법에 따라 학교는 수업 일수를 따로 정하지 않습니다.")).toBe(false);
    expect(partial("시행령에서 정하지 않은 세부 사항은 학칙으로 정할 수 있으며, 학칙에 따르면 4개 학기입니다.")).toBe(false);
  });

  it("시행 전 함정은 시행일과 '시행 예정' 취지를 함께 말해야 통과", () => {
    const q = byId("E22");
    expect(q.trap.kind).toBe("not_yet");
    const [y, m, d] = q.trap.date.split("-").map(Number);
    const ok = scoreOne(q, result({ summary: `${y}. ${m}. ${d}.부터 시행됩니다. 아직 시행 전입니다.` }));
    const bad = scoreOne(q, result({ summary: "지금 적용됩니다." }));
    expect(ok.checks.trap.pass).toBe(true);
    expect(bad.checks.trap.pass).toBe(false);
  });

  it("학칙 조는 --strict-school일 때만 통과 조건에 든다", () => {
    const q = questions.find((x) => x.school && x.school_article_ids.length)!;
    const cards = q.article_ids.map((id: string) => ({ id, location: "", quote: "" }));
    const r = result({ summary: q.answer_summary, cards });
    expect(scoreOne(q, r).checks.article.pass).toBe(true);
    expect(scoreOne(q, r, { strictSchool: true }).checks.article.pass).toBe(false);
  });
});

describe("실행기", () => {
  it("옵션을 읽고 잘못된 값은 막는다", () => {
    const o = parseArgs(["--asof", "2026-11-05", "--repeat", "3", "--compare", "a,b", "--credit-limit", "5", "--mock"]);
    expect(o).toMatchObject({ asof: "2026-11-05", repeat: 3, compare: ["a", "b"], creditLimit: 5, mock: true });
    expect(parseArgs(["--mock-runner"])).toMatchObject({ mockRunner: true, mock: false });
    expect(() => parseArgs(["--asof", "11/5"])).toThrow();
    expect(() => parseArgs(["--nope"])).toThrow();
  });

  it("비용은 토큰×단가로 계산하고 단가 없는 모델은 표시한다", () => {
    const costOf = makeCoster(pricing);
    const c = costOf({
      trace: {
        calls: [
          { api: "router", model: "liner-mark-1.3", usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } },
          { api: "search", usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cost_usd: 0.001 } },
          { api: "search", note: "고정 응답" }, // 고정 응답·건너뜀은 과금 없음
          { api: "router", model: "unknown-model", usage: { prompt_tokens: 10, completion_tokens: 10, cost_usd: 0.5 } },
        ],
      },
    });
    expect(c.calls).toMatchObject({ router: 2, search: 2 });
    expect(c.usd).toBeCloseTo(pricing.router["liner-mark-1.3"].input_per_million + pricing.search_per_call + 0.5);
    expect(c.unpriced).toBe(true);
  });

  it("목 파이프라인 결과를 채점·집계한다", async () => {
    const costOf = makeCoster(pricing);
    const rows = [];
    for (const q of questions) {
      let r = null;
      try {
        r = await mockPipeline({ question: q.question, asOf: "2026-11-05", school: q.school ?? null, mode: "fixed" }, {});
      } catch {
        r = null;
      }
      const s = r ? scoreOne(q, r) : { pass: false, format_error: true, problems: [], checks: {} };
      const c = costOf(r);
      rows.push({ id: q.id, pass: s.pass, format_error: s.format_error, removed_citations: r?.verification.removed_citations ?? null, calls: c.calls, tokens: c.tokens, cost_usd: c.usd, unpriced: c.unpriced, duration_ms: 1, answer_ms: 1 });
    }
    const s = summarize(rows, questions);
    expect(s.runs).toBe(28);
    expect(s.passed).toBeGreaterThan(0);
    expect(s.passed).toBeLessThan(28);
    expect(s.no_basis.of).toBe(4);
    expect(s.traps.of).toBe(5);
  });

  it("결과에 키 값이나 키 모양 문자열이 있으면 찾아낸다", () => {
    const env = { LINER_API_KEY: "test-key-value-123456" };
    expect(findSecrets("... test-key-value-123456 ...", env)).toContain("LINER_API_KEY");
    expect(findSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz", {})).toHaveLength(1);
    expect(findSecrets("정상 결과", env)).toHaveLength(0);
  });
});
