// Liner Search(search/web) 호출. include_knowledge:false를 늘 넣는다(11/11부터 Premium Data 기본, 빠지면 단가 2배).
// 평가 실행기·오프라인 시험은 fixtureDir의 고정 응답을 쓴다(파일 이름 규칙은 fixtureFileName).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { linerRequest, type LinerCallOptions } from "./client";

export type DateRange = "past_day" | "past_week" | "past_month" | "past_year";

export interface SearchQuery {
  query: string;
  date_range?: DateRange;
  max_results?: number;
}

/** Search 응답의 결과 하나(문서 형식 그대로) */
export interface RawSearchResult {
  title: string;
  url: string;
  hostname: string;
  faviconUrl?: string;
  description: string;
  date: string | null;
}

export interface SearchResponse {
  results: RawSearchResult[];
  status: number | undefined; // fixture면 undefined
  duration_ms: number;
  source: "live" | "fixture" | "fixture_missing";
}

/** fixture 파일 이름: 검색어와 date_range로 만든 해시 16자리 + .json. 내용은 Search 응답 본문 그대로({results:[...]}) */
export function fixtureFileName(q: SearchQuery): string {
  const key = JSON.stringify({ query: q.query.trim(), date_range: q.date_range ?? null });
  return `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`;
}

export function searchRequestBody(q: SearchQuery) {
  const body: Record<string, unknown> = {
    query: q.query,
    lang: "ko",
    country_code: "kr",
    max_results: q.max_results ?? 20,
    include_knowledge: false,
  };
  if (q.date_range) body.date_range = q.date_range;
  return body;
}

function sanitize(results: unknown): RawSearchResult[] {
  if (!Array.isArray(results)) return [];
  const out: RawSearchResult[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.url !== "string") continue;
    let hostname = typeof o.hostname === "string" ? o.hostname : "";
    if (!hostname) {
      try {
        hostname = new URL(o.url).hostname;
      } catch {
        continue;
      }
    }
    const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
    out.push({
      title: typeof o.title === "string" ? o.title : "",
      url: o.url,
      hostname: hostname.toLowerCase(),
      description: typeof o.description === "string" ? o.description : "",
      date,
    });
  }
  return out;
}

export interface SearchOptions extends LinerCallOptions {
  fixtureDir?: string;
}

export async function searchWeb(q: SearchQuery, options: SearchOptions = {}): Promise<SearchResponse> {
  if (options.fixtureDir) {
    const file = path.join(options.fixtureDir, fixtureFileName(q));
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as { results?: unknown };
      return { results: sanitize(raw.results), status: undefined, duration_ms: 0, source: "fixture" };
    } catch {
      return { results: [], status: undefined, duration_ms: 0, source: "fixture_missing" };
    }
  }
  const res = await linerRequest<{ results?: unknown }>("POST", "/tools/search/web", searchRequestBody(q), "x-api-key", {
    timeoutMs: 20_000,
    ...options,
  });
  return { results: sanitize(res.body.results), status: res.status, duration_ms: res.duration_ms, source: "live" };
}
