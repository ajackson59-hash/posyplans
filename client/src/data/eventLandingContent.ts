export interface TimelineStep {
  label: string;
  detail: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface EventLandingContent {
  slug: string;
  eventName: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  checklistTitle: string;
  checklist: string[];
  timelineTitle: string;
  timeline: TimelineStep[];
  faqTitle: string;
  faq: FaqItem[];
  ctaHeadline: string;
  ctaSubhead: string;
}

export const EVENT_LANDING_CONTENT: Record<string, EventLandingContent> = {
  "baby-shower": {
    slug: "baby-shower-planning",
    eventName: "Baby Shower",
    metaTitle: "Baby Shower Planning Checklist & Timeline | Posy",
    metaDescription:
      "A calm, complete baby shower planning checklist and timeline. Tell Posy the basics once, and get a guest list, invitations, budget, and schedule that stay connected.",
    eyebrow: "BABY SHOWER PLANNING",
    headline: "Everything a baby shower needs, without the spreadsheet.",
    subhead:
      "Tell Posy the date, the guest count, and the feeling you're going for. Posy Concierge turns it into a timeline, a checklist, and a guest list that stays organized on its own.",
    checklistTitle: "The baby shower checklist",
    checklist: [
      "Pick a date and a backup date",
      "Build the guest list and collect mailing addresses",
      "Choose a theme and color palette",
      "Send invitations with RSVP tracking built in",
      "Plan the menu around dietary notes",
      "Set a budget and track it as you spend",
      "Plan games or activities (optional)",
      "Arrange favors and thank-you notes",
    ],
    timelineTitle: "A typical baby shower timeline",
    timeline: [
      {
        label: "6–8 weeks before",
        detail: "Set the date, guest list, and theme. Send save-the-dates if guests are traveling in.",
      },
      { label: "4 weeks before", detail: "Send invitations and start tracking RSVPs." },
      { label: "2 weeks before", detail: "Finalize headcount, confirm the menu, and settle any rentals." },
      { label: "1 week before", detail: "Confirm final numbers with the venue or caterer, and prep favors." },
      { label: "Day of", detail: "Everything's already decided — you just get to be there." },
    ],
    faqTitle: "Baby shower planning, answered",
    faq: [
      {
        q: "How far in advance should I plan a baby shower?",
        a: "Six to eight weeks gives enough room for invitations, RSVPs, and any custom orders. Posy can help even if you're starting closer to the date than that.",
      },
      {
        q: "Can Posy help if I don't know where to start?",
        a: "Yes. Tell Posy the basics in one sentence, and it builds a first draft you can edit from there — nothing has to be decided all at once.",
      },
      {
        q: "Does Posy track RSVPs automatically?",
        a: "Yes. Invitations and RSVP tracking are connected, so your guest count updates as responses come in — no separate spreadsheet to reconcile.",
      },
    ],
    ctaHeadline: "Tell Posy about the shower. See the plan in minutes.",
    ctaSubhead: "Free to begin. No pressure, no clutter.",
  },

  birthday: {
    slug: "birthday-party-planning",
    eventName: "Birthday Party",
    metaTitle: "Birthday Party Planning Checklist & Timeline | Posy",
    metaDescription:
      "Plan a birthday party without juggling five apps. Posy builds a connected guest list, invitations, timeline, and budget from one conversation.",
    eyebrow: "BIRTHDAY PARTY PLANNING",
    headline: "A birthday party plan that keeps up with you.",
    subhead:
      "Whatever the age and whatever the theme, tell Posy once and get a connected plan — timeline, guest list, budget, and invitations that track their own RSVPs.",
    checklistTitle: "The birthday party checklist",
    checklist: [
      "Pick a date, time, and venue",
      "Choose a theme",
      "Build the guest list",
      "Send invitations with RSVP tracking",
      "Plan food and cake",
      "Set and track your budget",
      "Plan activities or entertainment",
      "Prep favors or a thank-you follow-up",
    ],
    timelineTitle: "A typical birthday party timeline",
    timeline: [
      { label: "4–6 weeks before", detail: "Set the date, theme, and venue. Start the guest list." },
      { label: "2–3 weeks before", detail: "Send invitations and begin collecting RSVPs." },
      { label: "1 week before", detail: "Confirm headcount, order the cake, and finalize activities." },
      { label: "2–3 days before", detail: "Confirm any rentals or deliveries." },
      { label: "Day of", detail: "Everything's mapped out — just show up and enjoy it." },
    ],
    faqTitle: "Birthday party planning, answered",
    faq: [
      {
        q: "Does Posy work for kids' parties and adult parties?",
        a: "Yes — the same connected planning approach works for a first birthday or a milestone adult celebration. Posy adapts the checklist to what you tell it.",
      },
      {
        q: "Can I change the plan after Posy creates it?",
        a: "Always. Edit any part of it directly — the first draft is a starting point, not a final answer.",
      },
      {
        q: "What if I'm planning close to the date?",
        a: "Posy can still help. The checklist and timeline compress automatically around whatever date you give it.",
      },
    ],
    ctaHeadline: "Tell Posy about the party. See the plan in minutes.",
    ctaSubhead: "Free to begin. No pressure, no clutter.",
  },

  graduation: {
    slug: "graduation-party-planning",
    eventName: "Graduation Party",
    metaTitle: "Graduation Party Planning Guide & Checklist | Posy",
    metaDescription:
      "Plan a graduation party with a clear checklist, guest list, and timeline. Posy Concierge keeps the details connected so nothing gets missed.",
    eyebrow: "GRADUATION PARTY PLANNING",
    headline: "A graduation party plan that stays as organized as they are.",
    subhead:
      "Open house or sit-down celebration, tell Posy the basics and get a guest list, invitations, budget, and timeline that stay connected as things change.",
    checklistTitle: "The graduation party checklist",
    checklist: [
      "Pick a date that avoids other graduation conflicts",
      "Decide open house vs. seated celebration",
      "Build the guest list across family and friends",
      "Send invitations with RSVP tracking",
      "Plan catering or a potluck",
      "Set and track your budget",
      "Plan a photo area or memory display",
      "Arrange thank-you notes for gifts",
    ],
    timelineTitle: "A typical graduation party timeline",
    timeline: [
      { label: "6–8 weeks before", detail: "Set the date and format, and start the guest list before calendars fill up." },
      { label: "3–4 weeks before", detail: "Send invitations and begin tracking RSVPs." },
      { label: "1–2 weeks before", detail: "Finalize headcount and confirm catering or potluck contributions." },
      { label: "Few days before", detail: "Prep the photo area and confirm any rentals." },
      { label: "Day of", detail: "Everything's already decided — you just get to celebrate." },
    ],
    faqTitle: "Graduation party planning, answered",
    faq: [
      {
        q: "How do I plan around a busy graduation season?",
        a: "Set your date early and send invitations as soon as it's set — Posy's timeline adjusts automatically around whatever date you choose.",
      },
      {
        q: "Can Posy help with an open house format?",
        a: "Yes. Tell Posy it's an open house and the checklist adjusts — think flexible arrival windows and lighter catering instead of a seated meal.",
      },
      {
        q: "Does Posy help track who's bringing what for a potluck?",
        a: "Yes — assign dishes when you send invitations, and Posy keeps track of what's covered and what's still needed.",
      },
    ],
    ctaHeadline: "Tell Posy about the celebration. See the plan in minutes.",
    ctaSubhead: "Free to begin. No pressure, no clutter.",
  },

  "family-reunion": {
    slug: "family-reunion-planning",
    eventName: "Family Reunion",
    metaTitle: "Family Reunion Planning Guide & Checklist | Posy",
    metaDescription:
      "Coordinate a family reunion across households without losing track of details. Posy keeps the guest list, budget, and timeline connected in one place.",
    eyebrow: "FAMILY REUNION PLANNING",
    headline: "One connected plan for everyone coming together.",
    subhead:
      "Multiple households, multiple opinions, one plan. Tell Posy the basics and get a guest list, budget, and timeline that stay organized as RSVPs and details come in.",
    checklistTitle: "The family reunion checklist",
    checklist: [
      "Pick a date that works across households",
      "Choose a venue or location with enough space",
      "Build the guest list by household",
      "Send invitations with RSVP tracking",
      "Coordinate lodging or travel notes",
      "Plan food — potluck or catered",
      "Set and track a shared budget",
      "Plan activities for multiple generations",
    ],
    timelineTitle: "A typical family reunion timeline",
    timeline: [
      { label: "3–6 months before", detail: "Set the date and location, and give distant family enough notice to plan travel." },
      { label: "2 months before", detail: "Send invitations and start tracking RSVPs and lodging needs." },
      { label: "3–4 weeks before", detail: "Finalize headcount, food plan, and any assigned contributions." },
      { label: "1 week before", detail: "Confirm venue details and print any final schedules." },
      { label: "Day of", detail: "Everything's already coordinated — just enjoy being together." },
    ],
    faqTitle: "Family reunion planning, answered",
    faq: [
      {
        q: "How early should we plan a family reunion?",
        a: "Three to six months out gives family time to arrange travel, especially if people are flying in. Posy's timeline adjusts to whatever lead time you have.",
      },
      {
        q: "Can multiple people help plan without confusion?",
        a: "Yes — the plan lives in one place, so updates to the guest list, budget, or schedule stay in sync instead of living in someone's separate notes.",
      },
      {
        q: "Does Posy track RSVPs by household?",
        a: "Yes. Invitations and RSVPs are connected to your guest list, so headcounts stay accurate as each household responds.",
      },
    ],
    ctaHeadline: "Tell Posy about the reunion. See the plan in minutes.",
    ctaSubhead: "Free to begin. No pressure, no clutter.",
  },

  holiday: {
    slug: "holiday-party-planning",
    eventName: "Holiday Party",
    metaTitle: "Holiday Party Planning Checklist & Timeline | Posy",
    metaDescription:
      "Plan a holiday party without the seasonal scramble. Posy builds a connected checklist, guest list, and timeline in one calm place.",
    eyebrow: "HOLIDAY PARTY PLANNING",
    headline: "A holiday party plan that fits into a busy season.",
    subhead:
      "The calendar is already full. Tell Posy the basics once and get a guest list, invitations, budget, and timeline that stay organized without adding to the noise.",
    checklistTitle: "The holiday party checklist",
    checklist: [
      "Pick a date before the calendar fills up",
      "Decide the guest list — work, family, or friends",
      "Choose a theme or keep it simple",
      "Send invitations with RSVP tracking",
      "Plan food — potluck or catered",
      "Set and track your budget",
      "Plan a gift exchange, if you're doing one",
      "Arrange decor and any rentals",
    ],
    timelineTitle: "A typical holiday party timeline",
    timeline: [
      { label: "4–6 weeks before", detail: "Set the date early — holiday calendars fill up fast. Start the guest list." },
      { label: "2–3 weeks before", detail: "Send invitations and begin tracking RSVPs and dietary notes." },
      { label: "1 week before", detail: "Finalize headcount, confirm the menu, and organize any gift exchange." },
      { label: "2–3 days before", detail: "Confirm rentals or deliveries and prep decor." },
      { label: "Day of", detail: "Everything's already decided — you just get to enjoy it." },
    ],
    faqTitle: "Holiday party planning, answered",
    faq: [
      {
        q: "How do I plan a holiday party around a packed calendar?",
        a: "Set the date as early as you can and send invitations right away — Posy's timeline compresses automatically if you're starting later than ideal.",
      },
      {
        q: "Can Posy help coordinate a gift exchange?",
        a: "Yes — track who's participating and any spending limit alongside your guest list, so it's one less separate thread to manage.",
      },
      {
        q: "What if plans change close to the date?",
        a: "Edit any part of the plan directly, at any point — nothing about Posy's first draft is meant to be locked in.",
      },
    ],
    ctaHeadline: "Tell Posy about the party. See the plan in minutes.",
    ctaSubhead: "Free to begin. No pressure, no clutter.",
  },
};

export type EventLandingKey = keyof typeof EVENT_LANDING_CONTENT;
