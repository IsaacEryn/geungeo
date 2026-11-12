// law.go.kr 공개 화면(raw HTML)을 조 단위 데이터로 바꾸는 순수 함수 모음.
// 수집기(scripts/collect)와 학칙 remote 모드(load.ts, 개발·점검용)가 같이 쓴다.
// 이 파일은 런타임 import가 없다(Node --experimental-strip-types로 수집기에서 바로 읽기 위해 type import만 둔다).
// 원칙: 원문은 바꾸지 않는다. 태그를 벗기고 공백만 정리한다(설계 4-2).
import type {
  ArticleOverride,
  ArticleVersion,
  DelegationLink,
  IsoDate,
  Item,
  LawArticle,
  LawDocument,
  LawKind,
  Manifest,
  Overrides,
  Paragraph,
  SchoolId,
  Synonyms,
} from "./schema";

// ───────── 날짜 ─────────

/** "2026. 3. 10." · "2026.3.10." · "20260310" → "2026-03-10". 못 읽으면 null */
export function toIsoDate(raw: string): IsoDate | null {
  const compact = raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const m = raw.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 'YYYY-MM-DD'에 일수를 더한다(달력 계산만, 시간대 무관) */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// ───────── HTML → 줄 ─────────

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ", middot: "·" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** 태그를 벗기고 <br>을 줄바꿈으로, 줄 안 공백을 한 칸으로 정리한 줄 목록 */
export function htmlToLines(fragment: string): string[] {
  const text = decodeEntities(
    fragment
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0\u3000\r]+/g, " ").trim())
    .filter((l) => l.length > 0);
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
}

// ───────── 조 번호 ─────────

/** "제11조의2" → "heaf:011-02" */
export function articleId(lawId: string, number: string): string | null {
  const m = number.match(/^제(\d+)조(?:의(\d+))?$/);
  if (!m) return null;
  return `${lawId}:${m[1].padStart(3, "0")}-${(m[2] ?? "0").padStart(2, "0")}`;
}

/** "heaf:011-02" → "제11조의2" */
export function articleNumberFromId(id: string): string {
  const m = id.match(/:(\d{3})-(\d{2})$/);
  if (!m) return id;
  const main = Number(m[1]);
  const branch = Number(m[2]);
  return branch ? `제${main}조의${branch}` : `제${main}조`;
}

const CIRCLED_BASE = [0x2460, 0x3251, 0x32b1]; // ①~⑳, ㉑~㉟, ㊱~㊿

/** 원문자 → "1"… 원문자가 아니면 null */
export function circledToNumber(ch: string): string | null {
  const c = ch.codePointAt(0);
  if (c === undefined) return null;
  if (c >= 0x2460 && c <= 0x2473) return String(c - CIRCLED_BASE[0] + 1);
  if (c >= 0x3251 && c <= 0x325f) return String(c - CIRCLED_BASE[1] + 21);
  if (c >= 0x32b1 && c <= 0x32bf) return String(c - CIRCLED_BASE[2] + 36);
  return null;
}

// 줄 끝 개정 꼬리표: "<개정 2016. 12. 20., 2019. 12. 3.>", 삭제 항의 "<2021. 9. 24.>"
const TRAILING_TAG = /\s*(<[^<>]*\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?[^<>]*>)\s*$/;
const BRACKET_LINE = /^\[.*\]$/;

function splitTrailingTags(line: string): { body: string; tags: string[] } {
  const tags: string[] = [];
  let body = line;
  for (;;) {
    const m = body.match(TRAILING_TAG);
    if (!m || m.index === undefined) break;
    tags.unshift(m[1]);
    body = body.slice(0, m.index).trimEnd();
  }
  return { body, tags };
}

/** 문자열 앞의 균형 잡힌 괄호 "(…)"를 떼어 낸다 */
function takeParenthesized(s: string): { inner: string; rest: string } | null {
  if (s[0] !== "(") return null;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return { inner: s.slice(1, i), rest: s.slice(i + 1) };
    }
  }
  return null;
}

// ───────── 조 하나 ─────────

export interface ParsedArticle {
  id: string;
  number: string;
  title: string;
  text: string;
  paragraphs: Paragraph[];
  amend_tags: string[];
}

