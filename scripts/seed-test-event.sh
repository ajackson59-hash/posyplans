#!/usr/bin/env bash
# One-shot test-data seed script.
#
# Creates a single fresh test event and populates it with guests, budget
# items, menu items, shopping-list items, and timeline items in one command
# via the existing REST API — no AI endpoints are called (no theme
# suggestions, no budget/invite AI generation, no illustration generation),
# so this script never costs anything and never needs an LLM credential.
#
# Usage:
#   BASE_URL=http://127.0.0.1:5000 ./scripts/seed-test-event.sh
#
# BASE_URL defaults to the local dev/production server address.
#
# On success, prints the event's ownerToken, shareSlug, and ready-to-open
# dashboard URL (hash-routed, per the app's routing setup).

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required (used to parse JSON responses)" >&2; exit 1; }

json_get() {
  # Usage: echo "$json" | json_get key
  python3 -c "import sys, json; print(json.load(sys.stdin)['$1'])"
}

echo "Seeding a test event against ${BASE_URL} ..."

EVENT_JSON=$(curl -sS -X POST "${BASE_URL}/api/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventName": "Seed Script Test Party",
    "eventType": "Birthday",
    "eventDate": "Saturday, September 12",
    "location": "Backyard, 123 Maple St",
    "hostNames": "Test Host",
    "themeName": "Rustic Kraft Paper",
    "budgetTotal": 900,
    "rsvpDeadline": "September 1"
  }')

OWNER_TOKEN=$(echo "$EVENT_JSON" | json_get ownerToken)
SHARE_SLUG=$(echo "$EVENT_JSON" | json_get shareSlug)

echo "Created event. ownerToken=${OWNER_TOKEN} shareSlug=${SHARE_SLUG}"

# --- Guests (no bulk endpoint exists for guests, so loop individual POSTs) ---
echo "Adding guests..."
GUESTS='[
  {"name":"Alex Rivera","email":"alex.rivera@example.com","phone":"555-0101","group":"Family","partySize":2},
  {"name":"Jamie Chen","email":"jamie.chen@example.com","phone":"555-0102","group":"Work friends","partySize":1},
  {"name":"Morgan Lee","email":"morgan.lee@example.com","phone":"555-0103","group":"Family","partySize":3},
  {"name":"Taylor Brooks","email":"taylor.brooks@example.com","phone":"555-0104","group":"Neighbors","partySize":2},
  {"name":"Sam Patel","email":"sam.patel@example.com","phone":"555-0105","group":"Work friends","partySize":1}
]'
echo "$GUESTS" | python3 -c "
import sys, json
for g in json.load(sys.stdin):
    print(json.dumps(g))
" | while IFS= read -r guest; do
  curl -sS -X POST "${BASE_URL}/api/events/owner/${OWNER_TOKEN}/guests" \
    -H "Content-Type: application/json" \
    -d "$guest" >/dev/null
done

# --- Budget items (bulk endpoint) ---
echo "Adding budget items..."
curl -sS -X POST "${BASE_URL}/api/events/owner/${OWNER_TOKEN}/budget-items/bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"category": "Venue", "name": "Backyard setup rental", "estimatedCost": 150, "vendor": "Self-hosted"},
      {"category": "Food & Beverage", "name": "Catering", "estimatedCost": 350, "vendor": "Local Catering Co"},
      {"category": "Décor", "name": "Balloons and banners", "estimatedCost": 80, "vendor": "Party City"},
      {"category": "Entertainment", "name": "DJ / playlist speaker rental", "estimatedCost": 100, "vendor": ""},
      {"category": "Photography", "name": "Friend with a good camera", "estimatedCost": 0, "vendor": ""}
    ]
  }' >/dev/null

# --- Menu items (bulk endpoint) ---
echo "Adding menu items..."
curl -sS -X POST "${BASE_URL}/api/events/owner/${OWNER_TOKEN}/menu-items/bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"course": "Appetizers", "itemName": "Cheese and charcuterie board", "source": "Store-bought", "costEstimate": 40},
      {"course": "Main Course", "itemName": "BBQ pulled pork sliders", "source": "Caterer", "costEstimate": 180},
      {"course": "Sides", "itemName": "Coleslaw and potato salad", "source": "Homemade", "costEstimate": 25},
      {"course": "Dessert", "itemName": "Birthday cake", "source": "Store-bought", "costEstimate": 60},
      {"course": "Drinks & Bar", "itemName": "Lemonade and iced tea station", "source": "Homemade", "costEstimate": 20}
    ]
  }' >/dev/null

# --- Shopping list items (bulk endpoint) ---
echo "Adding shopping-list items..."
curl -sS -X POST "${BASE_URL}/api/events/owner/${OWNER_TOKEN}/shopping-items/bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"category": "Décor", "itemName": "String lights", "quantity": "2 strands", "status": "have"},
      {"category": "Serving Supplies", "itemName": "Disposable plates and napkins", "quantity": "1 pack", "status": "need", "estimatedCost": 15},
      {"category": "Guest Supplies", "itemName": "Folding chairs", "quantity": "6", "status": "borrowing", "source": "Neighbor"},
      {"category": "Bathroom Essentials", "itemName": "Extra hand towels", "quantity": "4", "status": "have"},
      {"category": "Emergency Supplies", "itemName": "First aid kit", "quantity": "1", "status": "have"}
    ]
  }' >/dev/null

# --- Timeline items (bulk endpoint) ---
echo "Adding timeline items..."
curl -sS -X POST "${BASE_URL}/api/events/owner/${OWNER_TOKEN}/timeline-items/bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"time": "12:00 PM", "title": "Setup begins", "category": "Setup", "assignedTo": "Test Host"},
      {"time": "1:30 PM", "title": "Guests arrive", "category": "Arrival", "assignedTo": "Test Host"},
      {"time": "2:00 PM", "title": "Lunch served", "category": "Food & Toasts", "assignedTo": "Local Catering Co"},
      {"time": "3:00 PM", "title": "Cake and candles", "category": "Special Moments", "assignedTo": "Test Host"},
      {"time": "4:30 PM", "title": "Cleanup", "category": "Cleanup", "assignedTo": "Test Host"}
    ]
  }' >/dev/null

echo ""
echo "Done. Seeded event summary:"
echo "  ownerToken:  ${OWNER_TOKEN}"
echo "  shareSlug:   ${SHARE_SLUG}"
echo "  Dashboard:   ${BASE_URL}/#/dashboard/${OWNER_TOKEN}"
echo "  Public RSVP: ${BASE_URL}/#/rsvp/${SHARE_SLUG}"
