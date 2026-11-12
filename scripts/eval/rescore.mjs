#!/usr/bin/env node
// 저장된 results.jsonl을 지금 채점 코드(score.mjs)로 다시 매긴다. 모델·Search는 부르지 않는다.
//
//   node scripts/eval/rescore.mjs <results.jsonl> [--strict-school]
//
// results.jsonl에는 결론(summary)·판정·카드 ID·지운 인용 수만 남아 있고 카드 인용문·확인 사항·체크리스트는 없다.
// 그래서 저장된 값만으로 다시 셀 수 있는 항목(근거 조, 판정, 지어낸 인용)만 새로 매기고,
// 나머지(세부 위치, 시행일 함정, 핵심 표현)는 저장된 채점 결과를 그대로 쓴다.
// 판정은 저장된 결과가 통과였으면 통과로 둔다(새 문구 규칙은 옛 규칙을 넓히기만 하므로 전체 글로 통과한 것은 새 규칙으로도 통과).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadQuestions, summarize } from "./run.mjs";
import { scoreOne } from "./score.mjs";

const RECOUNTED = ["article", "verdict", "fabricated"];

export function rescoreRow(q, row, opts = {}) {
  const partial = {
    verdict: row.verdict,
    summary: row.summary ?? "",
    cards: (row.card_ids ?? []).map((id) => ({ id, location: "", quote: "" })),
    checklist: [],
    caveats: [],
    warnings: [],
    verification: { removed_citations: row.removed_citations ?? 0 },
    trace: { calls: [] },
  };
  if (row.format_error || !row.verdict) return { ...row };
  const fresh = scoreOne(q, partial, opts);
  const checks = { ...row.checks };
  for (const k of RECOUNTED) checks[k] = fresh.checks[k];
  if (row.checks?.verdict?.pass) checks.verdict = { ...fresh.checks.verdict, pass: true };
  const counted = ["article", "verdict", "trap", "fabricated", "must_include"];
  const pass = counted.every((k) => !checks[k] || !checks[k].applicable || checks[k].pass);
  return { ...row, checks, pass };
}

export function rescore(path, opts = {}) {
  const questions = loadQuestions();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const fresh = rows.map((r) => rescoreRow(byId.get(r.id), r, opts));
  return { before: summarize(rows, questions), after: summarize(fresh, questions), changed: fresh.filter((r, i) => r.pass !== rows[i].pass).map((r) => `${r.id}#${r.repeat} ${rows.find((x) => x.id === r.id && x.repeat === r.repeat).pass ? "통과→실패" : "실패→통과"}`) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [path, ...rest] = process.argv.slice(2);
  if (!path) {
    console.error("사용법: node scripts/eval/rescore.mjs <results.jsonl> [--strict-school]");
    process.exitCode = 1;
  } else {
    const { before, after, changed } = rescore(path, { strictSchool: rest.includes("--strict-school") });
    const line = (s) => `${s.passed}/${s.runs} (${(s.pass_rate * 100).toFixed(1)}%), 근거 없음 ${s.no_basis.passed}/${s.no_basis.of}, 함정 ${s.traps.passed}/${s.traps.of}`;
    console.log(`저장된 채점: ${line(before)}`);
    console.log(`지금 채점:   ${line(after)}`);
    console.log(`바뀐 문항: ${changed.length ? changed.join(", ") : "없음"}`);
  }
}
