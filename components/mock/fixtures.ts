// 개발 전용 목 결과. 파이프라인이 붙기 전 화면과 데모 장면을 맞춰 보는 데만 쓴다.
// - 질문은 평가 세트(2026. 11. 5. 작성) 문항 그대로다.
// - 인용문(quote)은 평가 세트 근거로 받은 법제처 원문 캡처(2026. 11. 5.)에서 그대로 옮긴 quotes.json과
//   data/examples/heaf.example.json만 쓴다. 조문 문구를 새로 쓰지 않는다.
// - 결론(summary)·체크리스트는 평가 세트 '정답 요지'를 줄인 것이다.
// - 처리 과정의 토큰·소요 시간·금액은 예시 값이다(화면에도 목 데이터라고 띄운다).
import heafExample from "@/data/examples/heaf.example.json";
import messages from "@/messages/ko.json";
import type {
  AskRequest,
  AskResult,
  ChangeSignal,
  EvidenceCard,
  IsoDate,
  StageEvent,
  StageName,
  TraceCall,
} from "@/lib/pipeline/types";
import { AskError } from "../ask-client";
import quotes from "./quotes.json";

const COLLECTED_AT = "2026-11-05T00:27:00+09:00";
const LAW_ATTRIBUTION = "출처: 법제처 국가법령정보센터";

const URL_HEAF = "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=283883&efYd=20260911";
const URL_HEAF_270311 = "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=283883&efYd=20270311";
const URL_HEDEC = "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=289437&efYd=20260911";
const URL_TUITION = "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=240223&efYd=20220207";
const URL_SNU = "https://www.law.go.kr/LSW/schlPubRulInfoR.do?schlPubRulSeq=2200000157427";

// Liner 단가(설계 1-1): liner-mark-1.3 입력 $1/100만·출력 $5/100만(추론 토큰은 출력에 포함해 출력 단가), Search 회당 $0.001
const MODEL = "liner-mark-1.3";
function routerUsage(prompt: number, completion: number, reasoning: number) {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: reasoning,
    cost_usd: (prompt * 1 + completion * 5) / 1_000_000,
  };
}
const SEARCH_USAGE = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cost_usd: 0.001 };

function joinQuote(...keys: (keyof typeof quotes)[]): string {
  return keys.map((k) => quotes[k]).join("\n");
}

function lawCard(card: Omit<EvidenceCard, "attribution" | "changed_after_collection" | "notes" | "amend_tags" | "collected_at" | "badge"> & Partial<EvidenceCard>): EvidenceCard {
  return {
    attribution: LAW_ATTRIBUTION,
    changed_after_collection: false,
    notes: [],
    amend_tags: [],
    collected_at: COLLECTED_AT,
    badge: "in_force",
    ...card,
  };
}

interface MockScenario {
  id: string;
  /** 단계 순서와 예시 소요 시간(ms) */
  stages: [StageName, number][];
  calls: TraceCall[];
  build: (request: Required<Pick<AskRequest, "question" | "asOf">> & { school: AskRequest["school"] }) => Omit<
    AskResult,
    "request" | "data_collected_at" | "trace" | "verification"
  > & { verification?: Partial<AskResult["verification"]> };
}

