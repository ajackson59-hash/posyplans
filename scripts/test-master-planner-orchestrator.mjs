// Zero-cost mock test for the AI Master Planner orchestrator + entitlement
// gate — no real Anthropic call, no new event created (reuses the existing
// "Phase1 Test Event 2" row, event id 13, per the credit-conservation
// instruction to reuse test data instead of creating new rows). Exercises:
//
//   1. Stage sequencing (theme -> budget/menu -> shopping/timeline -> invites
//      -> checks -> done) via injected `deps` that record call order instead
//      of calling the Anthropic SDK.
//   2. Partial-failure persistence: a failing stage stops orchestration but
//      keeps whatever fine-grained sub-stages already succeeded.
//   3. The reservation state machine: reserve -> consume (Test A), and
//      reserve -> fail -> resume -> consume (Test B), including that a
//      resumed run does NOT re-call already-completed AI stages.
//
// Run with: npx tsx scripts/test-master-planner-orchestrator.mjs

import { storage } from "../server/storage.ts";
import { reserveOrResumeFreeDraft, safeParseStages } from "../server/masterPlannerEntitlement.ts";
import { runMasterPlannerOrchestration } from "../server/masterPlannerOrchestrator.ts";
import Database from "better-sqlite3";

const EVENT_ID = 13; // "Phase1 Test Event 2" — pre-existing test row, reused rather than creating a new one.
const raw = new Database("data.db");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.log(`FAIL: ${msg}`);
  } else {
    console.log(`ok:   ${msg}`);
  }
}

/** Wipes this test event back to a pre-draft baseline and clears any rows a
 *  previous run of this script left behind, so the script is safely rerunnable. */
function resetEventToBaseline() {
  raw
    .prepare(
      `UPDATE events SET
        theme_name = '', palette_colors = '[]', event_identity = '',
        invite_design_concept_json = '{}', invite_illustration_url = '',
        draft_status = 'none', draft_stage = NULL
      WHERE id = ?`,
    )
    .run(EVENT_ID);
  raw.prepare(`DELETE FROM master_planner_generations WHERE event_id = ?`).run(EVENT_ID);
  raw.prepare(`DELETE FROM budget_items WHERE event_id = ?`).run(EVENT_ID);
  raw.prepare(`DELETE FROM menu_items WHERE event_id = ?`).run(EVENT_ID);
  raw.prepare(`DELETE FROM shopping_list_items WHERE event_id = ?`).run(EVENT_ID);
  raw.prepare(`DELETE FROM timeline_items WHERE event_id = ?`).run(EVENT_ID);
}

function mockThemeIdentity(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("theme");
    if (shouldFail) throw new Error("mock theme failure");
    return { themeName: "Bonfire Glow", paletteColors: ["#3B2F2F", "#E4A64C"], eventIdentity: "A cozy backyard bonfire night." };
  };
}
function mockBudget(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("budget");
    if (shouldFail) throw new Error("mock budget failure");
    return { items: [{ category: "Venue", name: "Backyard setup", estimatedCost: 100 }], suggestedTotal: 100, tip: "mock tip" };
  };
}
function mockMenu(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("menu");
    if (shouldFail) throw new Error("mock menu failure");
    return {
      items: [{ course: "Main Course", itemName: "S'mores bar", source: "Homemade", servesCount: 25, costEstimate: 40, dietaryTags: "", notes: "" }],
      tip: "mock tip",
    };
  };
}
function mockShopping(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("shopping");
    if (shouldFail) throw new Error("mock shopping failure");
    return { items: [{ category: "Setup Tools", itemName: "Citronella candles", quantity: "6", estimatedCost: 20, notes: "" }], tip: "mock tip" };
  };
}
function mockInviteConcepts(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("inviteConcepts");
    if (shouldFail) throw new Error("mock invite concepts failure");
    return [
      {
        conceptName: "Rustic Ember",
        description: "Warm, handwritten backyard invite",
        paletteColors: ["#3B2F2F", "#E4A64C", "#F5E6C8", "#7A5C3E"],
        fontPairingId: "classic-serif",
        borderStyle: "none",
        layoutStyle: "backdrop",
        illustrationPrompt: "cozy backyard bonfire at dusk, warm string lights",
        dnaHints: { elegantCasual: 0.2, traditionalModern: 0.3 },
      },
      {
        conceptName: "Wide Banner Glow",
        description: "Wide banner-style invite",
        paletteColors: ["#3B2F2F", "#E4A64C", "#F5E6C8", "#7A5C3E"],
        fontPairingId: "classic-serif",
        borderStyle: "thin",
        layoutStyle: "banner",
        illustrationPrompt: "wide bonfire banner scene",
        dnaHints: { elegantCasual: 0.8, traditionalModern: 0.7 },
      },
    ];
  };
}
function mockIllustration(callOrder, shouldFail = false) {
  return async () => {
    callOrder.push("illustration");
    if (shouldFail) throw new Error("mock illustration failure");
    return "data:image/png;base64,bW9jaw==";
  };
}

