/**
 * A titled block of a long admin form, as a card. Three ways to title it:
 * - `description` given: the title and a line saying what the section decides, above its fields (the create forms,
 *   where each section needs a heading to find it by). `bare`: the same heading without the card, for content that is
 *   cards already (a pageant's sub-activities), so cards don't nest.
 * - otherwise: the title on the left, fields on the right (Settings).
 * Below 1280px the create forms keep a bar of their sections at the top of the window (see SectionIndex), so a jump to
 * a section stops below it.
 */
export function Section({
  title,
  id,
  bare = false,
  description,
  children,
}: {
  title: string;
  bare?: boolean;
  /** What the section decides, in a line under its title. */
  description?: React.ReactNode;
  /** For a link straight to this section. */
  id?: string;
  children: React.ReactNode;
}) {
  if (description) {
    return (
      <section
        id={id}
        aria-labelledby={id ? `${id}-title` : undefined}
        className={`scroll-mt-20 xl:scroll-mt-6 ${bare ? "mt-10" : "card mt-4 p-5 sm:p-7"}`}
      >
        <header className={`max-w-2xl ${bare ? "mb-4" : "mb-6"}`}>
          {/* Focusable from code (not by Tab), so a jump to the section can take focus there. */}
          <h2 id={id ? `${id}-title` : undefined} tabIndex={id ? -1 : undefined} className="title-sm outline-none">
            {title}
          </h2>
          <p className="hint mt-1.5 text-pretty">{description}</p>
        </header>
        <div className="min-w-0">{children}</div>
      </section>
    );
  }
  return (
    <section id={id} className="card mt-4 grid scroll-mt-20 gap-4 p-5 sm:p-7 md:grid-cols-[14rem_1fr] md:gap-10 xl:scroll-mt-6">
      <h2 className="title-sm">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A section's mark in the index: a filled circle with a tick once it's done, an empty ring before. */
function DoneMark({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-regal" aria-hidden>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="var(--color-mint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-field" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export type IndexedSection = { id: string; title: string; done: boolean };

/**
 * A create form's sections, each a link, marked done once it has what Create needs, so what's left is always one
 * glance away. From 1280px a list beside the form, held in view as it scrolls; narrower, a bar of them across the top
 * of the window, scrolling sideways. Render it before the form, inside the form's two-column grid. Only one of the two
 * shows at any width, so screen readers meet one.
 */
export function SectionIndex({ sections }: { sections: IndexedSection[] }) {
  // Said whole, as one name: a separate screen-reader-only part would be heard (and matched) as "Details , done".
  const said = (section: IndexedSection) => `${section.title}, ${section.done ? "done" : "not done yet"}`;
  return (
    <>
      <nav
        aria-label="Sections of the form"
        className="sticky top-0 z-20 -mx-4 border-b border-line bg-mint px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:hidden"
      >
        <ol className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {sections.map((section) => (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-label={said(section)}
                className="flex h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-semibold hover:border-field pointer-coarse:h-11"
              >
                <DoneMark done={section.done} />
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <nav aria-label="Sections of the form" className="sticky top-6 mt-4 hidden xl:col-start-2 xl:row-start-1 xl:block">
        <ol className="space-y-1">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} aria-label={said(section)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] font-semibold hover:bg-white">
                <DoneMark done={section.done} />
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
