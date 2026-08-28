// Exploration state for the AI-first invitation experience.
//
// It lives in a hook the *parent* owns rather than inside the experience
// component, because the host switches between the generated directions and
// the Posy collection and those are different subtrees. If the state sat in
// the component, every switch would unmount it and silently discard four
// generated directions, the host's typed steer and their filters. Holding it
// one level up makes a conditional unmount lossless.
//
// Reliability repair: a run is only ever "successful" because the server
// said `done`, or "failed" because the server said `error`. If the streaming
// display connection disappears, Posy now reconciles against the durable run
// instead of making the host know to refresh the page.

import { useCallback, useRef, useState } from "react";
import {
  hostFacingGenerationError,
  QUALITY_REJECTION_MESSAGE,
  SseParser,
  type FinishedDirection,
  type PipelineEvent,
  type RunSummary,
} from "@shared/aiFirstStream";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { API_BASE, queryClient } from "./queryClient";

export interface AiFirstFilters {
  style: string;
  occasion: string;
}

export interface AiFirstRunOptions {
  action?: string;
  concept?: AiFirstConcept;
  direction?: string;
  avoidConceptNames?: string[];
  /** Desired number of directions for this action; the server caps it. */
  directionCount?: number;
  /**
   * The first generation for an event is the primary experience. Every
   * later provider-backed generation is a separate cost-bearing decision,
   * so the UI must obtain an explicit confirmation and the server must see
   * it before a new run id can be claimed.
   */
  confirmAdditionalGeneration?: boolean;
}

/** A fresh id per logical run (a generate click), not per HTTP retry of one. */
function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // A jsdom / very old browser fallback. Collision odds are irrelevant here:
  // the id only has to be unique among this tab's own runs.
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface AiFirstSession {
  /** Directions the gate approved, in the order they were revealed. */
  directions: FinishedDirection[];
  /** Earlier approved directions remain available while a revision runs. */
  savedDirections: FinishedDirection[];
  /** Concepts parsed so far — a card can show its idea before its artwork. */
  concepts: AiFirstConcept[];
  progress: string[];
  warnings: string[];
  summary: RunSummary | null;
  error: string | null;
  running: boolean;
  hasRun: boolean;
  /** Directions actually on screen so far, generated or adapted-fallback. */
  completedCount: number;
  /** Of those, how many are an adapted studio direction rather than generated art. */
  fallbackCount: number;
  /** The id of the run currently in flight (or most recently run). */
  currentRunId: string | null;

  typedDirection: string;
  setTypedDirection: (value: string) => void;
  inspirationNotes: string;
  setInspirationNotes: (value: string) => void;
  vibeAnswer: string;
  setVibeAnswer: (value: string) => void;

  /** The card the host is considering. Previewing never touches the event. */
  selectedPreviewId: string | null;
  setSelectedPreviewId: (previewId: string | null) => void;

  browsingCollection: boolean;
  setBrowsingCollection: (value: boolean) => void;
  filters: AiFirstFilters;
  setFilters: (filters: AiFirstFilters) => void;

  run: (options?: AiFirstRunOptions) => Promise<void>;
  cancel: () => void;
}

/** Host-visible copy only after durable reconciliation also cannot recover. */
export const UNEXPECTED_STREAM_END_MESSAGE =
  "Posy lost the display connection before confirming the result. Your work is saved; reconnect and Posy will check for the finished design before you start another direction.";
export const EMPTY_COMPLETION_MESSAGE =
  "Posy couldn't finish a usable invitation direction. You were not shown a completed design.";
export const RUN_STILL_PROCESSING_MESSAGE =
  "Your invitation is still being created. Posy is checking for the finished design automatically.";

interface DurableRunStatus {
  status?: string;
  completedCount?: number;
  errorMessage?: string | null;
  terminal?: boolean;
}

type DurableRecovery =
  | { kind: "complete" }
  | { kind: "failed"; message: string }
  | { kind: "processing" }
  | { kind: "unknown" };

