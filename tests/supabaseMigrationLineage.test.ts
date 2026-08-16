import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");

const reconstructedLineage = [
  "20260719000000_production_baseline.sql",
  "20260720031633_enable_rls_all_public_tables.sql",
  "20260720043318_add_sms_opt_in_columns_to_guests.sql",
  "20260722182301_add_spark_unlock_columns.sql",
  "20260730012307_add_liner_color_stamp_color.sql",
  "20260730015113_add_invite_status_rsvp_phone.sql",
  "20260801180749_ai_first_foundation.sql",
  "20260803155442_ai_first_reliability_repair.sql",
  "20260804032135_ai_first_attempt_provenance.sql",
  "20260812142723_ai_first_image_2_default.sql",
  "20260813153756_secure_public_tables.sql",
  "20260813153856_explicit_data_api_deny_policies.sql",
] as const;

async function migration(name: (typeof reconstructedLineage)[number]) {
  return readFile(resolve(migrationDirectory, name), "utf8");
}

describe("Supabase migration lineage", () => {
  it("keeps the reconstructed history as the ordered prefix", async () => {
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(files.slice(0, reconstructedLineage.length)).toEqual(reconstructedLineage);
    expect(files.every((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))).toBe(true);
  });

  it("creates the AI foundation before the reliability repair depends on it", async () => {
    const foundation = await migration("20260801180749_ai_first_foundation.sql");
    const reliability = await migration("20260803155442_ai_first_reliability_repair.sql");

    expect(foundation).toContain('CREATE TABLE "ai_first_previews"');
    expect(foundation).toContain('CREATE TABLE "ai_first_image_ledger"');
    expect(reliability).toContain('ON "ai_first_image_ledger"');
    expect(reliability).toContain('CREATE TABLE "ai_first_generation_runs"');
    expect(reliability).toContain('CREATE TABLE "ai_first_artwork_attempts"');
  });

  it("leaves recorded post-baseline columns to their original migrations", async () => {
    const baseline = await migration("20260719000000_production_baseline.sql");
    const sms = await migration("20260720043318_add_sms_opt_in_columns_to_guests.sql");
    const spark = await migration("20260722182301_add_spark_unlock_columns.sql");

    expect(baseline).not.toContain('"sms_opt_in"');
    expect(baseline).not.toContain('"spark_unlocked_at"');
    expect(sms).toContain("ADD COLUMN sms_opt_in");
    expect(spark).toContain("spark_unlocked_at");
  });

  it("routes hosted database deployment through Supabase migrations", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.scripts["db:push"]).toContain("supabase@2.114.0 db push");
    expect(packageJson.scripts["db:push"]).not.toContain("drizzle-kit push");
  });
});
