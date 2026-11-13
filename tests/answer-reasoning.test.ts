// ③ 답변의 추론 강도(LINER_REASONING_ANSWER)와 출력 길이 관련 설정. 네트워크 없이 fetch 목으로만 돈다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANSWER_REASONING, answerQuestion, answerReasoning, coerceDraft, type AnswerInput } from "@/lib/pipeline/answer";
import { reasoningFromEnv } from "@/lib/liner/router";
import { outputChars } from "../scripts/eval/run.mjs";
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
