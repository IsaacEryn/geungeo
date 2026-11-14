// 같은 IP의 분당 요청 수를 느슨하게 제한한다. 환경변수 RATE_LIMIT_PER_MIN이 있을 때만 켜진다.
// 기록은 서버 인스턴스 메모리에만 있어서 인스턴스가 여러 개 뜨거나 새로 뜨면 따로 센다.
// 그래서 이것은 연타·자동 요청을 늦추는 보조 수단일 뿐이고, 비용을 실제로 묶는 것은 예산 상한(budget.ts)이다.

const WINDOW_MS = 60_000;
const MAX_TRACKED = 5_000;

const hits = new Map<string, number[]>();

export function rateLimitPerMinute(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.RATE_LIMIT_PER_MIN?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.warn("[deploy] RATE_LIMIT_PER_MIN 값이 양의 정수가 아니어서 분당 제한을 끕니다.");
    return null;
  }
  return n;
}

/** 요청 보낸 쪽 IP. Vercel은 x-real-ip·x-forwarded-for를 붙인다. 없으면 한 덩어리로 센다 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** 이번 요청을 받아도 되면 true(받은 것으로 센다). 제한이 꺼져 있으면 늘 true */
export function allowRequest(request: Request, env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
  const limit = rateLimitPerMinute(env);
  if (limit === null) return true;
  const ip = clientIp(request);
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > MAX_TRACKED) prune(now);
  return true;
}

function prune(now: number) {
  for (const [ip, times] of hits) {
    if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(ip);
  }
}

/** 시험용: 기록 비우기 */
export function resetRateLimit() {
  hits.clear();
}