/** 조 하나의 줄(첫 줄은 "제N조(제목) …")을 항·호·목으로 나눈다 */
export function buildArticle(lawId: string, lines: string[]): ParsedArticle | null {
  if (lines.length === 0) return null;
  const head = lines[0].match(/^(제\d+조(?:의\d+)?)\s*/);
  if (!head) return null;
  const number = head[1];
  const id = articleId(lawId, number);
  if (!id) return null;

  let rest = lines[0].slice(head[0].length);
  let title = "";
  const paren = takeParenthesized(rest);
  if (paren) {
    title = paren.inner.trim();
    rest = paren.rest.trim();
  }

  const paragraphs: Paragraph[] = [];
  const amend_tags: string[] = [];
  let curPara: Paragraph | null = null;
  let curItem: Item | null = null;
  let curSub: { no: string; text: string } | null = null;

  const pushTags = (tags: string[]) => {
    for (const t of tags) if (!amend_tags.includes(t)) amend_tags.push(t);
  };
  const ensurePara = (): Paragraph => {
    if (!curPara) {
      curPara = { no: "", text: "", items: [] };
      paragraphs.push(curPara);
    }
    return curPara;
  };

  const consume = (line: string) => {
    if (BRACKET_LINE.test(line)) {
      // "[본조신설 2026. 3. 10.]" 같은 줄. 한 줄에 둘 이상 붙은 경우도 그대로 하나로 둔다
      pushTags([line]);
      return;
    }
    const { body, tags } = splitTrailingTags(line);
    pushTags(tags);
    const circ = circledToNumber(body[0] ?? "");
    if (circ) {
      curPara = { no: circ, text: body.slice(1).trim(), items: [] };
      paragraphs.push(curPara);
      curItem = null;
      curSub = null;
      return;
    }
    const item = body.match(/^(\d+(?:의\d+)?)\.\s*/);
    if (item) {
      curItem = { no: item[1], text: body.slice(item[0].length), subitems: [] };
      ensurePara().items.push(curItem);
      curSub = null;
      return;
    }
    const sub = body.match(/^([가-하](?:의\d+)?)\.\s*/);
    if (sub && curItem) {
      curSub = { no: sub[1], text: body.slice(sub[0].length) };
      (curItem as Item).subitems.push(curSub);
      return;
    }
    // 그 밖(1) 가) 같은 더 깊은 단계, 이어지는 줄): 가장 깊은 요소 뒤에 줄바꿈으로 잇는다
    if (curSub) (curSub as { text: string }).text += `\n${body}`;
    else if (curItem) (curItem as Item).text += `\n${body}`;
    else {
      const p = ensurePara();
      p.text = p.text ? `${p.text}\n${body}` : body;
    }
  };

  if (rest) consume(rest);
  for (const line of lines.slice(1)) consume(line);

  // 첫 줄 본문이 비고 항이 없는 조(예: "제2조(학교의 종류) 다음 각 호…"는 위에서 처리됨)
  return { id, number, title, text: lines.join("\n"), paragraphs, amend_tags };
}

// ───────── 화면 하나(판 하나) ─────────

export interface ParsedAddendum {
  /** "법률 제21423호" */
  promulgation_no: string;
  promulgated: IsoDate | null;
  /** "<법률 제21423호, 2026. 3. 10.>" 원문 그대로 */
  label: string;
  articles: ParsedArticle[];
}

export interface ParsedEdition {
  law_name: string;
  effective_from: IsoDate;
  promulgated: IsoDate;
  promulgation_no: string; // "법률 제21423호"
  amendment_kind: string; // "일부개정"
  articles: ParsedArticle[];
  addenda: ParsedAddendum[];
}

export class LawPageError extends Error {}

/** law.go.kr 오류 페이지(해당 한글주소명을 찾을 수 없습니다 등)인지 */
export function isErrorPage(html: string): boolean {
  return /오류페이지|error500|찾을 수 없습니다/.test(html.slice(0, 4000)) && !/pty1_p4/.test(html);
}

/**
 * lsInfoR.do(법령) · admRulLsInfoR.do(행정규칙) · schlPubRulInfoR.do(학칙) 본문 화면을 읽는다.
 * lawId는 조 ID 접두어("heaf")
 */
