/**
 * The host describes the event once during intake. Some older events store
 * that description in `vibeDescription`, while later edits may also add a
 * shorter `themeName`. These helpers keep every creative surface reading the
 * same brief without forcing the host to type it again.
 */
export interface EventStyleSource {
  themeName?: string | null;
  vibeDescription?: string | null;
  eventType?: string | null;
  eventName?: string | null;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function eventStyleParts(event: EventStyleSource): string[] {
  const parts = [clean(event.themeName), clean(event.vibeDescription)].filter(Boolean);
  const seen = new Set<string>();

  return parts.filter((part) => {
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The best editable starting value for theme tools. */
export function eventStyleSeed(event: EventStyleSource): string {
  return eventStyleParts(event)[0] ?? "";
}

/** The complete brief shown to the host and passed to creative tools. */
export function eventStyleSummary(event: EventStyleSource): string {
  const saved = eventStyleParts(event).join(" — ");
  if (saved) return saved;

  const eventType = clean(event.eventType);
  const eventName = clean(event.eventName);
  if (eventType && eventName) return `${eventType} for ${eventName}`;
  return eventType || eventName;
}

/** Avoid copying an intake vibe into themeName just because it was reviewed. */
export function isSavedEventStyle(event: EventStyleSource, value: string): boolean {
  const candidate = clean(value).toLocaleLowerCase();
  if (!candidate) return false;
  return eventStyleParts(event).some((part) => part.toLocaleLowerCase() === candidate);
}
