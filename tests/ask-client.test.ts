// 화면의 components/ask-client.ts가 실제 /api/ask 응답(NDJSON 스트림·JSON 오류)을 받는지 본다.
// 브라우저 fetch("/api/ask")를 라우트 POST로 이어 주고, 라우트 안의 Liner 호출은 fetch 목으로 막는다.
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
const { ask, AskError } = await import("@/components/ask-client");

beforeEach(() => {
  vi.stubEnv("LINER_API_KEY", "test-key-not-real");
  const liner = createLinerMock(e22Handler).fetchImpl;
  // 상대 주소 /api/ask는 라우트로, 그 밖(Liner)은 목으로
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/ask") return POST(new Request("http://localhost/api/ask", init));
    return liner(input, init);
  }) as typeof fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ask-client ↔ /api/ask", () => {
  it("NDJSON 단계 이벤트와 결과를 차례로 받는다(목 데이터 아님)", async () => {
    const events: StageEvent[] = [];
    const outcome = await ask({ question: E22_QUESTION, asOf: "2026-11-05", school: null }, (e) => events.push(e), new AbortController().signal);
    expect(outcome.mock).toBe(false);
    expect(events[0]).toMatchObject({ type: "stage_start", stage: "analyze" });
    const last = events.at(-1)!;
    expect(last.type).toBe("result");
    if (last.type === "result") {
      expect(last.result.cards.some((c) => c.id === "heaf:011-02" && c.badge === "not_yet")).toBe(true);
      // 서버가 계산한 금액이 처리 과정에 실려 온다
      const routerCalls = last.result.trace.calls.filter((c) => c.api === "router");
      expect(routerCalls.every((c) => typeof c.usage?.cost_usd === "number" && c.usage.cost_usd > 0)).toBe(true);
      expect(last.result.trace.total_cost_usd).toBeGreaterThan(0);
    }
  });

  it("빈 질문은 서버 오류 문구와 코드를 그대로 받는다", async () => {
    // 라우트는 JSON 본문 오류를 {type:"error", code, message}로 돌려준다
    const res = await POST(
      new Request("http://localhost/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }),
    );
    expect(await res.json()).toMatchObject({ type: "error", code: "bad_request" });
    await expect(ask({} as never, () => undefined, new AbortController().signal)).rejects.toBeInstanceOf(AskError);
    await expect(ask({} as never, () => undefined, new AbortController().signal)).rejects.toMatchObject({ code: "bad_request" });
  });
});
