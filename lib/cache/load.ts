// data/를 읽는 유일한 입구. 파이프라인은 data/ 파일을 직접 열지 않는다(설계 6절 경계).
// 학칙은 시연·평가에 쓰는 조·항만 data/rules/에 담아 파일로 읽는다(설계 4-1). 앱 실행 중에는 law.go.kr을 부르지 않는다.
// remote(law.go.kr 공개 화면에서 받기)는 수집기 개발·점검용으로만 남겼고, allowRemote: true를 줄 때만 돈다.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildAddendumDocument,
  buildLawDocument,
  parseLawPage,
  validateLawDocument,
  validateManifest,
  validateOverrides,
  validateSynonyms,
} from "./lawdata";
import type { IsoDate, IsoDateTime, LawArticle, LawDocument, Manifest, ManifestEntry, Overrides, SchoolId, Synonyms } from "./schema";

/**
 * data/notices.json — 교육부 공고·안내(E16형) 캐시. 공고명·대상 연도·원문 URL·게시일·공고 기관과,
 * moe.go.kr 원문 HTML(또는 교육부 synap 미리보기 HTML)에서 직접 확인한 수치만 둔다(설계 4-1).
 * 원문에서 수치를 찾지 못한 항목은 status "needs_source_check"로 두고 figures를 비운다. 언론 보도 수치는 넣지 않는다.
 * 문장 발췌(excerpt)는 공공누리 제1유형 표시를 확인한 것만 둔다(설계 4-1·5-1).
 */
export interface NoticeFigure {
  label: string; // 무엇의 수치인지, 예 "2026학년도 1학기 국가장학금 1차 신청 시작"
  value: string; // 원문 표기 그대로, 예 "11. 20.(목) 9시"
  unit?: string; // "%", "배" 등(값에 이미 있으면 생략)
  location: string; // 원문 안 위치, 예 "본문 둘째 문단" "첨부 미리보기 1쪽 표"
  checked_url: string; // 수치를 확인한 HTML 주소(게시글 또는 moe.go.kr/upload/synap/… 미리보기)
}

export interface NoticeEntry {
  id: string; // "moe-tuition-cap-2026"
  title: string; // 공고명 원문
  issuer: string; // 공고 기관, 예 "교육부"
  year: number | null; // 대상 학년도
  url: string; // 원문 게시글 URL(https)
  posted: IsoDate | null; // 게시일
  /** 연결되는 평가 문항(예 ["E16"]) */
  questions?: string[];
  /** 수치를 원문에서 확인했으면 "checked", 못 했으면 "needs_source_check"(figures는 빈 배열). 없으면 checked로 본다 */
  status?: "checked" | "needs_source_check";
  /** 원문에서 직접 확인한 수치(문장 발췌가 아님) */
  figures?: NoticeFigure[];
  /** 확인하지 못한 이유·확인할 곳 등 메모 */
  note?: string;
  /** 저작권 메모, 예 "저작권법 제7조제2호(국가의 고시·공고·훈령 그 밖에 이와 유사한 것)" */
  redistribution?: string;
  excerpt: string | null; // 짧은 문장 발췌. kogl_type1_confirmed가 true일 때만
  kogl_type1_confirmed: boolean; // 공공누리 제1유형 표시를 사람이 확인했는지
  collected_at: IsoDateTime;
}

export interface NoticeCache {
  schema_version: 1;
  notices: NoticeEntry[];
}

export interface LawCache {
  manifest: Manifest;
  /** law_id → 법령 */
  laws: Map<string, LawDocument>;
  /** 조 ID("heaf:011-02") → 조 */
  articles: Map<string, LawArticle>;
  overrides: Overrides;
  synonyms: Synonyms;
  /** manifest 항목 중 가장 이른 수집 시각(화면 "데이터 수집일") */
  collectedAt: string;
  /** data/notices.json(없으면 빈 목록). loadCache는 항상 채운다 */
  notices?: NoticeCache;
  /** 읽기는 됐지만 알릴 것(예: 학칙 파일 없음). loadCache는 항상 채운다 */
  warnings?: string[];
}

