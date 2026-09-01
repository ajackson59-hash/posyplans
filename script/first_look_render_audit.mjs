import fs from "node:fs";
import { chromium } from "playwright";

const outputDir = "artifacts/first-look-render-audit";
fs.mkdirSync(outputDir, { recursive: true });

const directionCard = {
  eventName: "Brian and Blippi's Extravaganza",
  eyebrow: "THEME RECOGNIZED",
  headline: "Blippi + Meekah",
  supportingCopy: "Posy captured the event direction.",
  cues: ["Blippi + Meekah", "Indoor soft play", "Bubbles", "Ice-cream treats"],
};

const fallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#f7f1e8"/>
  <rect x="20" y="20" width="984" height="984" fill="none" stroke="#17315c" stroke-width="8"/>
  <text x="38" y="90" font-family="Arial" font-size="34" fill="#17315c">LEFT EDGE — MUST REMAIN VISIBLE</text>
  <text x="986" y="150" text-anchor="end" font-family="Arial" font-size="34" fill="#17315c">RIGHT EDGE — MUST REMAIN VISIBLE</text>
  <text x="512" y="420" text-anchor="middle" font-family="Georgia" font-size="62" fill="#17315c">Blippi + Meekah</text>
  <text x="512" y="500" text-anchor="middle" font-family="Arial" font-size="34" fill="#17315c">Indoor soft play · Bubbles · Ice-cream treats</text>
  <text x="512" y="930" text-anchor="middle" font-family="Arial" font-size="28" fill="#17315c">SQUARE DIRECTION CARD — NATIVE RATIO</text>
</svg>`;

const approvedSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="630" height="1120" viewBox="0 0 630 1120">
  <rect width="630" height="1120" fill="#f8efe5"/>
  <rect x="18" y="18" width="594" height="1084" fill="none" stroke="#17315c" stroke-width="7"/>
  <circle cx="160" cy="250" r="95" fill="#ff7a00"/>
  <circle cx="470" cy="250" r="95" fill="#7f5bb3"/>
  <text x="315" y="520" text-anchor="middle" font-family="Georgia" font-size="54" fill="#17315c">APPROVED PORTRAIT ART</text>
  <text x="315" y="590" text-anchor="middle" font-family="Arial" font-size="30" fill="#17315c">No browser overlay may cover these pixels</text>
  <text x="30" y="1080" font-family="Arial" font-size="24" fill="#17315c">BOTTOM LEFT</text>
  <text x="600" y="1080" text-anchor="end" font-family="Arial" font-size="24" fill="#17315c">BOTTOM RIGHT</text>
</svg>`;

let mode = "idle";
let checkoutCalls = 0;

function readiness() {
  if (mode === "generating") {
    return {
      ready: false,
      generationState: "generating",
      pollAfterMs: 100,
      kind: "none",
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      automaticReferenceResolutionEnabled: true,
      automaticReferenceAttempted: true,
      directionCard,
    };
  }
  if (mode === "fallback") {
    return {
      ready: true,
      generationState: "fallback",
      pollAfterMs: null,
      kind: "direction-card",
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      automaticReferenceResolutionEnabled: true,
      automaticReferenceAttempted: true,
      directionCard,
    };
  }
  if (mode === "approved") {
    return {
      ready: true,
      generationState: "ready",
      pollAfterMs: null,
      kind: "approved-image",
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      automaticReferenceResolutionEnabled: true,
      automaticReferenceAttempted: true,
      directionCard,
    };
  }
  return {
    ready: false,
    generationState: "idle",
    pollAfterMs: null,
    kind: "none",
    namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
    automaticReferenceResolutionEnabled: true,
    automaticReferenceAttempted: false,
    directionCard,
  };
}

