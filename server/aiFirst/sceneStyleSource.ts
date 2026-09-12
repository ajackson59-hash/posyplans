/** Private source preparation, not a scene certificate or customer renderer. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { customerVisiblePreviewBytes } from "../prePaymentPreviewQuality";
import { readPngSize } from "./png";

const manifestSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  sourceFile: z.literal("source.png"),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(),
  origin: z.literal("built-in-image-generation"),
  approval: z.object({
    scope: z.literal("art-direction-only"), approvedBy: z.literal("project-owner"),
    evidence: z.string().trim().min(1),
  }).strict(),
  subjectScope: z.literal("original-children-construction"), namedThemeId: z.null(),
  qualityReview: z.literal("pending"), requirementCertification: z.literal("pending"),
  commercialReview: z.literal("pending"), customerActivation: z.literal("disabled"),
}).strict();

/**
 * Input must come from the server-owned source pack, never request metadata.
 * Copies preserve the approved original even if a caller mutates returned data.
 * No I/O, certificate creation, model calls, matching, or quality marker.
 */
export function prepareSceneStyleSource(source: Buffer, metadata: unknown) {
  const manifest = manifestSchema.parse(metadata);
  if (source.length > 16_000_000 || manifest.width * manifest.height > 4_000_000) {
    throw new Error("Style source exceeds preparation limits");
  }
  const original = Buffer.from(source);
  if (createHash("sha256").update(original).digest("hex") !== manifest.sourceSha256) {
    throw new Error("Style-approved source bytes changed");
  }
  const size = readPngSize(original);
  if (!size || size.width !== manifest.width || size.height !== manifest.height ||
      original[24] !== 8 || original[25] !== 2) {
    throw new Error("Style source must be the declared native RGB PNG");
  }
  const teaser = customerVisiblePreviewBytes(original);
  return {
    kind: "style-approved-source" as const,
    manifest,
    original,
    teaser,
    teaserSha256: createHash("sha256").update(teaser).digest("hex"),
    customerActivation: "disabled" as const,
  };
}
