// 평가 자동 채점(설계 9-1). 코드만으로 판정한다 — 모델 채점은 보조.
// 입력: eval/questions.jsonl의 문항 하나, runPipeline의 AskResult(lib/pipeline/types.ts)
// 출력: 항목별 결과와 통과 여부. 학칙 조 일치는 따로 세고 기본 통과 조건에는 넣지 않는다(학칙 처리 방식 결정 전).

/** 공백을 지운 비교용 문자열 */
const squash = (s) => String(s ?? "").replace(/\s+/g, "");

/** "a|b|c" 대안 중 하나라도 본문에 있으면 참 */
export function includesAny(corpus, spec) {
  const body = squash(corpus);
  return spec.split("|").some((alt) => alt && body.includes(squash(alt)));
}

const NOT_YET = /시행\s*예정|아직|시행\s*전|부터\s*시행|시행되지|시행된다|효력이\s*없/;
const PROPOSED = /입법\s*예고|확정\s*전|개정안|확정되지|의견\s*제출/;
const NO_BASIS_PHRASE = /직접\s*(?:적인\s*)?근거.{0,8}(?:없|찾지\s*못)|근거\s*(?:가|는)?\s*없|정한\s*(?:조항|규정)이\s*없|법정\s*기준은\s*없/;

/** 결론·체크리스트·확인 사항(인용문 제외) */
export function answerText(result) {
  const parts = [result.summary];
  for (const c of result.checklist ?? []) parts.push(c.step, c.deadline ?? "");
  parts.push(...(result.caveats ?? []), ...(result.warnings ?? []));
  return parts.filter(Boolean).join("\n");
}

/** 결론 + 근거 카드 인용문 */
export function fullText(result) {
  return [answerText(result), ...(result.cards ?? []).map((c) => c.quote)].join("\n");
}

/** AskResult 모양이 맞는지(형식 오류 판정). 문제 목록 */
export function shapeProblems(result) {
  const p = [];
  if (!result || typeof result !== "object") return ["결과가 객체가 아님"];
  if (!["answered", "partial", "no_basis"].includes(result.verdict)) p.push("verdict");
  if (typeof result.summary !== "string") p.push("summary");
  if (!Array.isArray(result.cards)) p.push("cards");
  if (!result.verification || typeof result.verification.removed_citations !== "number") p.push("verification");
  if (!result.trace || !Array.isArray(result.trace.calls)) p.push("trace");
  return p;
}

/**
 * 문항 하나 채점
 * @param {object} q eval/questions.jsonl 레코드
 * @param {object} result AskResult
 * @param {{ strictSchool?: boolean }} [opts]
 * @returns {{ pass: boolean; format_error: boolean; problems: string[]; checks: Record<string, any> }}
 */
export function scoreOne(q, result, opts = {}) {
  const shape = shapeProblems(result);
  if (shape.length) return { pass: false, format_error: true, problems: shape, checks: {} };

  const cardIds = new Set(result.cards.map((c) => c.id));
  const checks = {};

  // 1. 근거 조문 일치(조) · 세부 위치 일치(항·호·목)
  const required = [...q.article_ids, ...(opts.strictSchool && q.school ? q.school_article_ids : [])];
  const missing = required.filter((id) => !cardIds.has(id));
  checks.article = { applicable: required.length > 0, pass: missing.length === 0, missing };
  const locHits = q.locations.filter((l) => result.cards.some((c) => c.id === l.id && squash(c.location).startsWith(squash(l.location))));
  checks.location = { applicable: q.locations.length > 0, pass: locHits.length === q.locations.length, hit: locHits.length, of: q.locations.length };
  const schoolHits = q.school_article_ids.filter((id) => cardIds.has(id));
  checks.school_article = { applicable: Boolean(q.school) && q.school_article_ids.length > 0, counted: Boolean(opts.strictSchool), hit: schoolHits.length, of: q.school_article_ids.length };

  // 2. 판정 일치
  const text = answerText(result);
  if (q.expected_verdict === "no_basis") {
    const ok = result.verdict === "no_basis" || (result.verdict === "partial" && NO_BASIS_PHRASE.test(text));
    checks.verdict = { applicable: true, pass: ok, got: result.verdict };
  } else {
    checks.verdict = { applicable: true, pass: result.verdict === "answered" || result.verdict === "partial", got: result.verdict };
  }

  // 3. 시행일 함정
  if (q.trap?.kind === "not_yet") {
    const [y, m, d] = q.trap.date.split("-").map(Number);
    const dateSpec = `${y}. ${m}. ${d}.|${q.trap.date}|${y}년 ${m}월 ${d}일|${y}.${m}.${d}`;
    checks.trap = { applicable: true, pass: includesAny(text, dateSpec) && NOT_YET.test(text), kind: "not_yet" };
  } else if (q.trap?.kind === "proposed") {
    checks.trap = { applicable: true, pass: PROPOSED.test(text), kind: "proposed" };
  } else {
    checks.trap = { applicable: false, pass: true };
  }

  // 4. 지어낸 인용 0건(④ 검증에서 지운 인용 수)
  const removed = result.verification.removed_citations;
  checks.fabricated = { applicable: true, pass: removed === 0, removed };

  // 5. 핵심 숫자·표현
  const corpus = fullText(result);
  const absent = q.must_include.filter((spec) => !includesAny(corpus, spec));
  checks.must_include = { applicable: q.must_include.length > 0, pass: absent.length === 0, missing: absent };

  const counted = ["article", "verdict", "trap", "fabricated", "must_include"];
  const pass = counted.every((k) => !checks[k].applicable || checks[k].pass);
  return { pass, format_error: false, problems: [], checks };
}