async function wire(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/checkout/config") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true }) });
    }
    if (path.endsWith("/master-planner/entitlement")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ eventId: 999, freeDraftState: "none", emailCaptured: false, planTier: "spark", sparkUnlocked: false, canGenerate: false }),
      });
    }
    if (path.endsWith("/prepayment-preview/readiness")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
    }
    if (path.endsWith("/prepayment-preview") && request.method() === "POST") {
      mode = "generating";
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(readiness()) });
    }
    if (path.endsWith("/prepayment-preview/asset")) {
      if (mode === "fallback") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: fallbackSvg });
      if (mode === "approved") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: approvedSvg });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not ready" }) });
    }
    if (path === "/api/checkout/create-session" && request.method() === "POST") {
      checkoutCalls += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "about:blank" }) });
    }
    if (path === "/api/consent") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasChoice: true }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unhandled audit route: ${path}` }) });
  });
}

async function assertViewport(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (metrics.scrollWidth > metrics.innerWidth + 1) {
    throw new Error(`${label}: horizontal overflow ${metrics.scrollWidth} > ${metrics.innerWidth}`);
  }
  const card = page.getByTestId("prepayment-preview-card");
  const box = await card.boundingBox();
  if (!box || box.x < -1 || box.x + box.width > metrics.innerWidth + 1) {
    throw new Error(`${label}: preview card escapes viewport: ${JSON.stringify(box)}`);
  }
  return { ...metrics, card: box };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const audit = {};
try {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await wire(mobile);
  mode = "idle";
  await mobile.goto("http://127.0.0.1:4173/draft-generating/render-audit-owner", { waitUntil: "networkidle" });
  await mobile.getByTestId("input-spark-email").fill("audit@posyplans.com");
  await mobile.getByTestId("button-unlock-spark").click();
  await mobile.getByTestId("prepayment-preview-progress-proof").waitFor();
  const progressText = await mobile.getByTestId("prepayment-preview-progress-proof").innerText();
  if (!progressText.includes("Blippi + Meekah") || !progressText.includes("Indoor soft play")) {
    throw new Error(`mobile progress proof lost event details: ${progressText}`);
  }
  const continueButton = mobile.getByTestId("button-unlock-spark");
  if (await continueButton.isDisabled()) throw new Error("checkout stayed disabled during background artwork work");
  if (!(await continueButton.innerText()).includes("Continue to checkout")) throw new Error("background CTA does not offer checkout continuation");
  audit.mobileGenerating = await assertViewport(mobile, "mobile-generating");
  await mobile.screenshot({ path: `${outputDir}/mobile-generating.png`, fullPage: true });

  mode = "fallback";
  await mobile.waitForTimeout(350);
  const fallbackImage = mobile.getByTestId("img-prepayment-preview");
  await fallbackImage.waitFor();
  await fallbackImage.evaluate((image) => image.complete || new Promise((resolve) => image.addEventListener("load", resolve, { once: true })));
  const fallbackDimensions = await fallbackImage.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    clientWidth: image.clientWidth,
    clientHeight: image.clientHeight,
  }));
  if (fallbackDimensions.naturalWidth !== fallbackDimensions.naturalHeight) throw new Error(`fallback asset lost square source ratio: ${JSON.stringify(fallbackDimensions)}`);
  if (Math.abs(fallbackDimensions.clientWidth - fallbackDimensions.clientHeight) > 2) throw new Error(`fallback asset was cropped or stretched: ${JSON.stringify(fallbackDimensions)}`);
  audit.mobileFallback = { ...(await assertViewport(mobile, "mobile-fallback")), fallbackDimensions };
  await mobile.screenshot({ path: `${outputDir}/mobile-fallback.png`, fullPage: true });
  await mobile.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await wire(desktop);
  mode = "approved";
  await desktop.goto("http://127.0.0.1:4173/draft-generating/render-audit-owner", { waitUntil: "networkidle" });
  const approvedImage = desktop.getByTestId("img-prepayment-preview");
  await approvedImage.waitFor();
  await approvedImage.evaluate((image) => image.complete || new Promise((resolve) => image.addEventListener("load", resolve, { once: true })));
  const approvedDimensions = await approvedImage.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    clientWidth: image.clientWidth,
    clientHeight: image.clientHeight,
  }));
  const naturalRatio = approvedDimensions.naturalWidth / approvedDimensions.naturalHeight;
  const renderedRatio = approvedDimensions.clientWidth / approvedDimensions.clientHeight;
  if (Math.abs(naturalRatio - renderedRatio) > 0.01) throw new Error(`approved image ratio changed in browser: ${JSON.stringify(approvedDimensions)}`);
  const bodyText = await desktop.locator("body").innerText();
  if (bodyText.includes("A first look, made from your details") || bodyText.includes("Unlock your complete plan and full invitation designs")) {
    throw new Error("browser sales copy still overlays or follows reviewed artwork in the ready branch");
  }
  audit.desktopApproved = { ...(await assertViewport(desktop, "desktop-approved")), approvedDimensions };
  await desktop.screenshot({ path: `${outputDir}/desktop-approved.png`, fullPage: true });
  await desktop.close();

  fs.writeFileSync(`${outputDir}/audit.json`, JSON.stringify({ passed: true, checkoutCalls, ...audit }, null, 2));
} catch (error) {
  fs.writeFileSync(`${outputDir}/audit.json`, JSON.stringify({ passed: false, error: error instanceof Error ? error.stack : String(error), checkoutCalls, ...audit }, null, 2));
  throw error;
} finally {
  await browser.close();
}
