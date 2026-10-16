import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { KEY_GREEN } from "@/lib/led";
import { getPublicBoard } from "@/lib/data";
import { LedView } from "./led-view";

export const viewport: Viewport = { themeColor: KEY_GREEN };

export async function generateMetadata({ params }: PageProps<"/led/[publicId]">): Promise<Metadata> {
  const board = await getPublicBoard((await params).publicId);
  return { title: board && !board.activity.archivedAt ? `${board.activity.name} LED wall` : "LED wall not found" };
}

export default async function LedPage({ params }: PageProps<"/led/[publicId]">) {
  const board = await getPublicBoard((await params).publicId);
  // The wall is for the show: once an activity is archived it's not available.
  if (!board || board.activity.archivedAt) notFound();
  return <LedView board={board} />;
}
