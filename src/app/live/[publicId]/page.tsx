import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveBoard } from "@/components/live-board";
import { getPublicBoard } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/live/[publicId]">): Promise<Metadata> {
  const board = await getPublicBoard((await params).publicId);
  return { title: board ? `${board.activity.name} live results` : "Results not found" };
}

export default async function LivePage({ params }: PageProps<"/live/[publicId]">) {
  const board = await getPublicBoard((await params).publicId);
  if (!board) notFound();

  return (
    <main className="min-h-dvh bg-prussian">
      <LiveBoard board={board} />
    </main>
  );
}