const RECOVERY_POLL_ATTEMPTS = 30;
const RECOVERY_POLL_DELAY_MS = 2000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read the server's durable truth when the streaming response disappears. */
async function readDurableRun(ownerToken: string, runId: string): Promise<DurableRecovery> {
  try {
    const response = await fetch(`${API_BASE}/api/events/owner/${ownerToken}/ai-first/run/${runId}`);
    if (!response.ok || typeof response.json !== "function") return { kind: "unknown" };
    const run = (await response.json()) as DurableRunStatus;
    if (run.terminal && run.status === "failed") {
      return { kind: "failed", message: hostFacingGenerationError(run.errorMessage || QUALITY_REJECTION_MESSAGE) };
    }
    if (run.terminal && (run.completedCount ?? 0) === 0) {
      return { kind: "failed", message: QUALITY_REJECTION_MESSAGE };
    }
    if (run.terminal) return { kind: "complete" };
    return { kind: "processing" };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Keep checking a run that survived a dropped mobile/SSE connection. This is a
 * read-only recovery loop: it never starts another generation or spends again.
 */
async function recoverDurableRun(ownerToken: string, runId: string): Promise<DurableRecovery> {
  let last: DurableRecovery = { kind: "unknown" };
  for (let attempt = 0; attempt < RECOVERY_POLL_ATTEMPTS; attempt += 1) {
    last = await readDurableRun(ownerToken, runId);
    if (last.kind === "complete" || last.kind === "failed") return last;
    if (attempt < RECOVERY_POLL_ATTEMPTS - 1) await wait(RECOVERY_POLL_DELAY_MS);
  }
  return last;
}

function revealFinishedDirections() {
  if (typeof document === "undefined") return;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // The query invalidation / direction state update needs a render before the
  // result grid exists. Two frames is enough without introducing a timer that
  // can yank a host around later.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.getElementById("grid-ai-directions") ?? document.getElementById("ai-first-invitations");
      target?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    });
  });
}

