import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareSceneStyleSource } from "../server/aiFirst/sceneStyleSource";
import { encodePng, readPngSize } from "../server/aiFirst/png";

const dir = "server/aiFirst/sceneAssets/construction-gouache-v1/";
// Synthetic preparation-contract pixels, not the approved artwork. The real
// master must not be committed publicly just so CI can read it. The offline
// verifySceneStyleSource CLI validates the actual owner's approved image.
const source = encodePng({ width: 1024, height: 1536, rgb: new Uint8Array(1024 * 1536 * 3).fill(160) });
const metadata = () => ({
  ...JSON.parse(readFileSync(dir + "manifest.json", "utf8")),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  approval: { scope: "art-direction-only", approvedBy: "project-owner", evidence: "Synthetic contract fixture, not real artwork approval" },
});

describe("style-approved source preparation contract (synthetic pixels)", () => {
  it("preserves the exact approved source and deterministic native teaser", () => {
    const first = prepareSceneStyleSource(source, metadata());
    const second = prepareSceneStyleSource(source, metadata());
    expect(first.original.equals(source)).toBe(true);
    expect(readPngSize(first.original)).toEqual({ width: 1024, height: 1536 });
    expect(readPngSize(first.teaser)).toEqual({ width: 373, height: 560 });
    expect(first.teaser.equals(second.teaser)).toBe(true);
    expect(first.teaserSha256).toBe(createHash("sha256").update(first.teaser).digest("hex"));
    first.original.fill(0);
    expect(second.original.equals(source)).toBe(true);
  });

  it("never upgrades style approval into quality certification or customer activation", () => {
    const result = prepareSceneStyleSource(source, metadata());
    expect(result.kind).toBe("style-approved-source");
    expect(result.customerActivation).toBe("disabled");
    expect(result.manifest.qualityReview).toBe("pending");
    expect(result).not.toHaveProperty("certificate");
    expect(result).not.toHaveProperty("dataUrl");
    expect(result.manifest.namedThemeId).toBeNull();
  });

  it("rejects changed source bytes before preparing a teaser", () => {
    const changed = Buffer.from(source); changed[changed.length - 1] ^= 1;
    expect(() => prepareSceneStyleSource(changed, metadata())).toThrow("bytes changed");
  });

  it.each(["qualityReview", "requirementCertification", "commercialReview", "customerActivation", "namedThemeId"])("does not infer %s approval", (field) => {
    const manifest = metadata(); manifest[field] = "approved";
    expect(() => prepareSceneStyleSource(source, manifest)).toThrow();
  });

  it("rejects an unexpected source size", () => {
    const manifest = metadata(); manifest.width = 900;
    expect(() => prepareSceneStyleSource(source, manifest)).toThrow("native RGB PNG");
  });
});