const E01: MockScenario = {
  id: "E01",
  stages: [
    ["analyze", 2100],
    ["collect_cache", 60],
    ["collect_signals", 1400],
    ["answer", 5200],
    ["verify", 30],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 2100, usage: routerUsage(1850, 410, 160) },
    { stage: "collect_cache", api: "cache", query: "다른 학교 학점 인정 범위", duration_ms: 30 },
    { stage: "collect_cache", api: "cache", query: "학점인정의 범위 및 기준", duration_ms: 30 },
    {
      stage: "collect_signals",
      api: "search",
      query: "고등교육법 시행령 학점인정 개정 입법예고",
      http_status: 200,
      duration_ms: 1400,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "opinion.lawmaking.go.kr", grade: "W1" },
        { hostname: "www.moe.go.kr", grade: "W1", excluded: "list_page" },
        { hostname: "blog.naver.com", grade: "W3" },
      ],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 5200, usage: routerUsage(7900, 1150, 380) },
  ],
  build: () => ({
    scene: "processing",
    verdict: "answered",
    summary:
      "일반적인 경우 졸업에 필요한 학점의 2분의 1 이내에서 인정할 수 있습니다(시행령 제15조제1항제1호 다목). 다만 우리 학교가 다른 국내·외국대학과 공동으로 운영하는 교육과정(가목)이나 외국대학이 운영하게 한 교육과정(나목)을 이수한 경우는 '대학 간 협약을 통해 정하는 범위 이내'입니다. 법 제23조제1항은 이 범위에서 학칙으로 정하게 하므로, 실제 인정 한도는 학칙을 함께 확인하세요.",
    cards: [
      lawCard({
        id: "hedec:015-00",
        grade: "L1",
        role: "basis",
        title: "고등교육법 시행령",
        kind: "presidential_decree",
        location: "제15조제1항제1호 가목·나목·다목",
        quote: joinQuote("hedec_15_1_head", "hedec_15_1_1"),
        effective_from: "2026-09-11",
        source_url: URL_HEDEC,
      }),
      lawCard({
        id: "heaf:023-00",
        grade: "L1",
        role: "delegation",
        title: "고등교육법",
        kind: "act",
        location: "제23조제1항제1호",
        quote: joinQuote("heaf_23_1_head", "heaf_23_1_1"),
        effective_from: "2026-09-11",
        source_url: URL_HEAF,
        notes: ["학칙으로 위임 — 학교별 확인"],
      }),
    ],
    checklist: [],
    caveats: [
      "가·나목은 협약서의 인정 범위를 확인해야 합니다.",
      "제1호는 법 제23조제1항제1호~제3호와 제5호(학점은행)를 함께 묶습니다.",
    ],
    change_signals: [],
    searched_scope: null,
    warnings: [],
  }),
};

const E03: MockScenario = {
  id: "E03",
  stages: [
    ["analyze", 1900],
    ["collect_cache", 50],
    ["collect_signals", 1300],
    ["answer", 4300],
    ["verify", 30],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 1900, usage: routerUsage(1820, 380, 140) },
    { stage: "collect_cache", api: "cache", query: "군 휴학 원격수업 학점 인정", duration_ms: 25 },
    { stage: "collect_cache", api: "cache", query: "병역법 입영 휴학 원격수업", duration_ms: 25 },
    {
      stage: "collect_signals",
      api: "search",
      query: "고등교육법 시행령 제15조 개정",
      http_status: 200,
      duration_ms: 1300,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "www.law.go.kr", grade: "W1" },
        { hostname: "www.korea.kr", grade: "W1" },
      ],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 4300, usage: routerUsage(6400, 900, 300) },
  ],
  build: () => ({
    scene: "processing",
    verdict: "answered",
    summary:
      "입영·복무로 휴학 중에 원격수업으로 딴 학점은 법 제23조제1항제4호에 해당하고, 시행령 제15조제1항제2호에 따라 학기당 6학점 이내, 연 12학점 이내로 인정할 수 있습니다. 다른 학교 학점의 일반 기준(졸업학점 2분의 1)과는 별개 호입니다. 인정 방법은 학칙으로 정하는 바에 따릅니다.",
    cards: [
      lawCard({
        id: "hedec:015-00",
        grade: "L1",
        role: "basis",
        title: "고등교육법 시행령",
        kind: "presidential_decree",
        location: "제15조제1항제2호",
        quote: quotes.hedec_15_1_2,
        effective_from: "2026-09-11",
        source_url: URL_HEDEC,
      }),
      lawCard({
        id: "heaf:023-00",
        grade: "L1",
        role: "basis",
        title: "고등교육법",
        kind: "act",
        location: "제23조제1항제4호",
        quote: quotes.heaf_23_1_4,
        effective_from: "2026-09-11",
        source_url: URL_HEAF,
        notes: ["학칙으로 위임 — 학교별 확인"],
      }),
    ],
    checklist: [],
    caveats: ["학기당 한도와 연간 한도를 함께 확인하세요."],
    change_signals: [],
    searched_scope: null,
    warnings: [],
  }),
};

