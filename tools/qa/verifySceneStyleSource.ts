// Offline check of the real private master, separate from CI's fake pixels.
import { readFileSync } from "node:fs";
import { prepareSceneStyleSource } from "../../server/aiFirst/sceneStyleSource";
import { readPngSize } from "../../server/aiFirst/png";

if (process.argv.length !== 3) {
  console.error("Usage: node --import tsx tools/qa/verifySceneStyleSource.ts <private-master.png>");
  process.exitCode = 2;
} else {
  try {
    const source = readFileSync(process.argv[2]);
    const manifest = JSON.parse(readFileSync("server/aiFirst/sceneAssets/construction-gouache-v1/manifest.json", "utf8"));
    const first = prepareSceneStyleSource(source, manifest);
    const second = prepareSceneStyleSource(source, manifest);
    if (!first.original.equals(source) || !first.teaser.equals(second.teaser)) throw new Error("Pixel mismatch");
    console.log(JSON.stringify({
      kind: first.kind, sourceSha256: first.manifest.sourceSha256,
      sourceDimensions: readPngSize(first.original), teaserDimensions: readPngSize(first.teaser),
      teaserSha256: first.teaserSha256, sourceUnchanged: true, deterministicTeaser: true,
      providerCalls: 0, customerActivation: first.customerActivation, qualityReview: first.manifest.qualityReview,
    }, null, 2));
  } catch {
    console.error("Private master verification failed; no artwork or credentials were logged.");
    process.exitCode = 1;
  }
}
