// Server-owned feature flags, readable by the client through
// GET /api/feature-flags.
//
// Every flag here defaults to OFF. Production behaviour is unchanged unless
// the corresponding environment variable is explicitly set to "1"/"true", so
// merging this file cannot alter the live experience.

export const FEATURE_FLAG_IDS = [
  // The AI-first invitation experience: four automatically generated,
  // quality-gated directions shown before the curated collection.
  "aiFirstInvitations",
  // Global kill switch for *new* image generation. Independent of the flag
  // above: when this is on, reuse of existing previews, applying a saved
  // design, and the whole curated studio keep working.
  "invitationGenerationKillSwitch",
  // Next-proof safety setting: disables the automatic paid quality retry.
  // With this on, a direction gets exactly one billed image call — if it
  // fails the gate, it goes straight to the adapted studio fallback instead
  // of spending a second time on the same direction. Off by default so the
  // existing one-retry behaviour (MAX_ARTWORK_ATTEMPTS = 2) is unchanged
  // until this is explicitly turned on.
  "aiFirstDisableAutomaticRetry",
] as const;

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];

export type FeatureFlags = Record<FeatureFlagId, boolean>;

/** Production defaults. All off — the live experience is untouched. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  aiFirstInvitations: false,
  invitationGenerationKillSwitch: false,
  aiFirstDisableAutomaticRetry: false,
};

const ENV_VAR: Record<FeatureFlagId, string> = {
  aiFirstInvitations: "POSY_FLAG_AI_FIRST_INVITATIONS",
  invitationGenerationKillSwitch: "POSY_FLAG_INVITE_GENERATION_KILL_SWITCH",
  aiFirstDisableAutomaticRetry: "POSY_FLAG_AI_FIRST_DISABLE_AUTOMATIC_RETRY",
};

function isTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Reads the flags out of an environment bag. Anything other than an explicit
 * truthy string leaves the flag at its (off) default — an unset, empty,
 * misspelled or "0" value all mean off.
 */
export function readFeatureFlags(env: Record<string, string | undefined>): FeatureFlags {
  const flags = { ...DEFAULT_FEATURE_FLAGS };
  for (const id of FEATURE_FLAG_IDS) {
    flags[id] = isTruthy(env[ENV_VAR[id]]);
  }
  return flags;
}

/** The env var name that controls a flag — used by docs and error messages. */
export function featureFlagEnvVar(id: FeatureFlagId): string {
  return ENV_VAR[id];
}
