import type { Metadata } from "next";
import messages from "@/messages/ko.json";
import "./globals.css";

export const metadata: Metadata = {
  title: `${messages.app.title} - ${messages.app.subtitle}`,
  description: messages.app.description,
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
