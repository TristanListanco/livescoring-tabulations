/**
 * Placeholders while a page of the panel loads, in the shape of what's coming (see .skeleton in globals.css): announced
 * once as loading, the shapes themselves hidden from screen readers. They fade in after a beat (.skeleton-enter), so a
 * page that arrives quickly never flashes one.
 */
function Loading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className={className}>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** A card of list rows: a name, the line under it, and a status at the end. */
function Rows({ count }: { count: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="skeleton h-4" style={{ width: `${[38, 30, 44, 26, 34][i % 5]}%` }} />
            <div className="skeleton mt-2.5 h-3" style={{ width: `${[52, 46, 58, 40, 50][i % 5]}%` }} />
          </div>
          <div className="skeleton h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A page of the panel: its title and its button, then its list. */
export function PageSkeleton() {
  return (
    <Loading className="skeleton-enter">
      <div className="flex items-center justify-between gap-4">
        <div className="skeleton h-10 w-48" />
        <div className="skeleton h-11 w-32 rounded-full" />
      </div>
      <div className="mt-10">
        <Rows count={5} />
      </div>
    </Loading>
  );
}

/** An activity's tab: a card, then a list. */
function Panel() {
  return (
    <>
      <div className="card h-56 p-6">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-4 h-8 w-2/3" />
      </div>
      <div className="mt-6">
        <Rows count={4} />
      </div>
    </>
  );
}

/** An activity's tab on its own, while another tab opens (see .tab-skeleton in globals.css). */
export function PanelSkeleton({ className = "" }: { className?: string }) {
  return (
    <Loading className={className}>
      <Panel />
    </Loading>
  );
}

/**
 * An activity, as its page lays out: the way back to Activities, its name, under it its status (and where it happens),
 * its tabs where the page shows them (as its own tabs do), then its tab.
 */
export function ActivitySkeleton() {
  return (
    <Loading className="skeleton-enter">
      <div className="skeleton h-4 w-20" />
      <div className="skeleton mt-2.5 h-10 w-72 max-w-[70%]" />
      <div className="mt-3 flex items-center gap-2">
        <div className="skeleton h-7 w-24 rounded-full" />
        <div className="skeleton h-4 w-36 max-w-[40%]" />
      </div>
      <div className="page-tabs mt-6 lg:hidden">
        <div className="grid grid-cols-6 gap-1 rounded-[1.375rem] bg-wash p-1 md:flex md:w-max md:rounded-full">
          {[2, 2, 2, 3, 3].map((span, i) => (
            <div key={i} className={`flex h-9 items-center justify-center px-2 pointer-coarse:h-11 md:w-24 ${span === 2 ? "col-span-2" : "col-span-3"}`}>
              <div className="skeleton h-3.5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="pt-6 lg:pt-8">
        <Panel />
      </div>
    </Loading>
  );
}
