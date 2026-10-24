import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LegalLinks } from "@/components/legal-links";

/**
 * The privacy policy and the terms of service: a quiet page for reading, the name back to the start page above it. One
 * text size for the whole page, so the header, the text and the footer share one measure (they're sized in ch).
 */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-mint text-[17px] text-prussian">
      <header className="mx-auto max-w-[68ch] px-4 pt-8 sm:px-6">
        <Link href="/" className="text-lg text-regal">
          <Wordmark />
        </Link>
      </header>
      <main className="legal mx-auto max-w-[68ch] px-4 pt-8 pb-16 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-[68ch] border-t border-line px-4 py-6 sm:px-6">
        <LegalLinks className="text-prussian/75" />
      </footer>
    </div>
  );
}
