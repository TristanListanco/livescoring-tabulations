import { hostname, networkInterfaces } from "node:os";
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
 * (judge links carry codes); and the browser features LiveScoring never uses stay off. HTTPS-only (HSTS) is left to
 * the host: Vercel sends it, and a server on the venue Wi-Fi is plain http.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // The corner badge would sit on top of the judge's Submit button and the LED wall's green.
  // Build and runtime errors still open the full-screen overlay.
  devIndicators: false,
  // The PDF renderer ships its own layout engine and font data; load it from node_modules as-is.
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    serverActions: {
      // New activities upload every judge photo in one request. Photos are resized to ~30 KB in the browser first.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
