"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isUuid, newFileTag } from "@/lib/codes";
import { getAdminCredentials } from "@/lib/data";
import { hashPassword, verifyPassword } from "@/lib/password";
import { MAX_PASSWORD_LENGTH, passwordProblem } from "@/lib/password-rules";
import { photoExtension, photoFile, type Photo } from "@/lib/photo-file";
import { removeActivityPhotos } from "@/lib/photo-storage";
import { endOtherAdminSessions, requireAdmin, requireSuperAdmin, startOrganizerSession } from "@/lib/session";
import { clientAddress, LIMITS, recordFailure, TOO_MANY, tooManyFailures } from "@/lib/sign-in-limits";
import { db, ORGANIZER_BUCKET } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import type { FormResult } from "./actions";
import { traced } from "@/lib/observe";
import { log } from "@/lib/log";

// Organizer accounts. Only the super admin can create, change or delete them; an organizer can change their own password.

const ok = (message?: string): ActionResult => ({ ok: true, message });
const err = (error: string): ActionResult => ({ ok: false, error });
/** A database failure the organizer can't fix from the panel: the details go to the server log, not the screen. */
const dbErr = (error: { message: string; code?: string }): ActionResult => {
  log("error", "db_failed", { code: error.code, error: error.message });
  return err("That didn't save. Check the connection and try again.");
};

function readProfile(formData: FormData): { name: string; email: string } | { error: string } {
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!name) return { error: "Enter the organizer's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  return { name, email };
}

/** A new password: at least 8 characters, with a number and a special character (see password-rules). */
function readPassword(formData: FormData, required: boolean): string | null | { error: string } {
  const password = String(formData.get("password") ?? "");
  if (!password && !required) return null;
  const problem = passwordProblem(password);
  return problem ? { error: problem } : password;
}