const E14: MockScenario = {
  id: "E14",
  stages: [
    ["analyze", 2200],
    ["collect_cache", 70],
    ["collect_signals", 1500],
    ["answer", 6100],
    ["verify", 40],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 2200, usage: routerUsage(1880, 450, 190) },
    { stage: "collect_cache", api: "cache", query: "등록금심의위원회 회의 소집 통지", duration_ms: 35 },
    { stage: "collect_cache", api: "cache", query: "회의 자료 송부 기한", duration_ms: 35 },
    {
      stage: "collect_signals",
      api: "search",
      query: "대학 등록금에 관한 규칙 개정 입법예고",
      http_status: 200,
      duration_ms: 1500,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "opinion.lawmaking.go.kr", grade: "W1" },
        { hostname: "www.moe.go.kr", grade: "W1" },
        { hostname: "www.moe.go.kr", grade: "W1", excluded: "menu_page" },
      ],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 6100, usage: routerUsage(8300, 1320, 420) },
  ],
  build: () => ({
    scene: "initiating",
    verdict: "answered",
    summary:
      "회의 일시·장소·안건은 회의 7일 전까지 통지하고, 회의 자료는 5일 전까지 각 위원에게 보내야 합니다. 두 기한 모두 토요일과 공휴일을 빼고 셉니다(대학 등록금에 관한 규칙 제2조제6항). 긴급한 사유가 있으면 예외입니다. 소집은 위원장이 필요하다고 인정하거나 재적위원 10분의 4 이상이 요청할 때 위원장이 합니다.",
    cards: [
      lawCard({
        id: "tuition:002-00",
        grade: "L1",
        role: "basis",
        title: "대학 등록금에 관한 규칙",
        kind: "ministerial_ordinance",
        location: "제2조제5항~제7항",
        quote: quotes.tuition_2_5_7,
        effective_from: "2022-02-07",
        source_url: URL_TUITION,
      }),
    ],
    checklist: [
      { step: "소집 요건 확인: 위원장이 필요하다고 인정하거나 재적위원 10분의 4 이상 요청", basis_ids: ["tuition:002-00"] },
      {
        step: "회의 일시·장소·안건을 각 위원에게 통지",
        deadline: "회의 개최 7일(토요일 및 공휴일은 제외한다) 전까지",
        basis_ids: ["tuition:002-00"],
      },
      {
        step: "회의 자료를 각 위원에게 송부",
        deadline: "회의 개최 5일(토요일 및 공휴일은 제외한다) 전까지",
        basis_ids: ["tuition:002-00"],
      },
      { step: "당일 개의·의결 정족수 확인: 재적위원 과반수 출석, 출석위원 과반수 찬성", basis_ids: ["tuition:002-00"] },
    ],
    caveats: ["달력일이 아니라 토요일·공휴일을 뺀 날로 셉니다.", "학칙에 더 자세한 운영 규정이 있는지 함께 확인하세요."],
    change_signals: [tuitionNoticeSignal()],
    searched_scope: null,
    warnings: [],
  }),
};

function tuitionNoticeSignal(): ChangeSignal {
  return {
    web_id: "web:1",
    title: "대학 등록금에 관한 규칙 일부개정령안 입법예고",
    url: "https://opinion.lawmaking.go.kr/gcom/ogLmPp/89212",
    hostname: "opinion.lawmaking.go.kr",
    date: "2026-10-27",
    kind: "legislative_notice",
    related_law: "대학 등록금에 관한 규칙",
    opinion_deadline: "2026-12-07",
    after_collection: false,
  };
}

