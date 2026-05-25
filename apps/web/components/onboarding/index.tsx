"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useOnboarding } from "@/lib/stores/onboarding";
import { useAnalytics } from "@/lib/stores/analytics";
import { useUpdateAnalyticsConfig, useAnalyticsConfig } from "@/lib/analytics-queries";

import { WelcomeStep } from "./steps/welcome-step";
import { PrivacyStep } from "./steps/privacy-step";
import { UploadStep } from "./steps/upload-step";
import { ModulesStep } from "./steps/modules-step";

const STEP_COUNT = 4;
type Step = 0 | 1 | 2 | 3;

export function OnboardingOverlay() {
  const router = useRouter();
  const completed = useOnboarding((s) => s.completed);
  const complete = useOnboarding((s) => s.complete);
  const promptResolved = useAnalytics((s) => s.promptResolved);
  const resolvePrompt = useAnalytics((s) => s.resolvePrompt);
  const cfgQuery = useAnalyticsConfig();
  const updateMut = useUpdateAnalyticsConfig();

  const [step, setStep] = useState<Step>(0);
  const [uploadedLogId, setUploadedLogId] = useState<string | null>(null);

  if (completed) return null;

  const isLast = step === STEP_COUNT - 1;
  const canGoBack = step > 0;

  const ensurePrivacyDefault = () => {
    // Privacy-respecting default: if the user finished or skipped without
    // answering, treat that as opt-out and persist so the server agrees.
    if (promptResolved) return;
    resolvePrompt(false);
    const cfg = cfgQuery.data;
    if (cfg && cfg.enabled) {
      updateMut.mutate({ ...cfg, enabled: false, opted_in_at: null });
    }
  };

  const finish = () => {
    ensurePrivacyDefault();
    complete();
    if (uploadedLogId) {
      router.push(`/processes?focus=${uploadedLogId}`);
    }
  };

  const onNext = () => {
    if (isLast) {
      finish();
    } else {
      setStep((s) => ((s + 1) as Step));
    }
  };

  const onBack = () => {
    if (canGoBack) setStep((s) => ((s - 1) as Step));
  };

  const onSkip = () => {
    if (isLast) {
      finish();
    } else {
      setStep((s) => ((s + 1) as Step));
    }
  };

  // Step indices: 0 welcome, 1 privacy, 2 upload, 3 modules
  const uploadInProgress = step === 2 && !uploadedLogId;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex justify-center pt-10">
        <StepIndicator current={step} total={STEP_COUNT} />
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        {step === 0 && <WelcomeStep />}
        {step === 1 && <PrivacyStep />}
        {step === 2 && (
          <UploadStep uploadedLogId={uploadedLogId} onUploaded={setUploadedLogId} />
        )}
        {step === 3 && <ModulesStep />}
      </div>

      <div className="border-t border-border bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <div>
            {canGoBack && (
              <Button
                variant="ghost"
                onClick={onBack}
                className="cursor-pointer gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="cursor-pointer text-muted-foreground"
            >
              {isLast ? "Skip" : "Skip step"}
            </Button>
            <Button
              onClick={onNext}
              className="cursor-pointer gap-1.5"
            >
              {isLast ? (
                <>
                  Finish
                  <Check className="h-4 w-4" />
                </>
              ) : uploadInProgress ? (
                <>
                  Skip
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 rounded-full transition-all",
            i === current ? "w-8 bg-primary" : "w-2 bg-muted",
            i < current && "bg-primary/50",
          )}
          aria-label={`Step ${i + 1}${i === current ? " (current)" : ""}`}
        />
      ))}
    </div>
  );
}
