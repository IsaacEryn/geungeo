// 파이프라인 시험용 Liner 응답 묶음(E22형 시행 예정, E25형 근거 없음).
import { chatBody, schemaName, type RecordedCall } from "./liner-mock";

export const E22_QUESTION = "기숙사비심의위원회를 만들어야 한다는 법이 생겼다던데, 지금 당장 설치해야 하나요?";
export const E25_QUESTION = "사립대인데 교원 연구년 제도를 새로 만들려고 해요. 법령상 근거 조항이 뭐예요?";

export const SIGNAL_RESULTS = {
  results: [
    {
      title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙」 입법예고",
      url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=107492&m=020402",
      hostname: "moe.go.kr",
      description: "고등교육법 시행령 개정. 10월 27일(화)부터 12월 7일(월)까지 41일간 입법 예고",
      date: "2026-10-27",
    },
    {
      title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙｣ 입법예고",
      url: "https://blog.naver.com/moeblog/224455227530",
      hostname: "blog.naver.com",
      description: "교육부 공식 블로그 재게시",
      date: "2026-10-27",
    },
    {
      title: "교육부 > 교육부 소식 > 공지사항",
      url: "https://www.moe.go.kr/boardCnts/listRenew.do?boardID=294",
      hostname: "moe.go.kr",
      description: "목록",
      date: "2026-11-05",
    },
    {
      title: "고등교육법 일부개정법률 공포",
      url: "https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=1",
      hostname: "law.go.kr",
      description: "고등교육법 일부개정 공포",
      date: "2026-11-10",
    },
  ],
};

function userText(call: RecordedCall): string {
  const msgs = call.body.messages as { role: string; content: string }[];
  return msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");
}

/** E22: 분석 → 신호 검색 → 시행일을 밝힌 답 */
export function e22Handler(call: RecordedCall) {
  if (call.path === "/tools/search/web") return { body: SIGNAL_RESULTS };
  const name = schemaName(call.body);
  if (name === "question_analysis") {
    return {
      body: chatBody({
        scene: "initiating",
        task: "기숙사비심의위원회 설치",
        concepts: ["기숙사비심의위원회", "기숙사비"],
        queries_cache: ["기숙사비심의위원회 설치", "기숙사비 심의 학생 위원", "2026-11-05 기숙사비"],
        queries_web: [],
        needs_external: false,
        needs_external_reason: "",
        school: "none",
      }),
    };
  }
  if (name === "grounded_answer") {
    if (!userText(call).includes("[heaf:011-02]")) throw new Error("후보 조문이 프롬프트에 없음");
    return {
      body: chatBody({
        verdict: "answered",
        summary: "아직 의무가 아닙니다. 고등교육법 제11조의2는 2027. 3. 11.부터 시행되므로 지금은 학칙 개정안을 준비하면 됩니다. 시행되면 학생 위원을 정수의 10분의 3 이상으로 둬야 합니다.",
        citations: [
          { id: "heaf:011-02", quote: "이 경우 전체 위원 정수의 10분의 3 이상을 학생 위원으로 구성하여야 한다.", role: "basis" },
          { id: "heaf:011-02", quote: "그 밖에 기숙사비심의위원회의 구성ㆍ운영에 필요한 사항은 학칙으로 정한다.", role: "delegation" },
          { id: "web:1", quote: "12월 7일(월)까지 41일간 입법 예고", role: "reference" },
        ],
        checklist: [
          { step: "기숙사비심의위원회 구성·운영 학칙 개정안 마련", deadline: "2027. 3. 11. 시행 전", basis_ids: ["heaf:011-02"] },
        ],
        caveats: ["구성·운영 세부는 학교별 학칙 확인"],
        searched_scope: { laws: [], queries: [], where_to_check: [] },
      }),
    };
  }
  throw new Error(`예상 밖 호출 ${call.path}`);
}

/** E25: 모델이 처음엔 없는 조를 지어내고, 재시도에도 원문에 없는 인용을 낸다 → 근거 없음 */
export function e25Handler(call: RecordedCall) {
  if (call.path === "/tools/search/web") return { body: { results: [] } };
  const name = schemaName(call.body);
  if (name === "question_analysis") {
    return {
      body: chatBody({
        scene: "initiating",
        task: "교원 연구년 제도 신설",
        concepts: ["연구년", "사립학교 교원", "연수"],
        queries_cache: ["사립학교 교원 연구년", "교원 연수 근무장소 외", "연구 휴가"],
        queries_web: [],
        needs_external: false,
        needs_external_reason: "",
        school: "none",
      }),
    };
  }
  if (name === "grounded_answer") {
    return {
      body: chatBody({
        verdict: "answered",
        summary: "사립학교법 제55조의4에 따라 연구년을 6개월 둘 수 있습니다.",
        citations: [
          { id: "pslaw:055-04", quote: "교원은 연구년을 받을 수 있다", role: "basis" },
          { id: "pslaw:055-03", quote: "교원은 6개월의 연구년을 받을 수 있다", role: "basis" },
        ],
        checklist: [],
        caveats: [],
        searched_scope: { laws: [], queries: [], where_to_check: [] },
      }),
    };
  }
  throw new Error(`예상 밖 호출 ${call.path}`);
}
