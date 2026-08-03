// FIXTURE / NON-PROVIDER QA HARNESS — reliability repair.
//
// This is not a live-traffic test and never calls a model, an image
// provider, or a network endpoint of any kind: `fetch` is stubbed with
// scripted SSE bodies built from the same fixtures the unit tests use. It
// exists to demonstrate, with the REAL production component and the REAL
// production session hook (client/src/components/AiFirstInvitations.tsx,
// client/src/lib/aiFirstSession.ts), what a host actually sees at desktop
// and at 390px mobile width for four scenarios:
//
//   1. progress          — a run in flight, with the completed/fallback counts visible
//   2. failure           — an unexpected stream termination, reported clearly
//   3. recovery          — a fresh, successful run after the failure
//   4. duplicate-click    — the Generate button stays locked while the server
//                          durably reports an active generation, surviving
//                          past this component's own local `running` state
//
// Output: one HTML snapshot per (scenario x width) under tools/qa/evidence/,
// plus a labeled schematic PNG per scenario assembled from the real captured
// text content (drawn with PIL because this sandbox has no browser engine
// available for a literal pixel screenshot — see tools/qa/README.md for why).
// The PNGs are explicitly schematics of real DOM output, not screenshots.

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { EventRecord } from "@/lib/types";
import { useAiFirstSession } from "@/lib/aiFirstSession";
import { concept } from "./aiFirstFixtures";

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "tools", "qa", "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const AiFirstInvitations = (await import("@/components/AiFirstInvitations")).default;

const event = (): EventRecord =>
  ({
    id: 1,
    shareSlug: "qa-fixture",
    eventName: "Ada's 4th Birthday",
    eventType: "birthday",
    eventDate: "12 September 2026",
    location: "our back garden",
  }) as unknown as EventRecord;

const STATUS_OK = {
  plan: "Plus",
  ceilings: { eventSoft: 24, eventHard: 40, monthlySoft: 48, monthlyHard: 80 },
  usage: { eventBilled: 2, monthlyBilled: 2, activeGenerations: 0 },
  killSwitch: false,
  briefQuestion: null,
  askPosyActions: [],
};

const STATUS_ACTIVE_ELSEWHERE = { ...STATUS_OK, usage: { ...STATUS_OK.usage, activeGenerations: 1 } };

function sseFrame(evt: unknown): string {
  return `data: ${JSON.stringify(evt)}\n\n`;
}

/** A body that yields one chunk then hangs open — "still in flight". */
function heldOpenFetch(firstChunk: string, holdUntil: Promise<void>) {
  return (async () => ({
    ok: true,
    body: {
      getReader: () => {
        let step = 0;
        return {
          read: async () => {
            if (step === 0) {
              step += 1;
              return { done: false, value: new TextEncoder().encode(firstChunk) };
            }
            await holdUntil;
            return { done: true, value: undefined };
          },
        };
      },
    },
  })) as unknown as typeof fetch;
}

function stubbedFetchReturning(body: string) {
  return (async () => ({
    ok: true,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () =>
            sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
        };
      },
    },
  })) as unknown as typeof fetch;
}

/**
 * A test-only harness component that owns the real session hook in the same
 * tree as the real experience component \u2014 exactly how DraftOverview.tsx
 * wires them in production \u2014 and exposes a button to trigger `run()` so the
 * test can drive it with fireEvent instead of a detached renderHook (which
 * this sandbox's React test environment does not reliably keep mounted
 * across the async gaps a scripted SSE stream needs).
 */
function Harness({ onSession }: { onSession?: (s: ReturnType<typeof useAiFirstSession>) => void }) {
  const session = useAiFirstSession("qa-fixture-token");
  onSession?.(session);
  return createElement(AiFirstInvitations, {
    ownerToken: "qa-fixture-token",
    event: event(),
    session,
    onBrowseCollection: () => {},
  });
}

function renderHarnessAtWidth(widthPx: number, statusBody: unknown, onSession?: (s: ReturnType<typeof useAiFirstSession>) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => statusBody } } });
  const wrapper = document.createElement("div");
  wrapper.style.width = `${widthPx}px`;
  document.body.appendChild(wrapper);

  const view = render(createElement(QueryClientProvider, { client }, createElement(Harness, { onSession })), {
    container: wrapper,
  });
  return { view, wrapper };
}

