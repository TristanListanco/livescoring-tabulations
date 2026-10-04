import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "judge-photos";

let client: SupabaseClient | undefined;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

/** Server-only client with the secret key. Bypasses row level security, so never send it to the browser. */
export function db(): SupabaseClient {
  client ??= createClient(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}

export function photoUrl(path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}
