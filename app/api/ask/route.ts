import type { AskRequest } from "@/lib/pipeline/types";

// POST: 질문 → 파이프라인 → 결과(JSON, 단계 이벤트는 스트리밍 예정). 구현은 파이프라인 작업자.
export async function POST(request: Request): Promise<Response> {
  let body: AskRequest;
  try {
    body = (await request.json()) as AskRequest;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  void body;
  return Response.json({ error: "not_implemented" }, { status: 501 });
}
