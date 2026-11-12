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
  model: string;
  usage: UsageCost;
  status: number;
  duration_ms: number;
  /** json_object 대체가 돌았는지 */
  json_fallback: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** 주면 json_schema(strict)로 요청 */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  maxTokens?: number;
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
  return {
    content: choice?.message?.content ?? null,
    tool_calls: choice?.message?.tool_calls ?? [],
    finish_reason: choice?.finish_reason ?? null,
    model,
    usage: usageCost(model, res.body.usage),
    status: res.status,
    duration_ms: res.duration_ms + extraMs,
    json_fallback: jsonFallback,
  };
}

/** Chat Completions 한 번. jsonSchema가 있고 400이면 json_object로 한 번 대체 */
export async function chat(request: ChatRequest, options: LinerCallOptions = {}): Promise<ChatResult> {
  const base: Record<string, unknown> = { model: request.model, messages: request.messages };
  if (request.maxTokens) base.max_tokens = request.maxTokens;
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
