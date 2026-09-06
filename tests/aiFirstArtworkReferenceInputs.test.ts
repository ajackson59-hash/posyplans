import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateArtwork } from "../server/aiFirst/artwork";

const GENERATED_BYTES = Buffer.from("generated-image-bytes");
const GENERATED_B64 = GENERATED_BYTES.toString("base64");
const fetchMock = vi.fn();

function successResponse(): Response {
  return new Response(JSON.stringify({
    data: [{ b64_json: GENERATED_B64 }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(successResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AI-first artwork reference inputs", () => {
  it.each([undefined, { input_tokens: 50, output_tokens: 100 }, {
    input_tokens: 50, output_tokens: 100, input_tokens_details: { text_tokens: 80, image_tokens: 0 },
  }])("keeps absent or inconsistent provider usage unknown", async (usage) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: GENERATED_B64 }], usage }), { status: 200 }));
    const result = await generateArtwork({ prompt: "Private art brief", aspectRatio: "9:16", maxTransientRetries: 0 });
    expect(result.telemetry?.responseUsage).toBeUndefined();
  });

  it("retains provider input and output usage without equating it with all-in invoice cost", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: GENERATED_B64 }], usage: {
      input_tokens: 50, output_tokens: 100, input_tokens_details: { text_tokens: 50, image_tokens: 0 },
      output_tokens_details: { text_tokens: 0, image_tokens: 100 },
    } }), { status: 200 }));
    const result = await generateArtwork({ prompt: "Private art brief", aspectRatio: "9:16", maxTransientRetries: 0 });
    expect(result.telemetry?.responseUsage).toEqual({ inputTokens: 50, outputTokens: 100,
      textInputTokens: 50, imageInputTokens: 0, textOutputTokens: 0, imageOutputTokens: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not spend an extra provider request when a preview forbids transient retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response("temporary upstream failure", { status: 503 }));
    await expect(generateArtwork({ prompt: "A premium illustrated scene", aspectRatio: "9:16",
      quality: "high", maxTransientRetries: 0 })).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the normal GPT Image 2 generations endpoint when no reference pixels exist", async () => {
    const result = await generateArtwork({
      prompt: "A refined rooftop dinner",
      aspectRatio: "9:16",
      model: "gpt-image-2",
      quality: "medium",
    });

    expect(result.bytes.equals(GENERATED_BYTES)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(init.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/json",
      Authorization: "Bearer test-openai-key",
    }));
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      size: "1024x1536",
      quality: "medium",
    }));
    expect(body).not.toHaveProperty("input_fidelity");
  });

  it("sends original pixels through GPT Image 1.5 edits with explicit high fidelity", async () => {
    const referenceBytes = Buffer.from("host-uploaded-reference-pixels");
    const result = await generateArtwork({
      prompt: "Create a new event-specific scene while preserving the referenced visual identity",
      aspectRatio: "9:16",
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
      referenceImages: [{
        bytes: referenceBytes,
        mimeType: "image/png",
        filename: "host-reference.png",
      }],
    });

    expect(result.bytes.equals(GENERATED_BYTES)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(init.headers).toEqual({ Authorization: "Bearer test-openai-key" });
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("size")).toBe("1024x1536");
    expect(form.get("quality")).toBe("high");
    expect(form.get("background")).toBe("opaque");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("input_fidelity")).toBe("high");
    const images = form.getAll("image[]");
    expect(images).toHaveLength(1);
    expect(images[0]).toBeInstanceOf(Blob);
    expect((images[0] as Blob).type).toBe("image/png");
    expect(Buffer.from(await (images[0] as Blob).arrayBuffer()).equals(referenceBytes)).toBe(true);
  });

  it("does not send an unsupported fidelity parameter unless the caller selects it", async () => {
    await generateArtwork({
      prompt: "Use the supplied image as loose inspiration",
      aspectRatio: "1:1",
      model: "gpt-image-2",
      quality: "medium",
      referenceImages: [{
        bytes: Buffer.from("reference"),
        mimeType: "image/jpeg",
      }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get("input_fidelity")).toBeNull();
  });

  it("honors Retry-After and retries one transient 429 without spending a second host action", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Rate limit reached. Please try again in 0s." },
      }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      }))
      .mockResolvedValueOnce(successResponse());

    const result = await generateArtwork({
      prompt: "A candlelit garden dinner",
      aspectRatio: "9:16",
      model: "gpt-image-2",
      quality: "medium",
    });

    expect(result.bytes.equals(GENERATED_BYTES)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/images/generations");
  });

  it("does not retry a non-transient provider rejection", async () => {
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "unsupported parameter" },
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(generateArtwork({
      prompt: "Invalid provider request",
      aspectRatio: "1:1",
      model: "gpt-image-2",
      quality: "medium",
    })).rejects.toThrow(/failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
