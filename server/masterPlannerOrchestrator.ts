// Sequences every stage of an AI Master Planner draft generation attempt for
// a single event. Called by the POST .../master-planner/generate route after
// the entitlement gate (server/masterPlannerEntitlement.ts) has reserved a
// generation row. See PartyPilot_AI_Master_Planner_Design_Spec.md §4 and
// PartyPilot_AI_Master_Planner_Engineering_Breakdown.md §1/§3 (filenames
// predate the Posy rebrand) for the authoritative stage breakdown this mirrors.
//
// Stage order:
//   1. Theme + Event Identity        (AI)  -> coarse stage "theme"
//   2. Budget + Menu (parallel)      (AI)  -> coarse stage "budget_menu"
//   3. Shopping + Timeline           (AI + rule-based) -> coarse stage "shopping_timeline"
//   4. Event DNA read                (rule-based, not persisted, feeds stage 5)
//   5. Invitation concept + illustration (AI) -> coarse stage "invites"
//   6. Rule-based readiness/contradiction/coherence checks -> coarse stage "checks"
//   done
//
// Failure handling: if any task within a coarse stage fails, that whole
// coarse stage is marked failed and orchestration stops immediately — no
// later stage runs. Whichever fine-grained sub-stages DID succeed within the
// failed coarse stage stay persisted and recorded in completedStages, so a
// resumed attempt (via masterPlannerEntitlement.reserveOrResumeFreeDraft)
// never re-runs (and re-spends AI calls on) work that already succeeded.
//
// The `deps` parameter makes every AI-calling function swappable so tests
// can exercise sequencing, partial failure, and resume behavior without
// touching the Anthropic SDK.

import { storage } from "./storage";
import { generateThemeAndIdentityAi, type ThemeAndIdentityResult } from "./themeAi";
import { generateBudgetSuggestionAi, type BudgetSuggestion } from "./budgetAi";
import { generateMenuAi, type MenuSuggestion } from "./menuAi";
import { generateShoppingAi, type ShoppingSuggestion } from "./shoppingAi";
import { generateTimeline } from "@shared/timelineGenerator";
import { generateInviteDesignConcepts } from "./inviteDesignAi";
import { generateInviteIllustration } from "./illustrationGen";
import { matchThemeLibrary } from "./themeLibrary";
import { resolveGuestCount } from "@shared/guestCount";
import {
  markGenerationConsumed,
  markGenerationFailed,
  markStageCompleted,
  safeParseStages,
} from "./masterPlannerEntitlement";
import { parseInviteDesignConcept, type InviteDesignConcept } from "@shared/inviteDesign";
import { computeEventDna, dnaSummaryForPrompt, CONCEPT_INFERABLE_AXES, type EventDnaProfile } from "@shared/eventDna";
import { recommendInviteFormat } from "@shared/inviteFormatRecommendation";
import { detectContradictions } from "@shared/contradictions";
import { detectMenuThemeCoherence } from "@shared/menuThemeCoherence";
import { computeReadinessScore } from "@shared/readinessScore";
import { detectMissingItems } from "@shared/missingItems";
import { assessBudgetFeasibility } from "@shared/budgetFeasibility";

export type CoarseDraftStage = "theme" | "budget_menu" | "shopping_timeline" | "invites" | "checks" | "done";

/** Fine-grained resume ledger entries — see masterPlannerEntitlement.ts's completedStages. */
export type FineStage = "theme" | "budget" | "menu" | "shopping" | "timeline" | "invites" | "checks";

export interface OrchestratorDeps {
  generateThemeAndIdentity: typeof generateThemeAndIdentityAi;
  generateBudget: typeof generateBudgetSuggestionAi;
  generateMenu: typeof generateMenuAi;
  generateShopping: typeof generateShoppingAi;
  generateInviteConcepts: typeof generateInviteDesignConcepts;
  generateIllustration: typeof generateInviteIllustration;
}

