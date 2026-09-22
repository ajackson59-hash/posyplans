import { describe, expect, it } from "vitest";
import {
  artworkPromptForSpec,
  assertProviderSafe,
  canonicalizeSlug,
  providerSafetyViolations,
  subjectPolicyIsConsistent,
  themeSpecSchema,
  type ThemeSpec,
} from "@shared/themeSpec";
import { contrastRatio } from "@shared/aiFirstPalette";
import {
  MIN_INK_CONTRAST,
  ensureLegible,
  normalizeThemeSpec,
} from "../server/aiFirst/themeSpecResolver";

const islandVoyage: ThemeSpec = {
  canonicalSlug: "island-voyage-sunset",
  displayName: "Island Voyage",
  themeStyle: "storybook",
  occasion: "kids-birthday",
  palette: { ink: "#0b3b52", accent: "#e2703a", surface: "#fdf6ec", body: "#2f4f5c" },
  artId: "botanical-sprig",
  artPlacement: "corner-mirrored",
  textureStyle: "cotton",
  dividerStyle: "rule",
  overlayTreatment: "veil",
  motifIdeal: "hibiscus-and-palm",
  setting: "open ocean at golden hour with an outrigger canoe under a woven sail",
  motifs: ["hibiscus", "plumeria", "palm fronds", "tapa border", "rope", "shells"],
  medium: "gouache",
  mood: "warm, adventurous, joyful",
  ageRegister: "young-child",
  subjectPolicy: "none",
  protectedTerms: ["Moana"],
  confidence: 0.86,
};

describe("ThemeSpec schema", () => {
  it("accepts a well-formed spec", () => {
    expect(themeSpecSchema.safeParse(islandVoyage).success).toBe(true);
  });

  it("rejects a non-hex palette role", () => {
    const bad = { ...islandVoyage, palette: { ...islandVoyage.palette, ink: "navy" } };
    expect(themeSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a slug that is not kebab-case", () => {
    expect(themeSpecSchema.safeParse({ ...islandVoyage, canonicalSlug: "Island Voyage" }).success).toBe(false);
  });

  it("rejects an unsupported medium", () => {
    expect(themeSpecSchema.safeParse({ ...islandVoyage, medium: "airbrush" }).success).toBe(false);
  });
});

describe("canonicalizeSlug", () => {
  it("converges phrasings of one aesthetic", () => {
    expect(canonicalizeSlug("Island Voyage Sunset")).toBe("island-voyage-sunset");
    expect(canonicalizeSlug("  island   voyage — sunset  ")).toBe("island-voyage-sunset");
    expect(canonicalizeSlug("Island Voyage Sunset!!")).toBe("island-voyage-sunset");
  });

  it("strips diacritics rather than dropping the word", () => {
    expect(canonicalizeSlug("Piñata Fiesta")).toBe("pinata-fiesta");
  });
});

describe("provider-safety egress gate", () => {
  it("passes a spec whose protected term appears only in protectedTerms", () => {
    expect(providerSafetyViolations(islandVoyage)).toEqual([]);
    expect(() => assertProviderSafe(islandVoyage)).not.toThrow();
  });

  it("catches a protected name leaked into the setting", () => {
    const leaked: ThemeSpec = {
      ...islandVoyage,
      setting: "Moana sailing her canoe across the open ocean at golden hour",
    };
    const violations = providerSafetyViolations(leaked);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ term: "Moana", field: "setting" });
    expect(() => assertProviderSafe(leaked)).toThrow(/not provider-safe/);
  });

  it("catches a protected name leaked into the display name or slug", () => {
    expect(providerSafetyViolations({ ...islandVoyage, displayName: "Moana Party" }))
      .toEqual([{ term: "Moana", field: "displayName" }]);
    expect(providerSafetyViolations({ ...islandVoyage, canonicalSlug: "moana-voyage" }))
      .toEqual([{ term: "Moana", field: "canonicalSlug" }]);
  });

  it("catches a protected name leaked into a motif", () => {
    const leaked = { ...islandVoyage, motifs: ["hibiscus", "Elsa snowflake"], protectedTerms: ["Elsa"] };
    expect(providerSafetyViolations(leaked)).toEqual([{ term: "Elsa", field: "motifs[1]" }]);
  });

  it("matches across punctuation and spacing variants", () => {
    const spec = { ...islandVoyage, protectedTerms: ["Paw Patrol"] };
    for (const setting of [
      "a paw-patrol rescue yard at noon",
      "a PawPatrol rescue yard at noon",
      "a Paw  Patrol rescue yard at noon",
    ]) {
      expect(providerSafetyViolations({ ...spec, setting })).not.toEqual([]);
    }
  });

  it("matches a possessive form of a single-word term", () => {
    const leaked = { ...islandVoyage, setting: "Elsa's ice palace at dusk", protectedTerms: ["Elsa"] };
    expect(providerSafetyViolations(leaked)).not.toEqual([]);
  });

  it("does not match a needle that only spans word boundaries", () => {
    // Regression: collapsing separators made "glitter-era-stage" contain
    // "eras", which blocked a clean spec. Found by the coverage spread.
    const spec = { ...islandVoyage, protectedTerms: ["Eras"], canonicalSlug: "glitter-era-stage" };
    expect(providerSafetyViolations(spec)).toEqual([]);
  });

  it("still matches a concatenated multi-word term as a single token", () => {
    const spec = { ...islandVoyage, protectedTerms: ["Paw Patrol"], setting: "a pawpatrol rescue yard at noon" };
    expect(providerSafetyViolations(spec)).not.toEqual([]);
  });

  it("blocks a protected title used in its ordinary-word sense", () => {
    // Intentional strictness: the gate is literal so it can be provable. The
    // resolver is instructed to pick a synonym instead.
    const spec = { ...islandVoyage, protectedTerms: ["Frozen"], setting: "an ice palace on a frozen fjord" };
    expect(providerSafetyViolations(spec)).toEqual([{ term: "Frozen", field: "setting" }]);
  });

  it("ignores very short terms that would match pathologically", () => {
    const spec = { ...islandVoyage, protectedTerms: ["Up"] };
    expect(providerSafetyViolations(spec)).toEqual([]);
  });

  it("never exposes protectedTerms through the artwork prompt", () => {
    const prompt = artworkPromptForSpec(islandVoyage);
    expect(prompt.toLowerCase()).not.toContain("moana");
    expect(prompt).toContain("No lettering");
    expect(prompt).toContain("hibiscus");
  });
});

