/**
 * A titled block of a long admin form, as a card. Three ways to title it:
 * - `description` given: the title and a line saying what the section decides, above its fields (the create form,
 *   where each section needs a heading to find it by).
 * - `quiet`: the title is for screen readers only (the fields' own labels say enough), and the fields take the card.
 * - otherwise: the title on the left, fields on the right (Settings).
 */
export function Section({
  title,
  id,
  quiet = false,
  description,
  children,
}: {
  title: string;
  quiet?: boolean;
  /** What the section decides, in a line under its title. */
  description?: React.ReactNode;
  /** For a link straight to this section. */
  id?: string;
  children: React.ReactNode;
}) {
  if (description) {
    return (
      <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="card mt-4 scroll-mt-6 p-5 sm:p-7">
        <header className="mb-6 max-w-2xl">
          <h2 id={id ? `${id}-title` : undefined} className="title-sm">
            {title}
          </h2>
          <p className="hint mt-1.5 text-pretty">{description}</p>
        </header>
        <div className="min-w-0">{children}</div>
      </section>
    );
  }
  return (
    <section id={id} className={`card mt-4 grid scroll-mt-6 gap-4 p-5 sm:p-7 ${quiet ? "" : "md:grid-cols-[14rem_1fr] md:gap-10"}`}>
      <h2 className={quiet ? "sr-only" : "title-sm"}>{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
