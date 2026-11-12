// Liner API fetch 목. 경로·요청 본문을 보고 정해 둔 응답을 돌려주며 호출을 기록한다(실제 네트워크 안 씀).
export interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export type MockHandler = (call: RecordedCall) => { status?: number; body: unknown; headers?: Record<string, string> };

export function createLinerMock(handler: MockHandler) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call = { path: url.pathname.replace(/^\/api\/v1/, ""), body, headers };
    calls.push(call);
    const res = handler(call);
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "content-type": "application/json", ...(res.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** chat/completions 응답 본문 */
export function chatBody(content: unknown, usage = { prompt_tokens: 1000, completion_tokens: 300, reasoning_tokens: 200 }) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "liner-mark-1.3",
    choices: [{ index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
      completion_tokens_details: { reasoning_tokens: usage.reasoning_tokens },
    },
  };
}

/** json_schema 이름(question_analysis | grounded_answer) */
export function schemaName(body: Record<string, unknown>): string | undefined {
  const rf = body.response_format as { json_schema?: { name?: string } } | undefined;
  return rf?.json_schema?.name;
}
