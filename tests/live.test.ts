// 실제 Liner API로 질문 몇 개를 돌려 보는 확인용 시험. 기본은 건너뛴다.
// 실행: GEUNGEO_LIVE=1 과 LINER_API_KEY를 환경에 두고 npx vitest run tests/live.test.ts
// 출력에는 요약과 호출 수·금액만 남기고 키는 찍지 않는다. 캐시는 ③의 data가 오기 전까지 시험용 픽스처다.
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linerRequest } from "@/lib/liner/client";
import { runPipeline } from "@/lib/pipeline/run";
import type { AskResult } from "@/lib/pipeline/types";
import { buildTestCache } from "./support/cache";

const LIVE = process.env.GEUNGEO_LIVE === "1";
const IDS = (process.env.GEUNGEO_LIVE_IDS ?? "E22,E25,E24").split(",");

const QUESTIONS: Record<string, string> = {
  E22: "기숙사비심의위원회를 만들어야 한다는 법이 생겼다던데, 지금 당장 설치해야 하나요?",
  E25: "사립대인데 교원 연구년 제도를 새로 만들려고 해요. 법령상 근거 조항이 뭐예요?",
  E24: "등심위 규정을 손보는 중인데, 곧 바뀌는 법령이 있나요? 전문가 위원 임기를 제한해야 하나요?",
  E23: "다음 수시 면접에 외부 평가위원을 위촉하려는데, 지원자랑 친족이면 빼야 하는 규정이 외부 위원에게도 적용돼요?",
};

/** GEUNGEO_LIVE_OUT에 파일 경로를 주면 요약을 그 파일에도 덧붙인다(vitest가 통과한 시험의 출력을 숨길 때) */
function report(text: string) {
  console.log(text);
  if (process.env.GEUNGEO_LIVE_OUT) appendFileSync(process.env.GEUNGEO_LIVE_OUT, `${text}\n`);
}

let httpCalls = 0;
const realFetch = globalThis.fetch;
const countingFetch: typeof fetch = (input, init) => {
  httpCalls += 1;
  return realFetch(input, init);
};

interface UsageBody {
  summary?: unknown;
}

async function usage(): Promise<UsageBody> {
  const res = await linerRequest<UsageBody>("GET", "/credits/usage", undefined, "x-api-key", { fetchImpl: countingFetch });
  return res.body;
}

function brief(id: string, r: AskResult) {
  return {
    id,
    verdict: r.verdict,
    scene: r.scene,
    summary: r.summary,
    cards: r.cards.map((c) => `${c.id} ${c.grade} ${c.role} ${c.badge} ${c.location ?? ""} | ${c.quote.slice(0, 60)}`),
    signals: r.change_signals.map(
      (s) => `${s.kind} ${s.hostname} ${s.date} ${s.opinion_deadline ?? ""} after=${s.after_collection} | ${s.title.slice(0, 40)}`,
    ),
    checklist: r.checklist.map((c) => `${c.step} / ${c.deadline ?? ""} / ${c.basis_ids.join(",")}`),
    caveats: r.caveats,
    warnings: r.warnings,
    issues: r.verification.issues.map((i) => `${i.kind} ${i.citation_id ?? ""}`),
    retried: r.verification.retried,
    retry_reasons: r.verification.retry_reasons,
    scope: r.searched_scope,
    calls: r.trace.calls.map(
      (c) =>
        `${c.stage} ${c.api} ${c.http_status ?? "-"} ${c.duration_ms}ms $${c.usage?.cost_usd ?? 0} ${
          c.usage ? `${c.usage.prompt_tokens}/${c.usage.completion_tokens}(r${c.usage.reasoning_tokens})` : ""
        } ${c.query ?? ""} ${c.note ?? ""}`,
    ),
    total_ms: r.trace.total_duration_ms,
    total_cost_usd: r.trace.total_cost_usd,
  };
}

describe.skipIf(!LIVE)("실제 Liner 호출", () => {
  const cache = buildTestCache();
  let before: UsageBody = {};

  beforeAll(async () => {
    before = await usage();
  });

  afterAll(async () => {
    const after = await usage();
    report(JSON.stringify({ http_calls: httpCalls, usage_before: before.summary, usage_after: after.summary }, null, 1));
  });

  for (const id of IDS) {
    it(id, { timeout: 120_000 }, async () => {
      const result = await runPipeline({ question: QUESTIONS[id], asOf: "2026-11-05" }, { cache, fetchImpl: countingFetch });
      const text = JSON.stringify(brief(id, result), null, 1);
      expect(text).not.toContain(process.env.LINER_API_KEY ?? "@@none@@");
      report(text);
    });
  }
});