export function parseLawPage(html: string, lawId: string): ParsedEdition {
  if (isErrorPage(html)) throw new LawPageError("law.go.kr 오류 페이지");
  const body = stripScripts(html);

  const nameInput = body.match(/id="lsNm"[^>]*value="([^"]*)"/) ?? body.match(/id="schlPubRulNm"[^>]*value="([^"]*)"/);
  const allText = htmlToLines(body).join("\n");
  const header = allText.match(/\[시행\s*([0-9.\s]+?)\]\s*\[([^\]]*?)\s*제\s*([0-9-]+)\s*호\s*,\s*([0-9.\s]+?)\s*,\s*([^\]]*?)\]/);
  if (!header) throw new LawPageError("머리글([시행 …] [… 제…호, …])을 찾지 못함");
  const effective_from = toIsoDate(header[1]);
  const promulgated = toIsoDate(header[4]);
  if (!effective_from || !promulgated) throw new LawPageError("머리글 날짜를 읽지 못함");
  const issuer = header[2].trim();
  const promulgation_no = `${issuer} 제${header[3]}호`;

  const h2 = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const law_name = decodeEntities(nameInput?.[1] ?? htmlToLines(h2?.[1] ?? "").join(" ")).trim();

  // 본문 p 요소를 순서대로
  const pRe = /<p class="(pty[0-9a-z_]*|gtit)"[^>]*>([\s\S]*?)<\/p>/g;
  const articles: ParsedArticle[] = [];
  const addenda: ParsedAddendum[] = [];
  let curLines: string[] | null = null;
  let curAdd: { add: ParsedAddendum; lines: string[][] } | null = null;
  const seen = new Set<string>();

  const flushArticle = () => {
    if (curLines) {
      const a = buildArticle(lawId, curLines);
      if (a && !seen.has(a.id)) {
        seen.add(a.id);
        articles.push(a);
      }
    }
    curLines = null;
  };
  const flushAddendum = () => {
    if (!curAdd) return;
    const { add, lines } = curAdd;
    let n = 0;
    for (const group of lines) {
      const numbered = /^제\d+조(?:의\d+)?/.test(group[0]);
      const a = numbered
        ? buildArticle("x", group)
        : { id: "x:000-00", number: "", title: "", text: group.join("\n"), paragraphs: [{ no: "", text: group.join("\n"), items: [] }], amend_tags: [] };
      if (a) {
        add.articles.push({ ...a, id: a.id.replace(/^x:/, "") });
        n += 1;
      }
    }
    if (n > 0) addenda.push(add);
    curAdd = null;
  };

  for (const m of body.matchAll(pRe)) {
    const cls = m[1];
    const inner = m[2];
    if (cls === "pty3") {
      flushArticle();
      flushAddendum();
      const labelRaw = (inner.match(/<span class="sfon">([\s\S]*?)<\/span>/) ?? [])[1] ?? "";
      const label = htmlToLines(labelRaw).join(" ");
      const lm = label.match(/<\s*([^<>]*?)\s*제\s*([0-9-]+)\s*호\s*,\s*([0-9.\s]+)\.?\s*>/);
      curAdd = {
        add: {
          label,
          promulgation_no: lm ? `${lm[1].trim()} 제${lm[2]}호`.trim() : label,
          promulgated: lm ? toIsoDate(lm[3]) : null,
          articles: [],
        },
        lines: [],
      };
      continue;
    }
    const lines = htmlToLines(inner);
    if (cls.startsWith("pty3_")) {
      if (!curAdd || lines.length === 0) continue;
      const startsArticle = cls === "pty3_dep1" && /^제\d+조(?:의\d+)?/.test(lines[0]);
      if (startsArticle || curAdd.lines.length === 0) curAdd.lines.push([...lines]);
      else curAdd.lines[curAdd.lines.length - 1].push(...lines);
      continue;
    }
    if (cls === "gtit") {
      flushArticle();
      continue;
    }
    if (curAdd) continue; // 부칙 뒤의 본문 클래스(별표 등)는 무시
    if (cls === "pty1_p4") {
      flushArticle();
      if (lines.length && /^제\d+조/.test(lines[0])) curLines = [...lines];
      continue;
    }
    if (curLines) curLines.push(...lines);
  }
  flushArticle();
  flushAddendum();

  if (articles.length === 0) throw new LawPageError("조문을 하나도 찾지 못함");
  return { law_name, effective_from, promulgated, promulgation_no, amendment_kind: header[5].trim(), articles, addenda };
}

// ───────── 연혁 목록 ─────────

