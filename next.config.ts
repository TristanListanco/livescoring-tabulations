import { hostname, networkInterfaces } from "node:os";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

/**
 * This computer's addresses on the local network (e.g. 192.168.1.16).
 * In development Next.js blocks its own scripts for any host but localhost, which leaves
 * judges' phones and tablets on the venue Wi-Fi with a page that never comes alive.
 */
function lanAddresses(): string[] {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && !iface.internal && iface.family === "IPv4")
    .map((iface) => iface!.address);
  const name = hostname().toLowerCase();
  return [...new Set([...ips, name, name.endsWith(".local") ? name : `${name}.local`])];
}

/**
 * Sent with every response. No page may be framed by another site (so nobody can overlay the panel and trick a
 * click); browsers don't guess file types; other sites only learn which site a visitor came from, never the page
 * (judge links carry codes); the browser features Tabulous never uses stay off; and a window another site opened (or
 * that Tabulous opened) can't reach into this one. And HTTPS only (HSTS), for two years, on this host alone: a browser
 * that has opened the site over HTTPS won't be talked down to plain HTTP. Browsers ignore it over plain HTTP, so a
 * server on the venue Wi-Fi (http://192.168.x.x) works as before.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // A page another site opens in a new tab can't reach back into Tabulous through window.opener, nor the other way.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

/**
 * Vercel BotID on the sign-ins (see src/lib/bot-check.ts) only in a build made on Vercel, which serves its check. A
 * build anywhere else (a laptop for the venue Wi-Fi, which may have no internet at all) leaves it out entirely.
 */
const botProtection = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),
  env: { NEXT_PUBLIC_BOT_PROTECTION: botProtection ? "on" : "off" },
  poweredByHeader: false,
  // Every page's title (and description) goes in its <head>, sent with the page, rather than streamed into the body
  // after it: streamed, it was dropped and added again each time a page refreshed itself (the live results do, as scores
  // come in), so for a moment the page had no title, for screen readers and the browser's tab alike. Every page waits
  // on the same data as its title anyway, so nothing arrives later for it.
  htmlLimitedBots: /.*/,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // The corner badge would sit on top of the judge's Submit button and the LED wall's green.
  // Build and runtime errors still open the full-screen overlay.
  devIndicators: false,
  // The PDF renderer ships its own layout engine and font data; load it from node_modules as-is.
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    // Pages visited in the last five minutes come back at once, from the browser's cache, rather than through their
    // skeleton: switching between activities and tabs is instant. Each checks as it opens whether its activity changed
    // (see LiveSince and CatchUp) and reloads only if it did; every change made from the panel empties the cache.
    staleTimes: { dynamic: 300 },
    serverActions: {
      // New activities upload every judge photo in one request. Photos are resized to ~30 KB in the browser first.
      bodySizeLimit: "8mb",
    },
  },
};

// withBotId routes its check through this site, and lets its own frame be framed by this site alone.
export default botProtection ? withBotId(nextConfig) : nextConfig;
