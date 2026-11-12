// 비용 계산. Liner 응답 usage에는 금액(cost) 필드가 없어서 토큰×단가로 계산한다(설계 1절, 11/13 시험).
// 11/13 시험에서 이 계산이 GET /credits/usage의 실제 차감액과 정확히 맞았다.
// completion_tokens에는 reasoning 토큰이 이미 들어 있다(시험: completion 272 중 reasoning 217) → 출력 단가로 한 번만 센다.

/** 모델별 단가(USD / 100만 토큰). 확인한 것만 적는다 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "liner-mark-1.3": { input: 1, output: 5 },
  // liner-mark·liner-mark-latest는 늘 최신 버전을 가리킨다. 지금은 1.3과 같은 값이지만 버전이 바뀌면 다시 확인한다
  "liner-mark": { input: 1, output: 5 },
  "liner-mark-latest": { input: 1, output: 5 },
};

/** Search 회당 단가(USD). include_knowledge:false일 때 $1/1,000(11/13 시험 확인) */
export const SEARCH_COST_USD = 0.001;

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

export interface UsageCost {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  /** 단가를 모르는 모델이면 false(금액 0으로 두고 처리 과정에 표시) */
  priced: boolean;
}

/** 토큰 수 × 단가. 단가를 모르는 모델은 0으로 두고 priced:false */
export function usageCost(model: string, usage: ChatUsage | undefined | null): UsageCost {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const price = MODEL_PRICES[model];
  const cost = price ? (prompt * price.input + completion * price.output) / 1_000_000 : 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: reasoning,
    cost_usd: roundUsd(cost),
    priced: Boolean(price),
  };
}

/** 부동소수 잔여를 없앤다(1크레딧 = $0.000001이라 소수 6자리면 충분하지만 여유를 둔다) */
export function roundUsd(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
