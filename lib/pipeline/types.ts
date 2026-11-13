// 파이프라인 계약(설계 1·2·3절). 화면은 이 파일의 타입만 안다.
// 흐름: ① 질문 분석 → ② 근거 수집(캐시·Search·변경 신호) → ③ 대조·답변 → ④ 코드 검증 → ⑤ 출력(AskResult)
// 고칠 때는 화면(components/)과 데이터 읽기(lib/cache/)도 함께 맞춘다.

import type { IsoDate, IsoDateTime, LawKind, SchoolId } from "@/lib/cache/schema";

export type { IsoDate, IsoDateTime, LawKind, SchoolId };

// ───────── 요청 ─────────

/** 답변 방식(설계 2-3). fixed만 동작한다. tools는 미구현(만들지 않기로 함) — 계약 호환을 위해 값만 남김 */
export type AgentMode = "fixed" | "tools";

/** POST /api/ask 본문이자 runPipeline 입력 */
export interface AskRequest {
  question: string;
  asOf?: IsoDate; // 기준일. 비우면 오늘(KST)
  school?: SchoolId | null; // null·생략 = 지정 안 함
  mode?: AgentMode; // 비우면 환경변수 AGENT_MODE, 그것도 없으면 fixed
}

// ───────── ① 질문 분석 ─────────

/** 장면: 처리 중 / 업무 시작(기안) / 모름 */
export type Scene = "processing" | "initiating" | "unknown";

/** ① liner-mark json_schema 출력(설계 2-1) */
export interface QuestionAnalysis {
  scene: Scene;
  task: string; // 업무 이름
  concepts: string[];
  queries_cache: string[]; // 조문 검색어
  queries_web: string[]; // 웹 검색어(비어도 됨)
  needs_external: boolean; // 법령 DB 밖 정보(연도별 수치·공고·입법예고)가 필요한지
  needs_external_reason: string;
  school: SchoolId | null;
  fallback: boolean; // 모델 실패로 규칙 기반 대체가 돌았으면 true(처리 과정에 표시)
}

// ───────── 근거 등급·상태 ─────────

/** 근거 등급(설계 2-2·2-5). W3는 근거로 쓰지 않고 "원문 확인 필요" 표시용 */
export type EvidenceGrade =
  | "L1" // 법령·행정규칙(캐시)
  | "L2" // 학칙(캐시)
  | "W1" // 정부 원문(*.go.kr, korea.kr 등)
  | "W1_aux" // 교육부 공식 블로그 재게시(참고)
  | "W2" // 대학 공개 자료(*.ac.kr)
  | "W2_repost" // 대학 게시판에 올라온 정부 문서 재게시본(원문 확인 필요)
  | "W3"; // 언론·블로그 등 — 근거 아님

/** 조문 상태. 기준일로 매 요청마다 계산하고 캐시에 박지 않는다(설계 3-3) */
export type ArticleStatus =
  | "in_force" // 시행 중
  | "not_yet" // 시행 예정
  | "superseded"; // 구판

/** 카드 상태 배지(색만으로 구분하지 않게 글자와 함께 쓴다) */
export type StatusBadge = ArticleStatus | "proposed" /* 입법예고(미확정) */ | "reference" /* 웹 참고 */;

// ───────── ② 근거 수집 ─────────

/** ②-a 캐시 조문 후보(기준일 판 하나로 펼친 것) */
export interface ArticleCandidate {
  id: string; // LawArticle.id, 예 "heaf:011-02"
  law_id: string;
  law_name: string;
  kind: LawKind;
  number: string; // "제11조의2"
  title: string;
  text: string; // 해당 판 원문
  effective_from: IsoDate;
  effective_to: IsoDate | null;
  status: ArticleStatus;
  grade: "L1" | "L2";
  source_url: string;
  score: number; // 검색 점수(BM25 등)
  via: "direct" | "search" | "delegation"; // 조번호 직접 조회 / 검색 / 위임 사슬
  delegated_to_school_rule: boolean; // "학칙으로 위임 — 학교별 확인"
  excerpt_note?: string; // 일부 항만 담은 조의 안내(LawArticle.excerpt.note)
  /** 이 조에 권한을 맡긴 상위 조(후보에 있는 것만). quote는 상위 조 원문 그대로 */
  upper?: { id: string; phrase: string; quote: string }[];
  /** 이 조가 상위 조로서 맡긴 하위 조 ID(위로 거슬러 올라가 찾은 경우) */
  upper_of?: string[];
  /** 같은 행정규칙의 적용 범위 조라서 넣었으면 그 계기가 된 조 ID */
  scope_of?: string;
  /** 기준일 판이 개정으로 바뀐 판이면(같은 조의 이전 판이 있음) true */
  amended?: boolean;
}

