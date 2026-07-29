// Minimal, deliberately batched real-AI-call test for menuAi.ts and
// shoppingAi.ts. Kept to 2 scenarios (4 total AI calls: 2 menu + 2 chained
// shopping) per credit-conservation — enough to sanity check course/source/
// category enum handling and cost/quantity scaling across a small and a
// large event, without repeated one-off exploratory calls.
import { generateMenuAi } from "../server/menuAi.ts";
import { generateShoppingAi } from "../server/shoppingAi.ts";
import { MENU_COURSES, MENU_SOURCES, SHOPPING_CATEGORIES } from "../shared/schema.ts";

const scenarios = [
  {
    eventName: "Mia's 8th Birthday",
    eventType: "Birthday Party",
    themeName: "Under the Sea",
    vibeDescription: "Casual backyard bash for a bunch of kids and a few parents",
    guestCount: 20,
  },
  {
    eventName: "Sarah & Tom's Wedding",
    eventType: "Wedding",
    themeName: "Elegant Garden Wedding",
    vibeDescription: "",
    guestCount: 120,
  },
];

function checkMenu(scenario, menu) {
  const validCourses = new Set(MENU_COURSES);
  const validSources = new Set(MENU_SOURCES);
  const problems = [];
  if (!Array.isArray(menu.items) || menu.items.length === 0) problems.push("no items returned");
  for (const item of menu.items) {
    if (!validCourses.has(item.course)) problems.push(`invalid course: ${item.course}`);
    if (!validSources.has(item.source)) problems.push(`invalid source: ${item.source}`);
    if (!Number.isInteger(item.costEstimate) || item.costEstimate < 0) problems.push(`bad costEstimate for ${item.itemName}: ${item.costEstimate}`);
    if (!Number.isInteger(item.servesCount) || item.servesCount < 0) problems.push(`bad servesCount for ${item.itemName}: ${item.servesCount}`);
  }
  console.log(`\n=== MENU: ${scenario.eventName} (${scenario.guestCount} guests) ===`);
  console.table(menu.items.map((i) => ({ course: i.course, itemName: i.itemName, source: i.source, servesCount: i.servesCount, costEstimate: i.costEstimate, dietaryTags: i.dietaryTags })));
  console.log("Tip:", menu.tip);
  console.log(problems.length ? `PROBLEMS: ${problems.join(" | ")}` : "Shape checks: OK");
  return problems;
}

function checkShopping(scenario, shopping) {
  const validCategories = new Set(SHOPPING_CATEGORIES);
  const problems = [];
  if (!Array.isArray(shopping.items) || shopping.items.length === 0) problems.push("no items returned");
  for (const item of shopping.items) {
    if (!validCategories.has(item.category)) problems.push(`invalid category: ${item.category}`);
    if (!Number.isInteger(item.estimatedCost) || item.estimatedCost < 0) problems.push(`bad estimatedCost for ${item.itemName}: ${item.estimatedCost}`);
  }
  console.log(`\n=== SHOPPING: ${scenario.eventName} (${scenario.guestCount} guests) ===`);
  console.table(shopping.items.map((i) => ({ category: i.category, itemName: i.itemName, quantity: i.quantity, estimatedCost: i.estimatedCost })));
  console.log("Tip:", shopping.tip);
  console.log(problems.length ? `PROBLEMS: ${problems.join(" | ")}` : "Shape checks: OK");
  return problems;
}

let allProblems = [];
for (const scenario of scenarios) {
  const menu = await generateMenuAi(scenario);
  allProblems = allProblems.concat(checkMenu(scenario, menu));

  const shopping = await generateShoppingAi({
    eventName: scenario.eventName,
    eventType: scenario.eventType,
    themeName: scenario.themeName,
    guestCount: scenario.guestCount,
    menuItems: menu.items.map((i) => ({ course: i.course, itemName: i.itemName })),
  });
  allProblems = allProblems.concat(checkShopping(scenario, shopping));
}

console.log(`\n\nTOTAL PROBLEMS: ${allProblems.length}`);
if (allProblems.length > 0) process.exit(1);
