import { describe, expect, it } from "vitest";
import manifest from "@/data/manifest.json";
import messages from "@/messages/ko.json";

// 수록 범위 패널의 글은 정적이라, 실제 수록 데이터와 어긋나지 않는지 여기서 지킨다.
describe("수록 범위 패널 글", () => {
  const names = new Set(manifest.entries.map((e) => e.name));

  it("법령·행정규칙 목록은 manifest에 모두 있다", () => {
    for (const law of messages.coverage.laws) expect(names.has(law), law).toBe(true);
  });

  it("manifest의 본 법령(부칙 제외, 학칙 제외)이 패널 목록과 같은 수다", () => {
    const main = [...names].filter((n) => !n.includes("부칙") && !n.endsWith("학칙"));
    expect(main.sort()).toEqual([...messages.coverage.laws].sort());
  });

  it("학칙 7개 대학이 manifest 학칙과 학교 선택 목록에 맞다", () => {
    const rules = manifest.entries.filter((e) => e.kind === "school_rule").map((e) => e.name.replace(/ 학칙$/, ""));
    expect([...rules].sort()).toEqual([...messages.coverage.schools].sort());
    expect([...Object.values(messages.form.schools)].sort()).toEqual([...messages.coverage.schools].sort());
  });

  it("수집일 범위가 manifest의 가장 이른·늦은 수집일과 같다", () => {
    const days = manifest.entries.map((e) => e.collected_at.slice(0, 10)).sort();
    const fmtDay = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return { y, m, d };
    };
    const first = fmtDay(days[0]);
    const last = fmtDay(days[days.length - 1]);
    expect(messages.coverage.dateBody).toContain(`${first.y}. ${first.m}. ${first.d}.~${last.m}. ${last.d}.`);
  });

  it("고등교육법·시행령은 가장 늦은 수집일에 받았다", () => {
    const latest = manifest.entries.map((e) => e.collected_at.slice(0, 10)).sort().pop();
    for (const name of ["고등교육법", "고등교육법 시행령"]) {
      expect(manifest.entries.find((e) => e.name === name)?.collected_at.slice(0, 10), name).toBe(latest);
    }
  });

  it("머리글·바닥글 글에는 특정 대학 이름이 없다", () => {
    const shown = JSON.stringify([messages.app, messages.footer]);
    for (const school of messages.coverage.schools) expect(shown).not.toContain(school);
  });
});
