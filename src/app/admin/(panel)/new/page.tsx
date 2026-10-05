import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { ActivityForm } from "./activity-form";

export const metadata: Metadata = { title: "New activity" };

export default async function NewActivityPage() {
  await requireAdmin();
  return (
    <>
      <Link href="/admin" className="text-action">
        Activities
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">New activity</h1>
      <ActivityForm />
    </>
  );
}