const defaultDeps: OrchestratorDeps = {
  generateThemeAndIdentity: generateThemeAndIdentityAi,
  generateBudget: generateBudgetSuggestionAi,
  generateMenu: generateMenuAi,
  generateShopping: generateShoppingAi,
  generateInviteConcepts: generateInviteDesignConcepts,
  generateIllustration: generateInviteIllustration,
};

async function setDraftStage(eventId: number, stage: CoarseDraftStage): Promise<void> {
  await storage.updateEventById(eventId, { draftStage: stage });
}

async function failCoarseStage(eventId: number, generationId: number, stage: CoarseDraftStage): Promise<void> {
  await storage.updateEventById(eventId, { draftStatus: "failed_partial" });
  await markGenerationFailed(generationId, stage);
}

/** Rule-based, zero-AI-cost concept selection: picks whichever generated
 *  concept's dnaHints are closest (by absolute distance, summed across the
 *  axes an LLM concept can reasonably be scored on) to the event's own
 *  computed DNA profile. Falls back to the first concept when there isn't
 *  enough signal on either side to compare. */
function selectRecommendedConcept(
  concepts: InviteDesignConcept[],
  dnaProfile: EventDnaProfile,
): InviteDesignConcept {
  if (concepts.length === 0) throw new Error("No invitation design concepts were generated");

  const comparableAxes = CONCEPT_INFERABLE_AXES.filter((axis) => dnaProfile.scores[axis] !== undefined);
  if (comparableAxes.length === 0) return concepts[0];

  let best = concepts[0];
  let bestDistance = Infinity;
  for (const concept of concepts) {
    let distance = 0;
    let axesCompared = 0;
    for (const axis of comparableAxes) {
      const conceptScore = concept.dnaHints?.[axis];
      if (conceptScore === undefined) continue;
      distance += Math.abs(conceptScore - (dnaProfile.scores[axis] as number));
      axesCompared++;
    }
    // Concepts with no comparable dnaHints at all can't be scored against the
    // profile — treat them as a worse match than any concept that DID supply hints.
    const effectiveDistance = axesCompared > 0 ? distance : Infinity;
    if (effectiveDistance < bestDistance) {
      bestDistance = effectiveDistance;
      best = concept;
    }
  }
  return best;
}

