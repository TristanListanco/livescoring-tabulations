import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-prussian px-4 text-center text-mint">
      <div className="max-w-md">
        <h1 className="text-3xl font-bold">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-powder">
          The link may be mistyped, or its activity deleted. If you&apos;re watching the scores, ask the organizer for the live results link.
        </p>
        {/* The start page's two ways in, for a judge or an organizer who followed a wrong link: the audience has none. */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/judge" className="btn bg-mint text-prussian hover:bg-white">
            I&apos;m a judge
          </Link>
          <Link href="/admin" className="btn border border-oxford text-mint hover:bg-oxford">
            I&apos;m an organizer
          </Link>
        </div>
      </div>
    </main>
  );
}
