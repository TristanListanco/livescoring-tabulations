"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, newFileTag } from "@/lib/codes";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { requireAdmin, requireSuperAdmin } from "@/lib/session";
import { db, ORGANIZER_BUCKET, PHOTO_BUCKET } from "@/lib/supabase/server";
import type { ActionResult, Signatory } from "@/lib/types";
import type { FormResult } from "./actions";

// Organizer accounts. Only the super admin can create, change or delete them.

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ok = (message?: string): ActionResult => ({ ok: true, message });
const err = (error: string): ActionResult => ({ ok: false, error });

function readProfile(formData: FormData): { name: string; email: string } | { error: string } {
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!name) return { error: "Enter the organizer's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  return { name, email };
}

function readPassword(formData: FormData, required: boolean): string | null | { error: string } {
  const password = String(formData.get("password") ?? "");
  if (!password && !required) return null;
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password.length > 200) return { error: "That password is too long." };
  return password;
}

function photoFile(value: FormDataEntryValue | null): File | null | "invalid" {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_PHOTO_BYTES || !value.type.startsWith("image/")) return "invalid";
  return value;
}

async function uploadOrganizerPhoto(adminId: string, file: File): Promise<string> {
  const path = `${adminId}-${newFileTag()}.jpg`;
  const { error } = await db()
    .storage.from(ORGANIZER_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

async function removeOrganizerPhoto(path: string | null | undefined) {
  if (path) await db().storage.from(ORGANIZER_BUCKET).remove([path]);
}

const duplicateEmail = (e: { code?: string } | null) => e?.code === "23505";

export async function createOrganizer(_prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireSuperAdmin();
  const profile = readProfile(formData);
  if ("error" in profile) return err(profile.error);
  const password = readPassword(formData, true);
  if (typeof password !== "string") return err(password?.error ?? "Enter a password.");
  const photo = photoFile(formData.get("photo"));
  if (photo === "invalid") return err("The photo must be an image under 2 MB.");

  const { data, error } = await db()
    .from("admins")
    .insert({ ...profile, password_hash: await hashPassword(password) })
    .select("id")
    .single();
  if (duplicateEmail(error)) return err("An organizer with that email already exists.");
  if (error) return err(error.message);
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
}

export async function updateOrganizer(adminId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
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
  if (error) return err(error.message);
  if (!count) return err("Organizer not found.");
  refresh();
  return ok(password ? "Saved. The new password signs them out on their other devices." : "Saved.");
}

export async function setOrganizerPhoto(adminId: string, formData: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(adminId)) return err("Organizer not found.");
  const { data: current } = await db().from("admins").select("photo_path").eq("id", adminId).maybeSingle();
  if (!current) return err("Organizer not found.");

  const photo = photoFile(formData.get("photo"));
  if (photo === "invalid") return err("Photos must be images under 2 MB.");
  const path = photo ? await uploadOrganizerPhoto(adminId, photo) : null;
  const { error } = await db().from("admins").update({ photo_path: path, updated_at: new Date().toISOString() }).eq("id", adminId);
  if (error) {
    await removeOrganizerPhoto(path);
    return err(error.message);
  }
  await removeOrganizerPhoto((current as { photo_path: string | null }).photo_path);
  refresh();
  return ok();
}

/** Deletes the account. Their activities stay, and only the super admin can manage them afterwards. */
/**
 * Delete an organizer and their activities. Their activities are private to them, so they are deleted
 * rather than handed to the super admin.
 */
export async function deleteOrganizer(adminId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(adminId)) return err("Organizer not found.");
  const { data: current } = await db().from("admins").select("photo_path").eq("id", adminId).maybeSingle();
  if (!current) return err("Organizer not found.");

  const { data: owned, error: listError } = await db().from("activities").select("id").eq("owner_id", adminId);
  if (listError) return err(listError.message);
  const activityIds = (owned as { id: string }[]).map((a) => a.id);
  const photos: string[] = [];
  for (const id of activityIds) {
    const { data: files } = await db().storage.from(PHOTO_BUCKET).list(id, { limit: 1000 });
    photos.push(...(files ?? []).map((f) => `${id}/${f.name}`));
  }
  if (activityIds.length) {
    // Judges, entries, scores and devices go with their activity.
    const { error: deleteError } = await db().from("activities").delete().in("id", activityIds);
    if (deleteError) return err(deleteError.message);
    if (photos.length) await db().storage.from(PHOTO_BUCKET).remove(photos);
  }

  const { error } = await db().from("admins").delete().eq("id", adminId);
  if (error) return err(error.message);
  await removeOrganizerPhoto((current as { photo_path: string | null }).photo_path);
  redirect("/admin/organizers");
}

// Report signatories ------------------------------------------------------------------

const MAX_SIGNATORIES = 12;

/**
 * Names and designations printed as signature lines on an organizer's results PDFs. The super admin can
 * edit any organizer's; an organizer can edit their own (adminId null).
 */
export async function saveSignatories(adminId: string | null, signatories: Signatory[]): Promise<ActionResult> {
  const session = await requireAdmin();
  const target = adminId ?? (session.kind === "organizer" ? session.admin.id : null);
  if (!target || !isUuid(target)) return err("Organizer not found.");
  if (session.kind === "organizer" && session.admin.id !== target) return err("Organizer not found.");

  const clean = (Array.isArray(signatories) ? signatories : [])
    .map((s) => ({
      name: String(s?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      designation: String(s?.designation ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    }))
    .filter((s) => s.name || s.designation);
  if (clean.some((s) => !s.name)) return err("Every signatory needs a name.");
  if (clean.length > MAX_SIGNATORIES) return err(`Up to ${MAX_SIGNATORIES} signatories fit on the sheet.`);

  const { error } = await db().from("admins").update({ signatories: clean, updated_at: new Date().toISOString() }).eq("id", target);
  if (error) {
    return err(error.message.includes("signatories") ? "Signatories need a database update. Run supabase/migrations/006_devices_criteria_signatories.sql." : error.message);
  }
  refresh();
  return ok(clean.length ? `Saved. ${clean.length} ${clean.length === 1 ? "signatory prints" : "signatories print"} on the results PDF.` : "Saved. No signatories will print.");
}
