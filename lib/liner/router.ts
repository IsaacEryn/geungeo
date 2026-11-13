// Liner Router(Chat Completions) 호출. 단계별 모델은 환경변수로 바꾼다(설계 2-3).
// JSON 출력은 json_schema(strict)가 기본이다. 400이 나면 json_object + user 메시지 끝 "Respond in JSON."으로 한 번 대체한다
// (11/13 추가 시험: 띄어 쓴 영어 단어 JSON이 user 메시지에 있어야 json_object가 400을 피함).
import { LinerError, linerRequest, type LinerCallOptions } from "./client";
import { usageCost, type ChatUsage, type UsageCost } from "./cost";

export const DEFAULT_MODEL = "liner-mark-1.3";

export type ModelStage = "analyze" | "answer" | "judge";

const STAGE_ENV: Record<ModelStage, string> = {
  analyze: "LINER_MODEL_ANALYZE",
  answer: "LINER_MODEL_ANSWER",
  judge: "LINER_MODEL_JUDGE",
};

/** 단계 모델: 덮어쓰기 → 환경변수 → 기본값 순 */
export function modelFor(stage: ModelStage, override?: string): string {
  const fromOverride = override?.trim();
  if (fromOverride) return fromOverride;
  const fromEnv = process.env[STAGE_ENV[stage]]?.trim();
  return fromEnv || DEFAULT_MODEL;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatCompletionBody {
  model?: string;
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: ChatUsage;
}

export interface ChatResult {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: string | null;
  /** 요청한 모델 ID */
  model: string;
  /** 응답 본문의 model(실제로 답한 모델, 라우터면 고른 모델). 없으면 null */
  served_model: string | null;
  usage: UsageCost;
  status: number;
  duration_ms: number;
  /** json_object 대체가 돌았는지 */
  json_fallback: boolean;
  /** 늦어서 같은 요청을 겹쳐 보냈으면 그 수(chatHedged만). 끝까지 못 받은 요청도 과금됐을 수 있다 */
  duplicate_requests?: number;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** 주면 json_schema(strict)로 요청 */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  maxTokens?: number;
  /** 생략하면 보내지 않는다(Liner 기본값 medium) */
  reasoningEffort?: ReasoningEffort;
}

async function post(body: Record<string, unknown>, options: LinerCallOptions) {
  return linerRequest<ChatCompletionBody>("POST", "/chat/completions", body, "bearer", options);
}

function toResult(
  model: string,
  res: { body: ChatCompletionBody; status: number; duration_ms: number },
  jsonFallback: boolean,
  extraMs = 0,
): ChatResult {
  const choice = res.body.choices?.[0];
  const served = typeof res.body.model === "string" && res.body.model.trim() ? res.body.model.trim() : null;
  return {
    content: choice?.message?.content ?? null,
    tool_calls: choice?.message?.tool_calls ?? [],
    finish_reason: choice?.finish_reason ?? null,
    model,
    served_model: served,
    // 라우터는 답한 모델 단가로 과금된다(조사 문서 4절·검증 기록) → 답한 모델 단가를 먼저 찾는다
    usage: usageCost(served && served !== model ? [served, model] : [model], res.body.usage),
    status: res.status,
    duration_ms: res.duration_ms + extraMs,
    json_fallback: jsonFallback,
  };
}

/** Chat Completions 한 번. jsonSchema가 있고 400이면 json_object로 한 번 대체 */
export async function chat(request: ChatRequest, options: LinerCallOptions = {}): Promise<ChatResult> {
  const base: Record<string, unknown> = { model: request.model, messages: request.messages };
  if (request.maxTokens) base.max_tokens = request.maxTokens;
  if (request.reasoningEffort) base.reasoning_effort = request.reasoningEffort;
  if (request.tools) {
    base.tools = request.tools;
    base.tool_choice = request.toolChoice ?? "auto";
  }
  if (!request.jsonSchema) return toResult(request.model, await post(base, options), false);

  try {
    const res = await post(
      {
        ...base,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema },
        },
      },
      options,
    );
    return toResult(request.model, res, false);
  } catch (error) {
    if (!(error instanceof LinerError) || error.status !== 400) throw error;
    const messages = request.messages.map((m) => ({ ...m }));
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) lastUser.content = `${lastUser.content ?? ""}\n\nRespond in JSON.`;
    const res = await post({ ...base, messages, response_format: { type: "json_object" } }, options);
    return toResult(request.model, res, true, error.duration_ms);
  }
}

export interface HedgeOptions {
  /** 첫 요청이 이 시간(ms) 안에 끝나지 않으면 같은 요청을 하나 더 보낸다 */
  afterMs: number;
  /** 요청 하나의 제한 시간(ms). 제한 시간에 걸린 요청은 다시 부르지 않는다(겹친 요청이 그 몫을 한다) */
  timeoutMs: number;
}

/**
 * 늦는 호출을 겹쳐 보내기(hedged request). 11/13 평가에서 ③ 호출 하나가 60초 제한까지 멈췄다가 다시 불러
 * 질문 전체가 80초를 넘은 일이 두 번 있었다(평균 응답 ③ 17.6초). 첫 요청이 afterMs 안에 안 끝나면 같은 요청을 하나 더 보내고
 * 먼저 성공한 쪽을 쓰며 나머지는 취소한다. 첫 요청이 그 전에 실패하면 겹쳐 보내지 않고 그대로 실패를 돌려준다(5xx 재시도는 chat 안에서 한다).
 */
export async function chatHedged(request: ChatRequest, options: LinerCallOptions, hedge: HedgeOptions): Promise<ChatResult> {
  const started = Date.now();
  const controllers: AbortController[] = [];
  const outer = options.signal;
  const launch = (): Promise<ChatResult> => {
    const controller = new AbortController();
    controllers.push(controller);
    if (outer?.aborted) controller.abort();
    outer?.addEventListener("abort", () => controller.abort(), { once: true });
    return chat(request, { ...options, signal: controller.signal, timeoutMs: hedge.timeoutMs, retryOnTimeout: false });
  };
  return new Promise<ChatResult>((resolve, reject) => {
    let settled = false;
    let pending = 0;
    let lastError: unknown = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const track = (p: Promise<ChatResult>, index: number) => {
      pending += 1;
      p.then(
        (res) =>
          finish(() => {
            controllers.forEach((c, i) => i !== index && c.abort());
            const duplicates = controllers.length - 1;
            resolve({ ...res, duration_ms: Date.now() - started, ...(duplicates ? { duplicate_requests: duplicates } : {}) });
          }),
        (error) => {
          pending -= 1;
          lastError = error;
          // 겹친 요청이 아직 돌고 있으면 기다린다. 첫 요청이 겹쳐 보내기 전에 실패하면 그대로 실패(타이머도 멈춘다)
          if (pending === 0) finish(() => reject(lastError));
        },
      );
    };
    track(launch(), 0);
    timer = setTimeout(() => {
      timer = null;
      if (settled || outer?.aborted) return;
      track(launch(), 1);
    }, hedge.afterMs);
  });
}

/** 모델 응답 문자열에서 JSON 객체를 꺼낸다(코드 펜스·앞뒤 말 허용). 실패하면 null */
export function parseJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // 다음 후보
    }
  }
  return null;
}
