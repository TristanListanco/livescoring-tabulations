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

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),
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
