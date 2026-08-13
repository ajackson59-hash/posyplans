// A reviewer-only control for the protected Preview proof.
//
// The server decides whether this component may render. Even then, the button
// that asks Anthropic for four TEXT concepts stays disabled until the live
// readiness response proves the kill switch, one-direction cap, no-retry
// setting, exact image model, and zero artwork counters. This component has no
// reference to the generation endpoint and cannot turn the kill switch off.

import { useMutation, useQuery } from "@tanstack/react-query";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Check, FileCheck2, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";

interface ProviderReadiness {
  provider: "anthropic" | "openai";
  model: string;
  configured: boolean;
  accessible: boolean;
  httpStatus?: number;
  error?: string;
}

interface PreviewReadiness {
  ready: boolean;
  environment: "preview";
  killSwitch: true;
  canaryControlsReady: boolean;
  directionLimit: number;
  automaticRetryDisabled: boolean;
  artworkModel: string;
  providers: {
    ready: boolean;
    anthropic: ProviderReadiness;
    openai: ProviderReadiness;
    imageProviderCalls: number;
  };
  imageProviderCalls: number;
  billedArtworkAttempts: number;
}

interface ConceptProof {
  model: string;
  concepts: AiFirstConcept[];
  conceptRejections: number;
  environment: "preview";
  killSwitch: true;
  runClaimed: false;
  imageProviderCalls: 0;
  billedArtworkAttempts: 0;
}

function conceptProofPassed(value: ConceptProof): boolean {
  return (
    value.environment === "preview" &&
    value.killSwitch === true &&
    value.runClaimed === false &&
    value.imageProviderCalls === 0 &&
    value.billedArtworkAttempts === 0 &&
    value.concepts.length === 4
  );
}

export function previewReadinessPassed(value: PreviewReadiness | undefined): value is PreviewReadiness {
  return Boolean(
    value?.ready &&
      value.environment === "preview" &&
      value.killSwitch === true &&
      value.canaryControlsReady &&
      value.directionLimit === 1 &&
      value.automaticRetryDisabled &&
      value.artworkModel === "gpt-image-2" &&
      value.providers.ready &&
      value.providers.anthropic.accessible &&
      value.providers.openai.accessible &&
      value.providers.imageProviderCalls === 0 &&
      value.imageProviderCalls === 0 &&
      value.billedArtworkAttempts === 0,
  );
}

function Gate({ passed, children }: { passed: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-foreground">
      {passed ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      ) : (
        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
      )}
      <span>{children}</span>
    </li>
  );
}

export default function AiFirstPreviewReview({ ownerToken }: { ownerToken: string }) {
  const readiness = useQuery<PreviewReadiness>({
    queryKey: [`/api/events/owner/${ownerToken}/ai-first/review/readiness`],
    enabled: false,
    staleTime: 0,
    retry: false,
  });
  const conceptProof = useMutation<ConceptProof, Error>({
    retry: false,
    mutationFn: async () => {
      const result = await apiRequestJson<ConceptProof>(
        "POST",
        `/api/events/owner/${ownerToken}/ai-first/review/concept-proof`,
        { confirmConceptOnly: true },
      );
      if (!conceptProofPassed(result)) {
        throw new Error("The text proof did not preserve every zero-image safety boundary.");
      }
      return result;
    },
  });

  const passed = previewReadinessPassed(readiness.data);

  const checkReadiness = () => {
    conceptProof.reset();
    void readiness.refetch();
  };

  return (
    <section
      className="mb-5 rounded-md border border-primary/30 bg-background p-4"
      data-testid="card-preview-concept-review"
      aria-labelledby="preview-review-title"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p id="preview-review-title" className="text-sm font-semibold text-foreground">
            Preview canary review
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reviewer-only. The generation kill switch stays on. This proof creates four text concepts and cannot create artwork.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={checkReadiness}
          disabled={readiness.isFetching || conceptProof.isPending}
          data-testid="button-check-preview-readiness"
        >
          {readiness.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {readiness.data ? "Recheck readiness" : "Check readiness"}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => conceptProof.mutate()}
          disabled={!passed || conceptProof.isPending || Boolean(conceptProof.data)}
          data-testid="button-run-concept-proof"
        >
          {conceptProof.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {conceptProof.isPending
            ? "Reviewing text concepts…"
            : conceptProof.data
              ? "Concept proof complete"
              : "Run text-only concept proof"}
        </Button>
      </div>

      {readiness.isError && (
        <p className="mt-3 text-xs text-destructive" role="alert" data-testid="text-preview-readiness-error">
          Readiness check failed: {(readiness.error as Error).message}
        </p>
      )}

      {readiness.data && (
        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3" data-testid="preview-readiness-result">
          <p className="text-xs font-semibold text-foreground">
            {passed ? "All zero-image gates passed" : "Concept proof remains locked"}
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            <Gate passed={readiness.data.killSwitch}>Kill switch ON</Gate>
            <Gate passed={readiness.data.providers.anthropic.accessible}>
              Anthropic · {readiness.data.providers.anthropic.model}
            </Gate>
            <Gate passed={readiness.data.providers.openai.accessible}>
              OpenAI · {readiness.data.providers.openai.model}
            </Gate>
            <Gate passed={readiness.data.canaryControlsReady}>
              Direction limit 1 · retry disabled
            </Gate>
            <Gate passed={readiness.data.imageProviderCalls === 0}>Zero image-provider calls</Gate>
            <Gate passed={readiness.data.billedArtworkAttempts === 0}>Zero billed artwork attempts</Gate>
          </ul>
        </div>
      )}

      {conceptProof.isError && (
        <p className="mt-3 text-xs text-destructive" role="alert" data-testid="text-concept-proof-error">
          Concept proof failed: {conceptProof.error.message}
        </p>
      )}

      {conceptProof.data && (
        <div className="mt-4" data-testid="concept-proof-result">
          <p className="text-sm font-semibold text-foreground">
            Four text concepts passed with the safety boundary intact
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {conceptProof.data.model} · {conceptProof.data.conceptRejections} rejected concepts · zero artwork calls · zero billed attempts · no run claimed
          </p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {conceptProof.data.concepts.map((concept, index) => (
              <li key={`${concept.conceptName}-${index}`} className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Concept {index + 1} · {concept.focalStrategy?.replaceAll("-", " ")}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{concept.conceptName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{concept.description}</p>
                <dl className="mt-2 space-y-1 text-xs">
                  <div>
                    <dt className="inline font-semibold text-foreground">Medium: </dt>
                    <dd className="inline text-muted-foreground">{concept.art.medium}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-foreground">Composition: </dt>
                    <dd className="inline text-muted-foreground">{concept.art.composition}</dd>
                  </div>
                </dl>
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">Review art prompt</summary>
                  <p className="mt-1 whitespace-pre-wrap">{concept.art.prompt}</p>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
