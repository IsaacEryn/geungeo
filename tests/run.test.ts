// runPipeline 끝까지: 예시 data와 픽스처, Liner fetch 목만으로 질문 하나를 처리한다.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPipeline } from "@/lib/pipeline/run";
import { PipelineError } from "@/lib/pipeline/errors";
import { fixtureFileName } from "@/lib/liner/search";
import type { StageEvent } from "@/lib/pipeline/types";
import messages from "@/messages/ko.json";
import { buildTestCache } from "./support/cache";
import { chatBody, createLinerMock, schemaName } from "./support/liner-mock";
import { E22_QUESTION, E25_QUESTION, e22Handler, e25Handler, SIGNAL_RESULTS } from "./support/scenarios";

const cache = buildTestCache();

beforeEach(() => {
  vi.stubEnv("LINER_API_KEY", "test-key-not-real");
  vi.stubEnv("LINER_MODEL_ANALYZE", "");
  vi.stubEnv("LINER_MODEL_ANSWER", "");
  vi.stubEnv("AGENT_MODE", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("runPipeline E22형(시행 예정)", () => {
  it("근거 카드·상태·변경 신호·처리 과정을 돌려준다", async () => {
    const mock = createLinerMock(e22Handler);
    const events: StageEvent[] = [];
    const result = await runPipeline(
      { question: E22_QUESTION, asOf: "2026-11-05" },
      { cache, fetchImpl: mock.fetchImpl, onEvent: (e) => events.push(e) },
    );

    expect(result.request).toEqual({ question: E22_QUESTION, asOf: "2026-11-05", school: null, mode: "fixed" });
    expect(result.scene).toBe("initiating");
    expect(result.verdict).toBe("answered");
    expect(result.data_collected_at).toBe("2026-11-05T00:27:00+09:00");

    const card = result.cards.find((c) => c.id === "heaf:011-02" && c.role === "basis")!;
    expect(card).toMatchObject({
      grade: "L1",
      title: "고등교육법",
      kind: "act",
      location: "제11조의2제2항",
      badge: "not_yet",
      effective_from: "2027-03-11",
      attribution: "출처: 법제처 국가법령정보센터",
    });
    expect(card.amend_tags).toContain("[본조신설 2026. 3. 10.]");
    expect(card.notes).toContain("학칙으로 위임 — 학교별 확인");
    expect(result.cards.find((c) => c.role === "delegation")?.location).toBe("제11조의2제3항");

    // 신호: 블로그 재게시본·목록 페이지는 빠지고 교육부 원문과 공포 소식만, 최근 것부터
    expect(result.change_signals.map((s) => s.kind)).toEqual(["amendment_news", "legislative_notice"]);
    // 고등교육법으로 찾았지만 제목의 「고등교육법 시행령」 입법예고라 다루는 법령은 시행령으로 적는다
    expect(result.change_signals[1]).toMatchObject({ opinion_deadline: "2026-12-07", after_collection: false, related_law: "고등교육법 시행령" });
    expect(result.change_signals[0].after_collection).toBe(true);
    const webCard = result.cards.find((c) => c.id === "web:1")!;
    expect(webCard).toMatchObject({ grade: "W1", badge: "proposed", role: "reference", posted_date: "2026-10-27" });
    // 수집 뒤 공포 소식이 있어 조문 카드에 배지
    expect(card.changed_after_collection).toBe(true);

    expect(result.checklist[0].basis_ids).toEqual(["heaf:011-02"]);
    expect(result.verification).toMatchObject({ removed_citations: 0, retried: false, verdict_before: "answered", verdict_after: "answered" });
    expect(result.warnings).toEqual([]);

    // 호출: 신호 검색 1(질문 분석과 겹쳐 먼저 띄움) + 분석 1 + 답 1. 공고 검색은 건너뜀. 분석 검색어의 날짜는 지워진다
    expect(mock.calls.map((c) => c.path)).toEqual(["/tools/search/web", "/chat/completions", "/chat/completions"]);
    expect(schemaName(mock.calls[1].body)).toBe("question_analysis");
    expect(mock.calls[0].body).toMatchObject({ query: "고등교육법 개정 입법예고", include_knowledge: false, lang: "ko", country_code: "kr", date_range: "past_year" });
    expect(mock.calls[0].headers["x-api-key"]).toBe("test-key-not-real");
    expect(mock.calls[1].headers.Authorization).toBe("Bearer test-key-not-real");
    expect(result.trace.calls.find((c) => c.stage === "collect_web")?.note).toContain("건너뜀");
    expect(result.trace.calls.find((c) => c.stage === "collect_cache")?.query).not.toContain("2026-11-05");

    // 비용 = 모델 2회(입력 1000·출력 300) + Search 1회
    expect(result.trace.total_cost_usd).toBeCloseTo(2 * (1000 * 1 + 300 * 5) / 1e6 + 0.001, 9);
    expect(result.trace.models).toEqual({ analyze: "liner-mark-1.3", answer: "liner-mark-1.3" });

    // 처리 과정에는 허용 필드만(키·본문 없음)
    expect(JSON.stringify(result)).not.toContain("test-key-not-real");

    const order = events.filter((e) => e.type === "stage_start").map((e) => (e as { stage: string }).stage);
    expect(order).toEqual(["analyze", "collect_cache", "collect_web", "collect_signals", "answer", "verify"]);
    expect(events.every((e) => e.type !== "stage_end" || e.ok)).toBe(true);
  });

  it("12/05 결선 기준일에도 시행 예정", async () => {
    const mock = createLinerMock(e22Handler);
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-12-05" }, { cache, fetchImpl: mock.fetchImpl });
    expect(result.cards.find((c) => c.id === "heaf:011-02")?.badge).toBe("not_yet");
  });
});

describe("runPipeline E25형(근거 없음)", () => {
  it("지어낸 인용을 빼고 한 번 다시 부른 뒤 근거 없음과 찾아본 범위를 낸다", async () => {
    const mock = createLinerMock(e25Handler);
    const result = await runPipeline({ question: E25_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl });
    expect(result.verdict).toBe("no_basis");
    expect(result.cards).toEqual([]);
    expect(result.verification.retried).toBe(true);
    expect(result.verification.removed_citations).toBe(4); // 처음 2 + 재시도 2
    expect(result.verification.verdict_before).toBe("answered");
    expect(result.searched_scope?.laws).toContain("사립학교법");
    expect(result.searched_scope?.where_to_check).toContain("학교법인 정관(사립)");
    expect(result.searched_scope?.queries.length).toBeGreaterThan(0);
    const answerCalls = mock.calls.filter((c) => schemaName(c.body) === "grounded_answer");
    expect(answerCalls).toHaveLength(2);
    expect((answerCalls[1].body.messages as { content: string }[])[1].content).toContain("앞 답의 문제");
  });
});

describe("runPipeline 실패·대체", () => {
  it("질문 분석이 400이면 규칙 기반으로 대체하고 계속한다", async () => {
    const mock = createLinerMock((call) => {
      if (schemaName(call.body) === "question_analysis" || (call.body.response_format as { type?: string })?.type === "json_object") {
        return { status: 400, body: { error: { code: "INVALID_REQUEST" } } };
      }
      return e22Handler(call);
    });
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl });
    const analyze = result.trace.calls.find((c) => c.stage === "analyze")!;
    expect(analyze.note).toContain("규칙 기반 대체");
    expect(result.cards.some((c) => c.id === "heaf:011-02")).toBe(true);
    // 규칙 대체는 처리 과정뿐 아니라 화면 주의 문구에도 나와야 한다
    expect(result.warnings).toContain("질문 분석은 규칙으로 대신했습니다.");
  });

  it("질문 분석이 성공하면 규칙 대체 주의 문구가 없다", async () => {
    const mock = createLinerMock(e22Handler);
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl });
    expect(result.warnings).not.toContain("질문 분석은 규칙으로 대신했습니다.");
  });

  it("키가 없으면 missing_api_key 오류 이벤트", async () => {
    vi.stubEnv("LINER_API_KEY", "");
    const events: StageEvent[] = [];
    await expect(runPipeline({ question: E22_QUESTION }, { cache, onEvent: (e) => events.push(e) })).rejects.toMatchObject({
      code: "missing_api_key",
    });
    expect(events).toEqual([{ type: "error", code: "missing_api_key", message: expect.stringContaining("LINER_API_KEY") }]);
  });

  it("기준일 형식이 틀리거나 질문이 비면 bad_request", async () => {
    await expect(runPipeline({ question: E22_QUESTION, asOf: "2026-13-01" }, { cache })).rejects.toBeInstanceOf(PipelineError);
    await expect(runPipeline({ question: "  " }, { cache })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("답 단계가 429를 계속 받으면 rate_limited", async () => {
    const mock = createLinerMock((call) =>
      schemaName(call.body) === "grounded_answer" ? { status: 429, body: {}, headers: { "retry-after": "0" } } : e22Handler(call),
    );
    await expect(runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  // Liner가 모든 요청에 같은 상태로 답할 때 화면에 나가는 코드와 문구
  it.each([
    [401, "invalid_api_key", messages.errors.invalid_api_key],
    [403, "invalid_api_key", messages.errors.invalid_api_key],
    [402, "insufficient_credit", messages.errors.insufficient_credit],
    [503, "liner_unavailable", messages.errors.liner_unavailable],
  ] as const)("Liner가 %i이면 %s", async (status, code, message) => {
    const mock = createLinerMock(() => ({ status, body: { error: { code: "X" } }, headers: { "retry-after": "0" } }));
    const events: StageEvent[] = [];
    await expect(
      runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl, onEvent: (e) => events.push(e) }),
    ).rejects.toMatchObject({ code, message });
    expect(events.at(-1)).toEqual({ type: "error", code, message });
  });

  it("키가 틀리면 '잠시 뒤 다시'가 아니라 키를 확인하라고 한다", () => {
    expect(messages.errors.invalid_api_key).toContain("LINER_API_KEY");
    expect(messages.errors.invalid_api_key).not.toContain("잠시 뒤");
    expect(messages.errors.insufficient_credit).toContain("크레딧");
    expect(messages.errors.rate_limited).toContain("잠시 뒤");
    expect(messages.errors.liner_unavailable).toContain("연결하지 못했습니다");
  });

  it("네트워크 오류가 이어지면 liner_unavailable(연결 실패)", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: failing })).rejects.toMatchObject({
      code: "liner_unavailable",
      message: messages.errors.liner_unavailable,
    });
  });

  it("tools 모드는 아직 fixed로 처리하고 알린다", async () => {
    const mock = createLinerMock(e22Handler);
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-11-05", mode: "tools" }, { cache, fetchImpl: mock.fetchImpl });
    expect(result.request.mode).toBe("tools");
    expect(result.warnings.join(" ")).toContain("tools");
  });
});

