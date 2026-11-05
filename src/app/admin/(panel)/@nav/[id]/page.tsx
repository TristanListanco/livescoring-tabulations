import { ActivityTree } from "../../activity-tree";

export default async function ActivityNav({ params, searchParams }: PageProps<"/admin/[id]">) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <ActivityTree id={id} requested={tab} />;
}
