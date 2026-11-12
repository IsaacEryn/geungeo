// 단위 시험용 LawCache. ③의 loadCache가 생기기 전까지 data/examples/와 작은 픽스처(laws.fixture.json)로 만든다.
import type { LawCache } from "@/lib/cache/load";
import type { LawArticle, LawDocument, Manifest, ManifestEntry, Overrides, Synonyms } from "@/lib/cache/schema";
import heafExample from "@/data/examples/heaf.example.json";
import manifestExample from "@/data/examples/manifest.example.json";
import overridesExample from "@/data/examples/overrides.example.json";
import fixture from "./laws.fixture.json";

export const COLLECTED_AT = "2026-11-05T00:27:00+09:00";

export const TEST_SYNONYMS: Synonyms = {
  schema_version: 1,
  groups: [
    ["등심위", "등록금심의위원회"],
    ["연구년", "연구 휴가"],
    ["쉬는 학기", "휴학"],
  ],
};

function entryFor(law: LawDocument): ManifestEntry {
  const school = law.kind === "school_rule";
  return {
    id: law.law_id,
    name: law.law_name,
    kind: law.kind,
    ...(law.school ? { school: law.school } : {}),
    editions: [],
    collected_at: COLLECTED_AT,
    method: "html",
    source_url: law.articles[0]?.versions[0]?.source_url ?? "https://www.law.go.kr/",
    attribution: school ? `출처: ${law.law_name}(시험용), 법제처 국가법령정보센터 게재본` : "출처: 법제처 국가법령정보센터",
    redistribution: school ? "시험용" : "저작권법 제7조제1호",
    storage: "file",
  };
}

/** options.withSchoolRules가 false면 학칙을 캐시에서 뺀다 */
export function buildTestCache(options: { withSchoolRules?: boolean } = {}): LawCache {
  const base = heafExample as LawDocument;
  const extra = (fixture as { laws: LawDocument[] }).laws;
  const laws = new Map<string, LawDocument>();
  for (const doc of [base, ...extra]) {
    if (doc.kind === "school_rule" && options.withSchoolRules === false) continue;
    const prev = laws.get(doc.law_id);
    if (prev) laws.set(doc.law_id, { ...prev, articles: [...prev.articles, ...doc.articles] });
    else laws.set(doc.law_id, structuredClone(doc));
  }
  const articles = new Map<string, LawArticle>();
  for (const law of laws.values()) for (const a of law.articles) articles.set(a.id, a);
  const exampleManifest = manifestExample as Manifest;
  const entries = [...exampleManifest.entries, ...[...laws.values()].filter((l) => l.law_id !== "heaf").map(entryFor)];
  return {
    manifest: { ...exampleManifest, entries },
    laws,
    articles,
    overrides: overridesExample as Overrides,
    synonyms: TEST_SYNONYMS,
    collectedAt: COLLECTED_AT,
  };
}
