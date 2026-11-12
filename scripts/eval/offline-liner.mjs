// 오프라인 평가용 Liner 대역(--mock). 네트워크를 쓰지 않는다.
// 실제 파이프라인(lib/pipeline/run.ts)에 fetchImpl로 끼워 넣어 ②~⑤(캐시 검색·위임 사슬·상태 계산·코드 검증·카드·채점)를
// 키 없이 끝까지 돌리는 용도다. 모델 품질은 재지 않는다 — 통과율은 '검색·검증·카드 경로가 정답 조를 내놓는가'의 하한으로 본다.
//
//  - ① 질문 분석: 빈 응답을 돌려 파이프라인의 규칙 기반 대체가 돌게 한다
//  - ③ 대조·답변: 프롬프트의 후보 조문에서 질문과 가장 많이 겹치는 줄을 그대로 인용하는 추출식 답을 만든다
//  - Search: 평가 실행기는 tests/fixtures/search/ 고정 응답을 쓰므로 여기까지 오면 빈 결과
const STOP = new Set(["있나요", "하나요", "해요", "어떻게", "언제까지", "뭐예요", "지금", "있어요", "되나요", "법령상", "근거", "조항"]);

function bigrams(s) {
  const out = new Set();
  for (const w of String(s).replace(/[^0-9A-Za-z가-힣]+/g, " ").split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    for (let i = 0; i + 1 < w.length; i += 1) out.add(w.slice(i, i + 2));
  }
  return out;
}

function overlap(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** 프롬프트(buildAnswerUserMessage)에서 질문·기준일·후보 조문·웹 자료를 다시 읽는다 */
export function parseAnswerPrompt(text) {
  const question = text.match(/^질문: (.*)$/m)?.[1] ?? "";
  const asOf = text.match(/^기준일: (.*)$/m)?.[1] ?? "";
  const scene = text.match(/^장면: ([^/]+)/m)?.[1]?.trim() ?? "";
  const section = (name) => {
    const start = text.indexOf(`## ${name}`);
    if (start < 0) return "";
    const rest = text.slice(start);
    const next = rest.indexOf("\n## ", 3);
    return next < 0 ? rest : rest.slice(0, next);
  };
  const blocks = (body) =>
    body
      .split(/\n(?=\[[^\]\n]+\] )/)
      .map((b) => b.trim())
      .filter((b) => b.startsWith("["));
  const candidates = blocks(section("후보 조문")).map((b) => {
    const [head, ...lines] = b.split("\n");
    const id = head.match(/^\[([^\]]+)\]/)[1];
    return { id, head, lines: lines.filter((l) => l.trim()) };
  });
  const web = blocks(section("웹 자료")).map((b) => {
    const [head, ...lines] = b.split("\n");
    return { id: head.match(/^\[([^\]]+)\]/)[1], head, title: (lines.find((l) => l.startsWith("제목: ")) ?? "").slice(4) };
  });
  return { question, asOf, scene, candidates, web };
}

function koDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
}

/** 추출식 답(grounded_answer 스키마) */
export function extractiveAnswer(prompt) {
  const { question, candidates, web, scene } = parseAnswerPrompt(prompt);
  const qgrams = bigrams(question);
  const scored = candidates
    .map((c, order) => {
      let best = { line: c.lines[0] ?? "", score: -1 };
      for (const line of c.lines) {
        const s = overlap(qgrams, bigrams(line));
        if (s > best.score) best = { line, score: s };
      }
      return { ...c, order, best };
    })
    .filter((c) => c.best.line);
  // 검색 순서(점수 순)를 존중하되 질문과 전혀 안 겹치는 후보는 뺀다. 위임 사슬로 온 조는 근거 조와 함께 둔다
  const picked = scored.filter((c) => c.best.score > 0).slice(0, 3);
  const notYet = picked
    .map((c) => c.head.match(/(\d{4})\. (\d{1,2})\. (\d{1,2})\. 시행 예정/))
    .filter(Boolean)
    .map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  const proposal = web.find((w) => /입법예고\(확정 전\)/.test(w.head));
  const citations = picked.map((c, i) => ({
    id: c.id,
    quote: c.best.line.replace(/\s*<[^>]*>\s*$/, "").trim(),
    role: i === 0 ? "basis" : /위임 사슬로 찾음/.test(c.head) ? "delegation" : "reference",
  }));
  if (proposal) citations.push({ id: proposal.id, quote: proposal.title, role: "reference" });
  const lawCitations = citations.filter((c) => !c.id.startsWith("web:"));
  if (!lawCitations.length) {
    return {
      verdict: "no_basis",
      summary: "오프라인 대체 답: 질문에 직접 답하는 근거를 후보 조문에서 찾지 못했습니다. 학칙·정관 등 학교 규정을 확인해야 합니다.",
      citations: [],
      checklist: [],
      caveats: ["모델을 부르지 않은 오프라인 대체 답입니다."],
      searched_scope: { laws: [], queries: [], where_to_check: ["학칙·학교 규정", "학교법인 정관"] },
    };
  }
  const parts = [`오프라인 대체 답: ${citations.map((c) => c.quote).join(" / ")}`];
  for (const d of notYet) parts.push(`${koDate(d)}부터 시행 예정이라 기준일 현재는 적용되지 않습니다.`);
  if (proposal) parts.push("입법예고 중인 개정안은 확정 전입니다.");
  return {
    verdict: "partial",
    summary: parts.join(" "),
    citations,
    checklist: scene.startsWith("업무 시작") ? [{ step: "근거 조문 확인", deadline: "", basis_ids: [lawCitations[0].id] }] : [],
    caveats: ["모델을 부르지 않은 오프라인 대체 답입니다."],
    searched_scope: { laws: [], queries: [], where_to_check: [] },
  };
}

const ZERO_USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } };

/** runPipeline의 fetchImpl로 넣는다. calls에 요청 경로가 쌓인다(네트워크 없음) */
export function createOfflineLiner() {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let out = { results: [] };
    if (path === "/chat/completions") {
      const name = body.response_format?.json_schema?.name;
      const user = (body.messages ?? []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const content = name === "grounded_answer" ? JSON.stringify(extractiveAnswer(user)) : "";
      out = {
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: ZERO_USAGE,
      };
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}
