import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 운영팀 PC에서 그대로 돌도록 숨은 외부 의존을 두지 않는다(글꼴은 시스템 글꼴 스택).
  poweredByHeader: false,
};

export default nextConfig;
