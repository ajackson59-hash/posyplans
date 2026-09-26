// Read-only/offline CLI. Accepts sanitized evidence; no provider or DB clients.
import { readFileSync } from "node:fs";
import { summarizePreviewBenchmark } from "../../server/aiFirst/previewBenchmark";

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) {
  console.error("Usage: node --import tsx tools/qa/summarizePreviewBenchmark.ts <evidence.json>");
  process.exitCode = 2;
} else {
  try {
    const report = summarizePreviewBenchmark(JSON.parse(readFileSync(inputPath, "utf8")));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.meetsObservedArtworkBenchmark ? 0 : 1;
  } catch {
    // No input echo: malformed evidence may accidentally contain owner secrets.
    console.error("Invalid benchmark evidence. Check the schema and registered trial IDs.");
    process.exitCode = 2;
  }
}
