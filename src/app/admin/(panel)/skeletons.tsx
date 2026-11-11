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

/** A card of list rows, as the activities table lays them out: a name over its line, the session, what needs you, the count. */
function Rows({ count }: { count: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-5 py-4 md:grid-cols-[minmax(0,2fr)_7rem_minmax(0,2fr)_5rem]">
          <div className="min-w-0">
            <div className="skeleton h-4" style={{ width: `${[58, 46, 66, 40, 52][i % 5]}%` }} />
            <div className="skeleton mt-2.5 h-3" style={{ width: `${[40, 34, 46, 30, 38][i % 5]}%` }} />
          </div>
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="skeleton h-4 max-md:hidden" style={{ width: `${[70, 0, 54, 0, 62][i % 5] || 12}%` }} />
          <div className="skeleton ml-auto h-4 w-12 max-md:hidden" />
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

/** A line of skeleton text, `w` wide (a Tailwind width class), on its own row. */
const Line = ({ w, h = "h-3.5", className = "" }: { w: string; h?: string; className?: string }) => <div className={`skeleton ${h} ${w} ${className}`} />;

/**
 * The Session tab before the show: the navy desk (who has a device, and Start session), the live results card under it,
 * then the running order.
 */
function SessionPanel() {
  return (
    <div className="max-w-4xl">
      <div className="rounded-[1.25rem] bg-prussian px-6 pt-6 pb-5">
        <div className="skeleton h-3.5 w-28 opacity-30" />
        <div className="skeleton mt-3 h-8 w-2/3 opacity-30" />
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-oxford px-3 py-2.5">
              <div className="skeleton size-9 rounded-full opacity-30" />
              <div className="skeleton h-4 w-28 opacity-30" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-oxford pt-4">
          <div className="skeleton h-3.5 w-1/2 opacity-30" />
          <div className="skeleton h-11 w-36 rounded-full opacity-40" />
        </div>
      </div>
      <div className="card mt-4 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <div className="skeleton size-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Line w="w-28" h="h-5" />
            <Line w="w-3/4" className="mt-2" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="skeleton h-10 flex-1 rounded-full" />
          <div className="skeleton h-10 w-56 rounded-full max-sm:hidden" />
        </div>
      </div>
      <div className="mt-10">
        <Rows count={3} />
      </div>
    </div>
  );
}

/** The Judges tab: a row per judge (photo, name fields, the Sign-in button, the device), then adding one. */
function JudgesPanel() {
  return (
    <div className="card max-w-4xl divide-y divide-line overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-x-6 gap-y-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto_15rem]">
          <div className="flex items-start gap-4">
            <div className="skeleton size-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <div className="skeleton h-11 flex-1 rounded-xl" />
                <div className="skeleton h-11 flex-1 rounded-xl" />
              </div>
              <Line w="w-20" className="mt-2.5" />
            </div>
          </div>
          <div className="skeleton h-9 w-24 rounded-full" />
          <div>
            <Line w="w-24" h="h-4" />
            <Line w="w-36" className="mt-2" />
          </div>
        </div>
      ))}
      <div className="bg-wash/60 px-5 py-5">
        <Line w="w-24" h="h-4" />
        <div className="mt-3 flex items-end gap-4">
          <div className="skeleton size-12 shrink-0 rounded-full" />
          <div className="skeleton h-11 flex-1 rounded-xl" />
          <div className="skeleton h-11 flex-1 rounded-xl max-sm:hidden" />
          <div className="skeleton h-11 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** The Entries tab: a row per entry (number, photo, name over details, arrows), Shuffle order, then adding entries. */
function EntriesPanel() {
  return (
    <div className="max-w-3xl">
      <div className="card divide-y divide-line">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3">
            <div className="skeleton h-4 w-5" />
            <div className="skeleton size-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-11 max-w-md rounded-xl" />
              <div className="skeleton h-10 max-w-md rounded-xl" />
            </div>
            <div className="skeleton size-9 rounded-full max-sm:hidden" />
            <div className="skeleton size-9 rounded-full max-sm:hidden" />
          </div>
        ))}
      </div>
      <div className="skeleton mt-4 h-9 w-36 rounded-full" />
    </div>
  );
}

/** The LED wall tab: its address, then the options beside the 16:9 preview. */
function LedPanel() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="skeleton h-11 max-w-lg flex-1 rounded-xl" />
        <div className="skeleton h-9 w-20 rounded-full" />
      </div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:gap-10">
        <div className="space-y-6">
          <div className="skeleton h-11 rounded-full" />
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="skeleton h-11 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="skeleton aspect-video rounded-lg" />
      </div>
    </>
  );
}

/** Settings, and a pageant's Segments: section cards of fields. */
function SettingsPanel() {
  return (
    <div className="max-w-4xl space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-5 sm:p-7">
          <Line w="w-32" h="h-5" />
          <Line w="w-24" className="mt-5" />
          <div className="skeleton mt-2 h-11 max-w-xl rounded-xl" />
          <Line w="w-28" className="mt-5" />
          <div className="skeleton mt-2 h-11 max-w-xl rounded-xl" />
        </div>
      ))}
    </div>
  );
}

/** A tab whose shape isn't known while the page loads: a card, then a list. */
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

const TAB_PANELS = {
  session: SessionPanel,
  judges: JudgesPanel,
  led: LedPanel,
  entries: EntriesPanel,
  segments: SettingsPanel,
  settings: SettingsPanel,
} as const;

/**
 * While another of an activity's tabs opens, its skeleton covers this one (see .tab-skeleton in globals.css): the
 * page carries each tab's, and the one for the tab being opened shows.
 */
export function PanelSkeleton({ className = "" }: { className?: string }) {
  return (
    <Loading className={className}>
      {Object.entries(TAB_PANELS).map(([tab, Shape]) => (
        <div key={tab} data-skeleton-for={tab}>
          <Shape />
        </div>
      ))}
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
