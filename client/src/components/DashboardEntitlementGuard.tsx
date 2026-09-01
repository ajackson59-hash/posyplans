import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface EntitlementSummary {
  planTier: string;
  trialEndsAt: number | null;
  gatedActionsAvailable: boolean;
}

/**
 * The dashboard header predates Plus entitlements and always renders its
 * Upgrade link. Keep the launch fix isolated from dashboard business logic:
 * resolve the same server-side entitlement summary used by generation and
 * suppress that stale CTA whenever this host already has active Plus access.
 *
 * This is deliberately read-only. Payment state remains authoritative on the
 * server; no client flag can grant access.
 */
export default function DashboardEntitlementGuard() {
  const [location] = useLocation();
  const match = location.match(/^\/dashboard\/([^/?#]+)/);
  const ownerToken = match?.[1] ?? "";

  const { data } = useQuery<EntitlementSummary>({
    queryKey: [`/api/events/owner/${ownerToken}/master-planner/entitlement`],
    enabled: Boolean(ownerToken),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (!ownerToken || !data) return null;

  const activePlus =
    data.planTier === "plus_active" ||
    (data.planTier === "plus_trial" && Boolean(data.trialEndsAt) && (data.trialEndsAt as number) > Date.now());

  if (!activePlus && !data.gatedActionsAvailable) return null;

  return (
    <style data-testid="style-hide-upgrade-for-plus">
      {`a[data-testid="link-upgrade-plus"] { display: none !important; }`}
    </style>
  );
}
