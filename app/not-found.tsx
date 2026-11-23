import type { Metadata } from "next";
import { StatusScreen } from "@/components/StatusScreen";
import messages from "@/messages/ko.json";

const ts = messages.status;

// 탭 제목: "페이지를 찾을 수 없습니다 - 근거"(layout의 제목 틀)
export const metadata: Metadata = { title: ts.notFoundTitle };

/** 없는 주소(404). Next 기본 영문 화면 대신 서비스 틀 안에서 처음 화면으로 안내한다 */
export default function NotFound() {
  return <StatusScreen code={ts.code.replace("{code}", "404")} title={ts.notFoundTitle} body={ts.notFoundBody} />;
}
