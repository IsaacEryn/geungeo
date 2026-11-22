import { AccessGate } from "@/components/AccessGate";
import { AskApp } from "@/components/AskApp";
import { CoveragePanel } from "@/components/CoveragePanel";
import { GuidePanel } from "@/components/GuidePanel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { accessCodeRequired } from "@/lib/deploy/access";

// 바깥 틀(설계 7절). 질문·결과는 components/AskApp이 맡고, 파이프라인 연결은 components/ask-client.ts 한 곳이다.
export default function Home() {
  // 접근 코드가 필요한지(참·거짓)만 넘긴다. 코드 값은 서버 밖으로 나가지 않는다
  const required = accessCodeRequired();
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[65rem] flex-1 px-4 py-8 sm:px-6">
        <AccessGate required={required}>
          <AskApp accessCodeRequired={required} />
        </AccessGate>
      </main>
      <SiteFooter />
      <CoveragePanel />
      <GuidePanel />
    </>
  );
}
