import { use } from "react";
import { ProcessDetailClient } from "./ProcessDetailClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProcessDetailPage({ params }: PageProps) {
  const { id } = use(params);
  return <ProcessDetailClient id={id} />;
}
