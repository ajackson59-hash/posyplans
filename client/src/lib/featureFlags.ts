// Reads the server's feature flags.
//
// The flags are answered by an unflagged route so the client knows which
// experience to render. Until the query resolves every flag reads false, so
// the default render is the existing one and a slow or failed request can
// never flash the new experience.

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@shared/featureFlags";

export function useFeatureFlags(): FeatureFlags {
  const query = useQuery<FeatureFlags>({ queryKey: ["/api/feature-flags"] });
  return query.data ?? DEFAULT_FEATURE_FLAGS;
}
