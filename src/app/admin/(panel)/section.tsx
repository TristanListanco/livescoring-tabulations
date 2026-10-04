/** A titled block of a long admin form: title and hint on the left, fields on the right. */
export function Section({
  title,
  hint,
  flush = false,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  /** The first section on a page: no divider or top padding. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`grid gap-4 py-8 md:grid-cols-[14rem_1fr] md:gap-10 ${flush ? "pt-0" : "border-t border-line"}`}>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="hint mt-1">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
