/** Mock provider responses read task data, never infer requirements from schema. */
export function visionRequestRequirements(request: any): string[] {
  return visionRequestManifest(request).map(row => row.requirement);
}
export function visionRequestManifest(request: any): { id: string; requirement: string; kind: string }[] {
  const text = request.messages[0].content.filter((part: any) => part.type === "text")
    .map((part: any) => part.text).join("\n");
  const heading = "VISIBLE MUST-HAVES (server-owned IDs; return each requirementId exactly once with located evidence):";
  const start = text.lastIndexOf(heading);
  if (start < 0) throw new Error("Review fixture did not receive the visible requirements");
  return JSON.parse(text.slice(start + heading.length).split("EXCLUDED:")[0].trim());
}

/** Upgrade older synthetic transport fixtures to the new schema. This is not a
 * visual judgment or a production compatibility path. New contract tests send
 * explicit model packets directly, without this helper. */
export function visionFixtureReply(request: any, supplied: any) {
  const manifest = visionRequestManifest(request);
  const body = structuredClone(supplied);
  if (Array.isArray(body.requiredPresent)) body.requiredPresent = body.requiredPresent.map((row: any) => ({
    requirementId: row.requirementId ?? manifest.find(item => item.requirement === row.requirement)?.id ?? "unknown-fixture-id",
    present: row.present, evidence: row.evidence ?? "Synthetic located fixture observation",
  }));
  const criteria: Record<string, string> = { textLogoWatermarkFree: "lettering", artifactFree: "malformed-object",
    premiumFinish: "careless-edge-work", briefFidelity: "missing-requested-detail",
    compositionQuality: "edge-clipping", ageAppropriate: "wrong-maturity" };
  body.dimensionAssessments ??= Object.fromEntries(Object.entries(criteria).map(([key, criterion]) => [key, {
    status: body[key] === 5 ? "clear" : "defect", criterion: body[key] === 5 ? "none" : criterion,
    location: "Full canvas", observation: "Synthetic located observation for the numeric-score fixture",
  }]));
  for (const [key, basis] of [["premiumFinish", "observed-craft"], ["compositionQuality", "observed-layout"]]) {
    if (body.dimensionAssessments[key]) body.dimensionAssessments[key].basis ??= basis;
  }
  const medium = manifest.find(item => item.kind === "medium");
  body.mediumAssessment ??= { status: medium ? "matched" : "not-requested", observedTreatment: "Synthetic observed treatment",
    location: "Full canvas", observation: "Synthetic medium evidence; not a real image assessment" };
  return body;
}

/** Pipeline accounting fixtures promise a complete checklist independently of
 * their numeric failure scenario. Populate the actual request, not old prose. */
export function visionFixtureAllPresent(request: any, supplied: any) {
  return visionFixtureReply(request, { ...supplied, requiredPresent: visionRequestManifest(request).map(row => ({
    requirementId: row.id, present: true, evidence: "Synthetic complete pipeline checklist",
  })) });
}