const E13: MockScenario = {
  id: "E13",
  stages: [
    ["analyze", 2300],
    ["collect_cache", 80],
    ["collect_signals", 1600],
    ["answer", 6600],
    ["verify", 40],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 2300, usage: routerUsage(1900, 470, 200) },
    { stage: "collect_cache", api: "cache", query: "등록금심의위원회 구성", duration_ms: 40 },
    { stage: "collect_cache", api: "cache", query: "학생 위원 비율 전문가 위원", duration_ms: 40 },
    {
      stage: "collect_signals",
      api: "search",
      query: "대학 등록금에 관한 규칙 개정 입법예고 전문가 위원",
      http_status: 200,
      duration_ms: 1600,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "opinion.lawmaking.go.kr", grade: "W1" },
        { hostname: "www.moe.go.kr", grade: "W1" },
        { hostname: "news.example.com", grade: "W3" },
      ],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 6600, usage: routerUsage(9100, 1400, 460) },
  ],
  build: (request) => {
    const snu = request.school === "snu";
    const cards: EvidenceCard[] = [
      lawCard({
        id: "heaf:011-00",
        grade: "L1",
        role: "basis",
        title: "고등교육법",
        kind: "act",
        location: "제11조제3항",
        quote: quotes.heaf_11_3,
        effective_from: "2026-09-11",
        source_url: URL_HEAF,
      }),
      lawCard({
        id: "tuition:002-00",
        grade: "L1",
        role: "basis",
        title: "대학 등록금에 관한 규칙",
        kind: "ministerial_ordinance",
        location: "제2조제2항~제4항",
        quote: quotes.tuition_2_2_4,
        effective_from: "2022-02-07",
        source_url: URL_TUITION,
        notes: snu ? [] : ["학칙으로 위임 — 학교별 확인"],
      }),
    ];
    if (snu) {
      cards.push(
        lawCard({
          id: "snu:113-00",
          grade: "L2",
          role: "reference",
          title: "서울대학교 학칙",
          kind: "school_rule",
          location: "제113조제2항",
          quote: quotes.snu_113_2,
          effective_from: "2026-06-29",
          source_url: URL_SNU,
          attribution: "출처: 서울대학교 학칙(제2710호, 시행 2026. 6. 29.), 법제처 국가법령정보센터 게재본",
        }),
      );
    }
    return {
      scene: "initiating",
      verdict: "answered",
      summary: snu
        ? "위원은 7명 이상이고 교직원(사립은 법인 추천 재단인사 포함)·학생·관련 전문가로 구성합니다. 학생 위원은 정수의 10분의 3 이상, 구성단위별 위원은 10분의 5 미만이어야 하고, 전문가 위원은 학칙에 따라 학교 측과 학생 측이 협의해 선임합니다. 서울대학교 학칙의 구성 조항은 학칙 원문 처리 방식이 정해진 뒤 인용합니다(지금은 자리 표시)."
        : "위원은 7명 이상이고 교직원(사립은 법인 추천 재단인사 포함)·학생·관련 전문가로 구성합니다. 학생 위원은 정수의 10분의 3 이상, 구성단위별 위원은 10분의 5 미만이어야 하고, 전문가 위원은 학칙에 따라 학교 측과 학생 측이 협의해 선임합니다. 구성단위별 위원 수·선임방법·임기는 위원회에서 논의해 학칙으로 정합니다.",
      cards,
      checklist: [
        { step: "위원 정수를 7명 이상으로 정함", basis_ids: ["tuition:002-00"] },
        { step: "학생 위원을 정수의 10분의 3 이상, 구성단위별 위원을 10분의 5 미만으로 배분", basis_ids: ["heaf:011-00"] },
        { step: "전문가 위원은 학교와 직접 이해관계가 없는 사람으로, 학교 측과 학생 측이 협의해 선임", basis_ids: ["heaf:011-00", "tuition:002-00"] },
        { step: "구성단위별 위원 수·선임방법·임기를 위원회 논의를 거쳐 학칙에 반영", basis_ids: ["tuition:002-00"] },
      ],
      caveats: ["'10분의 5 미만'은 과반 이하와 다릅니다. 절반(10분의 5)이면 안 됩니다."],
      change_signals: [tuitionNoticeSignal()],
      searched_scope: null,
      warnings: [],
    };
  },
};

