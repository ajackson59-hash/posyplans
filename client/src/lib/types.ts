export type RsvpStatus = "pending" | "yes" | "no" | "maybe";

export interface EventRecord {
  id: number;
  ownerToken?: string;
  shareSlug: string;
  eventName: string;
  eventType: string;
  eventDate: string;
  location: string;
  hostNames: string;
  themeName: string;
  paletteColors: string;
  inviteSubject: string;
  inviteMessage: string;
  inviteArtworkUrl: string;
  inviteFontFamily: string;
  inviteAccentColor: string;
  inviteDesignConceptJson: string;
  inviteIllustrationUrl: string;
  // Full-custom invite: a finished design used as-is, with no Posy styling.
  // inviteRenderMode === "custom" activates it; "" (or absent, for events
  // created before this feature) keeps today's concept-driven rendering.
  customInviteImageUrl?: string;
  inviteRenderMode?: string;
  // Coordinated design suite (see shared/themeDna.ts). Empty/absent means
  // "derive from the applied concept" — pre-existing events are unaffected.
  envelopeColor?: string;
  envelopeLinerPattern?: string;
  stampStyle?: string;
  linerColor?: string;
  stampColor?: string;
  inviteStatus?: string;
  rsvpPhone?: string;
  budgetTotal: number | null;
  venueName: string;
  venueAddress: string;
  venueCapacity: number | null;
  venueContactName: string;
  venueContactPhone: string;
  rsvpRestriction: RsvpRestriction;
  rsvpDeadline: string;
  createdAt: number;
  // AI Master Planner: intake + draft lifecycle
  estimatedGuestCount: number | null;
  budgetCeiling: number | null;
  vibeDescription: string;
  eventIdentity: string;
  draftStatus: "none" | "generating" | "ready" | "failed_partial";
  draftStage: string | null;
  capturedEmail: string | null;
  emailCapturedAt: number | null;
}

export type RsvpRestriction = "none" | "no_children" | "plus_one" | "no_additional_guests";

export const RSVP_RESTRICTION_OPTIONS: { value: RsvpRestriction; label: string; description: string }[] = [
  { value: "none", label: "Adults and children", description: "Guests can respond for the party size on their invitation." },
  { value: "plus_one", label: "Plus-one allowed", description: "Guests can respond for up to two people, within their invitation's party size." },
  { value: "no_children", label: "No children", description: "Adults only, up to the party size on each invitation." },
  { value: "no_additional_guests", label: "No additional guests", description: "Guests can only RSVP for themselves." },
];

export interface GuestRecord {
  id: number;
  eventId: number;
  accessToken: string;
  name: string;
  email: string;
  phone: string;
  group: string;
  partySize: number;
  rsvpStatus: RsvpStatus;
  attendingCount: number | null;
  attendingAdults: number | null;
  attendingChildren: number | null;
  note: string;
  invitedAt: number | null;
  respondedAt: number | null;
  emailSentAt: number | null;
  emailSendError: string | null;
  smsOptIn: boolean;
  smsConsentAt: number | null;
  smsSentAt: number | null;
  smsSendError: string | null;
}

export interface BudgetItemRecord {
  id: number;
  eventId: number;
  category: string;
  name: string;
  estimatedCost: number;
  actualCost: number | null;
  depositPaid: number;
  isPaidInFull: boolean;
  vendor: string;
  notes: string;
  sortOrder: number;
}

export interface MenuItemRecord {
  id: number;
  eventId: number;
  course: string;
  itemName: string;
  source: string;
  servesCount: number | null;
  costEstimate: number;
  dietaryTags: string;
  notes: string;
  sortOrder: number;
}

export const BUDGET_CATEGORIES = [
  "Venue",
  "Food & Beverage",
  "Décor",
  "Entertainment",
  "Rentals",
  "Photography",
  "Favors & Gifts",
  "Attire",
  "Other",
];

export const MENU_COURSES = [
  "Appetizers",
  "Main Course",
  "Sides",
  "Dessert",
  "Drinks & Bar",
  "Cake",
  "Other",
];

export const MENU_SOURCES = [
  "Caterer",
  "Store-bought",
  "Homemade",
  "Potluck / guests bringing",
  "Restaurant delivery",
  "Other",
];

export interface ShoppingListItemRecord {
  id: number;
  eventId: number;
  category: string;
  itemName: string;
  quantity: string;
  status: "need" | "have" | "borrowing";
  estimatedCost: number;
  source: string;
  notes: string;
  isPacked: boolean;
  sortOrder: number;
}