export interface LoadOptions {
  /** data/ 폴더 위치. 기본은 <프로젝트>/data */
  dataDir?: string;
  /** 학칙 읽는 방식. file = data/rules/(앱 기본), remote = law.go.kr 공개 화면에서 받기(수집기 개발용). 기본은 manifest의 storage 값 */
  rules?: "file" | "remote";
  /** remote 학칙 받기를 허용한다(수집기 개발·점검용). 앱 실행 경로는 주지 않는다 — 없으면 remote여도 law.go.kr을 부르지 않고 null */
  allowRemote?: boolean;
  /** 메모해 둔 캐시를 버리고 다시 읽기 */
  reload?: boolean;
  /** remote 모드에서 쓸 fetch(시험용 주입). 기본은 전역 fetch */
  fetchImpl?: typeof fetch;
  /** remote 모드 요청 제한 시간(ms). 기본 10000 */
  timeoutMs?: number;
}

export class CacheFormatError extends Error {
  constructor(public readonly problems: string[]) {
    super(`data/ 형식 오류 ${problems.length}건: ${problems.slice(0, 5).join(" / ")}`);
    this.name = "CacheFormatError";
  }
}

const defaultDataDir = () => join(process.cwd(), "data");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonIfExists<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

const MOE_HTML = /^https:\/\/(www\.)?moe\.go\.kr\//;

