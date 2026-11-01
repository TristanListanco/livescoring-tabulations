import Link from "next/link";

/** The privacy policy and the terms of service, quietly, at the foot of the pages people sign in from. Colour from `className`. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-5 gap-y-1 text-sm pointer-coarse:gap-y-3 ${className}`}>
      <Link href="/privacy" className="tap-target hover:underline">
        Privacy policy
      </Link>
      <Link href="/terms" className="tap-target hover:underline">
        Terms of service
      </Link>
    </nav>
  );
}