export interface HistoryEntry {
  lsiSeq: string;
  promulgated: IsoDate;
  promulgation_number: string; // "21423"
  effective_from: IsoDate;
  current: boolean; // 화면이 '현행'으로 표시한 판
  amendment_kind: string;
}

/** lsHstListR.do 화면(연혁 목록)에서 판 목록을 읽는다 */
export function parseHistoryList(html: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const re = /lsViewLsHst2\('(\d+)',\s*'(\d{8})',\s*'([^']*)',\s*'(\d{8})',\s*'([YN])',\s*'[^']*'\s*,\s*'([^']*)'\)/g;
  for (const m of html.matchAll(re)) {
    out.push({
      lsiSeq: m[1],
      promulgated: toIsoDate(m[2])!,
      promulgation_number: m[3],
      effective_from: toIsoDate(m[4])!,
      current: m[5] === "Y",
      amendment_kind: m[6],
    });
  }
  return out;
}

// ───────── 판 비교 → 조별 versions ─────────

export interface EditionInput {
  parsed: ParsedEdition;
  source_url: string;
}

export interface BuildOptions {
  law_id: string;
  law_name?: string;
  kind: LawKind;
  school?: SchoolId;
  overrides?: ArticleOverride[];
  /** 사람이 확인한 판 보정(config/collect.json article_fixes). 연혁 판끼리 조 번호 체계가 엇갈릴 때만 쓴다 */
  fixes?: ArticleFix[];
}

export interface ArticleFix {
  article_ids: string[];
  /** 이 시행일 판들의 원문은 후보에서 뺀다(조 번호 이동 전 체계로 만들어진 판 등) */
  exclude_editions?: IsoDate[];
  /** 이 기간에는 시행 중인 원문이 없다 */
  absent_from?: IsoDate;
  absent_to?: IsoDate;
  basis: string;
}

function versionFrom(e: EditionInput, a: ParsedArticle, from: IsoDate): ArticleVersion {
  return {
    effective_from: from,
    effective_to: null,
    promulgated: e.parsed.promulgated,
    promulgation_no: e.parsed.promulgation_no,
    text: a.text,
    paragraphs: a.paragraphs,
    amend_tags: a.amend_tags,
    source_url: e.source_url,
  };
}

/** 꼬리표에 적힌 날짜 중 가장 늦은 것("" = 꼬리표 없음). 원문이 얼마나 최근 개정까지 반영했는지 가늠하는 값 */
export function latestTagDate(tags: string[]): string {
  let max = "";
  for (const t of tags) {
    if (/시행일/.test(t)) continue; // "[시행일: …]"은 공포일이 아니라 시행일
    for (const m of t.matchAll(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/g)) {
      const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * 판들(시행일별 화면)에서 조별 versions[]를 만든다.
 *
 * law.go.kr의 시행일별 판은 그 법률이 공포될 때 만들어져 뒤에 공포된 개정을 반영하지 않는 경우가 있다
 * (예: 2025-04-23 판(법률 제20466호)에 2025-01-21 시행 개정(법률 제20662호)이 빠짐). 또 '현행' 판에
 * 부칙 단서로 시행이 늦춰진 조가 미리 보인다(E22·E23·E06 함정, 설계 3-1).
 * 그래서 각 판 시행일(과 overrides 날짜)마다 '그날까지 시행된 판들' 중 이 조를 가장 최근 개정까지 반영한 원문을 고른다:
 *   1) 꼬리표의 가장 늦은 날짜, 2) 판의 공포일, 3) 판의 시행일 순으로 큰 것.
 * overrides(사람이 부칙을 읽고 확인한 조별 시행일 X)가 있으면 X에 시행되는 원문은 X 전 날짜의 후보에서 뺀다.
 * 같은 원문이 이어지는 날짜는 한 판으로 묶고, 후보가 없는 날짜(그 조가 아직 없음/사라짐)는 구간을 닫는다.
 */
