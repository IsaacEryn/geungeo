// 주소 끝 조각(#code=…)으로 접근 코드를 넘기는 경우. 코드를 읽고, 나머지 조각은 그대로 남겨야 한다.
import { describe, expect, it } from "vitest";
import { accessCodeFromHash } from "@/components/ask-client";

describe("accessCodeFromHash", () => {
  it("#code=…만 있으면 코드를 읽고 조각을 비운다", () => {
    expect(accessCodeFromHash("#code=abc123")).toEqual({ code: "abc123", rest: "" });
  });

  it("코드가 없으면 조각을 건드리지 않는다", () => {
    expect(accessCodeFromHash("")).toEqual({ code: null, rest: "" });
    expect(accessCodeFromHash("#main")).toEqual({ code: null, rest: "#main" });
    expect(accessCodeFromHash("#encode=x")).toEqual({ code: null, rest: "#encode=x" });
  });

  it("다른 값 사이에 있어도 코드만 빼고 나머지는 남긴다", () => {
    expect(accessCodeFromHash("#x=1&code=abc&y=2")).toEqual({ code: "abc", rest: "#x=1&y=2" });
  });

  it("퍼센트 인코딩은 풀고 '+'는 그대로 두며 앞뒤 공백은 뺀다", () => {
    expect(accessCodeFromHash("#code=a%20b+c")).toEqual({ code: "a b+c", rest: "" });
    expect(accessCodeFromHash("#code=%20abc%20")).toEqual({ code: "abc", rest: "" });
  });

  it("빈 코드는 null이지만 주소에서는 지운다", () => {
    expect(accessCodeFromHash("#code=")).toEqual({ code: null, rest: "" });
  });

  it("인코딩이 깨졌으면 받은 글자 그대로 쓴다", () => {
    expect(accessCodeFromHash("#code=abc%E0%A4%A")).toEqual({ code: "abc%E0%A4%A", rest: "" });
  });
});
