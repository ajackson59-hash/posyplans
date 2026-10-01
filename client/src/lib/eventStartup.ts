import { apiRequest } from "@/lib/queryClient";
import type { EventRecord } from "@/lib/types";

const PENDING_START_KEY = "posy:pending-event-start:v1";
const DEFAULT_RETRY_DELAYS_MS = [0, 500, 1500] as const;

let inMemoryStartKey = "";

export interface EventStartSeed {
  eventName: string;
  eventType: string;
  eventDate: string;
  inviteSubject: string;
  inviteMessage: string;
}

interface ResponseLike {
  json(): Promise<unknown>;
}

type EventStartRequest = (
  method: string,
  url: string,
  data?: unknown,
) => Promise<ResponseLike>;

export interface EventStartupOptions {
  request?: EventStartRequest;
  sleep?: (ms: number) => Promise<void>;
  startKey?: string;
  retryDelaysMs?: readonly number[];
}

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function makeStartKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Old-browser fallback. The server hashes this value before using it as an
  // owner token, and the timestamp plus two random segments keeps collisions
  // vanishingly unlikely even without Web Crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreatePendingEventStartKey(): string {
  const storage = sessionStore();
  const existing = storage?.getItem(PENDING_START_KEY) || inMemoryStartKey;
  if (existing) return existing;

  const created = makeStartKey();
  inMemoryStartKey = created;
  try {
    storage?.setItem(PENDING_START_KEY, created);
  } catch {
    // The in-memory value still keeps every retry in this page idempotent.
  }
  return created;
}

export function clearPendingEventStartKey(completedKey: string): void {
  if (inMemoryStartKey === completedKey) inMemoryStartKey = "";
  const storage = sessionStore();
  try {
    if (storage?.getItem(PENDING_START_KEY) === completedKey) {
      storage.removeItem(PENDING_START_KEY);
    }
  } catch {
    // Nothing else is required; the event's owner token is already in the URL.
  }
}

function statusFromError(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isFinite(status)) return status;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = /^(\d{3}):/.exec(message);
  return match ? Number(match[1]) : null;
}

function retryableStartupError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status === null) return true; // network interruption / lost response
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Starts one logical event, even if the network response is lost. Every
 * automatic retry carries the same start key; the server resolves that key to
 * the same owner token, so a retry can recover the first insert rather than
 * creating duplicate blank events.
 */
export async function startEventWithRecovery(
  seed: EventStartSeed,
  options: EventStartupOptions = {},
): Promise<{ event: EventRecord; startKey: string }> {
  const request = options.request ?? apiRequest;
  const sleep = options.sleep ?? wait;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const startKey = options.startKey ?? getOrCreatePendingEventStartKey();
  let lastError: unknown = new Error("Posy couldn't start the event.");

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    try {
      const response = await request("POST", "/api/events/start", { ...seed, startKey });
      const event = (await response.json()) as EventRecord;
      if (!event?.ownerToken) throw new Error("Posy couldn't confirm the event link.");
      return { event, startKey };
    } catch (error) {
      lastError = error;
      if (!retryableStartupError(error)) throw error;
    }
  }

  throw lastError;
}
