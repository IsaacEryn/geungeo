// hostname 등급(설계 2-2 표)과 교육부 목록·메뉴 제외, 재게시본 규칙.
import { describe, expect, it } from "vitest";
import { duplicatesOfOriginals, gradeWebResult } from "@/lib/grade";

const r = (url: string, title = "제목", description = "", date: string | null = "2026-10-27") => ({
  url,
  title,
  description,
  date,
  hostname: new URL(url).hostname,
});

describe("gradeWebResult", () => {
  it("*.go.kr·korea.kr은 W1", () => {
    expect(gradeWebResult(r("https://opinion.moleg.go.kr/x")).grade).toBe("W1");
    expect(gradeWebResult(r("https://www.law.go.kr/LSW/lsInfoR.do")).grade).toBe("W1");
    expect(gradeWebResult(r("https://www.korea.kr/news/policyNewsView.do?newsId=1")).grade).toBe("W1");
    expect(gradeWebResult(r("https://www.kosaf.go.kr/ko/notice.do")).grade).toBe("W1");
  });

  it("교육부 게시글 본문(boardSeq 있음)은 W1 카드", () => {
    const g = gradeWebResult(r("https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=107492&m=020402"));
    expect(g).toMatchObject({ grade: "W1", date: "2026-10-27" });
    expect(g.excluded).toBeUndefined();
  });

  it("교육부 목록·메뉴는 제외하고 날짜를 비운다", () => {
    expect(gradeWebResult(r("https://www.moe.go.kr/boardCnts/listRenew.do?boardID=294&m=020402")).excluded).toBe("list_page");
    expect(gradeWebResult(r("https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&m=020402")).excluded).toBe("list_page");
    const menu = gradeWebResult(r("https://www.moe.go.kr/sub/info.do?m=0501", "교육부 > 교육부 소식 > 공지사항 > 사업공고"));
    expect(menu.excluded).toBe("menu_page");
    expect(menu.date).toBeNull();
  });

  it("첨부 내려받기(fileDown.do)는 카드에 남기되 게시일을 비운다", () => {
    const g = gradeWebResult(r("https://www.moe.go.kr/boardCnts/fileDown.do?m=0204&boardID=294&boardSeq=1&fileSeq=2"));
    expect(g.grade).toBe("W1");
    expect(g.excluded).toBeUndefined();
    expect(g.date).toBeNull();
  });

  it("교육부 공식 블로그는 W1_aux, 다른 블로그는 W3", () => {
    expect(gradeWebResult(r("https://blog.naver.com/moeblog/224455227530")).grade).toBe("W1_aux");
    expect(gradeWebResult(r("https://m.blog.naver.com/moeblog/224455227530")).grade).toBe("W1_aux");
    expect(gradeWebResult(r("https://blog.naver.com/someone/1")).grade).toBe("W3");
  });

  it("*.ac.kr은 W2, 정부 문서 표지가 있으면 재게시본", () => {
    expect(gradeWebResult(r("https://www.snu.ac.kr/admission/notice", "2027학년도 모집요강")).grade).toBe("W2");
    const repost = gradeWebResult(
      r("https://www.hknu.ac.kr/bbs/ir/430/116546/download.do", "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙｣ 입법예고", "2026년 10월 27일. 교육부장관."),
    );
    expect(repost.grade).toBe("W2_repost");
    expect(repost.notes.join(" ")).toContain("원문 확인 필요");
  });

  it("언론은 W3(근거 아님)", () => {
    const g = gradeWebResult(r("https://www.yna.co.kr/view/AKR2026"));
    expect(g.grade).toBe("W3");
    expect(g.notes[0]).toContain("근거 아님");
  });
});

describe("duplicatesOfOriginals", () => {
  it("같은 제목의 W1 원문이 있으면 블로그·대학 재게시본을 뺀다", () => {
    const drop = duplicatesOfOriginals([
      { title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙」 입법예고", grade: "W1" },
      { title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙｣ 입법예고", grade: "W1_aux" },
      { title: "「고등교육법 시행령」 및 「대학 등록금에 관한 규칙｣ 입법예고", grade: "W2_repost" },
      { title: "국가장학금 1차 신청 안내", grade: "W1_aux" },
    ]);
    expect([...drop]).toEqual([1, 2]);
  });
  it("원문이 목록 페이지로 제외됐으면 재게시본을 남긴다", () => {
    const drop = duplicatesOfOriginals([
      { title: "입법예고 안내", grade: "W1", excluded: "list_page" },
      { title: "입법예고 안내", grade: "W1_aux" },
    ]);
    expect(drop.size).toBe(0);
  });
});
