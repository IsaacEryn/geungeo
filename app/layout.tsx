import type { Metadata, Viewport } from "next";
import messages from "@/messages/ko.json";
import "./globals.css";

const siteTitle = `${messages.app.title} - ${messages.app.subtitle}`;

// 파비콘(app/icon.svg)·홈 화면 아이콘(app/apple-icon.png)·공유 이미지(app/opengraph-image.png, twitter-image.png)는
// 파일 이름 규칙으로 Next가 머리에 넣는다. 공유 이미지는 1200×630 정적 PNG(만드는 법은 설계/다듬기_1123.md)
export const metadata: Metadata = {
  metadataBase: new URL("https://geungeo-iota.vercel.app"),
  title: { default: siteTitle, template: `%s - ${messages.app.title}` },
  description: messages.app.description,
  applicationName: messages.app.title,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: messages.app.title,
    title: siteTitle,
    description: messages.app.description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: messages.app.description,
  },
};

// 머리글이 흰 바탕이라 브라우저 띠도 흰색으로 이어지게 한다. 다크 모드는 범위 밖
export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-bg focus:p-3 focus:font-bold focus:text-primary focus:underline"
        >
          {messages.app.skipLink}
        </a>
        {children}
      </body>
    </html>
  );
}
