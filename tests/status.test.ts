// 기준일 상태 계산: 평가 함정 E22·E23·E11과 기준일 경계(11/05 평가 기준일, 12/03 E23 시행일, 12/05 결선).
import { describe, expect, it } from "vitest";
import { resolveVersions, statusLabel, versionInForce, versionStatus } from "@/lib/cache/status";
import { buildTestCache } from "./support/cache";

const cache = buildTestCache();
const article = (id: string) => {
  const a = cache.articles.get(id);
  if (!a) throw new Error(`픽스처에 ${id} 없음`);
  return a;
};
const summary = (id: string, asOf: string) => resolveVersions(article(id), asOf).map((v) => `${v.version.effective_from}:${v.status}`);

describe("versionStatus", () => {
  const v = { effective_from: "2026-09-11", effective_to: "2026-12-02" };
  it("시행일 당일부터 시행 중, 종료일 다음 날부터 구판", () => {
    expect(versionStatus(v, "2026-09-10")).toBe("not_yet");
    expect(versionStatus(v, "2026-09-11")).toBe("in_force");
    expect(versionStatus(v, "2026-12-02")).toBe("in_force");
    expect(versionStatus(v, "2026-12-03")).toBe("superseded");
  });
  it("effective_to가 null이면 끝이 없다", () => {
    expect(versionStatus({ effective_from: "2022-02-07", effective_to: null }, "2099-01-01")).toBe("in_force");
  });
});

describe("E22 고등교육법 제11조의2(2027. 3. 11. 시행)", () => {
  it.each(["2026-11-05", "2026-12-03", "2026-12-05"])("%s에는 시행 예정", (asOf) => {
    expect(summary("heaf:011-02", asOf)).toEqual(["2027-03-11:not_yet"]);
    expect(versionInForce(article("heaf:011-02"), asOf)).toBeNull();
  });
  it("2027-03-11부터 시행 중", () => {
    expect(summary("heaf:011-02", "2027-03-11")).toEqual(["2027-03-11:in_force"]);
  });
});

describe("E23 고등교육법 제34조의2⑤(2026. 12. 3. 시행)", () => {
  it("11/05에는 현행 판(⑤ 없음)과 예정 판을 함께 본다", () => {
    expect(summary("heaf:034-02", "2026-11-05")).toEqual(["2026-09-11:in_force", "2026-12-03:not_yet"]);
    expect(versionInForce(article("heaf:034-02"), "2026-11-05")?.text).not.toContain("외부 위원");
  });
  it("12/02까지는 시행 전", () => {
    expect(summary("heaf:034-02", "2026-12-02")).toEqual(["2026-09-11:in_force", "2026-12-03:not_yet"]);
  });
  it.each(["2026-12-03", "2026-12-05"])("%s에는 ⑤가 시행 중이고 구판은 빠진다", (asOf) => {
    expect(summary("heaf:034-02", asOf)).toEqual(["2026-12-03:in_force"]);
    expect(versionInForce(article("heaf:034-02"), asOf)?.text).toContain("외부 위원");
  });
});

describe("E11 방송대 학칙 부칙<제1315호>(2027. 3. 1. 시행)", () => {
  it.each(["2026-11-05", "2026-12-03", "2026-12-05"])("%s에는 시행 예정", (asOf) => {
    expect(summary("knou_rule:902-00", asOf)).toEqual(["2027-03-01:not_yet"]);
  });
  it("2027-03-01부터 시행 중", () => {
    expect(summary("knou_rule:902-00", "2027-03-01")).toEqual(["2027-03-01:in_force"]);
  });
});

describe("statusLabel", () => {
  it("글자로 상태를 말한다", () => {
    expect(statusLabel("not_yet", "2027-03-11")).toBe("2027. 3. 11. 시행 예정");
    expect(statusLabel("in_force", "2026-12-03")).toBe("시행 중(2026. 12. 3. 시행)");
    expect(statusLabel("superseded", "2026-09-11")).toBe("이전 판");
  });
});
