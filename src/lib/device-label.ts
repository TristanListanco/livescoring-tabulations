/** A short, human label for a device from its user agent, e.g. "iPhone · Safari", so organizers can tell requests apart. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh/.test(ua)
          ? /Mobile/.test(ua)
            ? "iPad"
            : "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "browser";
  return `${os} · ${browser}`;
}