export function buildLawDocument(editions: EditionInput[], opts: BuildOptions): LawDocument {
  const sorted = [...editions].sort(
    (a, b) => a.parsed.effective_from.localeCompare(b.parsed.effective_from) || a.parsed.promulgated.localeCompare(b.parsed.promulgated),
  );
  const overrides = (opts.overrides ?? []).filter((o) => o.article_id.startsWith(`${opts.law_id}:`));
  const editionDates = [...new Set(sorted.map((e) => e.parsed.effective_from))];

  // 조 ID 순서: 처음 나타난 순(최신 판 순서를 우선)
  const order: string[] = [];
  const meta = new Map<string, ParsedArticle>();
  for (const e of [...sorted].reverse()) for (const a of e.parsed.articles) if (!meta.has(a.id)) meta.set(a.id, a);
  const latestOrder = sorted[sorted.length - 1]?.parsed.articles.map((a) => a.id) ?? [];
  for (const id of latestOrder) order.push(id);
  for (const e of sorted) for (const a of e.parsed.articles) if (!order.includes(a.id)) order.push(a.id);

  type Cand = { e: EditionInput; a: ParsedArticle; key: string };
  const fixes = (opts.fixes ?? []).filter((f) => f.article_ids.some((id) => id.startsWith(`${opts.law_id}:`)));
  const excluded = (id: string, e: EditionInput) =>
    fixes.some((f) => f.article_ids.includes(id) && (f.exclude_editions ?? []).includes(e.parsed.effective_from));
  const absent = (id: string, d: IsoDate) =>
    fixes.some((f) => f.article_ids.includes(id) && f.absent_from && d >= f.absent_from && (!f.absent_to || d <= f.absent_to));
  const candidatesAt = (id: string, date: IsoDate): Cand[] =>
    sorted
      .filter((e) => e.parsed.effective_from <= date && !excluded(id, e))
      .map((e) => ({ e, a: e.parsed.articles.find((x) => x.id === id) }))
      .filter((c): c is { e: EditionInput; a: ParsedArticle } => Boolean(c.a))
      .map((c) => ({ ...c, tagDate: latestTagDate(c.a.amend_tags) }))
      // 개정 꼬리표의 날짜(공포일)가 기준일보다 늦은 원문은 그날 시행 중일 수 없다(뒤에 다시 만든 판에 미리 실린 개정)
      .filter((c) => c.tagDate <= date)
      .map((c) => ({ e: c.e, a: c.a, key: `${c.tagDate || "0000-00-00"}|${c.e.parsed.promulgated}|${c.e.parsed.effective_from}` }));
  const best = (cands: Cand[]): Cand | null => cands.reduce<Cand | null>((b, c) => (!b || c.key >= b.key ? c : b), null);

  const articles: LawArticle[] = [];
  for (const id of order) {
    const own = overrides.filter((o) => o.article_id === id && o.effective_from);
    // override 날짜에 시행되는 원문(이 원문은 그 날짜 전에는 쓰지 않는다)
    const banned = own.map((o) => ({ from: o.effective_from!, text: best(candidatesAt(id, o.effective_from!))?.a.text }));
    const fixDates = fixes
      .filter((f) => f.article_ids.includes(id))
      .flatMap((f) => [f.absent_from, f.absent_to ? addDays(f.absent_to, 1) : undefined])
      .filter((d): d is string => Boolean(d));
    const dates = [...new Set([...editionDates, ...own.map((o) => o.effective_from!), ...fixDates])].sort();

    const versions: ArticleVersion[] = [];
    let cur: ArticleVersion | null = null;
    for (const d of dates) {
      const cands = absent(id, d) ? [] : candidatesAt(id, d).filter((c) => !banned.some((b) => b.text !== undefined && d < b.from && c.a.text === b.text));
      const pick = best(cands);
      if (!pick) {
        if (cur) cur.effective_to = addDays(d, -1);
        cur = null;
        continue;
      }
      if (cur && sameText(cur.text, pick.a.text)) continue;
      if (cur) cur.effective_to = addDays(d, -1);
      // 같은 원문을 실은 판 중 그날 시행하는 판이 있으면 그 판을 출처로(공포 번호·URL이 그 개정을 가리키게)
      const sameDay = cands.find((c) => c.e.parsed.effective_from === d && sameText(c.a.text, pick.a.text));
      const src = sameDay ?? pick;
      cur = versionFrom(src.e, src.a, d);
      versions.push(cur);
    }
    if (versions.length === 0) continue;

    const latest = versions[versions.length - 1];
    const m = meta.get(id)!;
    const latestParsed = { number: m.number, title: m.title };
    const article: LawArticle = {
      id,
      law_id: opts.law_id,
      law_name: opts.law_name ?? sorted[sorted.length - 1]?.parsed.law_name ?? opts.law_id,
      number: latestParsed.number,
      title: titleOf(latest.text) ?? latestParsed.title,
      versions,
      links: extractLinks(latest),
    };
    const moves = extractMoves(opts.law_id, latestParsed.number, latest.amend_tags);
    const o = overrides.find((x) => x.article_id === id && (x.moved_from || x.moved_to));
    const moved_from = o?.moved_from ?? moves.moved_from;
    const moved_to = o?.moved_to ?? moves.moved_to;
    if (moved_from) article.moved_from = moved_from;
    if (moved_to) article.moved_to = moved_to;
    articles.push(article);
  }

  const law_name = opts.law_name ?? sorted[sorted.length - 1]?.parsed.law_name ?? opts.law_id;
  const doc: LawDocument = { law_id: opts.law_id, law_name, kind: opts.kind, articles };
  if (opts.school) doc.school = opts.school;
  return doc;
}

