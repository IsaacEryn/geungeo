// 파이프라인 오류. message는 화면에 그대로 보여도 되는 한국어 문구만(예외 원문·키·응답 본문 금지).
// 문구 원본은 messages/ko.json의 errors다. 화면과 서버가 같은 문구를 쓴다.
import messages from "@/messages/ko.json";
import { LinerError } from "@/lib/liner/client";
import type { PipelineErrorCode } from "./types";

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;
  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

const MESSAGES: Record<PipelineErrorCode, string> = messages.errors;

function fromCode(code: PipelineErrorCode): PipelineError {
  return new PipelineError(code, MESSAGES[code]);
}

/** 어떤 예외든 화면용 오류로 바꾼다 */
export function toPipelineError(error: unknown): PipelineError {
  if (error instanceof PipelineError) return error;
  if (error instanceof LinerError) {
    switch (error.code) {
      case "missing_api_key":
      case "invalid_api_key": // 401·403
      case "insufficient_credit": // 402
      case "rate_limited": // 429
        return fromCode(error.code);
      case "aborted":
        return new PipelineError("internal", messages.errors.aborted);
      default:
        // 네트워크 오류·5xx·응답 형식 오류
        return fromCode("liner_unavailable");
    }
  }
  return fromCode("internal");
}

export function badRequest(detail?: string): PipelineError {
  return new PipelineError("bad_request", detail ?? MESSAGES.bad_request);
}