describe("subject policy invariant", () => {
  it("forbids an original character alongside a protected property", () => {
    expect(subjectPolicyIsConsistent({ ...islandVoyage, subjectPolicy: "original-character" })).toBe(false);
  });

  it("allows an original character for a wholly original request", () => {
    const original = { ...islandVoyage, protectedTerms: [], subjectPolicy: "original-character" as const };
    expect(subjectPolicyIsConsistent(original)).toBe(true);
  });

  it("is repaired deterministically rather than trusted to the model", () => {
    const normalized = normalizeThemeSpec({ ...islandVoyage, subjectPolicy: "original-character" });
    expect(normalized.subjectPolicy).toBe("none");
  });
});

describe("palette legibility repair", () => {
  it("leaves an already-legible role untouched", () => {
    expect(ensureLegible("#0b3b52", "#fdf6ec")).toBe("#0b3b52");
  });

  it("repairs a mid-tone ink on a mid-tone surface", () => {
    const repaired = ensureLegible("#8a8a8a", "#9a9a9a");
    expect(contrastRatio(repaired, "#9a9a9a")).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
  });

  it("repairs against a dark surface by lightening", () => {
    const repaired = ensureLegible("#333333", "#1a1a1a");
    expect(contrastRatio(repaired, "#1a1a1a")).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
  });

  it("normalizes ink and body together so no request fails for contrast", () => {
    const muddy = normalizeThemeSpec({
      ...islandVoyage,
      palette: { ink: "#8a8a8a", accent: "#e2703a", surface: "#9a9a9a", body: "#909090" },
    });
    expect(contrastRatio(muddy.palette.ink, muddy.palette.surface)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
    expect(contrastRatio(muddy.palette.body, muddy.palette.surface)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST);
  });

  it("keeps the repaired spec schema-valid", () => {
    const muddy = normalizeThemeSpec({
      ...islandVoyage,
      palette: { ink: "#8a8a8a", accent: "#e2703a", surface: "#9a9a9a", body: "#909090" },
    });
    expect(themeSpecSchema.safeParse(muddy).success).toBe(true);
  });
});
