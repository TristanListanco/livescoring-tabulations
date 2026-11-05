import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LegalLinks } from "@/components/legal-links";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Organizer sign-in" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  if (await currentAdmin()) redirect("/admin");
  const asSuper = (await searchParams).as === "super";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-lg text-regal">
          <Wordmark />
        </p>
        <div className="card mt-6 px-6 py-7 sm:px-8">
          <h1 className="title">{asSuper ? "Super admin sign-in" : "Organizer sign-in"}</h1>
          <LoginForm key={asSuper ? "super" : "organizer"} asSuper={asSuper} />
        </div>
        <p className="mt-6 text-sm">
          <Link href={asSuper ? "/admin/login" : "/admin/login?as=super"} className="font-semibold text-regal hover:underline">
            {asSuper ? "Sign in as an organizer instead" : "Super admin sign-in"}
          </Link>
        </p>
        <LegalLinks className="mt-8 text-prussian/70" />
      </div>
    </main>
  );
}
