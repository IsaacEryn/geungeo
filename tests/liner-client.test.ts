// Liner 호출 계층: 겹쳐 보내기(hedge)·제한 시간·실제 답한 모델·단가. 네트워크 없이 fetch 목으로만 돈다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinerError, linerRequest } from "@/lib/liner/client";
import { usageCost } from "@/lib/liner/cost";
import { chat, chatHedged, hedgeTraceFields } from "@/lib/liner/router";
import { traceTotalCost } from "@/lib/pipeline/run";
import { chatBody } from "./support/liner-mock";

beforeEach(() => vi.stubEnv("LINER_API_KEY", "test-key-not-real"));
afterEach(() => vi.unstubAllEnvs());

interface Planned {
  delayMs: number;
  status?: number;
  body?: unknown;
}

/** 요청마다 정해 둔 지연 뒤 응답. 취소되면 AbortError로 끝나고, 시작·취소를 기록한다 */
function delayedFetch(plan: Planned[]) {
  const log: { n: number; body: Record<string, unknown>; aborted: boolean }[] = [];
  const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => {
    const n = log.length;
    const entry = { n, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, aborted: false };
    log.push(entry);
    const p = plan[Math.min(n, plan.length - 1)];
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => {
        resolve(new Response(JSON.stringify(p.body ?? chatBody({ ok: n })), { status: p.status ?? 200, headers: { "content-type": "application/json" } }));
      }, p.delayMs);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        entry.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }) as typeof fetch;
  return { fetchImpl, log };
}

const request = { model: "liner-mark-1.3", messages: [{ role: "user" as const, content: "질문" }] };

describe("chatHedged", () => {
  it("첫 요청이 기준 안에 끝나면 하나만 보낸다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5 }]);
    const res = await chatHedged(request, { fetchImpl }, { afterMs: 200, timeoutMs: 1000 });
    expect(log).toHaveLength(1);
    expect(res.duplicate_requests).toBeUndefined();
    expect(res.hedge_winner).toBeUndefined();
    expect(JSON.parse(res.content!)).toEqual({ ok: 0 });
  });

  it("첫 요청이 늦으면 같은 요청을 겹쳐 보내고 먼저 끝난 쪽을 쓰며 나머지는 취소한다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 2000 }, { delayMs: 10 }]);
    const started = Date.now();
    const res = await chatHedged(request, { fetchImpl }, { afterMs: 30, timeoutMs: 5000 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log).toHaveLength(2);
    expect(log[1].body).toEqual(log[0].body); // 같은 요청
    expect(log[0].aborted).toBe(true);
    expect(res.duplicate_requests).toBe(1);
    expect(res.hedge_winner).toBe(2);
    expect(JSON.parse(res.content!)).toEqual({ ok: 1 });
    expect(res.duration_ms).toBeGreaterThanOrEqual(30);
  });

  it("겹쳐 보낸 뒤 첫 요청이 먼저 끝나면 그것을 쓴다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 60 }, { delayMs: 2000 }]);
    const res = await chatHedged(request, { fetchImpl }, { afterMs: 20, timeoutMs: 5000 });
    expect(JSON.parse(res.content!)).toEqual({ ok: 0 });
    expect(log[1].aborted).toBe(true);
    expect(res.duplicate_requests).toBe(1);
    expect(res.hedge_winner).toBe(1);
  });

  it("첫 요청이 기준 전에 실패하면 겹쳐 보내지 않고 실패를 돌려준다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5, status: 402, body: { error: { code: "INSUFFICIENT_CREDITS" } } }]);
    await expect(chatHedged(request, { fetchImpl }, { afterMs: 50, timeoutMs: 1000 })).rejects.toMatchObject({ code: "insufficient_credit" });
    await new Promise((r) => setTimeout(r, 80));
    expect(log).toHaveLength(1);
  });

  it("둘 다 제한 시간에 걸리면 다시 부르지 않고 실패한다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5000 }]);
    const started = Date.now();
    await expect(chatHedged(request, { fetchImpl }, { afterMs: 20, timeoutMs: 80 })).rejects.toBeInstanceOf(LinerError);
    expect(log).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("바깥 취소는 두 요청 모두 멈춘다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5000 }]);
    const controller = new AbortController();
    const p = chatHedged(request, { fetchImpl, signal: controller.signal }, { afterMs: 20, timeoutMs: 5000 });
    setTimeout(() => controller.abort(), 60);
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    expect(log.every((l) => l.aborted)).toBe(true);
  });
});

