import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getJudgeContext } from "@/lib/data";
import { judgeSession } from "@/lib/session";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Judge sign-in" };

export default async function JudgePortal({ searchParams }: PageProps<"/judge">) {
  const session = await judgeSession();
  if (session && (await getJudgeContext(session.judgeId))) redirect("/judge/score");

  const query = await searchParams;
  const code = typeof query.code === "string" ? query.code : "";
  const invalid = query.invalid === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-prussian px-4 py-12 text-mint">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold tracking-tight">Judge sign-in</h1>
        <p className="mt-3 text-lg text-powder">Enter the six-character code the organizer gave you.</p>
        <CodeForm initialCode={code} initialError={invalid ? "That code doesn't match any judge. Check it with the organizer." : undefined} />
      </div>
    </main>
  );
}
