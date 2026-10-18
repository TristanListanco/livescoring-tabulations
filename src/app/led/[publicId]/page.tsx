import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { KEY_GREEN } from "@/lib/led";
import { getPublicBoard } from "@/lib/data";
import type { Board } from "@/lib/types";
import { LedView } from "./led-view";

export const viewport: Viewport = { themeColor: KEY_GREEN };

/**
 * Whether an activity has an LED wall. It's for the show, so not once the activity is archived. And not for an event
 * without live scoring: its scores stay with the judges until they've deliberated and signed, so there's nothing to put
 * on the wall (and a wall left open would only keep asking the database for nothing).
 */
const hasWall = (board: Board | null): board is Board =>
  !!board && !board.activity.archivedAt && (board.activity.kind === "pageant" || board.activity.liveScoring);

export async function generateMetadata({ params }: PageProps<"/led/[publicId]">): Promise<Metadata> {
  const board = await getPublicBoard((await params).publicId);
  return { title: hasWall(board) ? `${board.activity.name} LED wall` : "LED wall not found" };
}

export default async function LedPage({ params }: PageProps<"/led/[publicId]">) {
  const board = await getPublicBoard((await params).publicId);
  if (!hasWall(board)) notFound();
  return <LedView board={board} />;
}
