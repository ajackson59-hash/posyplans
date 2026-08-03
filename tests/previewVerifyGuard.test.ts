// Tests for tools/preview-verify/guard.ts — the hard stop that must refuse
// to run anywhere except a Vercel Preview build. No real secrets used.

import { describe, expect, it } from "vitest";
import { assertPreviewEnv, PreviewGuardError } from "../tools/preview-verify/guard";

describe("assertPreviewEnv", () => {
  it("throws PreviewGuardError when VERCEL_ENV is undefined", () => {
    expect(() => assertPreviewEnv({})).toThrow(PreviewGuardError);
  });

  it("throws PreviewGuardError when VERCEL_ENV is 'production'", () => {
    expect(() => assertPreviewEnv({ VERCEL_ENV: "production" })).toThrow(PreviewGuardError);
  });

  it("throws PreviewGuardError when VERCEL_ENV is 'development'", () => {
    expect(() => assertPreviewEnv({ VERCEL_ENV: "development" })).toThrow(PreviewGuardError);
  });

  it("throws when VERCEL_ENV is an unexpected arbitrary value", () => {
    expect(() => assertPreviewEnv({ VERCEL_ENV: "Preview" })).toThrow(PreviewGuardError);
  });

  it("does not throw when VERCEL_ENV is exactly 'preview'", () => {
    expect(() => assertPreviewEnv({ VERCEL_ENV: "preview" })).not.toThrow();
  });
});
