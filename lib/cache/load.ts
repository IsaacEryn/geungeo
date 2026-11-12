// data/를 읽는 유일한 입구. 파이프라인은 data/ 파일을 직접 열지 않는다(설계 6절 경계).
// 학칙은 처리 방식 결정(저장소 수록 / 실행 때 받기) 전이라 두 방식을 모두 받게 둔다(설계 4-1).
import type { LawArticle, LawDocument, Manifest, Overrides, SchoolId, Synonyms } from "./schema";

export interface LawCache {
  manifest: Manifest;
  /** law_id → 법령 */
  laws: Map<string, LawDocument>;
  /** 조 ID("heaf:011-02") → 조 */
  articles: Map<string, LawArticle>;
  overrides: Overrides;
  synonyms: Synonyms;
  /** manifest 항목 중 가장 이른 수집 시각(화면 "데이터 수집일") */
  collectedAt: string;
}

export interface LoadOptions {
  /** data/ 폴더 위치. 기본은 <프로젝트>/data */
  dataDir?: string;
  /** 학칙 읽는 방식. file = data/rules/, remote = 실행 때 law.go.kr 공개 화면에서 받기. 기본은 manifest의 storage 값 */
  rules?: "file" | "remote";
}

/** data/ 전체를 읽어 메모리에 올린다. 프로세스 안에서 한 번만 읽고 재사용해도 된다 */
export async function loadCache(options: LoadOptions = {}): Promise<LawCache> {
  void options;
  throw new Error("not implemented");
}

/** 지정 학교의 학칙을 읽는다. 수록·받기 모두 실패하면 null(답에는 "학칙 확인 필요"로 표시) */
export async function loadSchoolRules(school: SchoolId, options: LoadOptions = {}): Promise<LawDocument | null> {
  void school;
  void options;
  throw new Error("not implemented");
}
