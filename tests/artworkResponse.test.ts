// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { streamArtwork } from "../server/artworkResponse";

class Sink extends Writable {
  req = { method: "GET" };
  headers = new Map<string, unknown>();
  headersFlushed = false;
  writes = 0;
  received = 0;
  largestChunk = 0;
  digest = createHash("sha256");
  constructor(readonly mode: "slow" | "disconnect" | "error" = "slow") { super({ highWaterMark: 1024 }); }
  setHeader(name: string, value: unknown) { this.headers.set(name, value); }
  removeHeader(name: string) { this.headers.delete(name); }
  flushHeaders() { this.headersFlushed = true; }
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.writes++; this.received += chunk.length;
    this.largestChunk = Math.max(this.largestChunk, chunk.length);
    this.digest.update(chunk);
    if (this.mode === "disconnect") { this.destroy(); return; }
    if (this.mode === "error") { done(new Error("synthetic write failure")); return; }
    setImmediate(done);
  }
}
const response = (sink: Sink) => sink as unknown as Response;

describe("exact-byte artwork streaming", () => {
  it("chunks a large response through a slow reader without changing bytes or buffering the entire write", async () => {
    const source = Buffer.alloc(6_000_013, 181), sink = new Sink();
    sink.setHeader("Content-Length", source.length); sink.setHeader("ETag", "stale");
    await streamArtwork(response(sink), source);
    expect(sink.headersFlushed).toBe(true);
    expect(sink.received).toBe(source.length);
    expect(sink.writes).toBeGreaterThan(90);
    expect(sink.largestChunk).toBeLessThanOrEqual(65536);
    expect(sink.digest.digest("hex")).toBe(createHash("sha256").update(source).digest("hex"));
    expect(sink.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sink.headers.has("Content-Length")).toBe(false);
    expect(sink.headers.has("ETag")).toBe(false);
    expect(sink.writableFinished).toBe(true);
  });
  it("stops reading when the client disconnects and does not try to send an error body", async () => {
    const sink = new Sink("disconnect");
    await expect(streamArtwork(response(sink), Buffer.alloc(6_000_000))).resolves.toBeUndefined();
    expect(sink.destroyed).toBe(true); expect(sink.writes).toBe(1);
  });
  it("propagates unexpected write errors to the route's headers-sent handler", async () => {
    await expect(streamArtwork(response(new Sink("error")), Buffer.alloc(100))).rejects.toThrow("synthetic write failure");
  });
  it("answers HEAD without creating a body stream", async () => {
    const sink = new Sink(); sink.req.method = "HEAD";
    await streamArtwork(response(sink), Buffer.alloc(6_000_000), "image/webp");
    expect(sink.writes).toBe(0); expect(sink.writableEnded).toBe(true);
    expect(sink.headers.get("Content-Type")).toBe("image/webp");
  });
});