export const SHOPPING_CATEGORIES = [
  "Décor",
  "Food & Beverages",
  "Serving Supplies",
  "Guest Supplies",
  "Bathroom Essentials",
  "Entertainment",
  "Emergency Supplies",
  "Setup Tools",
  "Cleanup Supplies",
  "Take-Home Items",
];

export const PROCUREMENT_STATUSES: { value: "need" | "have" | "borrowing"; label: string }[] = [
  { value: "need", label: "Need to get" },
  { value: "have", label: "Already have" },
  { value: "borrowing", label: "Borrowing" },
];

// A curated "resource" of commonly forgotten items, grouped by category.
// Since no algorithm can know exactly what a specific event needs, this gives
// every planner a real starting checklist they can one-click add to their list
// instead of staring at a blank page — covering the classic overlooked basics
// (scissors, tape, lighters, extension cords, phone chargers, trash bags, etc.).
export const SUGGESTED_SHOPPING_ITEMS: Record<string, string[]> = {
  "Décor": ["Welcome sign", "Balloons", "Tablecloths", "Centerpieces", "String lights", "Banner / backdrop"],
  "Food & Beverages": ["Ice", "Bottled water", "Coffee & creamer", "Extra napkins", "Condiments"],
  "Serving Supplies": ["Cake knife & server", "Serving utensils", "Chafing dishes", "Food-storage containers (leftovers)", "Coolers"],
  "Guest Supplies": ["Guest book", "Party favors", "Name tags / place cards", "Phone charging station", "Umbrellas (in case of rain)"],
  "Bathroom Essentials": ["Extra toilet paper", "Hand soap", "Paper towels", "Air freshener", "Small trash can liner"],
  "Entertainment": ["Speaker / music playlist", "Games or activities", "Photo booth props", "Lawn games"],
  "Emergency Supplies": ["First-aid kit", "Pain relievers", "Stain remover", "Sunscreen", "Bug spray", "Extra phone chargers"],
  "Setup Tools": ["Scissors", "Tape (packing & double-sided)", "Extension cords", "Lighters / matches", "Zip ties", "Step ladder"],
  "Cleanup Supplies": ["Trash bags", "Paper towels", "Disinfecting wipes", "Broom / dustpan", "Recycling bags"],
  "Take-Home Items": ["Leftover food containers", "Gift table cart", "Extra favors box", "Décor storage bins"],
};

export interface TimelineItemRecord {
  id: number;
  eventId: number;
  time: string;
  title: string;
  category: string;
  assignedTo: string;
  notes: string;
  isDone: boolean;
  sortOrder: number;
}

export const TIMELINE_CATEGORIES = [
  "Setup",
  "Arrival",
  "Activities",
  "Food & Toasts",
  "Special Moments",
  "Wind Down",
  "Cleanup",
];

export const EVENT_TYPES = [
  "Birthday Party",
  "Baby Shower",
  "Wedding",
  "Bridal Shower",
  "Graduation",
  "Anniversary",
  "Holiday Gathering",
  "Housewarming",
  "Corporate Event",
  "Other Celebration",
];

export interface ThemeMenuIdea {
  course: string;
  itemName: string;
  notes?: string;
}

export interface ThemeShoppingIdea {
  category: string;
  itemName: string;
}

export interface ThemeTimelineIdea {
  time: string;
  title: string;
}

export interface ThemeSuggestion {
  theme: string;
  source: "curated" | "ai" | "resource-only";
  paletteColors: string[];
  menuIdeas: ThemeMenuIdea[];
  shoppingIdeas: ThemeShoppingIdea[];
  timelineIdeas: ThemeTimelineIdea[];
  budgetTip: string;
  resourceUrl: string;
  error?: string;
}

export interface BudgetSuggestionItem {
  category: string;
  name: string;
  estimatedCost: number;
}

export interface BudgetSuggestion {
  items: BudgetSuggestionItem[];
  suggestedTotal: number;
  tip: string;
  error?: string;
}

