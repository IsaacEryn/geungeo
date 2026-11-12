// POST /api/ask: 단계 이벤트 NDJSON 스트리밍과 JSON 한 번에 받기.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StageEvent } from "@/lib/pipeline/types";
import { buildTestCache } from "./support/cache";
import { createLinerMock } from "./support/liner-mock";
import { E22_QUESTION, e22Handler } from "./support/scenarios";

vi.mock("@/lib/cache/load", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cache/load")>()),
  loadCache: async () => buildTestCache(),
  loadSchoolRules: async () => null,
}));

const { POST } = await import("@/app/api/ask/route");

function post(body: unknown, accept?: string) {
  return POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...(accept ? { accept } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("LINER_API_KEY", "test-key-not-real");
  vi.stubGlobal("fetch", createLinerMock(e22Handler).fetchImpl);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/ask", () => {
  it("NDJSON으로 단계 이벤트를 흘리고 마지막에 결과", async () => {
    const res = await post({ question: E22_QUESTION, asOf: "2026-11-05", school: null });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as StageEvent);
    expect(events[0]).toMatchObject({ type: "stage_start", stage: "analyze" });
    const last = events.at(-1)!;
    expect(last.type).toBe("result");
    if (last.type === "result") expect(last.result.cards[0].badge).toBe("not_yet");
    expect(events.filter((e) => e.type === "stage_end")).toHaveLength(6);
  });

  it("Accept: application/json이면 결과 하나", async () => {
    const res = await post({ question: E22_QUESTION, asOf: "2026-11-05" }, "application/json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("answered");
  });

  it("본문이 JSON이 아니거나 질문이 없으면 400", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ asOf: "2026-11-05" })).status).toBe(400);
  });

  it("스트리밍 중 오류는 error 이벤트 한 줄(예외 원문 없음)", async () => {
    vi.stubEnv("LINER_API_KEY", "");
    const res = await post({ question: E22_QUESTION });
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "error", code: "missing_api_key" });
  });

  it("JSON 모드 오류는 상태 코드와 함께", async () => {
    const res = await post({ question: E22_QUESTION, asOf: "bad" }, "application/json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ type: "error", code: "bad_request" });
  });
});
