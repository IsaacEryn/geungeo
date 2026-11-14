// 공개 배포용 접근 코드. 환경변수 ACCESS_CODE가 있을 때만 켜진다.
// 로컬 실행(.env에 ACCESS_CODE 없음)에서는 아무것도 막지 않는다. 코드 값은 서버에만 두고 화면에는 '필요한지'만 알린다.
import { createHash, timingSafeEqual } from "node:crypto";

/** 화면이 접근 코드를 실어 보내는 요청 헤더. 헤더에는 Latin-1만 들어가므로 화면은 encodeURIComponent로 보낸다 */
export const ACCESS_CODE_HEADER = "x-access-code";

function configuredCode(env: NodeJS.ProcessEnv = process.env): string | null {
  const code = env.ACCESS_CODE?.trim();
  return code ? code : null;
}

/** 이 배포가 접근 코드를 요구하는지(값은 내보내지 않는다) */
export function accessCodeRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredCode(env) !== null;
}

/**
 * 요청의 접근 코드가 맞는지. ACCESS_CODE가 없으면 늘 true.
 * 길이 차이로 새지 않게 양쪽을 SHA-256으로 같은 길이로 만든 뒤 timingSafeEqual로 비교한다.
 */
export function checkAccessCode(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = configuredCode(env);
  if (expected === null) return true;
  const given = decodeHeader(request.headers.get(ACCESS_CODE_HEADER) ?? "").trim();
  if (!given) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function decodeHeader(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