/** 판 사이 표기 차이(꼬리표 "<2022.2.28>"·"<2022. 2. 28.>" 같은 공백·마침표)는 같은 원문으로 본다 */
export function sameText(a: string, b: string): boolean {
  return a === b || a.replace(/[\s.]/g, "") === b.replace(/[\s.]/g, "");
}

/** 조 원문 첫 줄에서 제목 "(…)"을 읽는다 */
function titleOf(text: string): string | null {
  const head = text.match(/^제\d+조(?:의\d+)?\s*/);
  if (!head) return null;
  const p = takeParenthesized(text.slice(head[0].length));
  return p ? p.inner.trim() : "";
}
/** 부칙 하나를 별도 문서로(조 ID 접두어 "<law_id>_a<공포번호>") */
export function buildAddendumDocument(
  add: ParsedAddendum,
  base: { law_id: string; law_name: string; kind: LawKind; school?: SchoolId },
  source_url: string,
): LawDocument | null {
  const num = add.promulgation_no.match(/제([0-9-]+)호/)?.[1]?.replace(/-/g, "_");
  if (!num || !add.promulgated) return null;
  const law_id = `${base.law_id}_a${num}`;
  const law_name = `${base.law_name} 부칙 ${add.label}`;
  const articles: LawArticle[] = add.articles.map((a) => ({
    id: `${law_id}:${a.id}`,
    law_id,
    law_name,
    number: a.number,
    title: a.title,
    versions: [
      {
        effective_from: add.promulgated!,
        effective_to: null,
        promulgated: add.promulgated!,
        promulgation_no: add.promulgation_no,
        text: a.text,
        paragraphs: a.paragraphs,
        amend_tags: a.amend_tags,
        source_url,
      },
    ],
    links: [],
  }));
  const doc: LawDocument = { law_id, law_name, kind: base.kind, articles };
  if (base.school) doc.school = base.school;
  return doc;
}

// ───────── 위임·이동 ─────────

const DELEGATION_PATTERNS: { re: RegExp; target: DelegationLink["target"] | "decree" | "ordinance" }[] = [
  { re: /학칙으로\s*정(?:하는 바에 따라|한다|하는|하며|할 수 있다)/g, target: { kind: "school_rule" } },
  { re: /대통령령으로\s*정(?:하는 바에 따라|한다|하는|하며)/g, target: "decree" },
  { re: /교육부령으로\s*정(?:하는 바에 따라|한다|하는|하며)/g, target: "ordinance" },
  { re: /교육부장관이\s*정하여\s*(?:고시|공고)(?:하는|한다)/g, target: { kind: "notice", issuer: "교육부장관" } },
  { re: /교육부장관이\s*정하는\s*(?:기준|바에 따라)/g, target: { kind: "notice", issuer: "교육부장관" } },
];

/** 판 하나의 항에서 위임 문구를 찾는다. 대통령령·부령 대상 조는 나중에 linkDelegations가 채운다 */
export function extractLinks(v: ArticleVersion): DelegationLink[] {
  const links: DelegationLink[] = [];
  for (const p of v.paragraphs) {
    const texts = [p.text, ...p.items.map((i) => i.text), ...p.items.flatMap((i) => i.subitems.map((s) => s.text))];
    for (const t of texts) {
      for (const { re, target } of DELEGATION_PATTERNS) {
        for (const m of t.matchAll(re)) {
          if (typeof target === "string") continue; // 대통령령·부령은 대상 조를 알아야 해서 따로
          const link: DelegationLink = { phrase: m[0], target };
          if (p.no) link.paragraph_no = p.no;
          if (!links.some((l) => l.phrase === link.phrase && l.paragraph_no === link.paragraph_no)) links.push(link);
        }
      }
    }
  }
  return links;
}

