import "server-only";
import { headers } from "next/headers";
import { newPairingCode } from "./codes";
import { getDevice } from "./data";
import { deviceLabel } from "./device-label";
import { judgeSession, startJudgeSession } from "./session";
import { db } from "./supabase/server";

const MAX_PENDING_PER_JUDGE = 5;

/** Tell open screens (the organizer's, the judge's) that this judge's devices changed. The device rows stay private. */
export async function touchJudge(judgeId: string) {
  await db().from("judges").update({ devices_updated_at: new Date().toISOString() }).eq("id", judgeId);
}

/**
 * Sign this browser in as one of the judge's devices. A browser that already asked (and wasn't
 * turned away) keeps its request; anything else asks the organizer for approval with a new pairing code.
 */
export async function signInJudgeDevice(judgeId: string): Promise<{ error: string } | null> {
  const current = await judgeSession();
  if (current?.judgeId === judgeId && current.deviceId) {
    const device = await getDevice(current.deviceId);
    if (device && device.judgeId === judgeId && device.status !== "revoked") {
      await startJudgeSession(judgeId, device.id);
      return null;
    }
  }

  const { data, error } = await db()
    .from("judge_devices")
    .insert({ judge_id: judgeId, pairing_code: newPairingCode(), label: deviceLabel((await headers()).get("user-agent")) })
    .select("id")
    .single();
  if (error) {
    return { error: error.message.includes("judge_devices") ? "Judge sign-in needs a database update. Ask the organizer." : "Couldn't sign in. Try again." };
  }
  await startJudgeSession(judgeId, (data as { id: string }).id);

  // A QR code passed around shouldn't bury the organizer in requests: keep only the newest few waiting.
  const { data: pending } = await db()
    .from("judge_devices")
    .select("id")
    .eq("judge_id", judgeId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  const stale = (pending as { id: string }[] | null)?.slice(MAX_PENDING_PER_JUDGE).map((d) => d.id) ?? [];
  if (stale.length) await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).in("id", stale);

  await touchJudge(judgeId);
  return null;
}

/** The device this browser signed in as, if it's the judge's approved device. */
export async function approvedDevice(judgeId: string, deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  const device = await getDevice(deviceId);
  return !!device && device.judgeId === judgeId && device.status === "approved";
}
