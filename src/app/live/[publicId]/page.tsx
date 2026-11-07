import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveBoard } from "@/components/live-board";
import { getLiveBoard } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/live/[publicId]">): Promise<Metadata> {
  const board = await getLiveBoard((await params).publicId);
  const found = board && !board.activity.archivedAt;
  return {
    title: found ? `${board.activity.name} live results` : "Results not found",
    description: found ? `The live results of ${board.activity.name}, as the judges score.` : undefined,
  };
}

export default async function LivePage({ params }: PageProps<"/live/[publicId]">) {
  const board = await getLiveBoard((await params).publicId);
  // Archived, the live results close for good: the link no longer works.
  if (!board || board.activity.archivedAt) notFound();

  return (
    <main className="min-h-dvh bg-prussian">
      <LiveBoard board={board} />
    </main>
  );
}
