"use client";

import { AiGuidanceCard } from "@/components/ai/ai-guidance-card";

export function ProcessGuidancePane({ logId }: { logId: string }) {
  return (
    <div className="mb-6">
      <AiGuidanceCard
        kind="process"
        logId={logId}
        ctaLabel="Generate AI overview"
      />
    </div>
  );
}