async function testA_fullSuccessAndConsumption() {
  console.log("\n--- Test A: full success run, sequencing + consumption ---");
  resetEventToBaseline();
  const callOrder = [];
  const deps = {
    generateThemeAndIdentity: mockThemeIdentity(callOrder),
    generateBudget: mockBudget(callOrder),
    generateMenu: mockMenu(callOrder),
    generateShopping: mockShopping(callOrder),
    generateInviteConcepts: mockInviteConcepts(callOrder),
    generateIllustration: mockIllustration(callOrder),
  };

  const reservation = await reserveOrResumeFreeDraft(EVENT_ID);
  assert(reservation.ok === true, "reserveOrResumeFreeDraft succeeds for a fresh event");
  assert(!!reservation.generation, "reservation returns a generation row");

  await runMasterPlannerOrchestration(EVENT_ID, reservation.generation.id, deps);

  // Sequencing: theme must run before budget/menu; both must run before shopping;
  // inviteConcepts must run before illustration.
  assert(callOrder.indexOf("theme") === 0, "theme runs first");
  assert(callOrder.indexOf("theme") < callOrder.indexOf("budget"), "theme runs before budget");
  assert(callOrder.indexOf("theme") < callOrder.indexOf("menu"), "theme runs before menu");
  assert(Math.max(callOrder.indexOf("budget"), callOrder.indexOf("menu")) < callOrder.indexOf("shopping"), "budget+menu run before shopping");
  assert(callOrder.indexOf("inviteConcepts") < callOrder.indexOf("illustration"), "invite concepts run before illustration");

  const event = await storage.getEventById(EVENT_ID);
  assert(event.draftStage === "done", `event.draftStage is "done" (got "${event.draftStage}")`);
  assert(event.draftStatus === "ready", `event.draftStatus is "ready" (got "${event.draftStatus}")`);
  assert(event.themeName === "Bonfire Glow", "theme name was persisted onto the event");
  assert(event.inviteIllustrationUrl.startsWith("data:image/png"), "illustration URL was persisted onto the event");

  const generation = await storage.getGeneration(reservation.generation.id);
  assert(generation.state === "consumed", `generation.state is "consumed" (got "${generation.state}")`);
  const stages = safeParseStages(generation.completedStages);
  for (const stage of ["theme", "budget", "menu", "timeline", "shopping", "invites", "checks"]) {
    assert(stages.includes(stage), `completedStages includes "${stage}"`);
  }

  const secondReservation = await reserveOrResumeFreeDraft(EVENT_ID);
  assert(secondReservation.ok === false && secondReservation.reason === "already_consumed", "a consumed free draft cannot be reserved again");
}