export function validateNotices(n: NoticeCache): string[] {
  const errs: string[] = [];
  if (n.schema_version !== 1) errs.push("notices schema_version");
  const ids = new Set<string>();
  for (const x of n.notices ?? []) {
    if (!x.id || !x.title || !/^https:\/\//.test(x.url)) errs.push(`notices ${x.id}: id·title·https url 필요`);
    if (ids.has(x.id)) errs.push(`notices ${x.id}: id 중복`);
    ids.add(x.id);
    if (!x.issuer) errs.push(`notices ${x.id}: issuer(공고 기관) 필요`);
    if (x.posted !== null && !/^\d{4}-\d{2}-\d{2}$/.test(x.posted)) errs.push(`notices ${x.id}: posted는 YYYY-MM-DD`);
    if (x.excerpt && !x.kogl_type1_confirmed) errs.push(`notices ${x.id}: 공공누리 제1유형 확인 없이 발췌를 둘 수 없음`);
    const figures = x.figures ?? [];
    if (x.status === "needs_source_check" && figures.length) errs.push(`notices ${x.id}: 원문 확인 필요 항목에 수치를 둘 수 없음`);
    for (const f of figures) {
      if (!f.label || !f.value || !f.location) errs.push(`notices ${x.id}: 수치에 label·value·location 필요`);
      if (!MOE_HTML.test(f.checked_url) || /\.(hwpx?|pdf)(\?|$)/i.test(f.checked_url)) errs.push(`notices ${x.id}: 수치는 moe.go.kr 원문 HTML에서 확인한 것만(${f.checked_url})`);
    }
  }
  return errs;
}

/** 지금 쓸 수 있는 공고(원문 확인된 것)만. 대상 연도를 주면 그 연도만 */
export function checkedNotices(cache: Pick<LawCache, "notices">, year?: number): NoticeEntry[] {
  return (cache.notices?.notices ?? []).filter((x) => (x.status ?? "checked") === "checked" && (year === undefined || x.year === year));
}

/** 학칙 파일(data/rules/<id>.json, 부칙은 <id>_a<번호>.json)을 읽는다. 없으면 빈 배열 */
async function readRuleFiles(dataDir: string, entry: ManifestEntry): Promise<LawDocument[]> {
  const dir = join(dataDir, "rules");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const mine = names.filter((n) => n === `${entry.id}.json` || (n.startsWith(`${entry.id}_a`) && n.endsWith(".json")));
  return Promise.all(mine.map((n) => readJson<LawDocument>(join(dir, n))));
}

const memo = new Map<string, Promise<LawCache>>();

/** data/ 전체를 읽어 메모리에 올린다. 같은 옵션이면 한 번 읽은 것을 재사용한다(reload로 다시 읽기) */
export function loadCache(options: LoadOptions = {}): Promise<LawCache> {
  const dataDir = options.dataDir ?? defaultDataDir();
  const key = `${dataDir}|${options.rules ?? ""}`;
  if (!options.reload && memo.has(key)) return memo.get(key)!;
  const p = readCache(dataDir, options);
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

async function readCache(dataDir: string, options: LoadOptions): Promise<LawCache> {
  const manifest = await readJson<Manifest>(join(dataDir, "manifest.json"));
  const overrides = await readJsonIfExists<Overrides>(join(dataDir, "overrides.json"), { schema_version: 1, overrides: [] });
  const synonyms = await readJsonIfExists<Synonyms>(join(dataDir, "synonyms.json"), { schema_version: 1, groups: [] });
  const notices = await readJsonIfExists<NoticeCache>(join(dataDir, "notices.json"), { schema_version: 1, notices: [] });

  const problems = [...validateManifest(manifest), ...validateOverrides(overrides), ...validateSynonyms(synonyms), ...validateNotices(notices)];
  const warnings: string[] = [];
  const laws = new Map<string, LawDocument>();

  for (const entry of manifest.entries) {
    if (entry.kind === "school_rule") {
      const mode = options.rules ?? entry.storage;
      if (mode !== "file") continue; // remote: loadSchoolRules가 실행 때 받는다
      const docs = await readRuleFiles(dataDir, entry);
      if (docs.length === 0) warnings.push(`${entry.name}: data/rules/에 파일이 없음(학칙 확인 필요로 표시)`);
      for (const d of docs) laws.set(d.law_id, d);
      continue;
    }
    if (entry.storage !== "file" || !entry.path) continue;
    const doc = await readJson<LawDocument>(join(dataDir, entry.path));
    if (doc.law_id !== entry.id) problems.push(`${entry.path}: law_id ${doc.law_id} ≠ manifest id ${entry.id}`);
    laws.set(doc.law_id, doc);
  }

  const articles = new Map<string, LawArticle>();
  for (const doc of laws.values()) {
    problems.push(...validateLawDocument(doc));
    for (const a of doc.articles) {
      if (articles.has(a.id)) problems.push(`조 ID 중복: ${a.id}`);
      articles.set(a.id, a);
    }
  }

  // overrides가 가리키는 조가 실제로 있고, 그 시행일 판이 있는지(읽은 법령에 한해)
  for (const o of overrides.overrides) {
    const lawId = o.article_id.split(":")[0];
    if (!laws.has(lawId)) continue; // 학칙 등 이번에 읽지 않은 문서
    const a = articles.get(o.article_id);
    if (!a) {
      problems.push(`overrides: 없는 조 ${o.article_id}`);
      continue;
    }
    if (o.effective_from && !a.versions.some((v) => v.effective_from === o.effective_from)) {
      problems.push(`overrides: ${o.article_id}에 ${o.effective_from} 시행 판이 없음(수집기를 다시 돌려야 함)`);
    }
  }
  // 위임 연결 대상이 캐시에 있는지
  for (const a of articles.values()) {
    for (const l of a.links) {
      if (l.target.kind === "article" && !articles.has(l.target.article_id)) problems.push(`${a.id}: 위임 대상 조 없음 ${l.target.article_id}`);
    }
  }

  if (problems.length) throw new CacheFormatError(problems);

  const collectedAt = manifest.entries.map((e) => e.collected_at).sort()[0] ?? manifest.generated_at;
  return { manifest, laws, articles, overrides, synonyms, collectedAt, notices, warnings };
}

// ───────── 학칙 ─────────

export interface SchoolRuleBundle {
  rules: LawDocument;
  /** 학칙 부칙(예: 방송대 학칙 부칙<제1315호>). remote 모드면 화면의 모든 부칙 */
  addenda: LawDocument[];
  entry: ManifestEntry;
  storage: "file" | "remote";
}

const remoteMemo = new Map<string, Promise<SchoolRuleBundle | null>>();

/** 지정 학교의 학칙을 읽는다. 수록·받기 모두 실패하면 null(답에는 "학칙 확인 필요"로 표시) */
export async function loadSchoolRules(school: SchoolId, options: LoadOptions = {}): Promise<LawDocument | null> {
  return (await loadSchoolRuleBundle(school, options))?.rules ?? null;
}

/** 학칙과 그 부칙을 함께 읽는다(시행일 판단에 부칙이 필요할 때) */
export async function loadSchoolRuleBundle(school: SchoolId, options: LoadOptions = {}): Promise<SchoolRuleBundle | null> {
  const dataDir = options.dataDir ?? defaultDataDir();
  let manifest: Manifest;
  let overrides: Overrides;
  try {
    manifest = await readJson<Manifest>(join(dataDir, "manifest.json"));
    overrides = await readJsonIfExists<Overrides>(join(dataDir, "overrides.json"), { schema_version: 1, overrides: [] });
  } catch {
    return null;
  }
  const entry = manifest.entries.find((e) => e.kind === "school_rule" && e.school === school);
  if (!entry) return null;
  const mode = options.rules ?? entry.storage;

  if (mode === "file") {
    try {
      const docs = await readRuleFiles(dataDir, entry);
      // 본문 조 없이 부칙만 담은 학교(방송대)는 부칙 문서를 본문 자리에 둔다
      const rules = docs.find((d) => d.law_id === entry.id) ?? docs[0];
      if (!rules || docs.some((d) => validateLawDocument(d).length)) return null;
      return { rules, addenda: docs.filter((d) => d !== rules), entry, storage: "file" };
    } catch {
      return null;
    }
  }

  // 앱 실행 경로는 law.go.kr을 부르지 않는다. 수집기 개발·점검에서 allowRemote를 줄 때만 받는다
  if (!options.allowRemote) return null;

  const key = `${entry.source_url}|${options.reload ? Date.now() : ""}`;
  if (!remoteMemo.has(key)) {
    const p = fetchSchoolRules(entry, overrides, options);
    remoteMemo.set(key, p);
    p.then((r) => r === null && remoteMemo.delete(key));
  }
  return remoteMemo.get(key)!;
}

async function fetchSchoolRules(entry: ManifestEntry, overrides: Overrides, options: LoadOptions): Promise<SchoolRuleBundle | null> {
  if (!/^https:\/\/www\.law\.go\.kr\/LSW\/schlPubRulInfoR\.do\?schlPubRulSeq=\d+$/.test(entry.source_url)) return null;
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(entry.source_url, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; geungeo/0.1)" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
    if (!res.ok) return null;
    const parsed = parseLawPage(await res.text(), entry.id);
    const rules = buildLawDocument([{ parsed, source_url: entry.source_url }], {
      law_id: entry.id,
      law_name: entry.name,
      kind: "school_rule",
      school: entry.school,
      overrides: overrides.overrides,
    });
    const addenda: LawDocument[] = [];
    for (const add of parsed.addenda) {
      const d = buildAddendumDocument(add, { law_id: entry.id, law_name: entry.name, kind: "school_rule", school: entry.school }, entry.source_url);
      if (!d) continue;
      for (const a of d.articles) {
        const o = overrides.overrides.find((x) => x.article_id === a.id && x.effective_from);
        if (o) a.versions[0].effective_from = o.effective_from!;
      }
      addenda.push(d);
    }
    if (validateLawDocument(rules).length) return null;
    return { rules, addenda, entry, storage: "remote" };
  } catch {
    // law.go.kr 오류 페이지·시간 초과·파싱 실패: 예외 메시지는 밖으로 내보내지 않는다(설계 5-3)
    return null;
  }
}
