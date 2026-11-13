// 평가 실행기 자체를 시험하는 목 파이프라인. Liner를 부르지 않는다.
// ①의 runPipeline이 생기기 전까지 실행기·채점·비용 집계·크레딧 상한이 도는지 보는 용도다.
// 문항 정답 요지로 '그럴듯한' AskResult를 만들되, 일부러 틀린 답·형식 오류를 섞는다(문항 ID 해시로 고정).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadQuestions() {
  return readFileSync(join(ROOT, "eval/questions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => JSON.parse(l));
}

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

/**
 * @param {import("../../lib/pipeline/types").AskRequest} request
 * @param {{ models?: { analyze?: string; answer?: string }; mode?: string }} options
 */
export async function runPipeline(request, options = {}) {
  const q = loadQuestions().find((x) => x.question === request.question);
  if (!q) throw new Error("mock: 모르는 질문");
  const h = hash(`${q.id}:${options.models?.answer ?? ""}`);
  const kind = h % 10; // 0: 형식 오류, 1: 근거 하나 빠뜨림, 2: 지어낸 인용 1건, 나머지: 정답
  if (kind === 0) throw new TypeError("mock: 형식 오류");

  const ids = kind === 1 ? q.article_ids.slice(1) : q.article_ids;
  const cards = ids.map((id) => {
    const loc = q.locations.find((l) => l.id === id)?.location;
    return {
      id,
      grade: "L1",
      role: "basis",
      title: id,
      location: loc ?? "",
      quote: "",
      badge: q.trap?.kind === "not_yet" ? "not_yet" : "in_force",
      amend_tags: [],
      source_url: "https://www.law.go.kr/",
      attribution: "출처: 법제처 국가법령정보센터",
      changed_after_collection: false,
      notes: [],
    };
  });
  const verdict = q.expected_verdict === "no_basis" ? "no_basis" : "answered";
  const promptTokens = 1500 + (h % 700);
  const completionTokens = 300 + (h % 200);
  const usage = (p, c) => ({ prompt_tokens: p, completion_tokens: c, reasoning_tokens: Math.floor(c / 2), cost_usd: 0 });
  const model = options.models?.answer ?? "liner-mark-1.3";
  return {
    request: { question: request.question, asOf: request.asOf, school: request.school ?? null, mode: options.mode ?? "fixed" },
    data_collected_at: "2026-11-13T01:09:56+09:00",
    scene: "processing",
    verdict,
    summary: q.answer_summary,
    cards,
    checklist: [],
    caveats: [],
    change_signals: [],
    searched_scope: null,
    warnings: [],
    verification: { issues: [], removed_citations: kind === 2 ? 1 : 0, retried: false, retry_reasons: [], verdict_before: verdict, verdict_after: verdict },
    trace: {
      calls: [
        { stage: "analyze", api: "router", model: options.models?.analyze ?? "liner-mark-1.3", duration_ms: 3000, usage: usage(400, 200) },
        { stage: "collect_web", api: "search", query: "mock", duration_ms: 2500 },
        ...(q.needs_liner_search ? [{ stage: "collect_signals", api: "search", query: "mock", duration_ms: 2500 }] : []),
        { stage: "answer", api: "router", model, duration_ms: 6000 + (h % 3000), usage: usage(promptTokens, completionTokens) },
      ],
      total_duration_ms: 12000,
      total_cost_usd: 0,
      models: { analyze: options.models?.analyze ?? "liner-mark-1.3", answer: model },
    },
  };
}
