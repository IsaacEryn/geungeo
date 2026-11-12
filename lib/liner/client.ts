// Liner API 공통 호출. 키는 서버 환경변수 LINER_API_KEY에서만 읽고, 오류 메시지·로그에 키나 응답 원문을 넣지 않는다.
// 재시도: 429는 Retry-After를 따르고(최대 5초), 500·502·503·504와 네트워크 오류는 한 번 더 부른다(설계 13절, 조사 문서 한도 절).

export const LINER_BASE_URL = "https://platform.liner.com/api/v1";

export type LinerErrorCode = "missing_api_key" | "rate_limited" | "liner_unavailable" | "bad_response" | "aborted";

/** Liner 호출 실패. message는 짧은 한국어 설명만(응답 본문·키 금지) */
export class LinerError extends Error {
  readonly code: LinerErrorCode;
  readonly status?: number;
  readonly duration_ms: number;
  constructor(code: LinerErrorCode, message: string, status: number | undefined, durationMs: number) {
    super(message);
    this.name = "LinerError";
    this.code = code;
    this.status = status;
    this.duration_ms = durationMs;
  }
}

export interface LinerResponse<T> {
  body: T;
  status: number;
  duration_ms: number;
  /** x-liner-ignored-parameters 헤더(받기만 하고 적용 안 한 필드) */
  ignored: string | null;
}

export interface LinerCallOptions {
  signal?: AbortSignal;
  /** 한 번 시도의 제한 시간(ms). 기본 60초 */
  timeoutMs?: number;
  /** 시험용 fetch 바꿔 끼우기 */
  fetchImpl?: typeof fetch;
  /** 재시도 횟수(기본 1) */
  retries?: number;
}

export function getApiKey(): string {
  const key = process.env.LINER_API_KEY?.trim();
  if (!key) throw new LinerError("missing_api_key", "LINER_API_KEY가 설정되지 않았습니다.", undefined, 0);
  return key;
}

const RETRYABLE = new Set([500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LinerError("aborted", "요청이 취소되었습니다.", undefined, 0));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new LinerError("aborted", "요청이 취소되었습니다.", undefined, 0));
      },
      { once: true },
    );
  });
}

function retryAfterMs(header: string | null, attempt: number): number {
  const sec = header ? Number(header) : NaN;
  const base = Number.isFinite(sec) && sec >= 0 ? sec * 1000 : 500 * 2 ** attempt;
  return Math.min(base, 5000);
}

/**
 * Liner API에 JSON 요청을 보낸다.
 * auth: Router는 Bearer, Search·사용량 조회는 x-api-key(11/13 시험에서 동작한 형식 그대로)
 */
export async function linerRequest<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  auth: "bearer" | "x-api-key",
  options: LinerCallOptions = {},
): Promise<LinerResponse<T>> {
  const key = getApiKey();
  const doFetch = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 1;
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    if (options.signal?.aborted) throw new LinerError("aborted", "요청이 취소되었습니다.", undefined, Date.now() - started);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth === "bearer") headers.Authorization = `Bearer ${key}`;
    else headers["x-api-key"] = key;
    let res: Response | undefined;
    let networkFailed = false;
    try {
      res = await doFetch(`${LINER_BASE_URL}${path}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // 예외 원문에 요청 정보가 섞일 수 있어 버린다
      networkFailed = true;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
    const elapsed = Date.now() - started;
    if (options.signal?.aborted) throw new LinerError("aborted", "요청이 취소되었습니다.", undefined, elapsed);

    if (networkFailed || !res) {
      if (attempt < retries) {
        await sleep(retryAfterMs(null, attempt), options.signal);
        attempt += 1;
        continue;
      }
      throw new LinerError("liner_unavailable", "Liner API에 연결하지 못했습니다.", undefined, elapsed);
    }

    if (res.ok) {
      try {
        const parsed = (await res.json()) as T;
        return {
          body: parsed,
          status: res.status,
          duration_ms: Date.now() - started,
          ignored: res.headers.get("x-liner-ignored-parameters"),
        };
      } catch {
        throw new LinerError("bad_response", "Liner API 응답을 읽지 못했습니다.", res.status, Date.now() - started);
      }
    }

    if ((res.status === 429 || RETRYABLE.has(res.status)) && attempt < retries) {
      await sleep(retryAfterMs(res.headers.get("retry-after"), attempt), options.signal);
      attempt += 1;
      continue;
    }
    if (res.status === 429) throw new LinerError("rate_limited", "Liner API 요청 한도에 걸렸습니다.", 429, elapsed);
    if (res.status === 401 || res.status === 403)
      throw new LinerError("liner_unavailable", "Liner API 키가 거부되었습니다.", res.status, elapsed);
    if (res.status === 402) throw new LinerError("liner_unavailable", "Liner API 크레딧이 부족합니다.", 402, elapsed);
    throw new LinerError("liner_unavailable", `Liner API 오류(HTTP ${res.status})`, res.status, elapsed);
  }
}
