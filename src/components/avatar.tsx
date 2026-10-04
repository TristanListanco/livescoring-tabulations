function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Judge photo, or their initials when no photo was uploaded. Decorative: the name is always shown beside it. */
export function Avatar({
  name,
  src,
  size = 40,
  className = "",
}: {
  name: string;
  src: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) };
  if (src) {
    return (
      // Photos are already resized to small squares on upload, so the optimizer adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" style={style} className={`shrink-0 rounded-full object-cover ${className}`} />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-regal font-semibold text-mint ${className}`}
    >
      {initials(name)}
    </span>
  );
}