function writeSnapshot(name: string, widthPx: number, wrapper: HTMLElement) {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>FIXTURE — ${name} @ ${widthPx}px (non-provider QA harness)</title>
<style>body{margin:24px;font-family:system-ui,sans-serif;background:#fafaf9}
.frame{width:${widthPx}px;border:1px solid #ddd;padding:16px;background:#fff}
.banner{font-size:12px;color:#a33;margin-bottom:12px}</style>
</head>
<body>
<div class="banner">FIXTURE / NON-PROVIDER QA SNAPSHOT \u2014 scenario "${name}" at ${widthPx}px. No model or image provider was called to produce this DOM.</div>
<div class="frame">${wrapper.innerHTML}</div>
</body>
</html>`;
  const filePath = path.join(EVIDENCE_DIR, `${name}-${widthPx}.html`);
  writeFileSync(filePath, html, "utf8");
  return filePath;
}

const WIDTHS = { desktop: 1024, mobile: 390 } as const;
const capturedText: Record<string, { desktop: string; mobile: string }> = {};
const savedPaths: string[] = [];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("FIXTURE / NON-PROVIDER QA harness — desktop and 390px mobile", () => {
  it("scenario 1: progress — completed/fallback counts visible while a run is in flight", async () => {
    for (const [label, width] of Object.entries(WIDTHS) as ["desktop" | "mobile", number][]) {
      let resolveHold: () => void = () => {};
      const held = new Promise<void>((r) => (resolveHold = r));
      const firstChunk =
        sseFrame({ type: "progress", message: "Building another interpretation…", at: Date.now() }) +
        sseFrame({
          type: "direction",
          at: Date.now(),
          direction: {
            index: 0,
            concept: concept({ conceptName: "Lariat & Starlight", baseThemeId: "celestial-heirloom" }),
            source: "ai-generated",
            previewId: "p0",
            assetHash: "h0",
            illustrationUrl: "/api/events/owner/qa-fixture-token/ai-first/preview/p0/asset",
            overlay: "veil",
            attempts: [],
          },
        }) +
        sseFrame({
          type: "direction",
          at: Date.now(),
          direction: {
            index: 1,
            concept: concept({ conceptName: "Dust & Chrome", baseThemeId: "deco-midnight" }),
            source: "adapted-studio-direction",
            previewId: "p1",
            assetHash: "h1",
            illustrationUrl: "/api/events/owner/qa-fixture-token/ai-first/preview/p1/asset",
            overlay: "veil",
            attempts: [],
          },
        });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = heldOpenFetch(firstChunk, held);

      let latestSession: ReturnType<typeof useAiFirstSession> | undefined;
      const { wrapper } = renderHarnessAtWidth(width, STATUS_OK, (s) => (latestSession = s));

      await act(async () => {
        void latestSession!.run();
      });
      await waitFor(() => expect(wrapper.textContent).toContain("2 of 4 directions ready"));

      const p = writeSnapshot("1-progress", width, wrapper);
      savedPaths.push(p);
      capturedText["1-progress"] = capturedText["1-progress"] ?? { desktop: "", mobile: "" };
      capturedText["1-progress"][label] = wrapper.textContent ?? "";

      expect(wrapper.textContent).toContain("2 of 4 directions ready");
      expect(wrapper.textContent).toContain("1 from the Posy collection");

      resolveHold();
      await act(async () => {
        await Promise.resolve();
      });
      globalThis.fetch = originalFetch;
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("scenario 2: failure — unexpected stream termination is reported clearly", async () => {
    for (const [label, width] of Object.entries(WIDTHS) as ["desktop" | "mobile", number][]) {
      const originalFetch = globalThis.fetch;
      // One progress line, then the body just ends. No done, no error.
      globalThis.fetch = stubbedFetchReturning(
        sseFrame({ type: "progress", message: "Understanding the event's visual direction…", at: Date.now() }),
      );

      let latestSession: ReturnType<typeof useAiFirstSession> | undefined;
      const { wrapper } = renderHarnessAtWidth(width, STATUS_OK, (s) => (latestSession = s));

      await act(async () => {
        await latestSession!.run();
      });
      await waitFor(() => expect(wrapper.textContent).toContain("Posy lost the connection"));

      const p = writeSnapshot("2-failure", width, wrapper);
      savedPaths.push(p);
      capturedText["2-failure"] = capturedText["2-failure"] ?? { desktop: "", mobile: "" };
      capturedText["2-failure"][label] = wrapper.textContent ?? "";

      globalThis.fetch = originalFetch;
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("scenario 3: recovery — a fresh run after the failure succeeds normally", async () => {
    for (const [label, width] of Object.entries(WIDTHS) as ["desktop" | "mobile", number][]) {
      const originalFetch = globalThis.fetch;

      let latestSession: ReturnType<typeof useAiFirstSession> | undefined;
      const { wrapper } = renderHarnessAtWidth(width, STATUS_OK, (s) => (latestSession = s));

      // First: the same dropped-connection failure as scenario 2.
      globalThis.fetch = stubbedFetchReturning(
        sseFrame({ type: "progress", message: "Understanding the event's visual direction…", at: Date.now() }),
      );
      await act(async () => {
        await latestSession!.run();
      });
      await waitFor(() => expect(wrapper.textContent).toContain("Posy lost the connection"));

      // Then: the host presses Generate again, and this time it completes.
      const summary = {
        directions: 4,
        adaptedDirections: 0,
        billedImages: 4,
        reusedImages: 0,
        retries: 0,
        costUsd: 0.16,
        msToFirstConcept: 400,
        msToFirstDirection: 900,
        msToAllDirections: 3000,
        conceptRejections: 0,
        degraded: [],
      };
      const THEMES = ["celestial-heirloom", "deco-midnight", "meadow-storybook", "neon-arena"];
      const directions = [0, 1, 2, 3].map((index) => ({
        index,
        concept: concept({ conceptName: `Direction ${index}`, baseThemeId: THEMES[index] }),
        source: "ai-generated" as const,
        previewId: `p${index}`,
        assetHash: `h${index}`,
        illustrationUrl: `/api/events/owner/qa-fixture-token/ai-first/preview/p${index}/asset`,
        overlay: "veil" as const,
        attempts: [],
      }));
      globalThis.fetch = stubbedFetchReturning(
        directions.map((d) => sseFrame({ type: "direction", at: Date.now(), direction: d })).join("") +
          sseFrame({ type: "done", summary, at: Date.now() }),
      );
      await act(async () => {
        await latestSession!.run();
      });
      await waitFor(() => expect(wrapper.textContent).toContain("I created four invitation directions"));

      const p = writeSnapshot("3-recovery", width, wrapper);
      savedPaths.push(p);
      capturedText["3-recovery"] = capturedText["3-recovery"] ?? { desktop: "", mobile: "" };
      capturedText["3-recovery"][label] = wrapper.textContent ?? "";

      globalThis.fetch = originalFetch;
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("scenario 4: duplicate-click prevention — Generate stays locked while the server says active", async () => {
    for (const [label, width] of Object.entries(WIDTHS) as ["desktop" | "mobile", number][]) {
      // The server's durable status says a generation is already active for
      // this event (e.g. from another tab, or surviving a reload) even
      // though THIS component's local `running` is false. The button must
      // still be locked, because the lock is server-authoritative.
      const { view, wrapper } = renderHarnessAtWidth(width, STATUS_ACTIVE_ELSEWHERE);
      await waitFor(() => {
        const button = view.getByTestId("button-generate-directions") as HTMLButtonElement;
        expect(button.disabled).toBe(true);
      });

      const p = writeSnapshot("4-duplicate-click-locked", width, wrapper);
      savedPaths.push(p);
      capturedText["4-duplicate-click-locked"] = capturedText["4-duplicate-click-locked"] ?? { desktop: "", mobile: "" };
      capturedText["4-duplicate-click-locked"][label] = wrapper.textContent ?? "";

      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("writes the manifest and renders the labeled schematic PNGs", () => {
    const manifestPath = path.join(EVIDENCE_DIR, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          label: "FIXTURE / NON-PROVIDER QA HARNESS",
          note:
            "Every scenario drives the real production AiFirstInvitations component and useAiFirstSession hook. fetch() is stubbed with scripted SSE bodies; no model or image provider is called anywhere in this file.",
          widths: WIDTHS,
          scenarios: Object.keys(capturedText),
          htmlSnapshots: savedPaths.map((p) => path.basename(p)),
        },
        null,
        2,
      ),
      "utf8",
    );

    // A schematic PNG per scenario, for a quick visual scan without opening
    // each HTML file. Drawn from the real captured DOM text with Pillow,
    // because this sandbox has no browser engine to take a literal pixel
    // screenshot with (Playwright's bundled Chromium does not support this
    // sandbox's OS — see tools/qa/README.md). Clearly labeled as a schematic,
    // not a screenshot.
    const script = path.resolve(import.meta.dirname, "..", "tools", "qa", "renderFixtureSchematics.py");
    const dataPath = path.join(EVIDENCE_DIR, "captured-text.json");
    writeFileSync(dataPath, JSON.stringify(capturedText, null, 2), "utf8");
    execFileSync("python3", [script, dataPath, EVIDENCE_DIR], { stdio: "inherit" });

    expect(savedPaths.length).toBeGreaterThan(0);
    expect(Object.keys(capturedText).length).toBe(4);
  });
});
