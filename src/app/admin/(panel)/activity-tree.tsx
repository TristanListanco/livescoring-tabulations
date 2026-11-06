import { getBoard } from "@/lib/data";
import { canManageActivity, currentAdmin } from "@/lib/session";
import { TabLink } from "./[id]/tab-link";
import { ArchivedHere } from "./archived-nav";
import { activityTabs, askedTab } from "./[id]/tabs";

/**
 * The open activity in the sidebar, under Activities: its name, then its tabs as branches. An archived one's tabs go
 * under it in the Archived list instead (see ArchivedHere). Rendered by the sidebar's slot (@nav), which knows the URL
 * the panel's layout doesn't. Nothing for a path that isn't an activity this admin can
 * open (/admin/new and the like reach here too). `requested`: the `?tab=` asked for. `away`: on the activity's other
 * pages (its private tally), where no tab is open.
 */
export async function ActivityTree({ id, requested, away = false }: { id: string; requested?: string | string[]; away?: boolean }) {
  const [session, board] = await Promise.all([currentAdmin(), getBoard(id)]);
  if (!board || !canManageActivity(session, board.activity.ownerId)) return null;
  const { activity } = board;
  const { tabs, tab } = activityTabs(activity, askedTab(requested));
  const links = tabs.map((t, i) => (
    <li key={t.id} className={i > 0 && tabs[i - 1].group !== t.group ? "mt-2" : undefined}>
      <TabLink look="tree" href={`/admin/${activity.id}?tab=${t.id}`} active={!away && t.id === tab}>
        {t.label}
      </TabLink>
    </li>
  ));

  // An archived one with a single tab (its results) has no branches: its own link in the list is the page.
  if (activity.archivedAt) {
    return (
      <ArchivedHere id={activity.id} name={activity.name}>
        {tabs.length > 1 && (
          <nav aria-label="Activity sections" className="activity-tabs mb-1 ml-3 border-l border-line pl-3">
            <ul>{links}</ul>
          </nav>
        )}
      </ArchivedHere>
    );
  }

  return (
    <nav aria-label="Activity sections" className="activity-tabs sidebar-expanded-only mt-1 mb-2 ml-[1.375rem] border-l border-line pl-3">
      <p className="truncate py-1.5 pl-3 text-sm font-semibold text-prussian/70" title={activity.name}>
        {activity.name}
      </p>
      <ul>{links}</ul>
    </nav>
  );
}
