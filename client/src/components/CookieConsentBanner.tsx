import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { grantAnalyticsConsent, grantMarketingConsent } from "@/lib/analytics";

// Copy and structure follow PartyPilot_SMS_Cookie_Consent_Copy.md §2 (filename predates the Posy rebrand)
// verbatim (banner text, three-button layout, and the Manage Preferences
// panel). Consent is persisted via a plain Set-Cookie from the backend
// (see server/cookies.ts + the /api/consent routes) rather than
// document.cookie/localStorage, which aren't reliable in this app's
// sandboxed preview iframe.

interface ConsentState {
  hasChoice: boolean;
  analytics: boolean;
  marketing: boolean;
}

export function CookieConsentBanner() {
  const [showPreferences, setShowPreferences] = useState(false);
  const [draftAnalytics, setDraftAnalytics] = useState(false);
  const [draftMarketing, setDraftMarketing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<ConsentState>({
    queryKey: ["/api/consent"],
    queryFn: () => apiRequestJson<ConsentState>("GET", "/api/consent"),
  });

  // A prior visit already recorded "analytics: on" — resume tracking
  // without asking again, since re-showing the banner on every load would
  // violate the "don't nag" spirit of the 12-month consent window the
  // copy doc calls for.
  useEffect(() => {
    if (data?.hasChoice && data.analytics) {
      grantAnalyticsConsent();
    }
    if (data?.hasChoice && data.marketing) {
      grantMarketingConsent();
    }
  }, [data?.hasChoice, data?.analytics, data?.marketing]);

  const saveConsent = useMutation({
    mutationFn: (prefs: { analytics: boolean; marketing: boolean }) =>
      apiRequestJson<ConsentState>("POST", "/api/consent", prefs),
    onSuccess: (result) => {
      if (result.analytics) grantAnalyticsConsent();
      if (result.marketing) grantMarketingConsent();
      setShowPreferences(false);
      setDismissed(true);
    },
  });

  if (dismissed || data?.hasChoice) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card p-4 shadow-lg sm:p-6"
      data-testid="banner-cookie-consent"
    >
      <div className="mx-auto max-w-4xl">
        {!showPreferences ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground" data-testid="text-consent-title">
                We use cookies to make Posy work better for you.
              </p>
              <p className="mt-1 text-sm text-muted-foreground" data-testid="text-consent-body">
                We use essential cookies to run the site, and — if you allow it — analytics cookies
                to understand how Posy is used so we can improve it. We don't sell your data.{" "}
                <Link href="/privacy" className="underline hover:text-foreground">
                  Learn more in our Privacy Policy.
                </Link>
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-2">
              <Button
                variant="outline"
                data-testid="button-reject-nonessential"
                onClick={() => saveConsent.mutate({ analytics: false, marketing: false })}
                disabled={saveConsent.isPending}
              >
                Reject Non-Essential
              </Button>
              <Button
                variant="outline"
                data-testid="button-manage-preferences"
                onClick={() => {
                  setDraftAnalytics(false);
                  setDraftMarketing(false);
                  setShowPreferences(true);
                }}
                disabled={saveConsent.isPending}
              >
                Manage Preferences
              </Button>
              <Button
                data-testid="button-accept-all"
                onClick={() => saveConsent.mutate({ analytics: true, marketing: true })}
                disabled={saveConsent.isPending}
              >
                Accept All
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground" data-testid="text-preferences-title">
                Cookie preferences
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which cookies Posy can use. You can change this anytime from the footer.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Essential — Always on</p>
                  <p className="text-sm text-muted-foreground">
                    Required for the site to function (e.g., keeping your event session active).
                    Can't be turned off.
                  </p>
                </div>
                <Switch checked disabled data-testid="switch-consent-essential" />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Analytics</p>
                  <p className="text-sm text-muted-foreground">
                    Helps us understand how Posy is used, so we can improve the planning
                    experience (Google Analytics, Cloudflare Web Analytics).
                  </p>
                </div>
                <Switch
                  checked={draftAnalytics}
                  onCheckedChange={setDraftAnalytics}
                  data-testid="switch-consent-analytics"
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Marketing</p>
                  <p className="text-sm text-muted-foreground">
                    Used to measure whether our ads are working, via Meta.
                  </p>
                </div>
                <Switch
                  checked={draftMarketing}
                  onCheckedChange={setDraftMarketing}
                  data-testid="switch-consent-marketing"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                data-testid="button-back-to-banner"
                onClick={() => setShowPreferences(false)}
                disabled={saveConsent.isPending}
              >
                Back
              </Button>
              <Button
                data-testid="button-save-preferences"
                onClick={() => saveConsent.mutate({ analytics: draftAnalytics, marketing: draftMarketing })}
                disabled={saveConsent.isPending}
              >
                Save Preferences
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
