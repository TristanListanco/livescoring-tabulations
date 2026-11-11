import type { Metadata } from "next";
import Link from "next/link";
import { TallyGate, Wordmark } from "@/components/brand";
import { CookieNotice } from "@/components/cookie-notice";
import { LegalLinks } from "@/components/legal-links";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Organizer sign-in",
  description: "Organizers sign in to set up their activities, run the judging and download the official results.",
};

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  if (await currentAdmin()) redirect("/admin");
  const asSuper = (await searchParams).as === "super";

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* The brand's side, in the start page's navy: the name, and the tally gate drawing itself. A slim band on phones. */}
      <section className="flex items-center justify-between bg-prussian px-6 py-5 text-mint lg:flex-col lg:items-start lg:px-12 lg:py-12">
        <Link href="/" className="text-lg">
          <Wordmark />
        </Link>
        {/* Flush, so its left edge is the column's, under the name and over the links. */}
        <TallyGate flush className="hidden h-auto w-[min(24vw,20rem)] lg:block" strokes="text-powder/70" slash="text-mint" />
        <div className="hidden lg:block">
          <LegalLinks className="text-powder" />
        </div>
      </section>

      <div className="flex justify-center px-6 pt-12 pb-16 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">
          <CookieNotice className="mb-8" />
          <h1 className="title">{asSuper ? "Super admin sign-in" : "Organizer sign-in"}</h1>
          <LoginForm key={asSuper ? "super" : "organizer"} asSuper={asSuper} />
          <p className="mt-8 border-t border-line pt-6 text-sm">
            <Link href={asSuper ? "/admin/login" : "/admin/login?as=super"} className="font-semibold text-regal hover:underline">
              {asSuper ? "Sign in as an organizer instead" : "Super admin sign-in"}
            </Link>
          </p>
          <LegalLinks className="mt-10 text-prussian/70 lg:hidden" />
        </div>
      </div>
    </main>
  );
}
