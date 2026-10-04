import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import "./globals.css";

const nunito = Nunito_Sans({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "LiveScoring", template: "%s | LiveScoring" },
  description: "Live tabulation for judged competitions.",
};

export const viewport: Viewport = {
  themeColor: "#0b2545",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full`}>
      <body className="min-h-full bg-mint text-prussian">{children}</body>
    </html>
  );
}
