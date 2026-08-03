// Tests for tools/preview-verify/parse.ts. No real secrets: every
// connection string below is a synthetic fixture using the documented
// project refs and Supabase pooler hostname shape.

import { describe, expect, it } from "vitest";
import {
  parseRedactedDbFacts,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  EXPECTED_POOLER_PORT,
} from "../tools/preview-verify/parse";

const FAKE_PASSWORD = "not-a-real-password-fixture";

function fakeUrl(ref: string, port = 6543, host = "aws-0-us-east-1.pooler.supabase.com") {
  return `postgresql://postgres.${ref}:${FAKE_PASSWORD}@${host}:${port}/postgres`;
}

describe("parseRedactedDbFacts", () => {
  it("returns all-false facts for undefined input", () => {
    const facts = parseRedactedDbFacts(undefined);
    expect(facts.parsed).toBe(false);
    expect(facts.hostnameHasPreviewRef).toBe(false);
    expect(facts.hostnameHasProductionRef).toBe(false);
    expect(facts.isSupabasePooledHost).toBe(false);
    expect(facts.port).toBeNull();
  });

  it("returns all-false facts for an unparseable string", () => {
    const facts = parseRedactedDbFacts("not a url at all");
    expect(facts.parsed).toBe(false);
  });

  it("detects the Preview project ref in a direct hostname (db.<ref>.supabase.co)", () => {
    const url = `postgresql://postgres:${FAKE_PASSWORD}@db.${PREVIEW_PROJECT_REF}.supabase.co:5432/postgres`;
    const facts = parseRedactedDbFacts(url);
    expect(facts.parsed).toBe(true);
    expect(facts.hostnameHasPreviewRef).toBe(true);
    expect(facts.hostnameHasProductionRef).toBe(false);
  });

  it("flags Production ref presence when found in a direct hostname", () => {
    const url = `postgresql://postgres:${FAKE_PASSWORD}@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
    const facts = parseRedactedDbFacts(url);
    expect(facts.hostnameHasProductionRef).toBe(true);
    expect(facts.hostnameHasPreviewRef).toBe(false);
  });

  it("detects the Preview project ref in the pooled username (postgres.<ref>@pooler host)", () => {
    const url = fakeUrl(PREVIEW_PROJECT_REF);
    const facts = parseRedactedDbFacts(url);
    expect(facts.hostnameHasPreviewRef).toBe(true);
    expect(facts.hostnameHasProductionRef).toBe(false);
  });

  it("flags Production ref presence when found in the pooled username", () => {
    const url = fakeUrl(PRODUCTION_PROJECT_REF);
    const facts = parseRedactedDbFacts(url);
    expect(facts.hostnameHasProductionRef).toBe(true);
    expect(facts.hostnameHasPreviewRef).toBe(false);
  });

  it("recognizes a Supabase pooled (Supavisor) hostname on the expected port", () => {
    const url = fakeUrl(PREVIEW_PROJECT_REF, EXPECTED_POOLER_PORT);
    const facts = parseRedactedDbFacts(url);
    expect(facts.parsed).toBe(true);
    expect(facts.isSupabasePooledHost).toBe(true);
    expect(facts.port).toBe(EXPECTED_POOLER_PORT);
    expect(facts.isExpectedPoolerPort).toBe(true);
  });

  it("does not treat an arbitrary host as pooled", () => {
    const url = `postgresql://postgres:${FAKE_PASSWORD}@example.com:6543/postgres`;
    const facts = parseRedactedDbFacts(url);
    expect(facts.isSupabasePooledHost).toBe(false);
  });

  it("flags a non-6543 port as not the expected pooler port", () => {
    const url = fakeUrl(PREVIEW_PROJECT_REF, 5432);
    const facts = parseRedactedDbFacts(url);
    expect(facts.port).toBe(5432);
    expect(facts.isExpectedPoolerPort).toBe(false);
  });

  it("never includes the password or username in any returned field", () => {
    const url = fakeUrl(PREVIEW_PROJECT_REF);
    const facts = parseRedactedDbFacts(url);
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain(FAKE_PASSWORD);
    expect(serialized).not.toContain("postgres." + PREVIEW_PROJECT_REF);
  });
});
