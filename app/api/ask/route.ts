// POST /api/ask: 질문 → 파이프라인 → 단계 이벤트를 NDJSON(한 줄에 이벤트 하나)으로 흘려보내고 마지막 줄에 result를 보낸다.
// Accept가 application/json뿐이면(x-ndjson 없이) 스트리밍 없이 결과 JSON 하나만 돌려준다(평가·curl용).
// 키는 서버 환경변수에서만 읽고, 오류는 정해진 한국어 문구만 내려보낸다(설계 5-3).
import { checkAccessCode } from "@/lib/deploy/access";
import { checkBudget } from "@/lib/deploy/budget";
import { allowRequest } from "@/lib/deploy/rate-limit";
import { runPipeline } from "@/lib/pipeline/run";
import { toPipelineError } from "@/lib/pipeline/errors";
import type { AskRequest, PipelineErrorCode, StageEvent } from "@/lib/pipeline/types";
import { SCHOOL_IDS, type SchoolId } from "@/lib/cache/schema";
import messages from "@/messages/ko.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel 함수 최대 실행 시간(초). 지금까지 가장 오래 걸린 답이 66초(겹쳐 보내기 25초·끊기 55초에 재질문까지)라
// 두 배 가까운 여유를 두었다. Hobby 상한은 Fluid compute 기준 300초다. 로컬 실행에는 영향이 없다.
export const maxDuration = 120;

const STATUS: Record<PipelineErrorCode, number> = {
  bad_request: 400,
  missing_api_key: 500,
  invalid_api_key: 502,
  insufficient_credit: 502,
  liner_unavailable: 502,
  rate_limited: 429,
  access_denied: 401,
  daily_limit: 429,
  internal: 500,
};

/** 본문에서 계약 필드만 꺼낸다(모르는 필드는 버림) */
function pickRequest(body: unknown): AskRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.question !== "string") return null;
  const school = typeof b.school === "string" && (SCHOOL_IDS as readonly string[]).includes(b.school) ? (b.school as SchoolId) : null;
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
  // 배포용 문지기. 각 환경변수가 없으면 그대로 통과한다(로컬 실행은 지금과 같다).
  // 분당 제한을 먼저 두어 접근 코드를 마구 넣어 보는 시도도 늦춘다.
  if (!allowRequest(request)) return errorJson("rate_limited", messages.errors.rate_limited);
  if (!checkAccessCode(request)) return errorJson("access_denied", messages.errors.access_denied);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("bad_request", "요청 본문이 JSON이 아닙니다.");
  }
  const ask = pickRequest(body);
  if (!ask) return errorJson("bad_request", "질문을 입력해 주세요.");
  // 하루 상한은 질문 형식이 맞을 때만 센다
  if (!(await checkBudget()).allowed) return errorJson("daily_limit", messages.errors.daily_limit);

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
