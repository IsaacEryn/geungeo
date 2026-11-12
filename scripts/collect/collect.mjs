#!/usr/bin/env node
// 법령 캐시 수집기(개발자용, 설계 4-4). 운영팀은 실행할 필요가 없다. 앱은 이 파일을 import하지 않는다.
//
// 국가법령정보센터 Open API 키(LAW_OC)가 없어 law.go.kr 공개 화면(raw HTML)에서 받는다.
// 요청 사이 간격은 config의 request_interval_ms(1초 이상)를 지키고, 총 요청 수를 마지막에 출력한다.
//
// 실행(Node 22): node --experimental-strip-types scripts/collect/collect.mjs [옵션]
//   --raw-dir <dir>     받은 HTML을 저장할 곳(저장소 밖, 예: ~/tmp/geungeo-raw). 다시 돌릴 때 --offline으로 재사용
//   --offline           요청하지 않고 --raw-dir의 HTML만 읽는다(요청 0)
//   --rules-out <dir>   학칙 '쓰는 조'를 이 폴더에 저장한다. data/rules를 주면 manifest storage가 file이 된다.
//                       주지 않으면 학칙 본문은 어디에도 저장하지 않고 manifest에 remote로만 적는다(처리 방식 결정 전 기본)
//   --data-dir <dir>    출력 data 폴더(기본 <저장소>/data)
//   --only heaf,heaf_decree   일부만 다시 받기(나머지 manifest 항목은 그대로 둔다)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAddendumDocument,
  buildLawDocument,
  linkDelegations,
  parseHistoryList,
  parseLawPage,
  validateLawDocument,
  validateManifest,
} from "../../lib/cache/lawdata.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "https://www.law.go.kr";

// ───────── 옵션 ─────────
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);
const config = JSON.parse(readFileSync(join(ROOT, "config/collect.json"), "utf8"));
const dataDir = resolve(opt("--data-dir") ?? join(ROOT, "data"));
const rawDir = opt("--raw-dir") ? resolve(opt("--raw-dir")) : null;
const offline = flag("--offline");
const rulesOut = opt("--rules-out") ? resolve(opt("--rules-out")) : null;
const only = opt("--only")?.split(",").map((s) => s.trim());
const interval = Math.max(1000, Number(config.request_interval_ms) || 1100);
if (offline && !rawDir) throw new Error("--offline에는 --raw-dir이 필요합니다");

// ───────── 요청(간격 지키기·기록) ─────────
const requestLog = [];
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rawPath(url) {
  return join(rawDir, `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.html`);
}

// 마지막으로 읽은 화면의 수집 시각(오프라인 재실행이면 저장본을 받은 시각)
let lastFetchedAt = Date.now();

async function get(url) {
  if (rawDir && existsSync(rawPath(url)) && offline) {
    lastFetchedAt = statSync(rawPath(url)).mtimeMs;
    return readFileSync(rawPath(url), "utf8");
  }
  if (offline) throw new Error(`오프라인인데 저장본 없음: ${url}`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const wait = lastRequestAt + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    lastFetchedAt = lastRequestAt;
    const at = new Date().toISOString();
    try {
      const res = await fetch(url, { headers: { "User-Agent": config.user_agent, Accept: "text/html" }, signal: AbortSignal.timeout(30000) });
      const body = await res.text();
      requestLog.push({ at, url, status: res.status, bytes: body.length });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (rawDir) {
        mkdirSync(rawDir, { recursive: true });
        writeFileSync(rawPath(url), body);
      }
      return body;
    } catch (err) {
      if (!requestLog.length || requestLog[requestLog.length - 1].at !== at) requestLog.push({ at, url, status: 0, error: err.name });
      if (attempt === 2) throw new Error(`요청 실패(${err.name}): ${url}`);
      await sleep(3000);
    }
  }
  throw new Error("unreachable");
}

// ───────── 보조 ─────────
function kstNow(ms = Date.now()) {
  const t = new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 19);
  return `${t}+09:00`;
}
const overridesPath = join(dataDir, "overrides.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")).overrides : [];

/** 조 하나를 한 줄로 — git diff가 읽기 쉽고 파일이 작다 */
function serializeDoc(doc) {
  const { articles, ...head } = doc;
  const headJson = JSON.stringify(head).slice(0, -1);
  return `${headJson},"articles":[\n${articles.map((a) => JSON.stringify(a)).join(",\n")}\n]}\n`;
}

function writeDoc(doc, relPath) {
  const errs = validateLawDocument(doc);
  if (errs.length) throw new Error(`형식 오류 ${doc.law_id}:\n  ${errs.slice(0, 10).join("\n  ")}`);
  const full = join(dataDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, serializeDoc(doc));
  return full;
}

