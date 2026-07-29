// Client analytics + marketing tag loader. Two independent consent gates —
// "Analytics" and "Marketing" — each load their own tags only after the
// cookie-consent banner grants that category (see CookieConsentBanner.tsx).
// Everything here is a safe no-op until the relevant VITE_ env var is set, so
// the app runs fine with none configured.
//
//   Analytics gate  -> Cloudflare Web Analytics beacon + GA4 (gtag.js)
//   Marketing gate  -> Meta Pixel (fbq)
//
// Cloudflare Web Analytics is cookieless (see
// https://developers.cloudflare.com/web-analytics/) but is kept behind the
// Analytics toggle for consistency. GA4 adds the custom-event/conversion
// tracking Cloudflare lacks — purchase events fire from trackEvent() below.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const CF_ANALYTICS_TOKEN = import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined;
const GA4_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

// Analytics gate.
let analyticsConsentGranted = false;
let cfInitialized = false;
let ga4Initialized = false;

// Marketing gate.
let marketingConsentGranted = false;
let pixelInitialized = false;

export function isAnalyticsConfigured(): boolean {
  return !!CF_ANALYTICS_TOKEN || !!GA4_MEASUREMENT_ID;
}

export function isMarketingConfigured(): boolean {
  return !!META_PIXEL_ID;
}

/** Marketing consent flag, read by CheckoutSuccess.tsx to decide whether to
 *  fire the client-side Meta Pixel Purchase event. */
export function isMarketingConsentGranted(): boolean {
  return marketingConsentGranted;
}

function loadCloudflareBeacon(): void {
  if (cfInitialized || !CF_ANALYTICS_TOKEN || typeof document === "undefined") return;
  cfInitialized = true;

  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: CF_ANALYTICS_TOKEN }));
  document.head.appendChild(script);
}

function loadGa4(): void {
  if (ga4Initialized || !GA4_MEASUREMENT_ID || typeof document === "undefined") return;
  ga4Initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag pushes its own `arguments` object onto the dataLayer verbatim.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA4_MEASUREMENT_ID);
}

function loadMetaPixel(): void {
  if (pixelInitialized || !META_PIXEL_ID || typeof document === "undefined") return;
  pixelInitialized = true;

  // Standard Meta Pixel base snippet. Automatic Advanced Matching is enabled
  // pixel-side, so only the base loader + init + PageView are needed here.
  /* eslint-disable */
  (function (f: any, b: Document, e: string, v: string) {
    if (f.fbq) return;
    const n: any = (f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const t = b.createElement(e) as HTMLScriptElement;
    t.async = true;
    t.src = v;
    const s = b.getElementsByTagName(e)[0];
    s.parentNode!.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */

  window.fbq?.("init", META_PIXEL_ID);
  window.fbq?.("track", "PageView");
}

/** Call from the cookie-consent banner once the "Analytics" category is
 *  accepted. Loads Cloudflare Web Analytics + GA4. Safe to call more than
 *  once; no-ops for any tool whose env var isn't set. */
export function grantAnalyticsConsent(): void {
  analyticsConsentGranted = true;
  loadCloudflareBeacon();
  loadGa4();
}

/** Call from the cookie-consent banner once the "Marketing" category is
 *  accepted. Loads the Meta Pixel. Safe to call more than once; no-ops if
 *  VITE_META_PIXEL_ID isn't set. */
export function grantMarketingConsent(): void {
  marketingConsentGranted = true;
  loadMetaPixel();
}

export type AnalyticsEventName = "trial_started" | "subscribed" | "spark_unlocked";

interface TrackEventParams {
  value?: number;
  currency?: string;
  transaction_id?: string;
  billing_interval?: string;
}

/** Records a conversion in GA4 as a standard `purchase` event. Safe no-op
 *  until GA4 is both configured and analytics consent is granted. The Meta
 *  Pixel Purchase event is fired separately at the call site (gated on
 *  marketing consent). */
export function trackEvent(name: AnalyticsEventName, params?: TrackEventParams): void {
  if (!analyticsConsentGranted || !ga4Initialized || typeof window === "undefined" || !window.gtag) return;

  window.gtag("event", "purchase", {
    value: params?.value,
    currency: params?.currency ?? "USD",
    transaction_id: params?.transaction_id,
    ...(params?.billing_interval ? { billing_interval: params.billing_interval } : {}),
    posy_event: name,
  });
}
