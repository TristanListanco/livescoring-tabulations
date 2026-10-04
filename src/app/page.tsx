import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center bg-prussian px-4 py-16 text-mint sm:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-[clamp(2.75rem,8vw,5.5rem)] leading-[0.95] font-bold tracking-tight">LiveScoring</h1>
        <p className="mt-5 max-w-xl text-xl leading-relaxed text-powder">
          Judges score from their own devices. Averages and rankings update on the live results page the moment a score is submitted.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/judge" className="btn h-14 rounded-xl bg-mint px-7 text-lg text-prussian hover:bg-white">
            I&apos;m a judge
          </Link>
          <Link href="/admin" className="btn h-14 rounded-xl border border-oxford px-7 text-lg text-mint hover:bg-oxford">
            Admin panel
          </Link>
        </div>
      </div>
    </main>
  );
}
