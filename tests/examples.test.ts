// 첫 화면 예시 질문(messages.examples)이 평가 세트 문항 그대로이고 순서·태그가 정해진 대로인지 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "@/messages/ko.json";

const rows = readFileSync(join(__dirname, "..", "eval", "questions.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => JSON.parse(l) as { id: string; question: string });

describe("예시 질문", () => {
  it("E09·E19·E22·E28(처음 네 개)과 E03·E06(더 보기) 순서다", () => {
    expect(messages.examples.map((e) => e.id)).toEqual(["E09", "E19", "E22", "E28", "E03", "E06"]);
  });

  it("질문은 평가 세트 글자 그대로다", () => {
    for (const ex of messages.examples) {
      expect(ex.question, ex.id).toBe(rows.find((r) => r.id === ex.id)?.question);
    }
  });

  it("태그는 업무 상황 이름이고 옛 이름(처리 중·업무 시작)은 없다", () => {
    expect(messages.examples.map((e) => e.tag)).toEqual([
      "진행 중인 업무",
      "새로 시작하는 업무",
      "시행 전",
      "근거 없음",
      "진행 중인 업무",
      "진행 중인 업무",
    ]);
  });

  it("업무 상황 레이블과 값이 새 이름이다", () => {
    expect(messages.result.sceneLabel).toBe("업무 상황");
    expect(messages.result.scenes.processing).toBe("진행 중인 업무");
    expect(messages.result.scenes.initiating).toBe("새로 시작하는 업무");
  });
});
