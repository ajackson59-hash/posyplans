// Exploration state for the AI-first invitation experience.
//
// It lives in a hook the *parent* owns rather than inside the experience
// component, because the host switches between the generated directions and
// the Posy collection and those are different subtrees. If the state sat in
// the component, every switch would unmount it and silently discard four
// generated directions, the host's typed steer and their filters. Holding it
// one level up makes a conditional unmount lossless.

import { useCallback, useRef, useState } from "react";
import {
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

export function useAiFirstSession(ownerToken: string): AiFirstSession {
  const [directions, setDirections] = useState<FinishedDirection[]>([]);
  const [concepts, setConcepts] = useState<AiFirstConcept[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const [typedDirection, setTypedDirection] = useState("");
  const [inspirationNotes, setInspirationNotes] = useState("");
  const [vibeAnswer, setVibeAnswer] = useState("");
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [browsingCollection, setBrowsingCollection] = useState(false);
  const [filters, setFilters] = useState<AiFirstFilters>({ style: "all", occasion: "all" });

  const abort = useRef<AbortController | null>(null);

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
      setSummary(event.summary);
    } else if (event.type === "error") {
      setError(event.message);
    }
  }, []);

  const run = useCallback(
    async (options: AiFirstRunOptions = {}) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

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
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [apply, inspirationNotes, ownerToken, typedDirection, vibeAnswer],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
    setRunning(false);
  }, []);

  return {
    directions,
    concepts,
    progress,
    warnings,
    summary,
    error,
    running,
    hasRun,
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
