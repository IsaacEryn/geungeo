import { describe, expect, it } from "vitest";
import { displayNote } from "../components/EvidenceCard";

describe("근거 카드 개정 메모 표시", () => {
  it("조 단위 판 시행일임을 풀어 쓴다", () => {
    expect(displayNote("개정 — 2022. 2. 7.부터 시행")).toBe("조 현행 판 2022. 2. 7. 시행");
  });
  it("다른 메모는 그대로 둔다", () => {
    expect(displayNote("학칙으로 위임 — 학교별 확인")).toBe("학칙으로 위임 — 학교별 확인");
  });
});