export function useAiFirstSession(ownerToken: string): AiFirstSession {
  const [directions, setDirections] = useState<FinishedDirection[]>([]);
  const [savedDirections, setSavedDirections] = useState<FinishedDirection[]>([]);
  const directionsRef = useRef<FinishedDirection[]>([]);
  const [concepts, setConcepts] = useState<AiFirstConcept[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const [typedDirection, setTypedDirection] = useState("");
  const [inspirationNotes, setInspirationNotes] = useState("");
  const [vibeAnswer, setVibeAnswer] = useState("");
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [browsingCollection, setBrowsingCollection] = useState(false);
  const [filters, setFilters] = useState<AiFirstFilters>({ style: "all", occasion: "all" });

  const abort = useRef<AbortController | null>(null);
  /** Synchronous guard: closes the gap before React paints `running=true`. */
  const runInFlight = useRef(false);
  /** Set the instant a `done` or `error` event is applied, for this run only. */
  const reachedTerminal = useRef(false);
  /** Auto-reveal the first finished card once per run, never on every direction. */
  const revealedFirstDirection = useRef(false);

  const apply = useCallback((event: PipelineEvent) => {
    if (event.type === "progress") {
      setProgress((prev) => (prev[prev.length - 1] === event.message ? prev : [...prev, event.message]));
    } else if (event.type === "concept") {
      setConcepts((prev) => {
        const next = prev.slice();
        next[event.index] = event.concept;
        return next;
      });
    } else if (event.type === "direction") {
      // Replace rather than append: a re-run of the same index supersedes it.
      setDirections((prev) => {
        const next = [...prev.filter((d) => d.index !== event.direction.index), event.direction];
        directionsRef.current = next;
        return next;
      });
      if (!revealedFirstDirection.current) {
        revealedFirstDirection.current = true;
        revealFinishedDirections();
      }
    } else if (event.type === "warning") {
      setWarnings((prev) => [...prev, event.message]);
    } else if (event.type === "done") {
      reachedTerminal.current = true;
      if (event.summary.directions < 1) {
        setSummary(null);
        setError(EMPTY_COMPLETION_MESSAGE);
      } else {
        setSummary(event.summary);
      }
    } else if (event.type === "error") {
      reachedTerminal.current = true;
      setError(hostFacingGenerationError(event.message));
    }
  }, []);

  const run = useCallback(
    async (options: AiFirstRunOptions = {}) => {
      // A double click must remain one logical run even before React has had
      // time to disable the button. Do not abort the paid request and replace
      // it with a second run id.
      if (runInFlight.current) return;
      runInFlight.current = true;
      const controller = new AbortController();
      abort.current = controller;
      reachedTerminal.current = false;
      revealedFirstDirection.current = false;

      const runId = newRunId();
      setCurrentRunId(runId);

      setRunning(true);
      setHasRun(true);
      setError(null);
      setWarnings([]);
      setProgress([]);
      setSummary(null);
      const currentDirections = directionsRef.current;
      if (currentDirections.length > 0) {
        setSavedDirections((previous) => {
          const byPreviewId = new Map(previous.map((direction) => [direction.previewId, direction]));
          for (const direction of currentDirections) byPreviewId.set(direction.previewId, direction);
          return Array.from(byPreviewId.values());
        });
      }
      directionsRef.current = [];
      setDirections([]);
      setConcepts([]);

      const reconcileLostStream = async () => {
        setProgress((prev) =>
          prev[prev.length - 1] === RUN_STILL_PROCESSING_MESSAGE
            ? prev
            : [...prev, RUN_STILL_PROCESSING_MESSAGE],
        );
        const recovery = await recoverDurableRun(ownerToken, runId);
        if (recovery.kind === "failed") {
          setError(recovery.message);
          return;
        }
        if (recovery.kind === "complete") {
          setError(null);
          // Approved designs are durable even if their stream events never made
          // it to this tab. Refetch those exact saved assets; never regenerate.
          await queryClient.invalidateQueries({
            queryKey: [`/api/events/owner/${ownerToken}/ai-first/approved-designs`],
          });
          revealFinishedDirections();
          return;
        }
        setError(UNEXPECTED_STREAM_END_MESSAGE);
      };

      try {
        const response = await fetch(`${API_BASE}/api/events/owner/${ownerToken}/ai-first/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            runId,
            action: options.action,
            concept: options.concept,
            direction: options.direction ?? (typedDirection.trim() || undefined),
            avoidConceptNames: options.avoidConceptNames,
            directionCount: options.directionCount,
            inspirationNotes: inspirationNotes.trim() || undefined,
            feeling: vibeAnswer.trim() || undefined,
            confirmAdditionalGeneration: options.confirmAdditionalGeneration === true,
          }),
        });

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          reachedTerminal.current = true;
          setError(body?.error ?? "Posy couldn't start that. Please try again.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parser.push(decoder.decode(value, { stream: true }))) apply(event);
        }

        // Reaching EOF only means the display stream ended. If no terminal
        // event arrived, reconcile against the server's durable run instead of
        // telling the host to refresh or letting them accidentally start again.
        if (!reachedTerminal.current) await reconcileLostStream();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          await reconcileLostStream();
        }
      } finally {
        runInFlight.current = false;
        setRunning(false);
      }
    },
    [apply, inspirationNotes, ownerToken, typedDirection, vibeAnswer],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
    setRunning(false);
  }, []);

  const completedCount = directions.length;
  const fallbackCount = directions.filter((d) => d.source === "adapted-studio-direction").length;

  return {
    directions,
    savedDirections,
    concepts,
    progress,
    warnings,
    summary,
    error,
    running,
    hasRun,
    completedCount,
    fallbackCount,
    currentRunId,
    typedDirection,
    setTypedDirection,
    inspirationNotes,
    setInspirationNotes,
    vibeAnswer,
    setVibeAnswer,
    selectedPreviewId,
    setSelectedPreviewId,
    browsingCollection,
    setBrowsingCollection,
    filters,
    setFilters,
    run,
    cancel,
  };
}
