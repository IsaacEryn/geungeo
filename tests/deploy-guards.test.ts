// 배포용 문지기(접근 코드·하루 상한·분당 제한). 환경변수가 없으면 모두 꺼져 지금과 같이 동작해야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessCodeRequired, checkAccessCode, ACCESS_CODE_HEADER } from "@/lib/deploy/access";
import { allowanceUsd, budgetConfig, checkBudget, daysSinceStart, resetBudgetCache, todayKst, usageUsd } from "@/lib/deploy/budget";
import { allowRequest, clientIp, resetRateLimit } from "@/lib/deploy/rate-limit";
import { buildTestCache } from "./support/cache";
import { createLinerMock } from "./support/liner-mock";
import { E22_QUESTION, e22Handler } from "./support/scenarios";

vi.mock("@/lib/cache/load", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cache/load")>()),
  loadCache: async () => buildTestCache(),
  loadSchoolRules: async () => null,
}));

const { POST } = await import("@/app/api/ask/route");

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ask", { method: "POST", headers });
}

/** KST 날짜·시각 → epoch ms */
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

function usageFetch(creditsMicroUsd: number, counter?: { n: number }) {
  return (async () => {
    if (counter) counter.n += 1;
    return Response.json({
      start_date: "2026-10-17",
      end_date: "2026-11-15",
      timezone: "UTC",
      granularity: "day",
      summary: { requests: 10, credits: creditsMicroUsd, credits_usd: (creditsMicroUsd / 1e6).toFixed(6) },
      data: [],
    });
  }) as unknown as typeof fetch;
}

const BUDGET = { DAILY_QUESTION_LIMIT: "200", BUDGET_START_DATE: "2026-11-16", BUDGET_START_USD: "5" };

beforeEach(() => {
  resetBudgetCache();
  resetRateLimit();
  vi.stubEnv("LINER_API_KEY", "test-key-not-real");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("접근 코드", () => {
  it("ACCESS_CODE가 없으면 요구하지 않고 늘 통과", () => {
    expect(accessCodeRequired(env({}))).toBe(false);
    expect(accessCodeRequired(env({ ACCESS_CODE: "  " }))).toBe(false);
    expect(checkAccessCode(req(), env({}))).toBe(true);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: "anything" }), env({}))).toBe(true);
  });

  it("설정돼 있으면 없음·틀림은 거절, 맞음은 통과", () => {
    const e = env({ ACCESS_CODE: "open-sesame" });
    expect(accessCodeRequired(e)).toBe(true);
    expect(checkAccessCode(req(), e)).toBe(false);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: "open-sesam" }), e)).toBe(false);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: "open-sesame-long" }), e)).toBe(false);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: "open-sesame" }), e)).toBe(true);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: " open-sesame " }), e)).toBe(true);
  });

  it("한글·기호 코드는 화면이 인코딩해 보낸 값을 풀어서 비교", () => {
    const e = env({ ACCESS_CODE: "근거 심사%2026" });
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: encodeURIComponent("근거 심사%2026") }), e)).toBe(true);
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: encodeURIComponent("근거 심사") }), e)).toBe(false);
    // 잘못된 인코딩도 예외 없이 거절
    expect(checkAccessCode(req({ [ACCESS_CODE_HEADER]: "%E0%A4%A" }), e)).toBe(false);
  });
});

