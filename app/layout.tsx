import type { Metadata } from "next";
import messages from "@/messages/ko.json";
import "./globals.css";

export const metadata: Metadata = {
  title: messages.app.title,
  description: messages.app.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-bg focus:p-2"
        >
          {messages.app.skipLink}
        </a>
        {children}
      </body>
    </html>
  );
}