async function uploadOrganizerPhoto(adminId: string, photo: Photo): Promise<string> {
  const path = `${adminId}-${newFileTag()}.${photoExtension(photo.type)}`;
  const { error } = await db()
    .storage.from(ORGANIZER_BUCKET)
    .upload(path, photo.file, { contentType: photo.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** A photo no longer used goes once the response has been sent. */
function removeOrganizerPhoto(path: string | null | undefined) {
  if (!path) return;
  after(async () => {
    await db().storage.from(ORGANIZER_BUCKET).remove([path]);
  });
}

const duplicateEmail = (e: { code?: string } | null) => e?.code === "23505";

export const createOrganizer = traced("createOrganizer", async function createOrganizer(_prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireSuperAdmin();
  const profile = readProfile(formData);
  if ("error" in profile) return err(profile.error);
  const password = readPassword(formData, true);
  if (typeof password !== "string") return err(password?.error ?? "Enter a password.");
  const photo = await photoFile(formData.get("photo"));
  if (photo === "invalid") return err("The photo must be an image under 2 MB.");

  const { data, error } = await db()
    .from("admins")
    .insert({ ...profile, password_hash: await hashPassword(password) })
    .select("id")
    .single();
  if (duplicateEmail(error)) return err("An organizer with that email already exists.");
  if (error) return dbErr(error);
  const adminId = (data as { id: string }).id;

  if (photo) {
    try {
      const path = await uploadOrganizerPhoto(adminId, photo);
      await db().from("admins").update({ photo_path: path }).eq("id", adminId);
    } catch {
      // The account works without a photo; it can be added from the edit page.
    }
  }
  redirect("/admin/organizers");
});

export const updateOrganizer = traced("updateOrganizer", async function updateOrganizer(adminId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireSuperAdmin();
  if (!isUuid(adminId)) return err("Organizer not found.");
  const profile = readProfile(formData);
  if ("error" in profile) return err(profile.error);
  const password = readPassword(formData, false);
  if (password !== null && typeof password !== "string") return err(password.error);

  const update: Record<string, string> = { ...profile, updated_at: new Date().toISOString() };
  if (password) update.password_hash = await hashPassword(password);
  const { error, count } = await db().from("admins").update(update, { count: "exact" }).eq("id", adminId);
  if (duplicateEmail(error)) return err("Another organizer already uses that email.");
  if (error) return dbErr(error);
  if (!count) return err("Organizer not found.");
  // A new password signs them out everywhere (their sessions carry the old one); their session rows go too.
  if (password) await db().from("admin_sessions").delete().eq("admin_id", adminId);
  refresh();
  return ok(password ? "Saved. The new password signs them out on their other devices." : "Saved.");
});

/**
 * Sign your own account out of another browser (`sessionId`, from the list on your profile), or of every other one
 * (null). It ends there at once, wherever that browser is: its next click goes to the sign-in page.
 */
/**
 * An organizer changes the password the super admin gave them. Their current password first, so a browser left signed
 * in (a shared laptop at the venue) isn't enough; a wrong one counts against the same limits as signing in. Every other
 * browser signed in to the account is signed out, and this one carries on with a fresh session.
 */
export const changeOwnPassword = traced("changeOwnPassword", async function changeOwnPassword(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const session = await requireAdmin();
  if (session.kind !== "organizer") return err("The super admin's password is ADMIN_PASSWORD, where the app is hosted.");
  const address = await clientAddress();
  const accountKey = `admin:${session.admin.email}`;
  if (await tooManyFailures([[address, LIMITS.adminAddress], [accountKey, LIMITS.adminAccount]])) return err(TOO_MANY);
  const current = String(formData.get("current") ?? "");
  const account = await getAdminCredentials(session.admin.id);
  if (!account) return err("Your account wasn't found. Sign in again.");
  if (!current || current.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(current, account.passwordHash))) {
    await recordFailure([address, accountKey]);
    return err("That isn't your current password.");
  }
  const password = readPassword(formData, true);
  if (typeof password !== "string") return err(password?.error ?? "Enter a new password.");
  if (password === current) return err("Choose a new password, not the one you have now.");
  const hash = await hashPassword(password);
  const { error } = await db().from("admins").update({ password_hash: hash }).eq("id", session.admin.id);
  if (error) return dbErr(error);
  // Sessions carry the old password's fingerprint, so they all end; this browser gets a new one at once.
  await db().from("admin_sessions").delete().eq("admin_id", session.admin.id);
  await startOrganizerSession(session.admin.id, hash);
  refresh();
  return ok("Password changed. Your other devices are signed out.");
});

export const signOutOtherDevices = traced("signOutOtherDevices", async function signOutOtherDevices(sessionId: string | null): Promise<ActionResult> {
  const session = await requireAdmin();
  if (sessionId !== null && typeof sessionId !== "string") return err("That device isn't signed in.");
  if (!(await endOtherAdminSessions(session, sessionId ?? undefined))) return err("That didn't go through. Try again.");
  refresh();
  return ok(sessionId ? "That device is signed out." : "Every other device is signed out.");
});

export const setOrganizerPhoto = traced("setOrganizerPhoto", async function setOrganizerPhoto(adminId: string, formData: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(adminId)) return err("Organizer not found.");
  const { data: current } = await db().from("admins").select("photo_path").eq("id", adminId).maybeSingle();
  if (!current) return err("Organizer not found.");

  const photo = await photoFile(formData.get("photo"));
  if (photo === "invalid") return err("Photos must be images under 2 MB.");
  const path = photo ? await uploadOrganizerPhoto(adminId, photo) : null;
  const { error } = await db().from("admins").update({ photo_path: path, updated_at: new Date().toISOString() }).eq("id", adminId);
  if (error) {
    removeOrganizerPhoto(path);
    return dbErr(error);
  }
  removeOrganizerPhoto((current as { photo_path: string | null }).photo_path);
  refresh();
  return ok();
});

/**
 * Delete an organizer and their activities. Their activities are private to them, so they are deleted
 * rather than handed to the super admin.
 */
export const deleteOrganizer = traced("deleteOrganizer", async function deleteOrganizer(adminId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(adminId)) return err("Organizer not found.");
  const { data: current } = await db().from("admins").select("photo_path").eq("id", adminId).maybeSingle();
  if (!current) return err("Organizer not found.");

  // Signed out first, everywhere: an activity they created while theirs were being deleted would outlive them,
  // handed to the super admin when the account goes.
  await db().from("admin_sessions").delete().eq("admin_id", adminId);
  const { data: owned, error: listError } = await db().from("activities").select("id").eq("owner_id", adminId);
  if (listError) return err(listError.message);
  const activityIds = (owned as { id: string }[]).map((a) => a.id);
  if (activityIds.length) {
    // Judges, entries, scores and devices go with their activity; their photos once the response has been sent.
    const { error: deleteError } = await db().from("activities").delete().in("id", activityIds);
    if (deleteError) return err(deleteError.message);
    after(() => removeActivityPhotos(activityIds));
  }

  const { error } = await db().from("admins").delete().eq("id", adminId);
  if (error) return dbErr(error);
  removeOrganizerPhoto((current as { photo_path: string | null }).photo_path);
  redirect("/admin/organizers");
});
