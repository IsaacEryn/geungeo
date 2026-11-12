// 계약 파일이 서로 맞는지 보는 시험. data/examples/는 data/ 형식(설계 4-2)의 기준 예시다.
import { describe, expect, it } from "vitest";
import type { LawDocument, Manifest, Overrides } from "@/lib/cache/schema";
import heafExample from "@/data/examples/heaf.example.json";
import manifestExample from "@/data/examples/manifest.example.json";
import overridesExample from "@/data/examples/overrides.example.json";

const ARTICLE_ID = /^[a-z0-9_]+:\d{3}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("data/examples", () => {
  const doc = heafExample as LawDocument;
  const manifest = manifestExample as Manifest;
  const overrides = overridesExample as Overrides;

  it("조 ID와 날짜 형식을 지킨다", () => {
    for (const article of doc.articles) {
      expect(article.id).toMatch(ARTICLE_ID);
      expect(article.id.startsWith(`${doc.law_id}:`)).toBe(true);
      for (const v of article.versions) {
        expect(v.effective_from).toMatch(DATE);
        expect(v.promulgated).toMatch(DATE);
        if (v.effective_to !== null) expect(v.effective_to).toMatch(DATE);
        expect(v.source_url).toMatch(/^https:\/\/www\.law\.go\.kr\//);
      }
    }
  });

  it("판은 시행일 오름차순이고 마지막 판만 effective_to가 null이다", () => {
    for (const article of doc.articles) {
      const froms = article.versions.map((v) => v.effective_from);
      expect([...froms].sort()).toEqual(froms);
      article.versions.forEach((v, i) => {
        expect(v.effective_to === null).toBe(i === article.versions.length - 1);
      });
    }
  });

  it("항·호 본문이 조 원문 안에 그대로 있다(원문을 바꾸지 않는다)", () => {
    for (const article of doc.articles) {
      for (const v of article.versions) {
        for (const p of v.paragraphs) {
          expect(v.text).toContain(p.text);
          for (const item of p.items) expect(v.text).toContain(item.text);
        }
        for (const tag of v.amend_tags) expect(v.text).toContain(tag);
      }
    }
  });

  it("manifest와 overrides가 예시 법령을 가리킨다", () => {
    expect(manifest.entries.map((e) => e.id)).toContain(doc.law_id);
    const ids = new Set(doc.articles.map((a) => a.id));
    expect(overrides.overrides.some((o) => ids.has(o.article_id))).toBe(true);
  });
});
