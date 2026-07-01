import { FlowEditorPage } from "@/components/flows/flow-editor-page";

export default async function FlowDetailPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  return <FlowEditorPage flowId={flowId} />;
}
