// 화면이 파이프라인과 만나는 유일한 곳. 실제 파이프라인으로 바꿀 때 여기만 본다.
//
// 형식(app/api/ask와 맞출 것):
//   POST /api/ask, 본문 AskRequest(JSON)
//   응답 A(스트리밍, 권장): Content-Type application/x-ndjson — 한 줄에 StageEvent 하나.
//     stage_start/stage_end를 차례로 보내고 마지막 줄은 {type:"result"} 또는 {type:"error"}.
//   응답 B(한 번에): Content-Type application/json — AskResult 그대로.
//   오류(JSON): app/api/ask는 {type:"error", code, message}(StageEvent 꼴)로 보낸다. 예전 꼴 {error: code}도 받는다.
//
// 목 데이터: 개발 서버(NODE_ENV !== "production")에서만 쓴다. 배포 빌드 묶음에는 목 데이터 파일이 들어가지 않는다.
//   - 주소에 ?mock=1이 있으면 처음부터 목 데이터로 답한다.
//   - 주소에 ?demo=E22처럼 예시 ID를 주면 그 예시를 바로 목 데이터로 띄운다(접근성 검사·영상 촬영용, 대기 없음).
//   - /api/ask가 501(not_implemented)을 돌려주면 목 데이터로 넘어간다(파이프라인이 붙기 전 임시).
import type { AskRequest, AskResult, PipelineErrorCode, StageEvent } from "@/lib/pipeline/types";

export interface AskOutcome {
  /** 목 데이터로 답했으면 true(화면에 안내 띠를 띄운다) */
  mock: boolean;
}

export class AskError extends Error {
  constructor(
    public readonly code: PipelineErrorCode | "network" | "mock_unknown_question",
    message?: string,
  ) {
    super(message ?? code);
  }
}

const MOCK_ALLOWED = process.env.NODE_ENV !== "production";

function mockRequested(): boolean {
  if (!MOCK_ALLOWED || typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("mock") === "1" || params.has("demo");
}

/** 개발 서버에서 ?demo=<예시 ID>가 있으면 그 ID(없으면 null) */
export function demoExampleId(): string | null {
  if (!MOCK_ALLOWED || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("demo");
}

async function runMock(
  request: AskRequest,
  onEvent: (event: StageEvent) => void,
  signal: AbortSignal,
): Promise<AskOutcome> {
  // 목 픽스처는 개발 때만 받는다. import를 조건 블록 안에 두어 배포 빌드가 이 분기를 통째로 버리게 한다.
  if (process.env.NODE_ENV !== "production") {
    const { streamMockEvents } = await import("./mock/fixtures");
    await streamMockEvents(request, onEvent, signal, { instant: demoExampleId() !== null });
    return { mock: true };
  }
  throw new AskError("internal");
}

/** 질문 하나를 보내고 단계 이벤트를 onEvent로 흘려 준다. 결과·오류도 이벤트로 온다 */
export async function ask(
  request: AskRequest,
  onEvent: (event: StageEvent) => void,
  signal: AbortSignal,
): Promise<AskOutcome> {
  if (mockRequested()) return runMock(request, onEvent, signal);

  let response: Response;
  try {
    response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AskError("network");
  }

  if (response.status === 501 && MOCK_ALLOWED) return runMock(request, onEvent, signal);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-ndjson") && response.body) {
    let finished = false;
    await readNdjson(response.body, (event) => {
      if (event.type === "result" || event.type === "error") finished = true;
      onEvent(event);
    });
    // 결과·오류 줄 없이 끊긴 스트림(서버 중단 등)은 오류로 알린다. 그러지 않으면 화면이 '진행 중'에 머문다
    if (!finished && !signal.aborted) throw new AskError("internal");
    return { mock: false };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AskError("internal");
  }
  if (isErrorEvent(payload)) throw new AskError(payload.code, payload.message);
  if (!response.ok || isErrorPayload(payload)) {
    const code = isErrorPayload(payload) ? payload.error : "internal";
    throw new AskError(code);
  }
  onEvent({ type: "result", result: payload as AskResult });
  return { mock: false };
}

function isErrorEvent(value: unknown): value is Extract<StageEvent, { type: "error" }> {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "error" && "code" in value;
}

function isErrorPayload(value: unknown): value is { error: PipelineErrorCode } {
  return typeof value === "object" && value !== null && "error" in value;
}

async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (event: StageEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as StageEvent);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as StageEvent);
}
