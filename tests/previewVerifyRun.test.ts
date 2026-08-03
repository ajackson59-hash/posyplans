// Tests for tools/preview-verify/run.ts orchestration: the preview-only
// hard stop, and the PASS/FAIL + redacted-metadata report assembly. The
// `postgres` driver is mocked so these tests never open a real network
// connection or need real credentials — only synthetic fixture values.

import { describe, expect, it, vi } from "vitest";
import { PREVIEW_PROJECT_REF, EXPECTED_POOLER_PORT } from "../tools/preview-verify/parse";

const FAKE_PASSWORD = "not-a-real-password-fixture";
// Supabase's pooled Supavisor format carries the project ref in the
// *username* (postgres.<ref>), with a generic aws-0-<region>.pooler.
// supabase.com hostname shared by every project on that pooler. This
// fixture matches that real shape, so hostnameHasPreviewRef is expected to
// be true (see parse.ts, which checks username+hostname together).
const PREVIEW_URL = `postgresql://postgres.${PREVIEW_PROJECT_REF}:${FAKE_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:${EXPECTED_POOLER_PORT}/postgres`;

function makeMockSql(selectOneSucceeds: boolean) {
  const sqlFn = vi.fn(async () => {
    if (!selectOneSucceeds) throw new Error("simulated query failure");
    return [{ one: 1 }];
  });
  const mockSql = Object.assign(sqlFn, {
    begin: vi.fn(async (_mode: string, cb: (tx: typeof sqlFn) => Promise<unknown>) => {
      if (!selectOneSucceeds) throw new Error("simulated transaction failure");
      return cb(sqlFn);
    }),
    end: vi.fn(async () => undefined),
  });
  return mockSql;
}

describe("runVerifier", () => {
  it("throws PreviewGuardError outside of preview and never touches the DB", async () => {
    vi.resetModules();
    const postgresFactory = vi.fn();
    vi.doMock("postgres", () => ({ default: postgresFactory }));
    const { runVerifier } = await import("../tools/preview-verify/run");
    const { PreviewGuardError: FreshPreviewGuardError } = await import("../tools/preview-verify/guard");

    await expect(
      runVerifier({ VERCEL_ENV: "production", DATABASE_URL: PREVIEW_URL }),
    ).rejects.toBeInstanceOf(FreshPreviewGuardError);
    expect(postgresFactory).not.toHaveBeenCalled();
  });

  it("reports PASS with all facts true when everything lines up and SELECT 1 succeeds", async () => {
    vi.resetModules();
    const mockSql = makeMockSql(true);
    vi.doMock("postgres", () => ({ default: vi.fn(() => mockSql) }));
    const { runVerifier } = await import("../tools/preview-verify/run");

    const report = await runVerifier({
      VERCEL_ENV: "preview",
      DATABASE_URL: PREVIEW_URL,
      OPENAI_API_KEY: "fixture-openai-key",
      ANTHROPIC_API_KEY: "fixture-anthropic-key",
    });

    expect(report.status).toBe("PASS");
    expect(report.hostnameHasPreviewRef).toBe(true);
    expect(report.hostnameHasProductionRef).toBe(false);
    expect(report.isSupabasePooledHost).toBe(true);
    expect(report.port).toBe(EXPECTED_POOLER_PORT);
    expect(report.isExpectedPoolerPort).toBe(true);
    expect(report.selectOneOk).toBe(true);
    expect(report.openAiKeyPresent).toBe(true);
    expect(report.anthropicKeyPresent).toBe(true);
    expect(report.failureReasons).toEqual([]);
  });

  it("reports FAIL and lists reasons when provider keys are missing and SELECT 1 fails", async () => {
    vi.resetModules();
    const mockSql = makeMockSql(false);
    vi.doMock("postgres", () => ({ default: vi.fn(() => mockSql) }));
    const { runVerifier } = await import("../tools/preview-verify/run");

    const report = await runVerifier({
      VERCEL_ENV: "preview",
      DATABASE_URL: PREVIEW_URL,
    });

    expect(report.status).toBe("FAIL");
    expect(report.selectOneOk).toBe(false);
    expect(report.openAiKeyPresent).toBe(false);
    expect(report.anthropicKeyPresent).toBe(false);
    expect(report.failureReasons.length).toBeGreaterThan(0);
  });

  it("reports FAIL when DATABASE_URL is missing, without throwing", async () => {
    vi.resetModules();
    const postgresFactory = vi.fn();
    vi.doMock("postgres", () => ({ default: postgresFactory }));
    const { runVerifier } = await import("../tools/preview-verify/run");

    const report = await runVerifier({ VERCEL_ENV: "preview" });

    expect(report.status).toBe("FAIL");
    expect(report.selectOneOk).toBe(false);
    expect(postgresFactory).not.toHaveBeenCalled();
  });

  it("never includes the DATABASE_URL, password, or provider keys in the serialized report", async () => {
    vi.resetModules();
    const mockSql = makeMockSql(true);
    vi.doMock("postgres", () => ({ default: vi.fn(() => mockSql) }));
    const { runVerifier } = await import("../tools/preview-verify/run");

    const report = await runVerifier({
      VERCEL_ENV: "preview",
      DATABASE_URL: PREVIEW_URL,
      OPENAI_API_KEY: "fixture-openai-key",
      ANTHROPIC_API_KEY: "fixture-anthropic-key",
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(FAKE_PASSWORD);
    expect(serialized).not.toContain(PREVIEW_URL);
    expect(serialized).not.toContain("fixture-openai-key");
    expect(serialized).not.toContain("fixture-anthropic-key");
  });
});