/** ②-b·②-c Liner Search 결과 하나(등급 매김 뒤). description은 신뢰하지 않는 데이터 */
export interface WebResult {
  id: string; // 이번 요청 안에서만 쓰는 ID, 예 "web:3"
  title: string;
  url: string;
  hostname: string;
  date: IsoDate | null; // 검색 결과 게시일(참고). 개정일·시행일 근거로 쓰지 않는다
  description: string;
  grade: EvidenceGrade;
  query: string;
  excluded?: "list_page" | "menu_page"; // 교육부 목록·메뉴 URL 제외 규칙(설계 2-2)
  /** 공고 캐시(data/notices.json)에서 온 자료. 검색 결과가 아니다 */
  notice?: {
    id: string;
    issuer: string;
    status: "checked" | "needs_source_check"; // needs_source_check면 수치 없음("원문 확인 필요")
    figures: { label: string; value: string; location: string; checked_url: string }[];
  };
}

/** ②-c 변경 신호(확정 아님) */
export interface ChangeSignal {
  web_id: string;
  title: string;
  url: string;
  hostname: string;
  date: IsoDate | null;
  kind: "legislative_notice" | "amendment_news" | "other"; // 입법예고 / 개정 소식 / 그 밖
  related_law: string; // 신호를 찾은 법령 이름
  opinion_deadline?: IsoDate; // 입법예고 의견 제출 마감(알 때만)
  after_collection: boolean; // 캐시 수집일 이후 날짜면 true → "수집 뒤 변경 가능성" 배지
}

// ───────── ③ 대조·답변 ─────────

export type Verdict = "answered" | "partial" | "no_basis";

/** ③ liner-mark json_schema 출력의 인용 하나 */
export interface Citation {
  id: string; // ArticleCandidate.id 또는 WebResult.id
  quote: string; // 원문 그대로 일부
  role: "basis" | "reference" | "delegation"; // 근거 / 참고 / 위임
}

/** 업무 시작(기안) 장면의 체크리스트 한 줄 */
export interface ChecklistItem {
  step: string;
  deadline?: string; // "회의일 다음 날부터 10일 이내" 같은 원문 표현
  basis_ids: string[]; // 근거 ID
}

/** 근거 없음일 때 찾아본 범위 */
export interface SearchedScope {
  laws: string[]; // 본 법령 이름
  queries: string[]; // 쓴 검색어
  where_to_check: string[]; // 확인할 곳: 학칙·정관·교육부 공고 등
}

/** ③ 모델 출력 원본(④ 검증 전) */
export interface DraftAnswer {
  verdict: Verdict;
  summary: string;
  citations: Citation[];
  checklist: ChecklistItem[];
  caveats: string[];
  searched_scope: SearchedScope | null;
}

// ───────── ④ 코드 검증 ─────────

export type VerificationIssueKind =
  | "unknown_id" // 인용 ID가 캐시·검색 결과에 없음 → 제거
  | "quote_corrected" // 인용문을 원문 해당 부분으로 자동 교정
  | "quote_not_found" // 인용문을 원문에서 못 찾음 → 제거
  | "not_yet_as_current" // 시행 예정 조문을 현행처럼 말함 → partial로 낮춤
  | "number_unsupported" // 결론의 숫자가 인용문·카드에 없음 → 경고
  | "w3_number" // W3에만 있는 숫자
  | "no_citations_left" // 남은 근거 0 → no_basis
  | "delegation_only" // 법령은 학칙에 맡기기만 하고 묻는 숫자·기간이 없음 → no_basis
  | "school_rule_not_cited" // 위임 조만 인용했는데 그 학교 학칙 조가 후보에 있음 → no_basis로 바꾸지 않고 ③ 한 번 더
  | "notice_delegation" // 공고에 맡긴 사항 + 공고 있음 → no_basis를 partial로
  | "upper_added" // 학칙·하위 규범 근거에 상위 위임 조를 코드가 덧붙임
  | "hedged_basis"; // 결론이 "근거로 제시할 수 있다"처럼 에둘러 근거로 삼음 → ③ 한 번 더