const REDIST = {
  act: "저작권법 제7조제1호(헌법·법률·조약·명령·조례 및 규칙)",
  presidential_decree: "저작권법 제7조제1호(헌법·법률·조약·명령·조례 및 규칙)",
  ministerial_ordinance: "저작권법 제7조제1호(헌법·법률·조약·명령·조례 및 규칙)",
  administrative_rule: "저작권법 제7조제2호(국가 또는 지방자치단체의 고시·공고·훈령 그 밖에 이와 유사한 것)",
  school_rule: "확인 못 함 — 학칙 처리 방식(쓰는 조만 수록 / 실행 때 받기 / 대학에 묻기)을 정하기 전",
};
const ATTR = "출처: 법제처 국가법령정보센터";

const fmtKoDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
};

// ───────── 수집 ─────────
const manifestPath = join(dataDir, "manifest.json");
const oldManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { entries: [] };
const entries = [];
const docs = new Map(); // law_id → { doc, relPath }
const want = (id) => !only || only.includes(id);

async function collectLaw(law) {
  const histUrl = `${BASE}/LSW/lsHstListR.do?lsId=${law.lsId}`;
  const hist = parseHistoryList(await get(histUrl));
  if (hist.length === 0) throw new Error(`${law.id}: 연혁 목록을 읽지 못함`);
  const seen = new Set();
  const picks = hist
    .filter((h) => h.effective_from >= law.since)
    .filter((h) => {
      const k = `${h.lsiSeq}:${h.effective_from}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const editions = [];
  for (const h of picks) {
    const url = `${BASE}/LSW/lsInfoR.do?lsiSeq=${h.lsiSeq}&efYd=${h.effective_from.replace(/-/g, "")}`;
    const parsed = parseLawPage(await get(url), law.id);
    if (parsed.effective_from !== h.effective_from) {
      console.warn(`  경고 ${law.id}: 연혁 목록 시행일 ${h.effective_from} ≠ 화면 ${parsed.effective_from} (${url})`);
    }
    editions.push({ parsed, source_url: url, hist: h });
    console.log(`  ${law.id} ${h.effective_from} ${parsed.promulgation_no} 조 ${parsed.articles.length}`);
  }
  const collected_at = kstNow(lastFetchedAt);
  const doc = buildLawDocument(editions, { law_id: law.id, law_name: law.name, kind: law.kind, overrides, fixes: config.article_fixes });
  // 진단: 같은 원문이 떨어져서 다시 나오는 조(판 계보가 엇갈린 흔적) — 사람이 보고 article_fixes/overrides로 정한다
  for (const a of doc.articles) {
    const texts = a.versions.map((v) => v.text.replace(/[\s.]/g, ""));
    if (texts.some((t, i) => texts.indexOf(t) !== i)) console.warn(`  확인 필요 ${a.id}: 원문이 되돌아갔다 다시 바뀜 (${a.versions.map((v) => v.effective_from).join(" → ")})`);
  }
  docs.set(law.id, { doc, relPath: `laws/${law.id}.json` });
  entries.push({
    id: law.id,
    name: law.name,
    kind: law.kind,
    editions: editions.map((e) => ({
      effective_from: e.parsed.effective_from,
      promulgated: e.parsed.promulgated,
      promulgation_no: e.parsed.promulgation_no,
      source_url: e.source_url,
    })),
    collected_at,
    method: "html",
    source_url: histUrl,
    attribution: ATTR,
    redistribution: REDIST[law.kind],
    storage: "file",
    path: `laws/${law.id}.json`,
  });

  // 부칙: 받은 판들의 공포 번호에 해당하는 것만(최신 판 화면에 모든 부칙이 있다)
  // 부칙: 받은 판들의 공포 번호에 해당하는 것만. 판마다 실린 부칙이 달라(뒤에 공포된 법률의 부칙이 빠진 판이 있음)
  // 모든 판에서 모으고, 같은 부칙은 공포일이 가장 늦은 판의 것을 쓴다
  if (law.addenda) {
    const nos = new Set(editions.map((e) => e.parsed.promulgation_no));
    const byNo = new Map();
    for (const e of [...editions].sort((a, b) => a.parsed.promulgated.localeCompare(b.parsed.promulgated))) {
      for (const add of e.parsed.addenda) if (nos.has(add.promulgation_no)) byNo.set(add.promulgation_no, { add, source_url: e.source_url });
    }
    for (const { add, source_url } of byNo.values()) {
      const latest = { source_url };
      const adoc = buildAddendumDocument(add, { law_id: law.id, law_name: law.name, kind: law.kind }, latest.source_url);
      if (!adoc || docs.has(adoc.law_id)) continue;
      // 부칙에도 overrides(사람 확인 시행일)를 적용한다
      for (const a of adoc.articles) {
        const o = overrides.find((x) => x.article_id === a.id && x.effective_from);
        if (o) a.versions[0].effective_from = o.effective_from;
      }
      const relPath = `laws/addenda/${adoc.law_id}.json`;
      docs.set(adoc.law_id, { doc: adoc, relPath });
      entries.push({
        id: adoc.law_id,
        name: adoc.law_name,
        kind: law.kind,
        editions: [{ effective_from: add.promulgated, promulgated: add.promulgated, promulgation_no: add.promulgation_no, source_url: latest.source_url }],
        collected_at,
        method: "html",
        source_url: latest.source_url,
        attribution: ATTR,
        redistribution: REDIST[law.kind],
        storage: "file",
        path: relPath,
      });
    }
  }
}

async function collectAdminRule(rule) {
  const url = `${BASE}/LSW/admRulLsInfoR.do?admRulSeq=${rule.admRulSeq}`;
  const parsed = parseLawPage(await get(url), rule.id);
  const doc = buildLawDocument([{ parsed, source_url: url }], { law_id: rule.id, law_name: rule.name, kind: rule.kind, overrides, fixes: config.article_fixes });
  console.log(`  ${rule.id} ${parsed.effective_from} ${parsed.promulgation_no} 조 ${parsed.articles.length}`);
  docs.set(rule.id, { doc, relPath: `laws/${rule.id}.json` });
  entries.push({
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    editions: [{ effective_from: parsed.effective_from, promulgated: parsed.promulgated, promulgation_no: parsed.promulgation_no, source_url: url }],
    collected_at: kstNow(lastFetchedAt),
    method: "html",
    source_url: url,
    attribution: ATTR,
    redistribution: REDIST[rule.kind],
    storage: "file",
    path: `laws/${rule.id}.json`,
  });
}

async function collectSchoolRule(rule) {
  const url = `${BASE}/LSW/schlPubRulInfoR.do?schlPubRulSeq=${rule.schlPubRulSeq}`;
  const parsed = parseLawPage(await get(url), rule.id);
  const no = parsed.promulgation_no.match(/제([0-9-]+)호/)?.[1] ?? "";
  const attribution = `${rule.name}(제${no}호, 시행 ${fmtKoDate(parsed.effective_from)}), 법제처 국가법령정보센터 게재본`;
  console.log(`  ${rule.id} ${parsed.effective_from} ${parsed.promulgation_no} 조 ${parsed.articles.length}`);
  const toFile = rulesOut && resolve(rulesOut) === resolve(join(dataDir, "rules"));
  const entry = {
    id: rule.id,
    name: rule.name,
    kind: "school_rule",
    school: rule.school,
    editions: [{ effective_from: parsed.effective_from, promulgated: parsed.promulgated, promulgation_no: parsed.promulgation_no, source_url: url }],
    collected_at: kstNow(lastFetchedAt),
    method: "html",
    source_url: url,
    attribution,
    redistribution: REDIST.school_rule,
    storage: toFile ? "file" : "remote",
  };
  if (toFile) entry.path = `rules/${rule.id}.json`;
  entries.push(entry);
  if (!rulesOut) return; // 결정 전 기본: 본문 저장 안 함

  const full = buildLawDocument([{ parsed, source_url: url }], { law_id: rule.id, law_name: rule.name, kind: "school_rule", school: rule.school, overrides });
  const keep = new Set(rule.articles);
  const doc = { ...full, articles: full.articles.filter((a) => keep.has(a.number)) };
  const out = [];
  if (doc.articles.length) out.push({ doc, file: `${rule.id}.json` });
  for (const add of parsed.addenda) {
    const addNo = add.promulgation_no.match(/제([0-9-]+)호/)?.[1];
    if (!rule.addenda.includes(addNo)) continue;
    const adoc = buildAddendumDocument(add, { law_id: rule.id, law_name: rule.name, kind: "school_rule", school: rule.school }, url);
    if (!adoc) continue;
    for (const a of adoc.articles) {
      const o = overrides.find((x) => x.article_id === a.id && x.effective_from);
      if (o) a.versions[0].effective_from = o.effective_from;
    }
    out.push({ doc: adoc, file: `${adoc.law_id}.json` });
  }
  mkdirSync(rulesOut, { recursive: true });
  for (const { doc: d, file } of out) {
    const errs = validateLawDocument(d);
    if (errs.length) throw new Error(`형식 오류 ${d.law_id}: ${errs.slice(0, 5).join("; ")}`);
    writeFileSync(join(rulesOut, file), serializeDoc(d));
  }
}

console.log(`수집 시작 ${kstNow()} ${offline ? "(오프라인)" : ""}`);
for (const law of config.laws) if (want(law.id)) await collectLaw(law);
for (const rule of config.admin_rules) if (want(rule.id)) await collectAdminRule(rule);
for (const rule of config.school_rules) if (want(rule.id)) await collectSchoolRule(rule);

// 위임 연결(상위 법 → 시행령·규칙 조), 사람이 적은 연결
for (const d of config.delegations) {
  const parent = docs.get(d.parent)?.doc;
  const child = docs.get(d.child)?.doc;
  if (parent && child) linkDelegations(parent, child, d.phrase, new RegExp(d.ref, "g"));
}
for (const m of config.manual_links) {
  const lawId = m.from.split(":")[0];
  const a = docs.get(lawId)?.doc.articles.find((x) => x.id === m.from);
  if (!a) continue;
  const latest = a.versions[a.versions.length - 1];
  if (!latest.text.includes(m.phrase)) throw new Error(`manual_links: ${m.from}에 문구 "${m.phrase}" 없음`);
  if (!a.links.some((l) => l.target.kind === "article" && l.target.article_id === m.to)) {
    a.links.push({ phrase: m.phrase, target: { kind: "article", article_id: m.to }, paragraph_no: m.paragraph_no });
  }
}

// 진단: 부칙 제1조 단서로 시행일이 따로 정해진 조인데 overrides에 없는 것(사람이 부칙을 읽고 overrides.json에 적는다)
for (const { doc } of docs.values()) {
  const m = doc.law_id.match(/^(.+)_a[0-9_]+$/);
  if (!m) continue;
  const first = doc.articles[0]?.versions[0];
  const proviso = first?.text.match(/다만,([^.]*?)(?:의 개정규정|의 규정)은\s*([^.]*?)부터 시행/);
  if (!proviso) continue;
  const nums = [...proviso[1].matchAll(/제(\d+)조(?:의(\d+))?/g)].map((x) => `${m[1]}:${x[1].padStart(3, "0")}-${(x[2] ?? "0").padStart(2, "0")}`);
  // 단서의 시행일을 계산해 그날 시작하는 판이 이미 있으면 넘어간다
  const when = proviso[2].trim();
  let date = null;
  const ymd = when.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  const after = when.match(/공포 후\s*(\d+)\s*(개월|년)이 경과한 날/);
  const prom = first.promulgated;
  if (ymd) date = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  else if (/공포한 날/.test(when)) date = prom;
  else if (after) {
    const [y, mo, d] = prom.split("-").map(Number);
    const months = Number(after[1]) * (after[2] === "년" ? 12 : 1);
    date = new Date(Date.UTC(y, mo - 1 + months, d)).toISOString().slice(0, 10);
  }
  const target = docs.get(m[1])?.doc;
  for (const id of new Set(nums)) {
    const a = target?.articles.find((x) => x.id === id);
    if (date && a?.versions.some((v) => v.effective_from === date)) continue;
    if (!overrides.some((o) => o.article_id === id)) console.warn(`  확인 필요(부칙 단서) ${id}: ${doc.law_name} — "${proviso[2].trim()}부터 시행", overrides.json에 없음`);
  }
}

// 쓰기: 이번에 받은 것만 덮어쓴다. --only가 없으면 laws/addenda를 비우고 새로 쓴다
if (!only && existsSync(join(dataDir, "laws/addenda"))) {
  for (const f of readdirSync(join(dataDir, "laws/addenda"))) if (f.endsWith(".json")) rmSync(join(dataDir, "laws/addenda", f));
}
for (const { doc, relPath } of docs.values()) writeDoc(doc, relPath);

const kept = only ? oldManifest.entries.filter((e) => !entries.some((n) => n.id === e.id)) : [];
const manifest = { schema_version: 1, generated_at: kstNow(), entries: [...kept, ...entries] };
const mErrs = validateManifest(manifest);
if (mErrs.length) throw new Error(`manifest 형식 오류: ${mErrs.join("; ")}`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const ok = requestLog.filter((r) => r.status === 200).length;
console.log(`\n완료. 요청 ${requestLog.length}회(성공 ${ok}), 법령 문서 ${docs.size}개, manifest 항목 ${manifest.entries.length}개`);
if (rawDir) writeFileSync(join(rawDir, `requests_${Date.now()}.json`), JSON.stringify(requestLog, null, 1));
