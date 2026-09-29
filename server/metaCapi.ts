// Meta Conversions API (server-side Purchase events). Complements the
// client-side Meta Pixel fired from CheckoutSuccess.tsx: both send the same
// event_id so Meta deduplicates them into a single conversion. Server-side
// delivery is resilient to ad-blockers and lost client sessions, which the
// browser Pixel alone is not.
//
// Fully inert unless the caller supplies verified marketing consent AND the
// pixel id and META_CAPI_ACCESS_TOKEN are set. Current checkout/webhook callers
// have no verified consent signal, so server-side tracking stays disabled.
// Browser Pixel consent handling is independent and unchanged. The
// access token is read from process.env server-side only and is NEVER exposed
// to the client, logged, or embedded here. Every call is wrapped so a Meta
// outage or misconfiguration can never throw into — and therefore never break
// — the checkout/webhook flow that calls it.
import { createHash } from "node:crypto";

const META_GRAPH_VERSION = "v19.0";

// Must match VITE_META_PIXEL_ID used client-side. Defaults to the known Posy
// pixel id so the non-secret value doesn't need to be configured in two
// places, but can be overridden via META_PIXEL_ID.
const FALLBACK_PIXEL_ID = "1595662201929479";

function pixelId(): string {
  return process.env.META_PIXEL_ID || FALLBACK_PIXEL_ID;
}

function accessToken(): string | undefined {
  return process.env.META_CAPI_ACCESS_TOKEN;
}

// Meta requires user identifiers to be SHA-256 hashed, lowercased and trimmed
// first (phone reduced to digits only). Empty/absent values yield undefined so
// the field is omitted rather than sent as a hash of "".
function hashPii(value: string | null | undefined, digitsOnly = false): string | undefined {
  if (!value) return undefined;
  let normalized = value.trim().toLowerCase();
  if (digitsOnly) normalized = normalized.replace(/\D/g, "");
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

export interface MetaPurchaseParams {
  /** Only true when backed by the person's current, separately verified
   * marketing consent. Payment, billing contact details, webhook delivery and
   * an unverified client flag are not consent. No existing caller supplies this. */
  marketingConsent?: boolean;
  email: string | null | undefined;
  phone?: string | null;
  value: number;
  currency: string;
  eventId: string;
  eventSourceUrl?: string;
  actionSource?: string;
}

/** Send only with independently verified marketing consent. This helper does
 * not verify or persist consent; any future integration must do that before
 * passing true. Missing/false consent returns before reading configuration,
 * hashing contact details or making a network request. Never throws — checkout
 * must complete regardless of Meta's availability. */
export async function sendMetaPurchaseEvent(params: MetaPurchaseParams): Promise<void> {
  if (params.marketingConsent !== true) return;

  const token = accessToken();
  const id = pixelId();
  if (!token || !id) {
    console.debug("[metaCapi] skipped — META_CAPI_ACCESS_TOKEN or pixel id not configured");
    return;
  }

  try {
    const em = hashPii(params.email);
    const ph = hashPii(params.phone, true);
    const userData: Record<string, string[]> = {};
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: params.eventId,
          action_source: params.actionSource || "website",
          ...(params.eventSourceUrl ? { event_source_url: params.eventSourceUrl } : {}),
          user_data: userData,
          custom_data: {
            value: params.value,
            currency: params.currency,
          },
        },
      ],
    };

    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${id}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[metaCapi] Purchase event rejected (${res.status}):`, body);
    }
  } catch (err) {
    console.error("[metaCapi] Failed to send Purchase event:", err);
  }
}
