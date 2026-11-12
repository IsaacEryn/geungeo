// 파이프라인 오류. message는 화면에 그대로 보여도 되는 한국어 문구만(예외 원문·키·응답 본문 금지).
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

const MESSAGES: Record<PipelineErrorCode, string> = {
  bad_request: "질문이나 기준일 형식을 확인해 주세요.",
  missing_api_key: "서버에 LINER_API_KEY가 설정되지 않았습니다. README의 실행 방법을 확인해 주세요.",
  liner_unavailable: "Liner API에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
  rate_limited: "요청이 많아 잠시 막혔습니다. 몇 초 뒤 다시 시도해 주세요.",
  internal: "처리 중 문제가 생겼습니다. 다시 시도해 주세요.",
};

/** 어떤 예외든 화면용 오류로 바꾼다 */
export function toPipelineError(error: unknown): PipelineError {
  if (error instanceof PipelineError) return error;
  if (error instanceof LinerError) {
    if (error.code === "missing_api_key") return new PipelineError("missing_api_key", MESSAGES.missing_api_key);
    if (error.code === "rate_limited") return new PipelineError("rate_limited", MESSAGES.rate_limited);
    if (error.code === "aborted") return new PipelineError("internal", "요청이 취소되었습니다.");
    return new PipelineError("liner_unavailable", MESSAGES.liner_unavailable);
  }
  return new PipelineError("internal", MESSAGES.internal);
}

export function badRequest(detail?: string): PipelineError {
  return new PipelineError("bad_request", detail ?? MESSAGES.bad_request);
}
