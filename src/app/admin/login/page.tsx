import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign-in" };

export default async function AdminLogin() {
  if (await isAdmin()) redirect("/admin");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-lg font-bold text-regal">LiveScoring</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Admin sign-in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
