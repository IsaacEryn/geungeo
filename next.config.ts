import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 운영팀 PC에서 그대로 돌도록 숨은 외부 의존을 두지 않는다(글꼴은 시스템 글꼴 스택).
  poweredByHeader: false,
  // next dev가 저장소 루트에 AGENTS.md를 자동으로 만들지 않게 한다.
  agentRules: false,
  // /api/ask는 조문 캐시(data/)를 실행 중에 파일로 읽는다(lib/cache/load.ts, 경로를 실행 때 만들어 자동 추적에 안 잡힘).
  // 서버리스 배포 묶음에 data/가 빠지지 않게 명시한다. 로컬 실행에는 영향이 없다.
  outputFileTracingIncludes: {
    "/api/ask": ["./data/**/*.json"],
  },
};

export default nextConfig;