/** 꼬리표에서 조 이동을 읽는다: "[제11조의2에서 이동 …]", "[종전 제11조의2는 제11조의3으로 이동 …]" */
export function extractMoves(lawId: string, number: string, tags: string[]): { moved_from?: string; moved_to?: string } {
  const out: { moved_from?: string; moved_to?: string } = {};
  for (const tag of tags) {
    const from = tag.match(/(제\d+조(?:의\d+)?)에서 이동/);
    if (from) out.moved_from = articleId(lawId, from[1]) ?? undefined;
    const to = tag.match(/종전\s*(제\d+조(?:의\d+)?)[은는]\s*(제\d+조(?:의\d+)?)(?:으로|로)\s*이동/);
    if (to && to[1] === number) out.moved_to = articleId(lawId, to[2]) ?? undefined;
  }
  return out;
}

/**
 * 상위 법의 "대통령령으로 정하는…"·"교육부령으로 정하는…"을 하위 법령에서 "법 제N조"를 가리키는 조로 잇는다.
 * child의 조가 parent 조를 인용하면(예: 시행령 제15조 "법 제23조제1항에 따라") parent 조 → child 조 연결을 만든다.
 */
export function linkDelegations(parent: LawDocument, child: LawDocument, phrase: "대통령령" | "교육부령", refPattern: RegExp): void {
  const refs = new Map<string, Set<string>>();
  for (const a of child.articles) {
    const latest = a.versions[a.versions.length - 1];
    for (const m of latest.text.matchAll(refPattern)) {
      const pid = articleId(parent.law_id, `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`);
      if (!pid) continue;
      if (!refs.has(pid)) refs.set(pid, new Set());
      refs.get(pid)!.add(a.id);
    }
  }
  const re = phrase === "대통령령" ? /대통령령으로\s*정(?:하는 바에 따라|한다|하는|하며)/g : /교육부령으로\s*정(?:하는 바에 따라|한다|하는|하며)/g;
  for (const a of parent.articles) {
    const targets = refs.get(a.id);
    if (!targets) continue;
    const latest = a.versions[a.versions.length - 1];
    for (const p of latest.paragraphs) {
      const texts = [p.text, ...p.items.map((i) => i.text)];
      const m = texts.map((t) => t.match(re)).find(Boolean);
      if (!m) continue;
      for (const t of targets) {
        const link: DelegationLink = { phrase: m[0], target: { kind: "article", article_id: t } };
        if (p.no) link.paragraph_no = p.no;
        if (!a.links.some((l) => l.target.kind === "article" && l.target.article_id === t && l.paragraph_no === link.paragraph_no)) a.links.push(link);
      }
    }
  }
}

// ───────── 형식 검사 ─────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9_]+:\d{3}-\d{2}$/;

