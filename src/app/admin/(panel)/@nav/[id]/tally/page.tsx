import { ActivityTree } from "../../../activity-tree";

export default async function TallyNav({ params }: PageProps<"/admin/[id]/tally">) {
  return <ActivityTree id={(await params).id} away />;
}
