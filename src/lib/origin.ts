import "server-only";
import { headers } from "next/headers";
import { networkInterfaces } from "node:os";

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])$/;

/** This computer's first private IPv4 address on the local network, if any. */
function lanAddress(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i!.address);
  return candidates.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? candidates[0] ?? null;
}

/**
 * The address people use to reach this app, for shared links and QR codes.
 * When the admin opened the panel at localhost, other devices can't use that address,
 * so links point at this computer's Wi-Fi address instead.
 */
export async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (process.env.NODE_ENV === "production" ? "https" : "http");

  const [hostname, port] = host.startsWith("[") ? [host.slice(0, host.indexOf("]") + 1), host.split("]:")[1]] : host.split(":");
  if (LOOPBACK.test(hostname)) {
    const lan = lanAddress();
    if (lan) return `http://${lan}${port ? `:${port}` : ""}`;
  }
  return `${proto}://${host}`;
}
