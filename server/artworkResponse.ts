import type { Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const CHUNK_BYTES = 64 * 1024;
type ArtworkMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Call only after the route's owner/publication/approval/version checks.
 * Stream the exact saved bytes: Vercel's buffered response limit must not
 * force us to resize a kept image or hand out an independently accessible URL.
 * This changes delivery, not the stored image or the upload request limit. */
export async function streamArtwork(res: Response, bytes: Buffer, mime: ArtworkMime = "image/png"): Promise<void> {
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Do not use Express.send(), which buffers the response and adds a length/ETag.
  res.removeHeader("Content-Length");
  res.removeHeader("ETag");
  if (res.req.method === "HEAD") { res.end(); return; }
  res.flushHeaders();
  function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      yield bytes.subarray(offset, offset + CHUNK_BYTES);
    }
  }
  try {
    // pipeline respects backpressure and destroys the source on disconnect.
    await pipeline(Readable.from(chunks(), { objectMode: false }), res);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (res.destroyed && (code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET")) return;
    throw error;
  }
}
