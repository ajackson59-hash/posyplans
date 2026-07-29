import { generateTimeline } from "../shared/timelineGenerator.ts";

const eventTypes = [
  "Birthday Party", "Baby Shower", "Wedding", "Bridal Shower", "Graduation",
  "Anniversary", "Holiday Gathering", "Housewarming", "Corporate Event",
  "Other Celebration", "Some Unknown Type",
];
const guestCounts = [0, 10, 25, 26, 60, 61, 75, 76, 100, 101, 250];
const cakeOptions = [false, true];

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log("FAIL:", msg);
  }
}

for (const eventType of eventTypes) {
  for (const guestCount of guestCounts) {
    for (const hasCakeMenuItem of cakeOptions) {
      const items = generateTimeline({ eventType, guestCount, hasCakeMenuItem });

      // Basic shape checks
      assert(Array.isArray(items) && items.length > 0, `${eventType}/${guestCount}/${hasCakeMenuItem}: non-empty array`);
      items.forEach((item, i) => {
        assert(typeof item.time === "string" && item.time.length > 0, `${eventType}: item ${i} has time`);
        assert(typeof item.title === "string" && item.title.length > 0, `${eventType}: item ${i} has title`);
        assert(typeof item.category === "string" && item.category.length > 0, `${eventType}: item ${i} has category`);
        assert(item.sortOrder === i, `${eventType}: item ${i} sortOrder matches index (got ${item.sortOrder})`);
      });

      // Setup buffer scaling checks
      const setupItem = items.find((i) => i.category === "Setup");
      if (setupItem) {
        const match = setupItem.time.match(/^([\d.]+) hr before$/);
        if (match) {
          const hours = parseFloat(match[1]);
          if (guestCount > 100) assert(hours >= 3, `${eventType}/${guestCount}: setup >=3hr, got ${hours}`);
          else if (guestCount > 60) assert(hours >= 2, `${eventType}/${guestCount}: setup >=2hr, got ${hours}`);
          else if (guestCount > 25) assert(hours >= 1.5, `${eventType}/${guestCount}: setup >=1.5hr, got ${hours}`);
        }
      }

      // Staggered arrival checks
      const hasStaggered = items.some((i) => i.title.includes("staggered"));
      if (guestCount > 75) {
        assert(hasStaggered, `${eventType}/${guestCount}: expected staggered-arrival item`);
      } else {
        assert(!hasStaggered, `${eventType}/${guestCount}: unexpected staggered-arrival item`);
      }

      // Cake cutting checks
      const cakeItems = items.filter((i) => i.title.toLowerCase().includes("cake"));
      if (hasCakeMenuItem) {
        assert(cakeItems.length >= 1, `${eventType}/${guestCount}: expected at least one cake mention when hasCakeMenuItem=true`);
      }
      // "Baby Shower" already says "Serve food & cake" in its own base
      // template text, same as Wedding/Birthday's built-in cake moments.
      const templatesWithBuiltInCakeMention = ["Wedding", "Birthday Party", "Baby Shower"];
      if (!templatesWithBuiltInCakeMention.includes(eventType) && !hasCakeMenuItem) {
        assert(cakeItems.length === 0, `${eventType}/${guestCount}: unexpected cake mention with no cake menu item`);
      }
      // Never double up: templates that already mention cake should never get a second one
      if (templatesWithBuiltInCakeMention.includes(eventType)) {
        assert(cakeItems.length === 1, `${eventType}/${guestCount}/cake=${hasCakeMenuItem}: exactly one cake mention expected, got ${cakeItems.length}`);
      }

      // Never mutate/skip categories entirely
      assert(items.some((i) => i.category === "Cleanup"), `${eventType}: has a Cleanup item`);
    }
  }
}

console.log(`Ran ${checks} checks across ${eventTypes.length * guestCounts.length * cakeOptions.length} scenarios. Failures: ${failures}`);
if (failures > 0) process.exit(1);
