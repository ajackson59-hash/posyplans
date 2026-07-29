// Tracks events this browser has started, so a returning host can jump back
// into a dashboard from the homepage. Stored in localStorage, which is
// unreliable inside sandboxed preview iframes — every access is guarded so a
// StorageError/SecurityError can never propagate and crash the page. When
// storage is unavailable the feature silently degrades to "nothing to show".

const STORAGE_KEY = "pp_recent_events";
const MAX_ENTRIES = 5;

export interface RecentEvent {
  token: string;
  updatedAt: number;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRecentEvents(): RecentEvent[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEvent =>
          !!e && typeof e.token === "string" && typeof e.updatedAt === "number",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeRecentEvents(events: RecentEvent[]): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_ENTRIES)));
  } catch {
    // no-op — storage full/blocked; feature degrades silently.
  }
}

export function touchRecentEvent(token: string): void {
  if (!token) return;
  const existing = getRecentEvents().filter((e) => e.token !== token);
  const next: RecentEvent[] = [{ token, updatedAt: Date.now() }, ...existing];
  writeRecentEvents(next);
}

export function forgetRecentEvent(token: string): void {
  if (!token) return;
  const next = getRecentEvents().filter((e) => e.token !== token);
  writeRecentEvents(next);
}
