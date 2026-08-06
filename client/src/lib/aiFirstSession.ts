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
// said `done`, or "failed" because the server said `error`. Before this
// fix, an SSE/NDJSON body that simply ended — a dropped connection, a proxy
// timeout, a crashed process — fell through the reader loop with `running`
// set back to false and no error, no summary and nothing on screen but
// whatever partial directions had already arrived. A host could not tell
// that from success. Any stream end that is not one of those two explicit
// terminal events is now itself surfaced as a clear failure.

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
import { API_BASE } from "./queryClient";

export interface AiFirstFilters {
  style: string;
  occasion: string;
}

export interface AiFirstRunOptions {
  action?: string;
  concept?: AiFirstConcept;
  direction?: string;
  avoidConceptNames?: string[];
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

/** Host-visible copy for the case an SSE body ends with no terminal event. */
export const UNEXPECTED_STREAM_END_MESSAGE =
  "Posy lost the display connection before confirming the result. Do not click again yet—refresh the page before starting another direction.";
export const EMPTY_COMPLETION_MESSAGE =
  "Posy couldn't finish a usable invitation direction. You were not shown a completed design.";
export const RUN_STILL_PROCESSING_MESSAGE =
  "Posy lost the display connection, but this invitation may still be processing. Do not click again—refresh the page first.";

interface DurableRunStatus {
  status?: string;
  completedCount?: number;
  errorMessage?: string | null;
  terminal?: boolean;
}

/** Recover the server's durable truth when the streaming response disappears. */
async function recoverRunMessage(ownerToken: string, runId: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/api/events/owner/${ownerToken}/ai-first/run/${runId}`);
    if (!response.ok || typeof response.json !== "function") return null;
    const run = (await response.json()) as DurableRunStatus;
    if (run.terminal && run.status === "failed") {
      return hostFacingGenerationError(run.errorMessage || QUALITY_REJECTION_MESSAGE);
    }
    if (run.terminal && run.completedCount === 0) return QUALITY_REJECTION_MESSAGE;
    if (!run.terminal) return RUN_STILL_PROCESSING_MESSAGE;
    return null;
  } catch {
    return null;
  }
}

export function useAiFirstSession(ownerToken: string): AiFirstSession {
  const [directions, setDirections] = useState<FinishedDirection[]>([]);
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
      setDirections((prev) => [
        ...prev.filter((d) => d.index !== event.direction.index),
        event.direction,
      ]);
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

      const runId = newRunId();
      setCurrentRunId(runId);

      setRunning(true);
      setHasRun(true);
      setError(null);
      setWarnings([]);
      setProgress([]);
      setSummary(null);
      setDirections([]);
      setConcepts([]);

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
            inspirationNotes: inspirationNotes.trim() || undefined,
            feeling: vibeAnswer.trim() || undefined,
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

        // The defect this closes: reaching here only means the body ended,
        // not that the run succeeded. `done` and `error` are the only two
        // events that mean anything about the run's outcome; anything else
        // — including a clean-looking EOF with partial directions already
        // on screen — is reported as a failure rather than silently
        // treated as success by omission.
        if (!reachedTerminal.current) {
          setError((await recoverRunMessage(ownerToken, runId)) ?? UNEXPECTED_STREAM_END_MESSAGE);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          reachedTerminal.current = true;
          setError((await recoverRunMessage(ownerToken, runId)) ?? UNEXPECTED_STREAM_END_MESSAGE);
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
