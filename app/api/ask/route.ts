// POST /api/ask: 질문 → 파이프라인 → 단계 이벤트를 NDJSON(한 줄에 이벤트 하나)으로 흘려보내고 마지막 줄에 result를 보낸다.
// Accept가 application/json뿐이면(x-ndjson 없이) 스트리밍 없이 결과 JSON 하나만 돌려준다(평가·curl용).
// 키는 서버 환경변수에서만 읽고, 오류는 정해진 한국어 문구만 내려보낸다(설계 5-3).
import { runPipeline } from "@/lib/pipeline/run";
import { toPipelineError } from "@/lib/pipeline/errors";
import type { AskRequest, PipelineErrorCode, StageEvent } from "@/lib/pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<PipelineErrorCode, number> = {
  bad_request: 400,
  missing_api_key: 500,
  liner_unavailable: 502,
  rate_limited: 429,
  internal: 500,
};

/** 본문에서 계약 필드만 꺼낸다(모르는 필드는 버림) */
function pickRequest(body: unknown): AskRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.question !== "string") return null;
  const school = b.school === "snu" || b.school === "pnu" || b.school === "knou" ? b.school : null;
  return {
    question: b.question,
    asOf: typeof b.asOf === "string" && b.asOf ? b.asOf : undefined,
    school,
    mode: b.mode === "tools" ? "tools" : b.mode === "fixed" ? "fixed" : undefined,
  };
}

function errorJson(code: PipelineErrorCode, message: string) {
  return Response.json({ type: "error", code, message } satisfies StageEvent, { status: STATUS[code] });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("bad_request", "요청 본문이 JSON이 아닙니다.");
  }
  const ask = pickRequest(body);
  if (!ask) return errorJson("bad_request", "질문을 입력해 주세요.");

  // 화면(ask-client)은 "application/x-ndjson, application/json"을 함께 보낸다. NDJSON을 받을 수 있으면 스트리밍을 우선한다
  const accept = request.headers.get("accept") ?? "";
  const wantsJson = accept.includes("application/json") && !accept.includes("application/x-ndjson");
  if (wantsJson) {
    try {
      const result = await runPipeline(ask, { signal: request.signal });
      return Response.json(result);
    } catch (error) {
      const pe = toPipelineError(error);
      return errorJson(pe.code, pe.message);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StageEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // 연결이 끊긴 뒤에는 버린다
        }
      };
      try {
        const result = await runPipeline(ask, {
          signal: request.signal,
          onEvent: (event) => {
            // error 이벤트는 아래 catch에서 한 번만 보낸다
            if (event.type !== "error") send(event);
          },
        });
        send({ type: "result", result });
      } catch (error) {
        const pe = toPipelineError(error);
        send({ type: "error", code: pe.code, message: pe.message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
