import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import { RequestGuard } from "@/components/request-guard";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Tabulous", template: "%s | Tabulous" },
  description: "Tabulation for judged events: judges score on their own phones, the results update as they score, and the official results come out signed.",
};

export const viewport: Viewport = {
  themeColor: "#0b2545",
};

export default async function RootLayout({ children, legal }: LayoutProps<"/">) {
  // Every page renders for its request, so its scripts carry that request's nonce (see the policy in proxy.ts). A page
  // built ahead of time would carry none, and the policy would stop its scripts.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-mint text-prussian">
        {children}
        {/* The privacy policy or the terms, opened from a link in the app (see @legal). */}
        {legal}
        {/* Every request to the server: actions given up if they hang, refreshes asked again while the server fails
            them, and a page open across a deploy reloaded into the new version. */}
        <RequestGuard />
      </body>
    </html>
  );
}
