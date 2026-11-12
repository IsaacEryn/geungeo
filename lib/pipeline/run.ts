// 파이프라인 진입점. 화면(app/api/ask)과 평가 실행기(scripts/eval)가 같은 함수를 부른다(설계 9-1).
import type { LawCache } from "@/lib/cache/load";
import type { AgentMode, AskRequest, AskResult, StageEvent } from "./types";

export interface RunOptions {
  /** 단계 이벤트(상태 메시지·스트리밍). 결과는 반환값으로도 온다 */
  onEvent?: (event: StageEvent) => void;
  /** 요청 취소 */
  signal?: AbortSignal;
  /** 미리 읽은 캐시. 생략하면 loadCache()로 읽는다 */
  cache?: LawCache;
  /** 평가 실행기용: Search 대신 tests/fixtures/search/의 고정 응답을 쓴다 */
  searchFixtureDir?: string;
  /** 평가 실행기용: 단계별 모델 덮어쓰기(비우면 LINER_MODEL_* 환경변수, 그다음 liner-mark-1.3) */
  models?: { analyze?: string; answer?: string };
  /** 요청의 mode보다 우선 */
  mode?: AgentMode;
}

/** 질문 하나를 ①~⑤ 단계로 처리해 결과를 돌려준다. 근거가 없으면 verdict "no_basis"로 끝난다(예외 아님) */
export async function runPipeline(request: AskRequest, options: RunOptions = {}): Promise<AskResult> {
  void request;
  void options;
  throw new Error("not implemented");
}
