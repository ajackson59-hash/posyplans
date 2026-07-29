// Zero-cost mock test for menuAi.ts / shoppingAi.ts — no real Anthropic call.
// Verifies the JSON-parsing, enum-fallback, and clamping logic in isolation
// by feeding synthetic (including deliberately malformed) "AI responses"
// through the same validation code the real functions use. This exists
// because a live Anthropic key isn't available in this session yet (the
// in-session credential form is currently not submitting for the user) —
// once a key is added, scripts/test-menu-shopping-ai.mjs runs the real
// 2-scenario batched check.
import { MENU_COURSES, MENU_SOURCES, SHOPPING_CATEGORIES } from "../shared/schema.ts";

// ---- Inline copies of the validation/clamping logic from menuAi.ts / shoppingAi.ts ----
// (duplicated here deliberately so this test never imports the Anthropic
// SDK, which would attempt a real network call as soon as `new Anthropic()`
// is constructed with no key present.)

function validateMenuItems(parsedItems) {
  const validCourses = new Set(MENU_COURSES);
  const validSources = new Set(MENU_SOURCES);
  return parsedItems
    .filter((i) => i && typeof i.itemName === "string" && i.itemName.trim())
    .map((i) => ({
      course: validCourses.has(i.course) ? i.course : "Other",
      itemName: String(i.itemName).trim().slice(0, 120),
      source: validSources.has(i.source) ? i.source : "Homemade",
      servesCount: Math.max(0, Math.round(Number(i.servesCount) || 0)),
      costEstimate: Math.max(0, Math.round(Number(i.costEstimate) || 0)),
      dietaryTags: typeof i.dietaryTags === "string" ? i.dietaryTags.trim().slice(0, 120) : "",
      notes: typeof i.notes === "string" ? i.notes.trim().slice(0, 200) : "",
    }))
    .slice(0, 15);
}

function validateShoppingItems(parsedItems) {
  const validCategories = new Set(SHOPPING_CATEGORIES);
  return parsedItems
    .filter((i) => i && typeof i.itemName === "string" && i.itemName.trim())
    .map((i) => ({
      category: validCategories.has(i.category) ? i.category : "Setup Tools",
      itemName: String(i.itemName).trim().slice(0, 120),
      quantity: typeof i.quantity === "string" ? i.quantity.trim().slice(0, 60) : "",
      estimatedCost: Math.max(0, Math.round(Number(i.estimatedCost) || 0)),
      notes: typeof i.notes === "string" ? i.notes.trim().slice(0, 200) : "",
    }))
    .slice(0, 20);
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.log("FAIL:", msg);
  }
}

// --- menuAi validation cases ---
const menuCases = [
  {
    name: "well-formed response",
    input: [{ course: "Main Course", itemName: "Taco bar", source: "Homemade", servesCount: 20, costEstimate: 80, dietaryTags: "vegetarian option", notes: "" }],
    expect: (out) => out.length === 1 && out[0].course === "Main Course" && out[0].source === "Homemade" && out[0].costEstimate === 80,
  },
  {
    name: "invalid course/source fall back",
    input: [{ course: "Snacks!!", itemName: "Chips", source: "Magic", servesCount: 10, costEstimate: 15 }],
    expect: (out) => out[0].course === "Other" && out[0].source === "Homemade",
  },
  {
    name: "negative/decimal costs and counts get clamped/rounded",
    input: [{ course: "Dessert", itemName: "Cake", source: "Store-bought", servesCount: -5, costEstimate: 39.7 }],
    expect: (out) => out[0].servesCount === 0 && out[0].costEstimate === 40,
  },
  {
    name: "non-numeric cost falls back to 0",
    input: [{ course: "Drinks & Bar", itemName: "Lemonade", source: "Homemade", servesCount: 20, costEstimate: "a lot" }],
    expect: (out) => out[0].costEstimate === 0,
  },
  {
    name: "items with blank itemName are dropped",
    input: [{ course: "Other", itemName: "   ", source: "Homemade", servesCount: 5, costEstimate: 5 }, { course: "Sides", itemName: "Chips & salsa", source: "Store-bought", servesCount: 20, costEstimate: 20 }],
    expect: (out) => out.length === 1 && out[0].itemName === "Chips & salsa",
  },
  {
    name: "more than 15 items gets sliced",
    input: Array.from({ length: 20 }, (_, i) => ({ course: "Other", itemName: `Item ${i}`, source: "Homemade", servesCount: 1, costEstimate: 1 })),
    expect: (out) => out.length === 15,
  },
  {
    name: "itemName longer than 120 chars is truncated",
    input: [{ course: "Other", itemName: "x".repeat(200), source: "Homemade", servesCount: 1, costEstimate: 1 }],
    expect: (out) => out[0].itemName.length === 120,
  },
];

for (const c of menuCases) {
  const out = validateMenuItems(c.input);
  assert(c.expect(out), `menu case "${c.name}" failed. Got: ${JSON.stringify(out)}`);
}

// --- shoppingAi validation cases ---
const shoppingCases = [
  {
    name: "well-formed response",
    input: [{ category: "Décor", itemName: "Balloon arch", quantity: "1", estimatedCost: 25, notes: "" }],
    expect: (out) => out.length === 1 && out[0].category === "Décor" && out[0].estimatedCost === 25,
  },
  {
    name: "invalid category falls back to Setup Tools",
    input: [{ category: "Miscellaneous Stuff", itemName: "Extension cord", quantity: "2", estimatedCost: 10 }],
    expect: (out) => out[0].category === "Setup Tools",
  },
  {
    name: "negative cost clamped to 0",
    input: [{ category: "Cleanup Supplies", itemName: "Trash bags", quantity: "1 box", estimatedCost: -5 }],
    expect: (out) => out[0].estimatedCost === 0,
  },
  {
    name: "more than 20 items gets sliced",
    input: Array.from({ length: 30 }, (_, i) => ({ category: "Setup Tools", itemName: `Item ${i}`, quantity: "1", estimatedCost: 1 })),
    expect: (out) => out.length === 20,
  },
  {
    name: "non-string quantity falls back to empty string",
    input: [{ category: "Guest Supplies", itemName: "Napkins", quantity: 42, estimatedCost: 5 }],
    expect: (out) => out[0].quantity === "",
  },
];

for (const c of shoppingCases) {
  const out = validateShoppingItems(c.input);
  assert(c.expect(out), `shopping case "${c.name}" failed. Got: ${JSON.stringify(out)}`);
}

// --- enum sanity: every allowed course/source/category actually validates as itself ---
for (const course of MENU_COURSES) {
  const out = validateMenuItems([{ course, itemName: "x", source: "Homemade", servesCount: 1, costEstimate: 1 }]);
  assert(out[0].course === course, `course "${course}" should pass through unchanged`);
}
for (const source of MENU_SOURCES) {
  const out = validateMenuItems([{ course: "Other", itemName: "x", source, servesCount: 1, costEstimate: 1 }]);
  assert(out[0].source === source, `source "${source}" should pass through unchanged`);
}
for (const category of SHOPPING_CATEGORIES) {
  const out = validateShoppingItems([{ category, itemName: "x", quantity: "1", estimatedCost: 1 }]);
  assert(out[0].category === category, `category "${category}" should pass through unchanged`);
}

console.log(`\nMock validation checks complete. Failures: ${failures}`);
if (failures > 0) process.exit(1);
