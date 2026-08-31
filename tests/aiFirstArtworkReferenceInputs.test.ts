import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateArtwork } from "../server/aiFirst/artwork";

const GENERATED_BYTES = Buffer.from("generated-image-bytes");
const GENERATED_B64 = GENERATED_BYTES.toString("base64");
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    data: [{ b64_json: GENERATED_B64 }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AI-first artwork reference inputs", () => {
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
});
