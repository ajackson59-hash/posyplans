import type { PreviewQualityDependencies } from "./prePaymentPreviewQuality";

/** One customer policy for named and original artwork. This is a bounded
 * candidate for validation, not evidence of visual quality or 90s delivery. */
export const CUSTOMER_PREVIEW_POLICY = Object.freeze({
  quality: "medium",
  maxCandidates: 1,
  parallelCandidates: false,
  allowTargetedCorrection: false,
  maxFormatRepairs: 0,
} as const satisfies Partial<PreviewQualityDependencies>);