describe("Search 고정 응답(searchFixtureDir)", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "geungeo-fixture-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("검색어 해시 이름의 파일을 읽고 Search를 부르지 않는다", async () => {
    await writeFile(path.join(dir, fixtureFileName({ query: "고등교육법 개정 입법예고", date_range: "past_year" })), JSON.stringify(SIGNAL_RESULTS));
    const mock = createLinerMock((call) => {
      if (call.path === "/tools/search/web") throw new Error("Search를 부르면 안 됨");
      return e22Handler(call);
    });
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl, searchFixtureDir: dir });
    expect(result.change_signals).toHaveLength(2);
    const signalCall = result.trace.calls.find((c) => c.stage === "collect_signals")!;
    expect(signalCall.note).toBe("고정 응답, 목록 페이지 제외");
    expect(signalCall.usage).toBeUndefined();
  });

  it("파일이 없으면 빈 결과로 계속한다", async () => {
    const mock = createLinerMock(e22Handler);
    const result = await runPipeline({ question: E22_QUESTION, asOf: "2026-11-05" }, { cache, fetchImpl: mock.fetchImpl, searchFixtureDir: dir });
    expect(result.change_signals).toEqual([]);
    expect(result.trace.calls.find((c) => c.stage === "collect_signals")?.note).toBe("고정 응답 없음");
  });
});

it("chatBody 형식 확인(목 자체)", () => {
  expect(chatBody({ a: 1 }).choices[0].message.content).toBe('{"a":1}');
});
