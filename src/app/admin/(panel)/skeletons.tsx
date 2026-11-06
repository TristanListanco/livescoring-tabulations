/**
 * Placeholders while a page of the panel loads, in the shape of what's coming (see .skeleton in globals.css): announced
 * once as loading, the shapes themselves hidden from screen readers.
 */
function Loading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className={className}>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** A card of list rows. */
function Rows({ count }: { count: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="skeleton h-4" style={{ width: `${[38, 30, 44, 26, 34][i % 5]}%` }} />
          <div className="skeleton ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A page of the panel: its title, then cards. */
export function PageSkeleton() {
  return (
    <Loading>
      <div className="skeleton h-10 w-56" />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card px-5 py-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-3 h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="skeleton mt-10 h-6 w-40" />
      <div className="mt-4">
        <Rows count={4} />
      </div>
    </Loading>
  );
}

/** An activity's tab: a card, then a list. */
export function PanelSkeleton({ className = "" }: { className?: string }) {
  return (
    <Loading className={className}>
      <div className="card h-56 p-6">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-4 h-8 w-2/3" />
      </div>
      <div className="skeleton mt-8 h-6 w-36" />
      <div className="mt-3">
        <Rows count={5} />
      </div>
    </Loading>
  );
}

/** An activity: its name and status, then its tab. */
export function ActivitySkeleton() {
  return (
    <>
      <div aria-hidden className="flex items-center gap-3">
        <div className="skeleton h-10 w-72 max-w-[70%]" />
        <div className="skeleton h-7 w-20 rounded-full" />
      </div>
      <PanelSkeleton className="pt-6 lg:pt-8" />
    </>
  );
}