const E25: MockScenario = {
  id: "E25",
  stages: [
    ["analyze", 2000],
    ["collect_cache", 90],
    ["collect_web", 1700],
    ["collect_signals", 1300],
    ["answer", 5800],
    ["verify", 40],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 2000, usage: routerUsage(1840, 430, 170) },
    { stage: "collect_cache", api: "cache", query: "사립대 교원 연구년", duration_ms: 30 },
    { stage: "collect_cache", api: "cache", query: "교원 연수 근무장소 외", duration_ms: 30 },
    { stage: "collect_cache", api: "cache", query: "특별연수 연구년", duration_ms: 30 },
    {
      stage: "collect_web",
      api: "search",
      query: "사립대학 교원 연구년 법적 근거 교육부",
      http_status: 200,
      duration_ms: 1700,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "www.moe.go.kr", grade: "W1", excluded: "list_page" },
        { hostname: "www.example.ac.kr", grade: "W2" },
        { hostname: "blog.naver.com", grade: "W3" },
      ],
    },
    {
      stage: "collect_signals",
      api: "search",
      query: "사립학교법 교원 연수 개정 입법예고",
      http_status: 200,
      duration_ms: 1300,
      usage: SEARCH_USAGE,
      results: [{ hostname: "opinion.lawmaking.go.kr", grade: "W1" }],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 5800, usage: routerUsage(8800, 1250, 520) },
  ],
  build: () => ({
    scene: "initiating",
    verdict: "no_basis",
    summary:
      "법령에 사립대 교원 연구년을 직접 정한 조항은 찾지 못했습니다. 교육공무원법의 특별연수·근무장소 외 연수는 국공립 교육공무원 대상이고, 사립학교법 제55조의3(근무장소 외 연수)이 가장 가깝지만 연구년 제도 자체를 정한 조문은 아닙니다. 학교법인 정관과 학교 자체 규정으로 만들 사안입니다.",
    cards: [
      lawCard({
        id: "heaf:014-02",
        grade: "L1",
        role: "reference",
        title: "고등교육법",
        kind: "act",
        location: "제14조의2제1항제2호",
        quote: quotes.heaf_14_2_1_2,
        effective_from: "2026-09-11",
        source_url: URL_HEAF,
        notes: ["'연구년'은 강사를 1년 미만으로 임용할 수 있는 사유로만 나옵니다. 연구년 제도의 근거가 아닙니다."],
      }),
    ],
    checklist: [],
    caveats: ["교육공무원법 제40조(특별연수)를 사립대 근거로 쓰지 마세요."],
    change_signals: [],
    searched_scope: {
      laws: ["사립학교법(제55조, 제55조의2, 제55조의3)", "교육공무원법(제39조~제41조)", "고등교육법", "고등교육법 시행령"],
      queries: ["사립대 교원 연구년", "교원 연수 근무장소 외", "특별연수 연구년", "사립대학 교원 연구년 법적 근거 교육부"],
      where_to_check: ["학교법인 정관", "학교 자체 규정(교원 연구년·연구교수 규정)", "교원 인사 규정"],
    },
    warnings: [],
    verification: {
      verdict_before: "partial",
      verdict_after: "no_basis",
      issues: [{ kind: "no_citations_left", detail: "근거(basis)로 남은 인용이 없어 근거 없음으로 바꿨습니다." }],
    },
  }),
};

const heafArticle = heafExample.articles[0];
const heafVersion = heafArticle.versions[0];
const E22_EFFECTIVE: IsoDate = heafVersion.effective_from; // 2027-03-11

