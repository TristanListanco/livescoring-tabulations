/** A titled block of a long admin form, as a card: its title on the left, fields on the right. */
export function Section({
  title,
  id,
  children,
}: {
  title: string;
  /** For a link straight to this section. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card mt-4 grid scroll-mt-6 gap-4 p-5 sm:p-7 md:grid-cols-[14rem_1fr] md:gap-10">
      <h2 className="title-sm">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
