// ThemeSpec coverage spread.
// ─────────────────────────────────────────────────────────────────────────
// Validates 22 host requests spanning protected properties, original
// directions and deliberate long-tail oddities, plus 4 adversarial specs that
// must be caught. Prints a report table for founder review.
//
// Provenance: the specs in themeSpecSpread.json were authored by applying
// THEME_SPEC_RESOLVER_SYSTEM to each host prompt. This file proves the
// REPRESENTATION and the GATE hold across the range. It does not measure
// claude-haiku-4-5's own compliance, which needs a live key.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  artworkPromptForSpec,
  providerSafetyViolations,
  subjectPolicyIsConsistent,
  themeSpecSchema,
  type ThemeSpec,
} from "@shared/themeSpec";
import { contrastRatio } from "@shared/aiFirstPalette";
import { MIN_INK_CONTRAST, normalizeThemeSpec } from "../server/aiFirst/themeSpecResolver";

interface SpreadCase { hostText: string; spec: unknown }
interface AdversarialCase extends SpreadCase { label: string; expect: string }
interface Spread {
  provenance: string;
  cases: SpreadCase[];
  adversarialCases: AdversarialCase[];
}

const spread = JSON.parse(
  readFileSync(path.join(__dirname, "../tools/qa/themeSpecSpread.json"), "utf8"),
) as Spread;

function parsed(raw: unknown): ThemeSpec {
  const result = themeSpecSchema.safeParse(raw);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

describe("ThemeSpec spread — schema and gate", () => {
  it("covers a meaningful range", () => {
    expect(spread.cases.length).toBeGreaterThanOrEqual(20);
    const withProtected = spread.cases.filter((c) => (c.spec as ThemeSpec).protectedTerms.length > 0);
    const original = spread.cases.filter((c) => (c.spec as ThemeSpec).protectedTerms.length === 0);
    expect(withProtected.length).toBeGreaterThanOrEqual(8);
    expect(original.length).toBeGreaterThanOrEqual(8);
  });

  for (const testCase of spread.cases) {
    describe(testCase.hostText, () => {
      it("is a schema-valid spec", () => {
        expect(() => parsed(testCase.spec)).not.toThrow();
      });

      it("leaks no protected term into any provider-visible field", () => {
        expect(providerSafetyViolations(parsed(testCase.spec))).toEqual([]);
      });

      it("keeps every protected term out of the artwork prompt", () => {
        const spec = parsed(testCase.spec);
        const prompt = artworkPromptForSpec(spec).toLowerCase();
        for (const term of spec.protectedTerms) {
          const collapsed = term.toLowerCase().replace(/[^a-z0-9]+/g, "");
          expect(prompt.replace(/[^a-z0-9]+/g, "")).not.toContain(collapsed);
        }
      });

      it("requests no character rendering for a protected property", () => {
        expect(subjectPolicyIsConsistent(parsed(testCase.spec))).toBe(true);
      });

      it("renders legibly after normalization", () => {
        const spec = normalizeThemeSpec(parsed(testCase.spec));
        expect(contrastRatio(spec.palette.ink, spec.palette.surface)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
        expect(contrastRatio(spec.palette.body, spec.palette.surface)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
      });

      it("names an ideal motif distinct from the fallback it renders today", () => {
        const spec = parsed(testCase.spec);
        expect(spec.motifIdeal).not.toBe(spec.artId);
      });
    });
  }
});

describe("ThemeSpec spread — reuse key convergence", () => {
  it("collapses every phrasing of one aesthetic onto a single slug", () => {
    const moana = spread.cases
      .filter((c) => (c.spec as ThemeSpec).protectedTerms.includes("Moana"))
      .map((c) => parsed(c.spec).canonicalSlug);
    expect(moana.length).toBe(3);
    expect(new Set(moana).size).toBe(1);
  });

  it("does not collapse genuinely different aesthetics onto one slug", () => {
    const original = spread.cases
      .filter((c) => (c.spec as ThemeSpec).protectedTerms.length === 0)
      .map((c) => parsed(c.spec).canonicalSlug);
    expect(new Set(original).size).toBe(original.length);
  });
});

describe("ThemeSpec spread — adversarial specs are caught", () => {
  for (const testCase of spread.adversarialCases) {
    it(testCase.label, () => {
      const spec = parsed(testCase.spec);
      if (testCase.expect === "gate-blocks") {
        expect(providerSafetyViolations(spec).length).toBeGreaterThan(0);
      } else if (testCase.expect === "policy-repaired") {
        expect(subjectPolicyIsConsistent(spec)).toBe(false);
        expect(normalizeThemeSpec(spec).subjectPolicy).toBe("none");
      } else if (testCase.expect === "palette-repaired") {
        expect(contrastRatio(spec.palette.ink, spec.palette.surface)).toBeLessThan(MIN_INK_CONTRAST);
        const repaired = normalizeThemeSpec(spec);
        expect(contrastRatio(repaired.palette.ink, repaired.palette.surface)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
      } else {
        throw new Error(`Unknown expectation: ${testCase.expect}`);
      }
    });
  }
});

describe("ThemeSpec spread — report", () => {
  it("prints the founder review table and the motif backlog", () => {
    const rows = spread.cases.map((c) => {
      const spec = normalizeThemeSpec(parsed(c.spec));
      return {
        host: c.hostText.length > 46 ? `${c.hostText.slice(0, 43)}...` : c.hostText,
        slug: spec.canonicalSlug,
        shown: spec.displayName,
        medium: spec.medium,
        protected: spec.protectedTerms.join(", ") || "—",
        inkContrast: contrastRatio(spec.palette.ink, spec.palette.surface).toFixed(1),
      };
    });

    const counts = new Map<string, number>();
    for (const c of spread.cases) {
      const spec = parsed(c.spec);
      counts.set(spec.motifIdeal, (counts.get(spec.motifIdeal) ?? 0) + 1);
    }
    const backlog = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    console.info("\n=== ThemeSpec spread ===");
    console.info(spread.provenance);
    console.info(`\ncases: ${rows.length}   adversarial: ${spread.adversarialCases.length}`);
    console.info("\nhost request | slug | shown as | medium | protected (private) | ink contrast");
    for (const r of rows) {
      console.info(`${r.host} | ${r.slug} | ${r.shown} | ${r.medium} | ${r.protected} | ${r.inkContrast}:1`);
    }
    console.info(`\n=== motif backlog (${backlog.length} distinct, ranked) ===`);
    for (const [motif, n] of backlog) console.info(`${n}x  ${motif}`);

    expect(rows.length).toBeGreaterThanOrEqual(20);
  });
});