// A short list of popular themes to show as one-click suggestions in the
// theme picker — the full curated library on the server covers many more
// (including anything typed that matches, like "hole in one" for golf).
export const POPULAR_THEME_PICKS = [
  "Golf / Hole in One",
  "Superhero",
  "Princess / Fairy Tale",
  "Under the Sea / Mermaid",
  "Dinosaur",
  "Safari / Jungle",
  "Space / Astronaut",
  "Unicorn & Rainbow",
  "Construction / Dump Truck",
  "Sports (All-Star)",
  "Beach / Tropical Luau",
  "Rustic Farmhouse",
  "Enchanted Garden / Floral",
  "Western / Cowboy",
  "Vintage / Retro",
  "Circus / Carnival",
  "Casino Night",
  "Movie Night / Hollywood",
  "Holiday / Winter Wonderland",
  "Halloween / Spooky",
  "Tea Party",
];

export interface TimelineTemplateItem {
  time: string;
  title: string;
  category: string;
}

// Curated run-of-show templates per event type so a host never starts from a
// blank page. Times are relative markers (not clock times) since events don't
// have a fixed start-time field -- the host edits them to real times after
// adding, or leaves them as a rough order-of-operations guide.
export const SUGGESTED_TIMELINE_TEMPLATES: Record<string, TimelineTemplateItem[]> = {
  "Birthday Party": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests start arriving", category: "Arrival" },
    { time: "+30 min", title: "Games / activities", category: "Activities" },
    { time: "+1 hr", title: "Serve food", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Sing happy birthday & cut cake", category: "Special Moments" },
    { time: "+2 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Party favors & goodbyes", category: "Wind Down" },
    { time: "After", title: "Breakdown & cleanup", category: "Cleanup" },
  ],
  "Baby Shower": [
    { time: "1 hr before", title: "Decorate & set up food/drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive & mingle", category: "Arrival" },
    { time: "+30 min", title: "Games (guess the baby food, etc.)", category: "Activities" },
    { time: "+1 hr", title: "Serve food & cake", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Thank-you & favors", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Wedding": [
    { time: "3 hr before", title: "Vendors arrive & set up (florist, caterer, DJ)", category: "Setup" },
    { time: "1 hr before", title: "Guests arrive & are seated", category: "Arrival" },
    { time: "Start time", title: "Ceremony", category: "Special Moments" },
    { time: "+30 min", title: "Cocktail hour / photos", category: "Activities" },
    { time: "+1.5 hr", title: "Reception entrance", category: "Arrival" },
    { time: "+2 hr", title: "Dinner served", category: "Food & Toasts" },
    { time: "+2.5 hr", title: "Toasts & speeches", category: "Special Moments" },
    { time: "+3 hr", title: "First dance", category: "Special Moments" },
    { time: "+3.5 hr", title: "Cake cutting", category: "Special Moments" },
    { time: "+4 hr", title: "Open dancing", category: "Activities" },
    { time: "End time", title: "Send-off (sparklers, bubbles, etc.)", category: "Wind Down" },
    { time: "After", title: "Vendor breakdown & venue cleanup", category: "Cleanup" },
  ],
  "Bridal Shower": [
    { time: "1 hr before", title: "Decorate & set up food/drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive & mingle", category: "Arrival" },
    { time: "+30 min", title: "Games / advice cards for the bride", category: "Activities" },
    { time: "+1 hr", title: "Serve food & drinks", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Thank-you & favors", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Graduation": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Serve food", category: "Food & Toasts" },
    { time: "+1 hr", title: "Toast to the graduate", category: "Special Moments" },
    { time: "+1.5 hr", title: "Photos & mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Anniversary": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Dinner served", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Toasts, speeches / slideshow", category: "Special Moments" },
    { time: "+2 hr", title: "Dancing / mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Holiday Gathering": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+45 min", title: "Food served (potluck / buffet)", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Gift exchange / games", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Housewarming": [
    { time: "1 hr before", title: "Set up food & drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive, house tour", category: "Arrival" },
    { time: "+45 min", title: "Food & drinks served", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Corporate Event": [
    { time: "2 hr before", title: "AV/tech check & room setup", category: "Setup" },
    { time: "Start time", title: "Registration / check-in", category: "Arrival" },
    { time: "+15 min", title: "Welcome remarks", category: "Special Moments" },
    { time: "+30 min", title: "Main program / presentations", category: "Activities" },
    { time: "+1.5 hr", title: "Meal / networking break", category: "Food & Toasts" },
    { time: "End time", title: "Closing remarks", category: "Wind Down" },
    { time: "After", title: "Breakdown & load-out", category: "Cleanup" },
  ],
  "Other Celebration": [
    { time: "1 hr before", title: "Decorate & set up", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Main activity", category: "Activities" },
    { time: "+1 hr", title: "Food & drinks served", category: "Food & Toasts" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
};