const E22: MockScenario = {
  id: "E22",
  stages: [
    ["analyze", 2000],
    ["collect_cache", 60],
    ["collect_signals", 1400],
    ["answer", 5400],
    ["verify", 30],
  ],
  calls: [
    { stage: "analyze", api: "router", model: MODEL, http_status: 200, duration_ms: 2000, usage: routerUsage(1830, 400, 150) },
    { stage: "collect_cache", api: "cache", query: "기숙사비심의위원회 설치", duration_ms: 30 },
    { stage: "collect_cache", api: "cache", query: "heaf:011-02", duration_ms: 30, note: "조번호 직접 조회" },
    {
      stage: "collect_signals",
      api: "search",
      query: "고등교육법 기숙사비심의위원회 시행",
      http_status: 200,
      duration_ms: 1400,
      usage: SEARCH_USAGE,
      results: [
        { hostname: "www.moe.go.kr", grade: "W1" },
        { hostname: "www.korea.kr", grade: "W1" },
        { hostname: "news.example.com", grade: "W3" },
      ],
    },
    { stage: "answer", api: "router", model: MODEL, http_status: 200, duration_ms: 5400, usage: routerUsage(7600, 1100, 400) },
  ],
  build: (request) => {
    const inForce = request.asOf >= E22_EFFECTIVE;
    // 제②항과 각 호, 제③항(원문 줄 그대로)
    const lines = heafVersion.text.split("\n");
    const quote = lines.slice(1, 7).join("\n");
    return {
      scene: "initiating",
      verdict: inForce ? "answered" : "partial",
      summary: inForce
        ? "설치해야 합니다. 고등교육법 제11조의2(기숙사비 및 기숙사비심의위원회)는 2027. 3. 11.부터 시행 중입니다. 교직원·학생·관련 전문가 등으로 위원회를 두고 학생 위원을 정수의 10분의 3 이상으로 하며, 구성·운영에 필요한 사항은 학칙으로 정합니다."
        : "지금은 의무가 아닙니다. 고등교육법 제11조의2(기숙사비 및 기숙사비심의위원회)는 2026. 3. 10. 공포된 법률 제21423호로 신설됐지만 부칙 제1조 단서에 따라 2027. 3. 11.부터 시행합니다. 시행되면 교직원·학생·관련 전문가 등으로 위원회를 두고 학생 위원을 정수의 10분의 3 이상으로 해야 하니, 지금은 학칙 개정안을 준비하는 단계로 기안하면 됩니다.",
      cards: [
        lawCard({
          id: heafArticle.id,
          grade: "L1",
          role: "basis",
          title: heafArticle.law_name,
          kind: "act",
          location: `${heafArticle.number}제2항·제3항`,
          quote,
          badge: inForce ? "in_force" : "not_yet",
          effective_from: E22_EFFECTIVE,
          amend_tags: heafVersion.amend_tags,
          source_url: heafVersion.source_url || URL_HEAF_270311,
          notes: ["학칙으로 위임 — 학교별 확인", "종전 제11조의2는 제11조의3으로 이동했습니다."],
        }),
      ],
      checklist: inForce
        ? []
        : [
            { step: "시행일(2027. 3. 11.) 전에 기숙사비심의위원회 구성·운영 사항을 담은 학칙 개정안 마련", basis_ids: [heafArticle.id] },
            { step: "학생 위원을 전체 정수의 10분의 3 이상으로 배분", basis_ids: [heafArticle.id] },
          ],
      caveats: inForce ? [] : ["law.go.kr 현행 화면에 이 조가 이미 보이지만 아직 시행 전입니다. 개정일이나 공포일을 시행일로 보지 마세요."],
      change_signals: [],
      searched_scope: null,
      warnings: [],
      verification: inForce
        ? undefined
        : {
            verdict_before: "answered",
            verdict_after: "partial",
            issues: [{ kind: "not_yet_as_current", citation_id: heafArticle.id, detail: "시행 예정 조문을 현행처럼 쓴 문장을 고쳤습니다." }],
          },
    };
  },
};

const SCENARIOS: MockScenario[] = [E01, E03, E14, E13, E25, E22];

function findScenario(question: string): MockScenario | undefined {
  const example = messages.examples.find((e) => e.question === question.trim());
  return example ? SCENARIOS.find((s) => s.id === example.id) : undefined;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** 단계 이벤트를 실제와 비슷한 간격(줄인 시간)으로 흘려 보낸다 */
export async function streamMockEvents(
  request: AskRequest,
  onEvent: (event: StageEvent) => void,
  signal: AbortSignal,
  options: { instant?: boolean } = {},
): Promise<void> {
  const scenario = findScenario(request.question);
  if (!scenario) throw new AskError("mock_unknown_question");

  const asOf = request.asOf ?? new Date().toISOString().slice(0, 10);
  const school = request.school ?? null;
  for (const [stage, duration] of scenario.stages) {
    onEvent({ type: "stage_start", stage, at: new Date().toISOString() });
    // 화면 확인용으로 실제 시간의 1/8만 기다린다
    await wait(options.instant ? 0 : Math.min(900, duration / 8), signal);
    onEvent({ type: "stage_end", stage, at: new Date().toISOString(), duration_ms: duration, ok: true });
  }

  const built = scenario.build({ question: request.question, asOf, school });
  const totalCost = scenario.calls.reduce((sum, c) => sum + (c.usage?.cost_usd ?? 0), 0);
  const totalDuration = scenario.stages.reduce((sum, [, d]) => sum + d, 0);
  const result: AskResult = {
    ...built,
    request: { question: request.question, asOf, school, mode: request.mode ?? "fixed" },
    data_collected_at: COLLECTED_AT,
    verification: {
      issues: [],
      removed_citations: 0,
      retried: false,
      verdict_before: built.verdict,
      verdict_after: built.verdict,
      ...built.verification,
    },
    trace: {
      calls: scenario.calls,
      total_duration_ms: totalDuration,
      total_cost_usd: totalCost,
      models: { analyze: MODEL, answer: MODEL },
    },
  };
  onEvent({ type: "result", result });
}
