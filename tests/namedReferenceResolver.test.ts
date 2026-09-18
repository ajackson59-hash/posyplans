import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import type { NamedCreativeReference } from "../server/prePaymentPreviewQuality";
import {
  clearNamedReferenceResolverCache,
  namedReferenceAutoResolutionEnabled,
  resolveNamedCreativeReference,
} from "../server/namedReferenceResolver";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const event = {
  id: 10,
  eventName: "Brian and Blippi's Extravaganza",
  eventType: "Birthday Party",
  vibeDescription: "Blippi and Meekah at indoor soft play with bubbles and ice cream",
} as unknown as Event;

const blippi: NamedCreativeReference = {
  id: "blippi-meekah",
  label: "Blippi + Meekah",
  trigger: /blippi/i,
  cues: ["Blippi + Meekah", "Indoor soft play"],
  palette: ["#17315C", "#FF7A00", "#F8F3E8", "#B79DE2"],
  requirements: ["Both recognizable hosts are visibly present"],
};

const unknown: NamedCreativeReference = {
  id: "unregistered-media-reference",
  label: "Example Official Character World",
  trigger: /example/i,
  cues: ["Recognizable characters", "Event-specific setting"],
  palette: ["#445248", "#C9866B", "#F4EEE6", "#879887"],
  requirements: ["The named identity is recognizable at a glance"],
};

function imageResponse(): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(PNG_BYTES.length),
    },
  });
}

beforeEach(() => {
  clearNamedReferenceResolverCache();
});

describe("automatic named-reference resolver", () => {
  it("retrieves curated official character pixels without asking the host", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://static.wixstatic.com/media/")) return imageResponse();
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await resolveNamedCreativeReference(event, blippi, {
      fetchImpl,
      now: () => 1000,
      apiKey: "unused",
    });

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("curated");
    expect(result?.images).toHaveLength(2);
    expect(result?.images[0].mimeType).toBe("image/png");
    expect(result?.notes).toContain("Blippi");
    expect(result?.notes).toContain("Meekah");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a successful resolution so one event flow does not refetch official assets", async () => {
    const fetchImpl = vi.fn(async () => imageResponse()) as unknown as typeof fetch;

    const first = await resolveNamedCreativeReference(event, blippi, {
      fetchImpl,
      now: () => 2000,
    });
    const second = await resolveNamedCreativeReference(event, blippi, {
      fetchImpl,
      now: () => 3000,
    });

    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses OpenAI web search only as a fallback and extracts an official page image", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/responses") {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("web_search");
        return new Response(JSON.stringify({
          output: [{
            content: [{
              text: "https://official.example.com/characters",
              annotations: [{ url: "https://official.example.com/characters" }],
            }],
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://official.example.com/characters") {
        return new Response(
          '<html><img alt="Official Example Character World hero cast" src="https://cdn.official.example.com/character-team.png"></html>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      if (url === "https://cdn.official.example.com/character-team.png") return imageResponse();
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await resolveNamedCreativeReference(event, unknown, {
      fetchImpl,
      now: () => 4000,
      apiKey: "test-key",
      searchModel: "gpt-5-mini",
    });

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("web-search");
    expect(result?.images).toHaveLength(1);
    expect(result?.sourcePages).toContain("https://official.example.com/characters");
  });

  it("rejects private or IP-literal URLs returned by search", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.openai.com/v1/responses") {
        return new Response(JSON.stringify({
          output_text: "https://127.0.0.1/private-character-image.png",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unsafe URL should not be fetched: ${url}`);
    }) as unknown as typeof fetch;

    const result = await resolveNamedCreativeReference(event, unknown, {
      fetchImpl,
      now: () => 5000,
      apiKey: "test-key",
    });

    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enables automatic resolution by default only on the launch-QA Preview branch", () => {
    expect(namedReferenceAutoResolutionEnabled({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "fix/launch-qa-find-my-event-label",
    })).toBe(true);
    expect(namedReferenceAutoResolutionEnabled({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "codex/launch-blockers",
    })).toBe(true);
    expect(namedReferenceAutoResolutionEnabled({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    })).toBe(false);
    expect(namedReferenceAutoResolutionEnabled({
      VERCEL_ENV: "production",
      POSY_NAMED_PREVIEW_AUTO_RESOLVE: "true",
    })).toBe(true);
  });
});
