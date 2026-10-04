import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-prussian px-4 text-center text-mint">
      <div className="max-w-md">
        <h1 className="text-3xl font-bold">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-powder">The activity may have been deleted, or the link was typed wrong. Ask the organizer for a new link.</p>
        <Link href="/" className="btn mt-8 bg-mint text-prussian hover:bg-white">
          Go to the start page
        </Link>
      </div>
    </main>
  );
}