export interface VerificationIssue {
  kind: VerificationIssueKind;
  citation_id?: string;
  detail: string;
}

export interface VerificationReport {
  issues: VerificationIssue[];
  removed_citations: number; // 지어낸 인용 수(평가 채점 4번)
  retried: boolean; // ③을 1회 다시 불렀는지
  verdict_before: Verdict;
  verdict_after: Verdict;
}

// ───────── ⑤ 출력 ─────────

/** 근거 카드(설계 2-5). L1·L2는 조문, W*는 웹 자료 */
export interface EvidenceCard {
  id: string; // Citation.id
  grade: EvidenceGrade;
  role: Citation["role"];
  title: string; // 법령·규칙 이름 또는 웹 문서 제목
  kind?: LawKind; // 조문 카드만
  location?: string; // "제15조제1항제1호 다목"
  quote: string; // 원문 그대로
  badge: StatusBadge;
  effective_from?: IsoDate; // 조문 카드만
  amend_tags: string[]; // "<개정 2024. 2. 20.>"
  source_url: string;
  posted_date?: IsoDate | null; // 웹 카드: 검색 결과 게시일(참고)
  collected_at?: IsoDateTime; // 조문 카드: 수집 시각
  attribution: string; // 출처 표기(학칙은 대학명 먼저)
  changed_after_collection: boolean; // "수집 뒤 변경 가능성" 배지
  notes: string[]; // "원문 확인 필요", "학칙으로 위임 — 학교별 확인" 등
}

/** 처리 과정(TraceDetails)으로 브라우저에 내려보내는 호출 기록 — 허용 필드만(설계 5-3 4-1) */
export interface TraceCall {
  stage: StageName;
  api: "router" | "search" | "cache";
  model?: string; // 모델 ID(router)
  query?: string; // 검색어(search·cache)
  http_status?: number;
  duration_ms: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    cost_usd: number; // 코드가 토큰×단가로 계산(응답에 cost 없음). Search는 회당 단가
  };
  results?: { hostname: string; grade: EvidenceGrade; excluded?: WebResult["excluded"] }[];
  note?: string; // "규칙 기반 대체", "목록 페이지 제외" 같은 짧은 표시(예외 메시지 금지)
  candidate_ids?: string[]; // ②-a(cache)만: ③에 넘긴 후보 조 ID(평가 분석용)
}

export interface Trace {
  calls: TraceCall[];
  total_duration_ms: number;
  total_cost_usd: number;
  models: Partial<Record<"analyze" | "answer", string>>; // 단계별 모델 ID
}

/** 화면이 받는 최종 결과 */
export interface AskResult {
  request: Required<Pick<AskRequest, "question" | "asOf">> & { school: SchoolId | null; mode: AgentMode };
  data_collected_at: IsoDateTime; // "법령 데이터 수집일"
  scene: Scene;
  verdict: Verdict;
  summary: string; // 결론 한 단락
  cards: EvidenceCard[];
  checklist: ChecklistItem[]; // 업무 시작일 때
  caveats: string[];
  change_signals: ChangeSignal[];
  searched_scope: SearchedScope | null; // 근거 없음일 때
  warnings: string[]; // 숫자 대조 경고 등 화면에 보일 것
  verification: VerificationReport;
  trace: Trace;
}

// ───────── 단계 이벤트(스트리밍·상태 메시지) ─────────

export type StageName = "analyze" | "collect_cache" | "collect_web" | "collect_signals" | "answer" | "verify";

/** 화면 aria-live 상태 메시지와 스트리밍에 쓰는 이벤트 */
export type StageEvent =
  | { type: "stage_start"; stage: StageName; at: IsoDateTime }
  | { type: "stage_end"; stage: StageName; at: IsoDateTime; duration_ms: number; ok: boolean }
  | { type: "result"; result: AskResult }
  | { type: "error"; code: PipelineErrorCode; message: string }; // message는 사용자용 한국어 문구(예외 원문 금지)

export type PipelineErrorCode =
  | "bad_request" // 질문이 비었거나 기준일 형식 오류
  | "missing_api_key" // LINER_API_KEY 없음
  | "invalid_api_key" // 401·403: 키가 틀렸거나 권한 없음
  | "insufficient_credit" // 402: 크레딧 부족
  | "liner_unavailable" // 네트워크 오류·5xx·타임아웃(재시도 뒤)
  | "rate_limited" // 429
  | "internal";
