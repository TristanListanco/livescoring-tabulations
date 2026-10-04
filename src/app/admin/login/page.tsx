import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign-in" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  if (await currentAdmin()) redirect("/admin");
  const asSuper = (await searchParams).as === "super";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-lg font-bold text-regal">LiveScoring</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{asSuper ? "Super admin sign-in" : "Admin sign-in"}</h1>
        <p className="hint mt-2">
          {asSuper ? "For the developer who manages organizer accounts." : "Sign in with the organizer account you were given."}
        </p>
        <LoginForm key={asSuper ? "super" : "organizer"} asSuper={asSuper} />
        <p className="mt-8 text-sm">
          <Link href={asSuper ? "/admin/login" : "/admin/login?as=super"} className="font-semibold text-regal hover:underline">
            {asSuper ? "Sign in as an organizer instead" : "Super admin sign-in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