describe("겹친 요청 기록과 화면 금액", () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 300, reasoning_tokens: 0, cost_usd: 0.0025, priced: true };

  it("겹쳐 보내지 않았으면 trace에 아무것도 더하지 않는다", () => {
    expect(hedgeTraceFields({ usage })).toEqual({});
  });

  it("겹쳐 보냈으면 이긴 요청 번호와 취소된 요청 몫(먼저 끝난 요청과 같은 크기로 추정)을 남긴다", () => {
    expect(hedgeTraceFields({ usage, duplicate_requests: 1, hedge_winner: 2 })).toEqual({ duplicate_requests: 1, hedge_winner: 2, duplicate_cost_usd: 0.0025 });
  });

  it("total_cost_usd는 겹친 요청 추정치를 포함한다", () => {
    const calls = [
      { usage: { ...usage, cost_usd: 0.002 } },
      { usage: { ...usage, cost_usd: 0.0025 }, ...hedgeTraceFields({ usage, duplicate_requests: 1, hedge_winner: 1 }) },
      {},
    ];
    expect(traceTotalCost(calls)).toBeCloseTo(0.002 + 0.0025 * 2, 9);
  });
});

describe("linerRequest 제한 시간", () => {
  it("retryOnTimeout:false면 제한 시간에 걸린 시도를 다시 부르지 않는다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5000 }]);
    await expect(linerRequest("POST", "/chat/completions", {}, "bearer", { fetchImpl, timeoutMs: 30, retryOnTimeout: false })).rejects.toMatchObject({
      code: "liner_unavailable",
    });
    expect(log).toHaveLength(1);
  });

  it("기본은 제한 시간에 걸리면 한 번 더 부른다(예전 동작 유지)", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 5000 }, { delayMs: 5 }]);
    const res = await linerRequest("POST", "/chat/completions", {}, "bearer", { fetchImpl, timeoutMs: 30 });
    expect(res.status).toBe(200);
    expect(log).toHaveLength(2);
  });
});

describe("chat: 실제 답한 모델·추론 강도", () => {
  it("응답의 model을 served_model로 남기고 그 모델 단가로 센다", async () => {
    const body = { ...chatBody({ a: 1 }, { prompt_tokens: 1000, completion_tokens: 100, reasoning_tokens: 0 }), model: "claude-sonnet-5.5" };
    const { fetchImpl } = delayedFetch([{ delayMs: 1, body }]);
    const res = await chat({ ...request, model: "liner-claude-router" }, { fetchImpl });
    expect(res.model).toBe("liner-claude-router");
    expect(res.served_model).toBe("claude-sonnet-5.5");
    expect(res.usage.priced).toBe(true);
    expect(res.usage.cost_usd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 12);
  });

  it("응답에 model이 없으면 served_model은 null, 요청 모델 단가로 센다", async () => {
    const { model: _drop, ...body } = chatBody({ a: 1 });
    void _drop;
    const { fetchImpl } = delayedFetch([{ delayMs: 1, body }]);
    const res = await chat(request, { fetchImpl });
    expect(res.served_model).toBeNull();
    expect(res.usage.priced).toBe(true);
  });

  it("reasoningEffort를 주면 reasoning_effort로 보내고, 없으면 보내지 않는다", async () => {
    const { fetchImpl, log } = delayedFetch([{ delayMs: 1 }]);
    await chat({ ...request, reasoningEffort: "low" }, { fetchImpl });
    await chat(request, { fetchImpl });
    expect(log[0].body.reasoning_effort).toBe("low");
    expect("reasoning_effort" in log[1].body).toBe(false);
  });

  it("단가 모르는 답한 모델은 priced:false", () => {
    expect(usageCost(["gpt-6.1-sol", "liner-gpt-router"], { prompt_tokens: 10, completion_tokens: 10 }).priced).toBe(false);
  });
});
