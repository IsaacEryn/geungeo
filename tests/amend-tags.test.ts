import { describe, expect, it } from "vitest";
import { splitAmendTags } from "@/components/format";

describe("splitAmendTags", () => {
  it("문장 끝 이력 꼬리표를 떼고 본문은 그대로 둔다", () => {
    const quote = "② 위원회는 7명 이상의 위원으로 구성한다. <개정 2022. 2. 7.>\n③ 위원은 학생을 포함한다. <신설 2022. 2. 7.>";
    const { body, tags } = splitAmendTags(quote);
    expect(body).toBe("② 위원회는 7명 이상의 위원으로 구성한다.\n③ 위원은 학생을 포함한다.");
    expect(tags).toEqual(["<개정 2022. 2. 7.>", "<신설 2022. 2. 7.>"]);
  });

  it("대괄호 이력도 떼고, 이력이 없으면 그대로다", () => {
    expect(splitAmendTags("제5조 삭제 [전문개정 2011. 7. 21.]").tags).toEqual(["[전문개정 2011. 7. 21.]"]);
    const plain = "① 학교는 학점을 인정할 수 있다.";
    expect(splitAmendTags(plain)).toEqual({ body: plain, tags: [] });
  });
});