async function testB_partialFailureAndResume() {
  console.log("\n--- Test B: partial failure persists progress, resume skips completed stages ---");
  resetEventToBaseline();
  const failingCallOrder = [];
  const failingDeps = {
    generateThemeAndIdentity: mockThemeIdentity(failingCallOrder),
    generateBudget: mockBudget(failingCallOrder),
    generateMenu: mockMenu(failingCallOrder),
    generateShopping: mockShopping(failingCallOrder, /* shouldFail */ true),
    generateInviteConcepts: mockInviteConcepts(failingCallOrder),
    generateIllustration: mockIllustration(failingCallOrder),
  };

  const reservation = await reserveOrResumeFreeDraft(EVENT_ID);
  const generationId = reservation.generation.id;

  let threw = false;
  try {
    await runMasterPlannerOrchestration(EVENT_ID, generationId, failingDeps);
  } catch (err) {
    threw = true;
  }
  assert(threw, "orchestration throws when a stage fails");

  const eventAfterFailure = await storage.getEventById(EVENT_ID);
  assert(eventAfterFailure.draftStage === "shopping_timeline", `event.draftStage stayed at the failed coarse stage (got "${eventAfterFailure.draftStage}")`);
  assert(eventAfterFailure.draftStatus === "failed_partial", `event.draftStatus is "failed_partial" (got "${eventAfterFailure.draftStatus}")`);

  const generationAfterFailure = await storage.getGeneration(generationId);
  assert(generationAfterFailure.state === "failed", `generation.state is "failed" (got "${generationAfterFailure.state}")`);
  assert(generationAfterFailure.failedStage === "shopping_timeline", `generation.failedStage is "shopping_timeline" (got "${generationAfterFailure.failedStage}")`);
  const stagesAfterFailure = safeParseStages(generationAfterFailure.completedStages);
  for (const stage of ["theme", "budget", "menu", "timeline"]) {
    assert(stagesAfterFailure.includes(stage), `completedStages still includes pre-failure stage "${stage}"`);
  }
  for (const stage of ["shopping", "invites", "checks"]) {
    assert(!stagesAfterFailure.includes(stage), `completedStages correctly excludes post-failure stage "${stage}"`);
  }
  assert(failingCallOrder.includes("theme") && failingCallOrder.includes("budget") && failingCallOrder.includes("menu"), "theme/budget/menu did run before the failure");
  assert(!failingCallOrder.includes("inviteConcepts"), "invites stage never ran after the shopping_timeline failure");

  // Resume: reserving again should flip the same row back to "reserved" and
  // clear the failure markers, while keeping completedStages intact.
  const resumedReservation = await reserveOrResumeFreeDraft(EVENT_ID);
  assert(resumedReservation.ok === true, "a failed free draft can be resumed");
  assert(resumedReservation.generation.id === generationId, "resume reuses the same generation row instead of creating a new one");
  assert(resumedReservation.generation.state === "reserved", `resumed generation.state is "reserved" (got "${resumedReservation.generation.state}")`);
  assert(resumedReservation.generation.failedStage === null, "resumed generation clears failedStage");
  const resumedStages = safeParseStages(resumedReservation.generation.completedStages);
  assert(resumedStages.includes("theme") && resumedStages.includes("budget") && resumedStages.includes("menu") && resumedStages.includes("timeline"), "resume preserves previously completed stages");

  // Re-run with all-succeeding deps and confirm theme/budget/menu/timeline are
  // NOT re-invoked (timeline has no dep call to check, but its absence from
  // this run's dep-tracking array is implicit since it's rule-based).
  const resumeCallOrder = [];
  const succeedingDeps = {
    generateThemeAndIdentity: mockThemeIdentity(resumeCallOrder),
    generateBudget: mockBudget(resumeCallOrder),
    generateMenu: mockMenu(resumeCallOrder),
    generateShopping: mockShopping(resumeCallOrder),
    generateInviteConcepts: mockInviteConcepts(resumeCallOrder),
    generateIllustration: mockIllustration(resumeCallOrder),
  };
  await runMasterPlannerOrchestration(EVENT_ID, generationId, succeedingDeps);

  assert(!resumeCallOrder.includes("theme"), "resume does NOT re-call generateThemeAndIdentity for an already-completed stage");
  assert(!resumeCallOrder.includes("budget"), "resume does NOT re-call generateBudget for an already-completed stage");
  assert(!resumeCallOrder.includes("menu"), "resume does NOT re-call generateMenu for an already-completed stage");
  assert(resumeCallOrder.includes("shopping"), "resume DOES call generateShopping (the stage that previously failed)");
  assert(resumeCallOrder.includes("inviteConcepts") && resumeCallOrder.includes("illustration"), "resume proceeds on to the invites stage after shopping succeeds");

  const finalEvent = await storage.getEventById(EVENT_ID);
  assert(finalEvent.draftStage === "done", `final event.draftStage is "done" (got "${finalEvent.draftStage}")`);
  assert(finalEvent.draftStatus === "ready", `final event.draftStatus is "ready" (got "${finalEvent.draftStatus}")`);
  const finalGeneration = await storage.getGeneration(generationId);
  assert(finalGeneration.state === "consumed", `final generation.state is "consumed" (got "${finalGeneration.state}")`);
}

async function main() {
  await testA_fullSuccessAndConsumption();
  await testB_partialFailureAndResume();

  resetEventToBaseline(); // leave the shared test event clean for future runs
  raw.close();

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