export async function runMasterPlannerOrchestration(
  eventId: number,
  generationId: number,
  deps: OrchestratorDeps = defaultDeps,
): Promise<void> {
  const generationRow = await storage.getGeneration(generationId);
  const completed = new Set<FineStage>(
    (generationRow ? safeParseStages(generationRow.completedStages) : []) as FineStage[],
  );

  const initialEvent = await storage.getEventById(eventId);
  if (!initialEvent) throw new Error(`Event ${eventId} not found`);

  const guests = await storage.listGuests(eventId);
  const guestCount = resolveGuestCount(initialEvent.estimatedGuestCount, guests);

  await storage.updateEventById(eventId, { draftStatus: "generating" });

  /* ---- Stage 1: Theme + Event Identity ---- */
  if (!completed.has("theme")) {
    await setDraftStage(eventId, "theme");
    try {
      const result: ThemeAndIdentityResult = await deps.generateThemeAndIdentity({
        eventName: initialEvent.eventName,
        eventType: initialEvent.eventType,
        vibeDescription: initialEvent.vibeDescription,
        guestCount,
      });
      await storage.updateEventById(eventId, {
        themeName: result.themeName,
        paletteColors: JSON.stringify(result.paletteColors),
        eventIdentity: result.eventIdentity,
      });
      await markStageCompleted(generationId, "theme");
      completed.add("theme");
    } catch (err) {
      await failCoarseStage(eventId, generationId, "theme");
      throw err;
    }
  }

  /* ---- Stage 2: Budget + Menu (parallel AI calls) ---- */
  if (!completed.has("budget") || !completed.has("menu")) {
    await setDraftStage(eventId, "budget_menu");
    const eventForStage2 = (await storage.getEventById(eventId))!;

    const [budgetOutcome, menuOutcome] = await Promise.allSettled([
      completed.has("budget")
        ? Promise.resolve(null)
        : deps.generateBudget({
            eventName: eventForStage2.eventName,
            eventType: eventForStage2.eventType,
            themeName: eventForStage2.themeName,
            headcount: guestCount,
            targetBudget: eventForStage2.budgetCeiling,
          }),
      completed.has("menu")
        ? Promise.resolve(null)
        : deps.generateMenu({
            eventName: eventForStage2.eventName,
            eventType: eventForStage2.eventType,
            themeName: eventForStage2.themeName,
            vibeDescription: eventForStage2.vibeDescription,
            guestCount,
          }),
    ]);

    if (budgetOutcome.status === "fulfilled" && budgetOutcome.value) {
      const budget: BudgetSuggestion = budgetOutcome.value;
      await storage.createBudgetItemsBulk(
        eventId,
        budget.items.map((item) => ({ category: item.category, name: item.name, estimatedCost: item.estimatedCost })),
      );
      await markStageCompleted(generationId, "budget");
      completed.add("budget");
    }
    if (menuOutcome.status === "fulfilled" && menuOutcome.value) {
      const menu: MenuSuggestion = menuOutcome.value;
      await storage.createMenuItemsBulk(
        eventId,
        menu.items.map((item) => ({
          course: item.course,
          itemName: item.itemName,
          source: item.source,
          servesCount: item.servesCount,
          costEstimate: item.costEstimate,
          dietaryTags: item.dietaryTags,
          notes: item.notes,
        })),
      );
      await markStageCompleted(generationId, "menu");
      completed.add("menu");
    }

    if (budgetOutcome.status === "rejected" || menuOutcome.status === "rejected") {
      await failCoarseStage(eventId, generationId, "budget_menu");
      throw budgetOutcome.status === "rejected" ? budgetOutcome.reason : (menuOutcome as PromiseRejectedResult).reason;
    }
  }

  /* ---- Stage 3: Timeline (rule-based) + Shopping (AI) ---- */
  if (!completed.has("timeline") || !completed.has("shopping")) {
    await setDraftStage(eventId, "shopping_timeline");
    const eventForStage3 = (await storage.getEventById(eventId))!;
    const menuItemsForStage3 = await storage.listMenuItems(eventId);
    const hasCakeMenuItem = menuItemsForStage3.some((item) => item.course === "Cake");

    if (!completed.has("timeline")) {
      try {
        const timelineItems = generateTimeline({ eventType: eventForStage3.eventType, guestCount, hasCakeMenuItem });
        await storage.createTimelineItemsBulk(
          eventId,
          timelineItems.map((item) => ({
            time: item.time,
            title: item.title,
            category: item.category,
            sortOrder: item.sortOrder,
          })),
        );
        await markStageCompleted(generationId, "timeline");
        completed.add("timeline");
      } catch (err) {
        await failCoarseStage(eventId, generationId, "shopping_timeline");
        throw err;
      }
    }

    if (!completed.has("shopping")) {
      try {
        const shopping: ShoppingSuggestion = await deps.generateShopping({
          eventName: eventForStage3.eventName,
          eventType: eventForStage3.eventType,
          themeName: eventForStage3.themeName,
          guestCount,
          menuItems: menuItemsForStage3.map((item) => ({ course: item.course, itemName: item.itemName })),
        });
        await storage.createShoppingListItemsBulk(
          eventId,
          shopping.items.map((item) => ({
            category: item.category,
            itemName: item.itemName,
            quantity: item.quantity,
            estimatedCost: item.estimatedCost,
            notes: item.notes,
          })),
        );
        await markStageCompleted(generationId, "shopping");
        completed.add("shopping");
      } catch (err) {
        await failCoarseStage(eventId, generationId, "shopping_timeline");
        throw err;
      }
    }
  }

  /* ---- Stage 4 (read-only, feeds Stage 5) + Stage 5: Invitation concept + illustration ---- */
  if (!completed.has("invites")) {
    await setDraftStage(eventId, "invites");
    try {
      const eventForStage5 = (await storage.getEventById(eventId))!;
      const [menuItemsForDna, budgetItemsForDna] = await Promise.all([
        storage.listMenuItems(eventId),
        storage.listBudgetItems(eventId),
      ]);
      const appliedConcept = parseInviteDesignConcept(eventForStage5.inviteDesignConceptJson);
      const dnaProfile = computeEventDna({
        eventType: eventForStage5.eventType,
        menuItems: menuItemsForDna,
        budgetItems: budgetItemsForDna,
        appliedConceptDnaHints: appliedConcept?.dnaHints,
      });
      const formatRecommendation = recommendInviteFormat(dnaProfile, guestCount);

      const concepts = await deps.generateInviteConcepts({
        themePrompt: eventForStage5.vibeDescription || eventForStage5.themeName,
        eventName: eventForStage5.eventName,
        eventType: eventForStage5.eventType,
        eventDate: eventForStage5.eventDate,
        location: eventForStage5.location,
        hostNames: eventForStage5.hostNames,
        themeName: eventForStage5.themeName,
        dnaSummary: dnaSummaryForPrompt(dnaProfile),
        formatGuidance: formatRecommendation?.conceptGuidance ?? null,
      });
      const chosen = selectRecommendedConcept(concepts, dnaProfile);
      const aspectRatio = chosen.layoutStyle === "banner" ? "16:9" : chosen.layoutStyle === "full-bleed" ? "9:16" : "1:1";
      const illustrationUrl = await deps.generateIllustration(chosen, aspectRatio);

      await storage.updateEventById(eventId, {
        inviteDesignConceptJson: JSON.stringify(chosen),
        inviteIllustrationUrl: illustrationUrl,
      });
      await markStageCompleted(generationId, "invites");
      completed.add("invites");
    } catch (err) {
      await failCoarseStage(eventId, generationId, "invites");
      throw err;
    }
  }

  /* ---- Stage 6: rule-based checks (validation pass — nothing persisted, matches
   *  the rest of the app's "computed fresh on every read, never stored" convention) ---- */
  if (!completed.has("checks")) {
    await setDraftStage(eventId, "checks");
    try {
      const eventForStage6 = (await storage.getEventById(eventId))!;
      const [guestsForChecks, menuItemsForChecks, budgetItemsForChecks, shoppingItemsForChecks, timelineItemsForChecks] =
        await Promise.all([
          storage.listGuests(eventId),
          storage.listMenuItems(eventId),
          storage.listBudgetItems(eventId),
          storage.listShoppingListItems(eventId),
          storage.listTimelineItems(eventId),
        ]);
      const appliedConcept = parseInviteDesignConcept(eventForStage6.inviteDesignConceptJson);

      detectContradictions({
        eventType: eventForStage6.eventType,
        budgetTotal: eventForStage6.budgetTotal,
        guests: guestsForChecks,
        menuItems: menuItemsForChecks,
        budgetItems: budgetItemsForChecks,
        appliedConceptDnaHints: appliedConcept?.dnaHints,
      });
      computeReadinessScore({
        budgetTotal: eventForStage6.budgetTotal,
        budgetItems: budgetItemsForChecks,
        menuItems: menuItemsForChecks,
        guests: guestsForChecks,
        shoppingItems: shoppingItemsForChecks,
        timelineItems: timelineItemsForChecks,
      });
      detectMissingItems({ shoppingItems: shoppingItemsForChecks, guests: guestsForChecks });
      assessBudgetFeasibility({ budgetItems: budgetItemsForChecks, guests: guestsForChecks });
      const matchedEntry = matchThemeLibrary(eventForStage6.themeName);
      detectMenuThemeCoherence({
        matchedThemeLabel: matchedEntry?.label ?? null,
        themeKeywords: matchedEntry?.keywords ?? [],
        menuItems: menuItemsForChecks,
      });

      await markStageCompleted(generationId, "checks");
      completed.add("checks");
    } catch (err) {
      await failCoarseStage(eventId, generationId, "checks");
      throw err;
    }
  }

  /* ---- Done ---- */
  await setDraftStage(eventId, "done");
  await storage.updateEventById(eventId, { draftStatus: "ready" });
  await markGenerationConsumed(generationId);
}
