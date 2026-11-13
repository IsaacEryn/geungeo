// ③ 답변의 추론 강도(LINER_REASONING_ANSWER)와 출력 길이 관련 설정. 네트워크 없이 fetch 목으로만 돈다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANSWER_REASONING, answerQuestion, answerReasoning, coerceDraft, type AnswerInput } from "@/lib/pipeline/answer";
import { reasoningFromEnv } from "@/lib/liner/router";
import { analyzeReasoning, DEFAULT_ANALYZE_REASONING } from "@/lib/pipeline/analyze";
import { codeVersion, outputChars, reasoningRecord } from "../scripts/eval/run.mjs";
import { chatBody, createLinerMock } from "./support/liner-mock";

beforeEach(() => vi.stubEnv("LINER_API_KEY", "test-key-not-real"));
afterEach(() => vi.unstubAllEnvs());

const input: AnswerInput = {
  question: "질문",
  asOf: "2026-11-05",
  school: null,
  analysis: { scene: "processing", task: "", concepts: [], queries_cache: [], queries_web: [], needs_external: false, needs_external_reason: "", school: null, fallback: false },
  candidates: [],
  web: [],
  signals: [],
  notices: [],
};

const draft = { verdict: "no_basis", summary: "근거 없음", citations: [], checklist: [], caveats: [], searched_scope: { laws: [], queries: [], where_to_check: [] } };

async function sentEffort(options: Parameters<typeof answerQuestion>[1] = {}) {
  const mock = createLinerMock(() => ({ body: chatBody(draft) }));
  await answerQuestion(input, { ...options, call: { fetchImpl: mock.fetchImpl } });
  const body = mock.calls[0].body;
  return "reasoning_effort" in body ? body.reasoning_effort : "(보내지 않음)";
}

describe("③ 추론 강도", () => {
  it("환경변수가 없으면 기본값을 따르고, 기본값이 없으면 reasoning_effort를 보내지 않는다", async () => {
    vi.stubEnv("LINER_REASONING_ANSWER", "");
    expect(await sentEffort()).toBe(DEFAULT_ANSWER_REASONING ?? "(보내지 않음)");
  });

  it("LINER_REASONING_ANSWER 값을 그대로 보낸다(대소문자·공백 무시)", async () => {
    vi.stubEnv("LINER_REASONING_ANSWER", " LOW ");
    expect(await sentEffort()).toBe("low");
    vi.stubEnv("LINER_REASONING_ANSWER", "medium");
    expect(await sentEffort()).toBe("medium");
  });

  it("모르는 값은 무시하고 기본값으로 돌아간다", async () => {
    vi.stubEnv("LINER_REASONING_ANSWER", "fast");
    expect(reasoningFromEnv("LINER_REASONING_ANSWER")).toBeUndefined();
    expect(answerReasoning()).toBe(DEFAULT_ANSWER_REASONING);
  });

  it("인자로 준 값이 환경변수보다 앞선다", async () => {
    vi.stubEnv("LINER_REASONING_ANSWER", "low");
    expect(await sentEffort({ reasoningEffort: "high" })).toBe("high");
  });

  it("① 환경변수는 ③에 영향을 주지 않는다", async () => {
    vi.stubEnv("LINER_REASONING_ANALYZE", "max");
    vi.stubEnv("LINER_REASONING_ANSWER", "");
    expect(await sentEffort()).toBe(DEFAULT_ANSWER_REASONING ?? "(보내지 않음)");
  });
});

describe("③ 출력 길이", () => {
  it("기본값은 보내지 않음(Liner 기본)으로 둔다", () => {
    expect(DEFAULT_ANSWER_REASONING).toBeUndefined();
  });

  it("근거 없음이 아니면 모델이 채운 찾아본 범위는 버린다(화면은 근거 없음일 때만 보여 줌)", () => {
    const scope = { laws: ["법"], queries: ["검색어"], where_to_check: ["정관"] };
    expect(coerceDraft({ ...draft, verdict: "answered", searched_scope: scope })?.searched_scope).toBeNull();
    expect(coerceDraft({ ...draft, searched_scope: scope })?.searched_scope).toEqual(scope);
  });

  it("평가 결과에 필드별 글자 수를 센다", () => {
    const chars = outputChars({
      summary: "가나다",
      cards: [{ quote: "인용1" }, { quote: "인용22" }],
      checklist: [{ step: "단계", deadline: "7일" }, { step: "끝" }],
      caveats: ["주의"],
      searched_scope: null,
    });
    expect(chars).toEqual({ summary: 3, quotes: 7, checklist: 5, caveats: 2, searched_scope: 0 });
    expect(outputChars({ summary: "", searched_scope: { laws: ["법"], queries: ["검색어"], where_to_check: [] } }).searched_scope).toBe(4);
  });
});

describe("평가 실행 조건 기록", () => {
  it("모르는 추론 강도 값은 무시하고 기본값을 쓴다(①은 low, ③은 보내지 않음)", () => {
    vi.stubEnv("LINER_REASONING_ANALYZE", "fast");
    vi.stubEnv("LINER_REASONING_ANSWER", "fast");
    expect(analyzeReasoning()).toBe(DEFAULT_ANALYZE_REASONING);
    expect(answerReasoning()).toBe(DEFAULT_ANSWER_REASONING);
    expect(analyzeReasoning("high")).toBe("high");
  });

  it("summary.json에는 실제로 보낸 값과 환경변수 원문을 함께 남긴다", () => {
    const env = { LINER_REASONING_ANALYZE: "", LINER_REASONING_ANSWER: "fast" };
    expect(reasoningRecord({ analyze: "low", answer: undefined }, env)).toEqual({
      analyze: "low",
      answer: "(보내지 않음)",
      env: { analyze: "", answer: "fast" },
    });
    expect(reasoningRecord({ analyze: "low", answer: "low" }, { LINER_REASONING_ANSWER: " LOW " })).toEqual({
      analyze: "low",
      answer: "low",
      env: { analyze: null, answer: " LOW " },
    });
  });

  it("대역 파이프라인처럼 보낸 값을 모르면 null로 둔다", () => {
    expect(reasoningRecord(undefined, {})).toEqual({ analyze: null, answer: null, env: { analyze: null, answer: null } });
  });

  it("실행한 커밋 해시와 작업 중 변경 여부를 남기고, git이 실패하면 뺀다", () => {
    const fake = (out: Record<string, string>) => ((_cmd: string, args: string[]) => {
      const v = out[args[0]];
      if (v === undefined) throw new Error("git 실패");
      return v;
    }) as unknown as Parameters<typeof codeVersion>[1];
    expect(codeVersion("/x", fake({ "rev-parse": "abc1234\n", status: "" }))).toEqual({ commit: "abc1234", dirty: false });
    expect(codeVersion("/x", fake({ "rev-parse": "abc1234\n", status: " M lib/a.ts\n" }))).toEqual({ commit: "abc1234", dirty: true });
    expect(codeVersion("/x", fake({ "rev-parse": "abc1234" }))).toEqual({ commit: "abc1234" });
    expect(codeVersion("/x", fake({}))).toBeUndefined();
  });

  it("이 저장소에서는 실제 커밋 해시를 읽는다", () => {
    const v = codeVersion();
    if (v) expect(v.commit).toMatch(/^[0-9a-f]{7,}$/);
  });
});