describe("하루 상한 계산", () => {
  it("세 변수가 모두 있어야 켜진다", () => {
    expect(budgetConfig(env({}))).toBeNull();
    expect(budgetConfig(env({ DAILY_QUESTION_LIMIT: "200", BUDGET_START_DATE: "2026-11-16" }))).toBeNull();
    expect(budgetConfig(env(BUDGET))).toEqual({ dailyLimit: 200, startDate: "2026-11-16", startUsd: 5, questionCostUsd: 0.02 });
    expect(budgetConfig(env({ ...BUDGET, QUESTION_COST_USD: "0.03" }))?.questionCostUsd).toBe(0.03);
  });

  it("형식이 틀리면 꺼진다", () => {
    expect(budgetConfig(env({ ...BUDGET, BUDGET_START_DATE: "2026-02-30" }))).toBeNull();
    expect(budgetConfig(env({ ...BUDGET, DAILY_QUESTION_LIMIT: "0" }))).toBeNull();
    expect(budgetConfig(env({ ...BUDGET, BUDGET_START_USD: "abc" }))).toBeNull();
  });

  it("일수는 한국 시간 기준, 시작일 포함", () => {
    // UTC로는 아직 11/15지만 KST로는 11/16 00:00 → 첫날
    expect(todayKst(kst("2026-11-16T00:00:00"))).toBe("2026-11-16");
    expect(daysSinceStart("2026-11-16", kst("2026-11-16T00:00:00"))).toBe(1);
    expect(daysSinceStart("2026-11-16", kst("2026-11-15T23:59:59"))).toBe(0);
    expect(daysSinceStart("2026-11-16", kst("2026-11-16T23:59:59"))).toBe(1);
    expect(daysSinceStart("2026-11-16", kst("2026-11-17T00:00:00"))).toBe(2);
    expect(daysSinceStart("2026-11-16", kst("2026-12-05T12:00:00"))).toBe(20);
    const cfg = budgetConfig(env(BUDGET))!;
    expect(allowanceUsd(cfg, kst("2026-11-17T09:00:00"))).toBeCloseTo(8, 9); // 2일 × 200 × 0.02
  });

  it("사용량 조회 응답에서 금액을 읽는다", () => {
    expect(usageUsd({ summary: { credits: 8813, credits_usd: "0.008813" } })).toBeCloseTo(0.008813, 9);
    expect(usageUsd({ summary: { credits_usd: "1.5" } })).toBe(1.5);
    expect(usageUsd({ summary: {} })).toBeNull();
    expect(usageUsd(null)).toBeNull();
  });
});

describe("하루 상한 판단", () => {
  const now = kst("2026-11-16T15:00:00"); // 첫날, 허용액 $4

  it("변수가 없으면 사용량을 조회하지 않고 통과", async () => {
    const counter = { n: 0 };
    expect(await checkBudget({ env: env({}), fetchImpl: usageFetch(0, counter), now })).toEqual({ allowed: true, reason: "off" });
    expect(counter.n).toBe(0);
  });

  it("허용액 아래면 통과, 닿으면 막는다", async () => {
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: usageFetch(8_000_000), now })).allowed).toBe(true); // $3 썼음
    resetBudgetCache();
    expect(await checkBudget({ env: env(BUDGET), fetchImpl: usageFetch(9_000_000), now })).toEqual({ allowed: false, reason: "exhausted" }); // $4
    resetBudgetCache();
    // 다음 날이면 하루치가 더 쌓여 다시 받는다
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: usageFetch(9_000_000), now: kst("2026-11-17T00:00:01") })).allowed).toBe(true);
  });

  it("시작일 전에는 허용액이 0이라 막는다", async () => {
    const r = await checkBudget({ env: env(BUDGET), fetchImpl: usageFetch(5_000_000), now: kst("2026-11-15T20:00:00") });
    expect(r.allowed).toBe(false);
  });

  it("조회 결과는 30초 캐시하고, 받은 질문만큼 미리 더해 센다", async () => {
    const counter = { n: 0 };
    // $3.99 썼음 → 허용액 $4 전이라 한 건은 받고, 미리 더한 $4.01로 다음 건은 막는다
    const f = usageFetch(8_990_000, counter);
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: f, now })).allowed).toBe(true);
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: f, now: now + 10_000 })).allowed).toBe(false);
    expect(counter.n).toBe(1);
    await checkBudget({ env: env(BUDGET), fetchImpl: f, now: now + 31_000 });
    expect(counter.n).toBe(2);
  });

  it("조회가 실패하면 막지 않고 통과(로그에 키 없음)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    expect(await checkBudget({ env: env(BUDGET), fetchImpl: down, now })).toEqual({ allowed: true, reason: "check_failed" });
    resetBudgetCache();
    const throws = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: throws, now })).reason).toBe("check_failed");
    resetBudgetCache();
    const weird = (async () => Response.json({ hello: 1 })) as unknown as typeof fetch;
    expect((await checkBudget({ env: env(BUDGET), fetchImpl: weird, now })).reason).toBe("check_failed");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("test-key-not-real");
  });
});