/** LawDocument 형식 검사. 문제 목록(빈 배열이면 통과) */
export function validateLawDocument(doc: LawDocument): string[] {
  const errs: string[] = [];
  const where = (s: string) => `${doc.law_id}: ${s}`;
  if (!doc.law_id || !/^[a-z0-9_]+$/.test(doc.law_id)) errs.push(where("law_id 형식"));
  if (!doc.law_name) errs.push(where("law_name 없음"));
  if (!Array.isArray(doc.articles) || doc.articles.length === 0) errs.push(where("articles 비어 있음"));
  const ids = new Set<string>();
  for (const a of doc.articles ?? []) {
    const w = (s: string) => where(`${a.id} ${s}`);
    if (!ID.test(a.id) || !a.id.startsWith(`${doc.law_id}:`)) errs.push(w("조 ID 형식"));
    if (ids.has(a.id)) errs.push(w("조 ID 중복"));
    ids.add(a.id);
    if (a.law_id !== doc.law_id) errs.push(w("law_id 불일치"));
    if (!Array.isArray(a.versions) || a.versions.length === 0) {
      errs.push(w("versions 비어 있음"));
      continue;
    }
    let prev: ArticleVersion | null = null;
    for (const v of a.versions) {
      if (!DATE.test(v.effective_from) || !DATE.test(v.promulgated)) errs.push(w("날짜 형식"));
      if (v.effective_to !== null && !DATE.test(v.effective_to)) errs.push(w("effective_to 형식"));
      if (v.effective_to !== null && v.effective_to < v.effective_from) errs.push(w(`effective_to(${v.effective_to}) < effective_from(${v.effective_from})`));
      if (!/^https:\/\/www\.law\.go\.kr\//.test(v.source_url)) errs.push(w("source_url이 law.go.kr가 아님"));
      if (prev) {
        if (prev.effective_from >= v.effective_from) errs.push(w("versions가 시행일 오름차순이 아님"));
        if (prev.effective_to === null || prev.effective_to >= v.effective_from) errs.push(w("판 구간이 겹침"));
      }
      for (const p of v.paragraphs) {
        if (!v.text.includes(p.text)) errs.push(w(`항(${p.no}) 본문이 조 원문에 없음`));
        for (const it of p.items) {
          if (!v.text.includes(it.text)) errs.push(w(`호(${it.no}) 본문이 조 원문에 없음`));
          for (const s of it.subitems) if (!v.text.includes(s.text)) errs.push(w(`목(${s.no}) 본문이 조 원문에 없음`));
        }
      }
      for (const t of v.amend_tags) if (!v.text.includes(t)) errs.push(w(`꼬리표가 원문에 없음: ${t}`));
      prev = v;
    }
    if (a.excerpt) {
      // 일부 항만 담은 조: 담은 항과 판의 항이 같아야 하고, 뺀 항은 겹치지 않아야 한다
      const kept = a.excerpt.paragraphs.join(",");
      for (const v of a.versions) if (v.paragraphs.map((p) => p.no).join(",") !== kept) errs.push(w(`excerpt 항(${kept})과 판의 항이 다름`));
      if (a.excerpt.omitted.some((n) => a.excerpt!.paragraphs.includes(n))) errs.push(w("excerpt 담은 항과 뺀 항이 겹침"));
      if (!a.excerpt.note) errs.push(w("excerpt note 없음"));
    }
  }
  return errs;
}

export function validateManifest(m: Manifest): string[] {
  const errs: string[] = [];
  if (m.schema_version !== 1) errs.push("manifest schema_version");
  const ids = new Set<string>();
  for (const e of m.entries ?? []) {
    if (ids.has(e.id)) errs.push(`manifest: id 중복 ${e.id}`);
    ids.add(e.id);
    if (!e.attribution) errs.push(`manifest ${e.id}: attribution 없음`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(e.collected_at)) errs.push(`manifest ${e.id}: collected_at은 KST ISO 시각`);
    if (e.storage === "file" && !e.path) errs.push(`manifest ${e.id}: storage file인데 path 없음`);
    if (e.kind === "school_rule" && !e.school) errs.push(`manifest ${e.id}: 학칙인데 school 없음`);
    if (e.kind === "school_rule" && !/학교|대학/.test(e.attribution.split(/[,(]/)[0])) errs.push(`manifest ${e.id}: 학칙 출처는 대학명 먼저`);
    for (const ed of e.editions) if (!DATE.test(ed.effective_from) || !DATE.test(ed.promulgated)) errs.push(`manifest ${e.id}: 판 날짜 형식`);
  }
  return errs;
}

export function validateOverrides(o: Overrides): string[] {
  const errs: string[] = [];
  if (o.schema_version !== 1) errs.push("overrides schema_version");
  for (const x of o.overrides ?? []) {
    if (!ID.test(x.article_id)) errs.push(`overrides: 조 ID 형식 ${x.article_id}`);
    if (x.effective_from && !DATE.test(x.effective_from)) errs.push(`overrides ${x.article_id}: 날짜 형식`);
    if (!x.basis) errs.push(`overrides ${x.article_id}: basis 없음`);
  }
  return errs;
}

export function validateSynonyms(s: Synonyms): string[] {
  const errs: string[] = [];
  if (s.schema_version !== 1) errs.push("synonyms schema_version");
  for (const g of s.groups ?? []) if (!Array.isArray(g) || g.length < 2 || g.some((w) => typeof w !== "string" || !w.trim())) errs.push(`synonyms: 묶음 형식 ${JSON.stringify(g)}`);
  return errs;
}
