// lib/cache/load.ts·lawdata.ts 시험: 실제 data/가 형식대로 읽히는지, 시행일 함정 조가 맞게 들어갔는지,
// 형식 오류를 잡는지, 학칙이 data/rules/ 파일로 읽히고 remote는 명시적으로 허용할 때만 도는지, notices 형식.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CacheFormatError, checkedNotices, loadCache, loadSchoolRuleBundle, loadSchoolRules, validateNotices, type NoticeCache } from "@/lib/cache/load";
import {
  addDays,
  buildLawDocument,
  circledToNumber,
  parseHistoryList,
  parseLawPage,
  toIsoDate,
  validateLawDocument,
  type EditionInput,
} from "@/lib/cache/lawdata";
import type { LawArticle, Manifest } from "@/lib/cache/schema";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "data");
const FIX = join(ROOT, "tests/fixtures/lawgo");

/** 기준일에 시행 중인 판(없으면 undefined) */
const at = (a: LawArticle, d: string) => a.versions.find((v) => v.effective_from <= d && (v.effective_to === null || d <= v.effective_to));

describe("loadCache(실제 data/)", () => {
  it("manifest의 법령을 모두 읽고 형식 검사를 통과한다", async () => {
    const cache = await loadCache({ dataDir: DATA, reload: true });
    for (const id of ["heaf", "heaf_decree", "tuition_rule", "remote_class_rule", "private_school_act", "edu_official_act"]) {
      expect(cache.laws.has(id), id).toBe(true);
    }
    expect(cache.articles.size).toBeGreaterThan(400);
    expect(cache.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
    // 학칙: 쓰는 조·항만 data/rules/에 담아 파일로 읽는다
    const rules = cache.manifest.entries.filter((e) => e.kind === "school_rule");
    expect(rules.map((e) => e.school).sort()).toEqual(["dcu", "dnue", "knou", "knu", "pnu", "seoultech", "snu"]);
    for (const e of rules) {
      expect(e.storage).toBe("file");
      expect(e.attribution.startsWith(e.name)).toBe(true); // 대학명 먼저
      // 법제처에 없는 학칙(대구사이버대학교)만 학교 공식 규정 웹사이트 공개본을 사람이 옮겼다
      if (e.method === "manual") expect(e.attribution).toContain("규정 웹사이트(rule.dcu.ac.kr) 공개본");
      else expect(e.attribution).toContain("법제처 국가법령정보센터 게재본");
      expect(e.scope).toMatch(/^시연·평가에 쓰는 조·항만/);
    }
    expect(cache.warnings).toEqual([]);
  });

  it("학칙: 평가 근거 조 11개가 실려 있고, 그 밖의 조는 없다", async () => {
    const cache = await loadCache({ dataDir: DATA });
    const ids = [...cache.articles.keys()].filter((id) => /^(snu|pnu|knou)_rule/.test(id)).sort();
    expect(ids).toEqual([
      "knou_rule_a1315:001-00",
      "knou_rule_a1315:002-00",
      "pnu_rule:064-00",
      "pnu_rule:085-00",
      "snu_rule:066-00",
      "snu_rule:085-00",
      "snu_rule:103-00",
      "snu_rule:104-00",
      "snu_rule:113-00",
      "snu_rule:118-00",
      "snu_rule:119-00",
    ]);
    // 일부 항만 담은 조: 담은 항만 원문에 있고 excerpt로 표시된다
    const a66 = cache.articles.get("snu_rule:066-00")!;
    expect(a66.excerpt?.paragraphs).toEqual(["4", "5"]);
    expect(a66.versions[0].paragraphs.map((p) => p.no)).toEqual(["4", "5"]);
    expect(a66.versions[0].text).toContain("6개 학기 또는 3년");
    expect(a66.versions[0].text).not.toContain("①");
    expect(cache.articles.get("snu_rule:113-00")!.versions[0].text).toContain("교직원 3명, 학생 3명");
    expect(cache.articles.get("pnu_rule:085-00")!.excerpt).toBeUndefined(); // 조 전체
    // E11: 학과명 변경 경과조치는 2027. 3. 1. 시행이라 2026-11-05에는 시행 중인 판이 없다
    const k2 = cache.articles.get("knou_rule_a1315:002-00")!;
    expect(at(k2, "2026-11-05")).toBeUndefined();
    expect(at(k2, "2027-03-01")?.text).toContain("평생교육상담심리학과");
    const knou = cache.manifest.entries.find((e) => e.id === "knou_rule")!;
    expect(knou.editions.map((e) => e.promulgation_no)).toEqual(["한국방송통신대학교학칙 제1309호", "한국방송통신대학교학칙 제1315호"]);
    expect(knou.limitations?.length).toBeGreaterThan(0);
    // 글자 수: 인용 수준(합계 1만 자 미만)
    const chars = ids.reduce((n, id) => n + cache.articles.get(id)!.versions.reduce((m, v) => m + v.text.length, 0), 0);
    expect(chars).toBeLessThan(10000);
  });

  it("notices: 원문에서 확인한 수치만 있고, 원문 확인 필요 항목은 수치가 비어 있다", async () => {
    const cache = await loadCache({ dataDir: DATA });
    const all = cache.notices!.notices;
    expect(all.length).toBeGreaterThan(0);
    for (const n of all) {
      if (n.status === "needs_source_check") expect(n.figures ?? []).toEqual([]);
      for (const f of n.figures ?? []) expect(f.checked_url).toMatch(/^https:\/\/www\.moe\.go\.kr\//);
      expect(JSON.stringify(n)).not.toContain("3.19");
    }
    expect(all.find((n) => n.id === "moe-tuition-cap-2026")?.status).toBe("needs_source_check");
    expect(checkedNotices(cache).every((n) => (n.figures ?? []).length > 0)).toBe(true);
    expect(checkedNotices(cache, 2026).map((n) => n.id)).toContain("moe-national-scholarship-2026-1");
  });

  it("같은 옵션이면 한 번 읽은 캐시를 재사용한다", async () => {
    const a = await loadCache({ dataDir: DATA });
    const b = await loadCache({ dataDir: DATA });
    expect(a).toBe(b);
  });

  it("E22: 제11조의2(기숙사비심의위원회)는 2027-03-11 시행, 그 전에는 시행 중인 원문이 없다", async () => {
    const { articles } = await loadCache({ dataDir: DATA });
    const a = articles.get("heaf:011-02")!;
    expect(at(a, "2026-11-05")).toBeUndefined();
    expect(at(a, "2027-03-11")?.text).toContain("기숙사비심의위원회");
    expect(at(a, "2027-03-10")).toBeUndefined();
    // 결선일(12/05)과 그 앞 평가 기준일(12/03)에도 시행 중인 판이 없다
    expect(at(a, "2026-12-03")).toBeUndefined();
    expect(at(a, "2026-12-05")).toBeUndefined();
    expect(a.moved_to).toBe("heaf:011-03");
    expect(at(articles.get("heaf:011-03")!, "2026-11-05")?.text).toContain("평가 등");
  });

  it("E23: 제34조의2③~⑤(외부 평가 위원 준용)는 2026-12-03부터, 결선일 12/05에도 시행 중", async () => {
    const { articles } = await loadCache({ dataDir: DATA });
    const a = articles.get("heaf:034-02")!;
    expect(at(a, "2026-11-05")?.text).not.toContain("외부 위원");
    expect(at(a, "2026-12-02")?.text).not.toContain("외부 위원");
    expect(at(a, "2026-12-03")?.text).toContain("평가 위원을 외부에서 위촉하는 경우");
    // 결선일(12/05)에는 ⑤가 시행 중
    expect(at(a, "2026-12-05")?.effective_from).toBe("2026-12-03");
    expect(at(a, "2026-12-05")?.text).toContain("⑤ 제1항에 따른 교육부장관이 시행하는 시험의 성적 외의");
  });

  it("E06: 제23조의4제3호(육아휴학 12세 이하)는 2025-04-23부터, 그 전은 개정 전 문구", async () => {
    const { articles } = await loadCache({ dataDir: DATA });
    const a = articles.get("heaf:023-04")!;
    expect(at(a, "2025-04-23")?.text).toContain("12세 이하");
    expect(at(a, "2025-04-22")?.text).not.toContain("12세 이하");
    expect(at(a, "2025-04-23")?.promulgation_no).toBe("법률 제20466호");
  });

  it("E15: 제11조제10항 인상률 상한은 2025-10-01부터 1.2배, 그 전 1.5배", async () => {
    const { articles } = await loadCache({ dataDir: DATA });
    const a = articles.get("heaf:011-00")!;
    expect(at(a, "2025-09-30")?.text).toContain("1.5배");
    expect(at(a, "2025-10-01")?.text).toContain("1.2배");
  });

  it("위임 연결: 시행령 제14조의2 → 원격수업 훈령 제4조, 법 제23조 → 시행령 제15조", async () => {
    const { articles } = await loadCache({ dataDir: DATA });
    const targets = (id: string) => articles.get(id)!.links.flatMap((l) => (l.target.kind === "article" ? [l.target.article_id] : []));
    expect(targets("heaf_decree:014-02")).toContain("remote_class_rule:004-00");
    expect(targets("heaf:023-00")).toContain("heaf_decree:015-00");
    expect(articles.get("heaf:023-04")!.links.some((l) => l.target.kind === "school_rule")).toBe(true);
  });
});

describe("형식 검사", () => {
  function tempData(): string {
    const dir = mkdtempSync(join(tmpdir(), "geungeo-data-"));
    cpSync(DATA, dir, { recursive: true });
    return dir;
  }

  it("항 본문이 조 원문에 없으면(원문을 고침) 읽기를 거부한다", async () => {
    const dir = tempData();
    const p = join(dir, "laws/tuition_rule.json");
    const doc = JSON.parse(readFileSync(p, "utf8"));
    doc.articles[0].versions[0].paragraphs[0].text += " (고친 문장)";
    writeFileSync(p, JSON.stringify(doc));
    await expect(loadCache({ dataDir: dir, reload: true })).rejects.toBeInstanceOf(CacheFormatError);
  });

  it("판 구간이 겹치면 거부한다", async () => {
    const dir = tempData();
    const p = join(dir, "laws/heaf.json");
    const doc = JSON.parse(readFileSync(p, "utf8"));
    const a = doc.articles.find((x: LawArticle) => x.versions.length > 1);
    a.versions[0].effective_to = a.versions[1].effective_from;
    writeFileSync(p, JSON.stringify(doc));
    await expect(loadCache({ dataDir: dir, reload: true })).rejects.toThrow(/겹침/);
  });

  it("overrides가 없는 조를 가리키면 거부한다", async () => {
    const dir = tempData();
    const p = join(dir, "overrides.json");
    const o = JSON.parse(readFileSync(p, "utf8"));
    o.overrides.push({ article_id: "heaf:999-00", effective_from: "2027-01-01", basis: "시험" });
    writeFileSync(p, JSON.stringify(o));
    await expect(loadCache({ dataDir: dir, reload: true })).rejects.toThrow(/없는 조/);
  });

  it("공공누리 확인 없이 공고 발췌를 두면 거부한다", async () => {
    const dir = tempData();
    writeFileSync(
      join(dir, "notices.json"),
      JSON.stringify({ schema_version: 1, notices: [{ id: "n1", title: "공고", issuer: "교육부", year: 2026, url: "https://www.moe.go.kr/x", posted: null, excerpt: "발췌", kogl_type1_confirmed: false, collected_at: "2026-11-13T00:00:00+09:00" }] }),
    );
    await expect(loadCache({ dataDir: dir, reload: true })).rejects.toThrow(/공공누리/);
  });

  it("학칙 출처 표기가 대학명으로 시작하지 않으면 거부한다", async () => {
    const dir = tempData();
    const p = join(dir, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8")) as Manifest;
    m.entries.find((e) => e.kind === "school_rule")!.attribution = "출처: 법제처 국가법령정보센터";
    writeFileSync(p, JSON.stringify(m));
    await expect(loadCache({ dataDir: dir, reload: true })).rejects.toThrow(/대학명/);
  });
});

describe("lawdata 파서·판 비교", () => {
  const html = readFileSync(join(FIX, "heaf_20260911_excerpt.html"), "utf8");

  it("법령 화면에서 머리글·조·항·호·꼬리표·부칙을 읽는다", () => {
    const p = parseLawPage(html, "heaf");
    expect(p).toMatchObject({ law_name: "고등교육법", effective_from: "2026-09-11", promulgated: "2026-03-10", promulgation_no: "법률 제21423호" });
    expect(p.articles.map((a) => a.id)).toEqual(["heaf:011-02", "heaf:011-03", "heaf:023-04"]);
    const a = p.articles[0];
    expect(a.title).toBe("기숙사비 및 기숙사비심의위원회");
    expect(a.paragraphs.map((x) => x.no)).toEqual(["1", "2", "3"]);
    expect(a.paragraphs[1].items.map((x) => x.no)).toEqual(["1", "2", "3", "4"]);
    expect(a.amend_tags).toEqual(["[본조신설 2026. 3. 10.]", "[종전 제11조의2는 제11조의3으로 이동 <2026. 3. 10.>]"]);
    const holiday = p.articles[2];
    expect(holiday.paragraphs[0].no).toBe("");
    expect(holiday.paragraphs[0].text.endsWith("휴학하게 한다.")).toBe(true); // 줄 끝 꼬리표는 항 본문에서 뺀다
    expect(holiday.amend_tags).toContain("<개정 2024. 10. 22.>");
    expect(p.addenda[0].promulgation_no).toBe("법률 제21423호");
    expect(p.addenda[0].articles[0].text).toContain("공포 후 1년이 경과한 날");
  });

  it("예시 파일(data/examples)과 같은 모양으로 조를 만든다", () => {
    const example = JSON.parse(readFileSync(join(DATA, "examples/heaf.example.json"), "utf8"));
    const p = parseLawPage(html, "heaf");
    const a = p.articles[0];
    expect(a.text).toBe(example.articles[0].versions[0].text);
    expect(a.paragraphs).toEqual(example.articles[0].versions[0].paragraphs);
  });

  it("시행 전 조문이 미리 보이는 판은 overrides 날짜 전에는 쓰지 않고, 개정 공포일보다 이른 날에는 그 원문을 쓰지 않는다", () => {
    const base = parseLawPage(html, "heaf");
    const old = structuredClone(base);
    old.effective_from = "2026-03-01";
    old.promulgated = "2025-01-01";
    old.promulgation_no = "법률 제1호";
    old.articles[0] = { ...old.articles[0], text: "제11조의2(옛 조) 옛 원문", paragraphs: [{ no: "", text: "옛 원문", items: [] }], amend_tags: [] };
    const editions: EditionInput[] = [
      { parsed: old, source_url: "https://www.law.go.kr/old" },
      { parsed: base, source_url: "https://www.law.go.kr/new" },
    ];
    const doc = buildLawDocument(editions, {
      law_id: "heaf",
      kind: "act",
      overrides: [{ article_id: "heaf:011-02", effective_from: "2027-03-11", basis: "시험" }],
    });
    expect(validateLawDocument(doc)).toEqual([]);
    const a = doc.articles.find((x) => x.id === "heaf:011-02")!;
    expect(a.versions.map((v) => [v.effective_from, v.effective_to])).toEqual([
      ["2026-03-01", "2027-03-10"],
      ["2027-03-11", null],
    ]);
    // 두 판에 같은 원문이 있는 조는 앞 판 시행일부터 한 판으로 묶는다
    const h = doc.articles.find((x) => x.id === "heaf:023-04")!;
    expect(h.versions[0].effective_from).toBe("2026-03-01");
  });

  it("연혁 목록·날짜·원문자 보조 함수", () => {
    const list = parseHistoryList(
      "lsViewLsHst2('283883', '20260310', '21423', '20270311', 'N', '0' , '일부개정');lsViewLsHst2('283883', '20260310', '21423', '20260911', 'Y', '0' , '일부개정')",
    );
    expect(list).toEqual([
      { lsiSeq: "283883", promulgated: "2026-03-10", promulgation_number: "21423", effective_from: "2027-03-11", current: false, amendment_kind: "일부개정" },
      { lsiSeq: "283883", promulgated: "2026-03-10", promulgation_number: "21423", effective_from: "2026-09-11", current: true, amendment_kind: "일부개정" },
    ]);
    expect(toIsoDate("2026. 3. 10.")).toBe("2026-03-10");
    expect(toIsoDate("2027.3.1.")).toBe("2027-03-01");
    expect(addDays("2027-03-11", -1)).toBe("2027-03-10");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(circledToNumber("⑫")).toBe("12");
    expect(circledToNumber("㉑")).toBe("21");
  });
});

describe("학칙 두 방식", () => {
  const ruleHtml = readFileSync(join(FIX, "school_rule_synthetic.html"), "utf8");

  function dataWithRule(storage: "file" | "remote"): string {
    const dir = mkdtempSync(join(tmpdir(), "geungeo-rules-"));
    cpSync(DATA, dir, { recursive: true });
    const p = join(dir, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8")) as Manifest;
    const e = m.entries.find((x) => x.school === "snu")!;
    e.source_url = "https://www.law.go.kr/LSW/schlPubRulInfoR.do?schlPubRulSeq=2200000000001";
    e.storage = storage;
    if (storage === "file") e.path = `rules/${e.id}.json`;
    writeFileSync(p, JSON.stringify(m));
    return dir;
  }

  it("remote: law.go.kr 화면을 받아 조와 부칙을 만든다(요청은 주입한 fetch로)", async () => {
    const dir = dataWithRule("remote");
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls += 1;
      expect(url).toBe("https://www.law.go.kr/LSW/schlPubRulInfoR.do?schlPubRulSeq=2200000000001");
      return new Response(ruleHtml, { status: 200 });
    }) as unknown as typeof fetch;
    const bundle = await loadSchoolRuleBundle("snu", { dataDir: dir, fetchImpl, allowRemote: true });
    expect(bundle?.storage).toBe("remote");
    expect(bundle?.rules.school).toBe("snu");
    const art = bundle!.rules.articles.find((a) => a.id === "snu_rule:005-00")!;
    expect(art.title).toBe("휴학(일반)");
    expect(art.versions[0].effective_from).toBe("2026-03-01");
    expect(art.versions[0].paragraphs.map((p) => p.no)).toEqual(["1", "2", "3"]);
    expect(bundle!.addenda[0].articles.map((a) => a.id)).toEqual(["snu_rule_a100:001-00", "snu_rule_a100:002-00"]);
    // 두 번째 부르면 받은 것을 재사용
    await loadSchoolRules("snu", { dataDir: dir, fetchImpl, allowRemote: true });
    expect(calls).toBe(1);
  });

  it("remote: allowRemote 없이는 law.go.kr을 부르지 않고 null(앱 실행 경로)", async () => {
    const dir = dataWithRule("remote");
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(ruleHtml, { status: 200 });
    }) as unknown as typeof fetch;
    expect(await loadSchoolRules("snu", { dataDir: dir, fetchImpl, reload: true })).toBeNull();
    expect(await loadSchoolRules("snu", { dataDir: dir, fetchImpl, rules: "remote", reload: true })).toBeNull();
    const cache = await loadCache({ dataDir: dir, rules: "remote", reload: true });
    expect([...cache.laws.values()].some((d) => d.kind === "school_rule")).toBe(false);
    expect(calls).toBe(0);
  });

  it("remote: law.go.kr 오류 페이지나 실패면 null(답에는 '학칙 확인 필요')", async () => {
    const dir = dataWithRule("remote");
    const errorPage = "<html><head><title>국가법령정보센터 | 오류페이지</title></head><body><div id=\"error500\">해당 한글주소명을 찾을 수 없습니다.</div></body></html>";
    const fetchImpl = (async () => new Response(errorPage, { status: 200 })) as unknown as typeof fetch;
    expect(await loadSchoolRules("snu", { dataDir: dir, fetchImpl, reload: true, allowRemote: true })).toBeNull();
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await loadSchoolRules("snu", { dataDir: dir, fetchImpl: failing, reload: true, allowRemote: true })).toBeNull();
  });

  it("file: data/rules/의 파일을 loadCache와 loadSchoolRules가 함께 읽는다", async () => {
    const dir = dataWithRule("file");
    const parsed = parseLawPage(ruleHtml, "snu_rule");
    const doc = buildLawDocument([{ parsed, source_url: "https://www.law.go.kr/LSW/schlPubRulInfoR.do?schlPubRulSeq=2200000000001" }], {
      law_id: "snu_rule",
      law_name: "서울대학교 학칙",
      kind: "school_rule",
      school: "snu",
    });
    writeFileSync(join(dir, "rules/snu_rule.json"), JSON.stringify(doc));
    const cache = await loadCache({ dataDir: dir, reload: true });
    expect(cache.articles.has("snu_rule:005-00")).toBe(true);
    expect(cache.laws.get("snu_rule")?.kind).toBe("school_rule");
    expect((await loadSchoolRules("snu", { dataDir: dir }))?.articles.length).toBe(2);
    expect(cache.warnings?.some((w) => w.includes("부산대학교"))).toBe(false);
  });

  it("방송대처럼 부칙만 담은 학교도 loadSchoolRuleBundle이 읽는다", async () => {
    const bundle = await loadSchoolRuleBundle("knou", { dataDir: DATA, reload: true });
    expect(bundle?.storage).toBe("file");
    expect(bundle?.rules.law_id).toBe("knou_rule_a1315");
  });

  it("학칙 파일이 없으면 경고를 남긴다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "geungeo-norules-"));
    cpSync(DATA, dir, { recursive: true });
    for (const f of ["snu_rule.json", "pnu_rule.json", "knou_rule_a1315.json"]) rmSync(join(dir, "rules", f));
    const cache = await loadCache({ dataDir: dir, reload: true });
    expect(cache.warnings?.length).toBe(3);
  });
});