describe("분당 제한", () => {
  it("변수가 없으면 늘 통과", () => {
    for (let i = 0; i < 50; i++) expect(allowRequest(req({ "x-real-ip": "1.1.1.1" }), env({}))).toBe(true);
  });

  it("같은 IP는 분당 n회까지, 다른 IP는 따로, 1분 지나면 풀린다", () => {
    const e = env({ RATE_LIMIT_PER_MIN: "3" });
    const t = 1_000_000;
    const a = req({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" });
    expect(clientIp(a)).toBe("2.2.2.2");
    expect([1, 2, 3].map((i) => allowRequest(a, e, t + i))).toEqual([true, true, true]);
    expect(allowRequest(a, e, t + 10)).toBe(false);
    expect(allowRequest(req({ "x-real-ip": "3.3.3.3" }), e, t + 10)).toBe(true);
    expect(allowRequest(a, e, t + 60_002)).toBe(true);
  });
});

describe("POST /api/ask 문지기", () => {
  function post(headers: Record<string, string> = {}) {
    return POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({ question: E22_QUESTION, asOf: "2026-11-05" }),
      }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", createLinerMock(e22Handler).fetchImpl);
  });

  it("변수가 없으면 접근 코드 없이도 지금처럼 답한다", async () => {
    const res = await post();
    expect(res.status).toBe(200);
  });

  it("ACCESS_CODE가 있으면 없음·틀림은 401 한국어 안내, 맞으면 답한다", async () => {
    vi.stubEnv("ACCESS_CODE", "open-sesame");
    const none = await post();
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ type: "error", code: "access_denied", message: expect.stringContaining("접근 코드") });
    expect((await post({ [ACCESS_CODE_HEADER]: "wrong" })).status).toBe(401);
    expect((await post({ [ACCESS_CODE_HEADER]: "open-sesame" })).status).toBe(200);
  });

  it("하루 상한에 닿으면 429 한국어 안내", async () => {
    vi.stubEnv("DAILY_QUESTION_LIMIT", "1");
    vi.stubEnv("BUDGET_START_DATE", todayKst());
    vi.stubEnv("BUDGET_START_USD", "0");
    const liner = createLinerMock((call) => (call.path === "/credits/usage" ? { body: { summary: { credits: 50_000 } } } : e22Handler(call)));
    vi.stubGlobal("fetch", liner.fetchImpl);
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "daily_limit", message: expect.stringContaining("사용량") });
    expect(liner.calls.map((c) => c.path)).toEqual(["/credits/usage"]);
  });

  it("분당 제한을 넘으면 429", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MIN", "1");
    vi.stubEnv("ACCESS_CODE", "x");
    // 접근 코드가 틀려도 횟수에는 든다(마구 넣어 보기 늦추기)
    expect((await post({ "x-real-ip": "9.9.9.9" })).status).toBe(401);
    const res = await post({ "x-real-ip": "9.9.9.9", [ACCESS_CODE_HEADER]: "x" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });
});

describe("화면 쪽 접근 코드", () => {
  it("코드를 줄 때만 인코딩해 헤더에 싣고, 401은 access_denied로 받는다", async () => {
    const { ask, AskError } = await import("@/components/ask-client");
    const seen: (string | undefined)[] = [];
    vi.stubGlobal("fetch", (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)[ACCESS_CODE_HEADER]);
      return Response.json({ type: "error", code: "access_denied", message: "접근 코드가 맞지 않습니다." }, { status: 401 });
    }) as typeof fetch);
    const signal = new AbortController().signal;
    await expect(ask({ question: "q", asOf: "2026-11-16", school: null }, () => {}, signal)).rejects.toBeInstanceOf(AskError);
    await expect(ask({ question: "q", asOf: "2026-11-16", school: null }, () => {}, signal, { accessCode: "근거" })).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(seen).toEqual([undefined, encodeURIComponent("근거")]);
  });

  it("sessionStorage를 못 쓰면 조용히 넘어간다", async () => {
    const { loadAccessCode, saveAccessCode } = await import("@/components/ask-client");
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(loadAccessCode()).toBeNull();
    expect(() => saveAccessCode("x")).not.toThrow();
  });
});
