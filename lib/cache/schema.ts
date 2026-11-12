// data/ 파일 형식(설계 4-2). 수집기(scripts/collect)가 이 형식으로 쓰고, 파이프라인은 lib/cache/load.ts를 거쳐서만 읽는다.
// 원문 텍스트는 바꾸지 않는다(공백 정리만). 날짜는 모두 'YYYY-MM-DD'(시행일·공포일), 수집 시각은 ISO 8601(+09:00).

/** 'YYYY-MM-DD' 날짜 문자열 */
export type IsoDate = string;
/** ISO 8601 시각 문자열(예 2026-11-16T14:05:00+09:00) */
export type IsoDateTime = string;

/** 법령 종류. 학칙(school_rule)은 근거 등급 L2, 나머지는 L1 */
export type LawKind =
  | "act" // 법률
  | "presidential_decree" // 대통령령(시행령)
  | "ministerial_ordinance" // 부령(교육부령 등)
  | "administrative_rule" // 행정규칙(훈령·고시)
  | "school_rule"; // 학칙

/** 지원 학교. 화면의 '지정 안 함'은 null */
export type SchoolId = "snu" | "pnu" | "knou";

/** 목(가·나·다…) */
export interface SubItem {
  no: string; // "가"
  text: string;
}

/** 호(1·2·3…) */
export interface Item {
  no: string; // "1"
  text: string;
  subitems: SubItem[];
}

/** 항(①②…). 항이 없는 조는 no를 ""로 한 항 하나에 본문을 둔다 */
export interface Paragraph {
  no: string; // "1"(①), 항 없는 조는 ""
  text: string;
  items: Item[];
}

/** 조의 한 판(시행일 구간) */
export interface ArticleVersion {
  effective_from: IsoDate; // 이 판의 시행일(부칙 단서·overrides 반영 뒤 값)
  effective_to: IsoDate | null; // 다음 판 시행 전날. 현행·최신 판은 null
  promulgated: IsoDate; // 공포일
  promulgation_no: string; // "법률 제21423호"
  text: string; // 조 전체 원문(제목 줄 포함, 공백 정리만)
  paragraphs: Paragraph[];
  amend_tags: string[]; // 원문 꼬리표 그대로: "<개정 2024. 2. 20.>", "[본조신설 2026. 3. 10.]"
  source_url: string; // law.go.kr 해당 판 URL
}

/** 위임 연결(설계 2-2 위임 사슬). 수집 때 미리 만든다 */
export interface DelegationLink {
  phrase: string; // 원문 위임 문구, 예 "학칙으로 정한다"
  target:
    | { kind: "article"; article_id: string } // 다른 법령의 조
    | { kind: "school_rule" } // 학칙 위임 — 학교 지정 시 대응 조, 아니면 "학교별 확인"
    | { kind: "notice"; issuer: string }; // "교육부장관이 정하여 공고" 등
  paragraph_no?: string; // 위임 문구가 있는 항
}

/** 조 하나(색인 단위) */
export interface LawArticle {
  id: string; // "<law_id>:<조번호 3자리>-<가지번호 2자리>", 예 "heaf:011-02"(제11조의2), "heaf:023-00"(제23조)
  law_id: string; // "heaf"
  law_name: string; // "고등교육법"
  number: string; // "제11조의2"
  title: string; // "기숙사비 및 기숙사비심의위원회"
  versions: ArticleVersion[]; // effective_from 오름차순
  links: DelegationLink[];
  moved_from?: string; // 옛 조 ID(조 번호 이동)
  moved_to?: string; // 새 조 ID
  /** 조의 일부 항만 담은 경우(학칙 인용 최소화). 없으면 조 전체 */
  excerpt?: ArticleExcerpt;
}

/** 일부 항만 담은 조의 표시. versions[].text·paragraphs에는 담은 항만 있다 */
export interface ArticleExcerpt {
  paragraphs: string[]; // 담은 항 번호, 예 ["4","5"]
  omitted: string[]; // 뺀 항 번호
  note: string; // 화면·답에 붙일 안내, 예 "제4항·제5항만 수록(전문은 출처 URL)"
}

/** data/laws/<law_id>.json (학칙은 data/rules/<law_id>.json) */
export interface LawDocument {
  law_id: string;
  law_name: string;
  kind: LawKind;
  school?: SchoolId; // 학칙만
  articles: LawArticle[];
}

/** manifest.json의 판 하나 */
export interface ManifestEdition {
  effective_from: IsoDate;
  promulgated: IsoDate;
  promulgation_no: string;
  source_url: string;
}

/** data/manifest.json 항목 하나 */
export interface ManifestEntry {
  id: string; // law_id
  name: string;
  kind: LawKind;
  school?: SchoolId;
  editions: ManifestEdition[];
  collected_at: IsoDateTime; // 수집 시각(KST)
  method: "openapi" | "html" | "manual"; // manual = 사람이 원문을 옮겨 적음
  source_url: string;
  attribution: string; // 출처 표기 문구(학칙은 대학명 먼저)
  redistribution: string; // 재배포 근거 메모(예 "저작권법 제7조제1호")
  storage: "file" | "remote"; // remote = 수집기 개발용(law.go.kr에서 받기). 앱 실행 경로는 file만 읽는다
  path?: string; // storage가 file이면 data/ 기준 경로
  /** 학칙: 저장소에 담은 범위(쓰는 조·항만) */
  scope?: string;
  /** 알려진 한계(예: 현행 직전 판 정보를 확인하지 못함) */
  limitations?: string[];
}

export interface Manifest {
  schema_version: 1;
  generated_at: IsoDateTime;
  entries: ManifestEntry[];
}

/** data/overrides.json — 사람이 부칙을 읽고 확인한 조별 시행일·이동 연결 */
export interface ArticleOverride {
  article_id: string;
  effective_from?: IsoDate;
  moved_from?: string;
  moved_to?: string;
  basis: string; // 근거, 예 "법률 제21423호 부칙 제1조 단서"
}

export interface Overrides {
  schema_version: 1;
  overrides: ArticleOverride[];
}

/** data/synonyms.json — 구어체 ↔ 조문 용어 */
export interface Synonyms {
  schema_version: 1;
  groups: string[][]; // 예 [["등심위","등록금심의위원회"],["쉬는 학기","휴학"]]
}