describe("notices 형식 검사", () => {
  const base = (extra: Partial<NoticeCache["notices"][number]>): NoticeCache => ({
    schema_version: 1,
    notices: [
      {
        id: "x",
        title: "t",
        issuer: "교육부",
        year: 2026,
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=1",
        posted: "2026-01-01",
        excerpt: null,
        kogl_type1_confirmed: false,
        collected_at: "2026-11-13T00:00:00+09:00",
        ...extra,
      },
    ],
  });
  const fig = (checked_url: string) => ({ label: "l", value: "1.2배", location: "본문", checked_url });

  it("moe.go.kr HTML에서 확인한 수치는 통과", () => {
    expect(validateNotices(base({ figures: [fig("https://www.moe.go.kr/upload/synap/202611/abc.files/1.html")] }))).toEqual([]);
  });
  it("HWPX·PDF나 다른 사이트에서 확인한 수치는 막는다", () => {
    expect(validateNotices(base({ figures: [fig("https://www.moe.go.kr/boardCnts/fileDown.do?x=1.hwpx")] }))).toHaveLength(1);
    expect(validateNotices(base({ figures: [fig("https://news.example.com/a")] }))).toHaveLength(1);
  });
  it("원문 확인 필요 항목에는 수치를 둘 수 없다", () => {
    expect(validateNotices(base({ status: "needs_source_check", figures: [fig("https://www.moe.go.kr/a.html")] }))).toHaveLength(1);
  });
  it("공공누리 확인 없이 발췌를 둘 수 없다", () => {
    expect(validateNotices(base({ excerpt: "문장" }))).toHaveLength(1);
  });
});
