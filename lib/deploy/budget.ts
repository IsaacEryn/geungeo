// 공개 배포용 하루 질문 상한. 외부 저장소 없이 Liner의 사용량 조회(GET /credits/usage, 무료)만으로 센다.
// DAILY_QUESTION_LIMIT·BUDGET_START_DATE·BUDGET_START_USD가 모두 있을 때만 켜진다. 로컬 실행에서는 꺼져 있다.
//
// 계산: 쓴 돈 = (지금 사용량 조회 금액 − BUDGET_START_USD)
//       허용액 = (시작일부터 오늘까지 일수, KST, 시작일 포함) × DAILY_QUESTION_LIMIT × 질문당 단가(QUESTION_COST_USD, 기본 0.02달러)
//       쓴 돈이 허용액에 닿으면 새 질문을 받지 않는다.
// 하루치 허용액이 날마다 쌓이는 방식이라 인스턴스끼리 카운터를 나눌 필요가 없다. 어제 덜 썼으면 오늘 그만큼 더 쓸 수 있다.
//
// 사용량 조회가 실패하면(네트워크·5xx·응답 형식) 막지 않고 통과시킨다. 이유:
//  - 조회는 Liner 쪽 일시 장애로 실패하는 경우가 대부분이고, 그때 막으면 심사 중 화면이 통째로 멈춘다.
//  - 최악의 경우에도 손실은 선불 크레딧 잔액을 넘지 않고, 접근 코드와 분당 제한은 그대로 걸려 있다.
//  - 실패 결과도 짧게 캐시해 장애 중에 매 질문마다 조회를 기다리지 않게 한다.
// 로그에는 실패 종류만 남기고 키·응답 원문은 남기지 않는다.
//
// 주의: /credits/usage는 기본으로 최근 30일(UTC)을 합산한다. 운영 기간이 30일을 넘거나 시작 전 30일 안에
// 큰 사용이 있었다면 그 금액이 창 밖으로 빠지면서 '쓴 돈'이 실제보다 작게 잡힐 수 있다.
import { linerRequest, LinerError } from "@/lib/liner/client";

export const DEFAULT_QUESTION_COST_USD = 0.02;
const CACHE_MS = 30_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

export interface BudgetConfig {
  dailyLimit: number;
  startDate: string; // YYYY-MM-DD(KST)
  startUsd: number;
  questionCostUsd: number;
}

let warned = false;
function warnOnce(message: string) {
  if (warned) return;
  warned = true;
  console.warn(`[deploy] ${message}`);
}

/** 세 변수가 모두 있고 올바르면 설정, 아니면 null(상한 꺼짐) */
export function budgetConfig(env: NodeJS.ProcessEnv = process.env): BudgetConfig | null {
  const limitRaw = env.DAILY_QUESTION_LIMIT?.trim();
  const dateRaw = env.BUDGET_START_DATE?.trim();
  const usdRaw = env.BUDGET_START_USD?.trim();
  if (!limitRaw || !dateRaw || !usdRaw) return null;
  const dailyLimit = Number(limitRaw);
  const startUsd = Number(usdRaw);
  const costRaw = env.QUESTION_COST_USD?.trim();
  const questionCostUsd = costRaw ? Number(costRaw) : DEFAULT_QUESTION_COST_USD;
  if (
    !Number.isInteger(dailyLimit) ||
    dailyLimit <= 0 ||
    !isIsoDate(dateRaw) ||
    !Number.isFinite(startUsd) ||
    startUsd < 0 ||
    !Number.isFinite(questionCostUsd) ||
    questionCostUsd <= 0
  ) {
    warnOnce("예산 상한 변수 형식이 맞지 않아 상한을 끕니다(DAILY_QUESTION_LIMIT·BUDGET_START_DATE·BUDGET_START_USD·QUESTION_COST_USD 확인).");
    return null;
  }
  return { dailyLimit, startDate: dateRaw, startUsd, questionCostUsd };
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD) */
export function todayKst(now = Date.now()): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 시작일부터 오늘(KST)까지 일수, 시작일 포함. 시작일 전이면 0 */
export function daysSinceStart(startDate: string, now = Date.now()): number {
  const diff = Date.parse(`${todayKst(now)}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return diff < 0 ? 0 : Math.floor(diff / DAY_MS) + 1;
}

/** 지금까지 허용된 금액(USD) */
export function allowanceUsd(config: BudgetConfig, now = Date.now()): number {
  return daysSinceStart(config.startDate, now) * config.dailyLimit * config.questionCostUsd;
}

interface UsageBody {
  summary?: { credits?: unknown; credits_usd?: unknown };
}

/** /credits/usage 응답에서 합계 금액(USD). summary.credits는 100만분의 1달러 정수 */
export function usageUsd(body: unknown): number | null {
  const summary = (body as UsageBody | null)?.summary;
  if (!summary || typeof summary !== "object") return null;
  if (typeof summary.credits === "number" && Number.isFinite(summary.credits)) return summary.credits / 1_000_000;
  if (typeof summary.credits_usd === "string" || typeof summary.credits_usd === "number") {
    const v = Number(summary.credits_usd);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

type Cached = { at: number; usedUsd: number | null };
let cache: Cached | null = null;

async function readUsedUsd(config: BudgetConfig, fetchImpl: typeof fetch | undefined, now: number): Promise<number | null> {
  if (cache && now - cache.at < CACHE_MS) return cache.usedUsd;
  let usedUsd: number | null = null;
  try {
    const res = await linerRequest<unknown>("GET", "/credits/usage", undefined, "x-api-key", {
      timeoutMs: 5_000,
      retries: 0,
      fetchImpl,
    });
    const total = usageUsd(res.body);
    if (total === null) console.warn("[deploy] 사용량 조회 응답 형식을 읽지 못해 이번에는 상한 없이 통과시킵니다.");
    else usedUsd = Math.max(0, total - config.startUsd);
  } catch (error) {
    const kind = error instanceof LinerError ? error.code : "unknown";
    console.warn(`[deploy] 사용량 조회 실패(${kind}). 이번에는 상한 없이 통과시킵니다.`);
  }
  cache = { at: now, usedUsd };
  return usedUsd;
}

export type BudgetDecision = { allowed: true; reason: "off" | "under" | "check_failed" } | { allowed: false; reason: "exhausted" };

/** 새 질문을 받아도 되는지. 상한이 꺼져 있으면 사용량을 조회하지 않는다 */
export async function checkBudget(
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<BudgetDecision> {
  const config = budgetConfig(options.env ?? process.env);
  if (!config) return { allowed: true, reason: "off" };
  const now = options.now ?? Date.now();
  const used = await readUsedUsd(config, options.fetchImpl, now);
  if (used === null) return { allowed: true, reason: "check_failed" };
  if (used >= allowanceUsd(config, now)) return { allowed: false, reason: "exhausted" };
  // 캐시가 살아 있는 30초 동안 몰려드는 질문도 대략 세도록 질문당 단가만큼 미리 더해 둔다
  if (cache) cache.usedUsd = used + config.questionCostUsd;
  return { allowed: true, reason: "under" };
}

/** 시험용: 캐시·경고 상태 비우기 */
export function resetBudgetCache() {
  cache = null;
  warned = false;
}
