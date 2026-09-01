import Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import {
  aspectRatioForLayout,
  buildArtworkPrompt,
  type AiFirstConcept,
} from "@shared/aiFirstInvite";
import { OVERLAY_COVERAGE } from "@shared/aiFirstLayout";
import {
  DEFAULT_ARTWORK_MODEL,
  REFERENCE_ARTWORK_MODEL,
  generateArtwork,
  type ArtworkGenerator,
  type ArtworkModel,
  type ArtworkQuality,
  type ArtworkReferenceImage,
} from "./aiFirst/artwork";
import { buildEventBrief, type EventBrief } from "./aiFirst/brief";
import { buildArtworkConstraints, buildRetryPrompt } from "./aiFirst/prompt";
import {
  retryCodesFor,
  runTier1Checks,
  type Tier1Result,
} from "./aiFirst/tier1";
import {
  runVisionGate,
  type VisionVerdict,
} from "./aiFirst/visionGate";
import { prePaymentPreviewSourceBrief } from "./prePaymentPreviewConcept";

export const PREPAYMENT_PREVIEW_MODE_ENV = "POSY_PREPAYMENT_PREVIEW_MODE";
export const PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS = Date.UTC(2026, 7, 31, 2, 0, 0);

export type PrePaymentPreviewMode = "off" | "direction-card" | "quality-image";

/**
 * Fail closed. Until a benchmark explicitly enables quality-image, every
 * customer receives a deterministic proof-of-understanding card rather than
 * unreviewed generated artwork.
 */
export function readPrePaymentPreviewMode(
  env: Record<string, string | undefined> = process.env,
): PrePaymentPreviewMode {
  const value = env[PREPAYMENT_PREVIEW_MODE_ENV]?.trim().toLowerCase();
  if (value === "quality-image" || value === "off" || value === "direction-card") {
    return value;
  }
  return "direction-card";
}

export interface NamedCreativeReference {
  id: string;
  label: string;
  trigger: RegExp;
  cues: string[];
  palette: [string, string, string, string];
  requirements: string[];
}

const NAMED_REFERENCES: readonly NamedCreativeReference[] = [
  {
    id: "blippi-meekah",
    label: "Blippi + Meekah",
    trigger: /\b(?:blippi|blippy|blipi|meekah|mika)\b/i,
    cues: ["Blippi + Meekah", "Indoor soft play", "Bubbles", "Ice-cream treats"],
    palette: ["#17315C", "#FF7A00", "#F8F3E8", "#B79DE2"],
    requirements: [
      "Blippi is visibly identifiable as a full lead character through his blue-and-orange play-and-learn outfit, orange glasses and orange bow tie—not merely an isolated accessory or color palette",
      "Meekah is visibly identifiable as a distinct full co-host through her recognizable purple-and-orange visual identity—not a generic second adult",
      "Blippi and Meekah are both central to the same joyful event scene and visibly interact with the requested setting or activities",
    ],
  },
  {
    id: "unicorn-academy",
    label: "Unicorn Academy",
    trigger: /\bunicorn acad(?:emy|amy)\b/i,
    cues: ["Unicorn Academy", "Academy riders", "Bonded magical unicorns", "Winter snow-globe igloo"],
    palette: ["#4B356C", "#D5A93C", "#F7F1E8", "#AFCEF0"],
    requirements: [
      "The Unicorn Academy animated-series identity is unmistakable through recognizable academy riders and their distinct bonded magical unicorns—not generic children riding generic unicorns",
      "The rider-and-unicorn bonds are the central subject and the requested winter wonderland, glowing igloo and party-inside-a-snow-globe setting remain visibly present",
      "A generic unicorn party, fantasy horse scene or rainbow palette alone does not satisfy the requested named world",
    ],
  },
  {
    id: "kpop-demon-hunters",
    label: "KPop Demon Hunters",
    trigger: /\b(k[ -]?pop demon hunters?|huntr\/?x|rumi|mira|zoey|saja boys?)\b/i,
    cues: ["KPop Demon Hunters", "Heroine trio", "Performance energy", "Supernatural hunter details"],
    palette: ["#2A1748", "#E847A8", "#F7F1F6", "#55CBD2"],
    requirements: [
      "The recognizable KPop Demon Hunters heroine trio is visibly present as three distinct central characters",
      "Both K-pop performance energy and supernatural demon-hunting cues are unmistakably visible",
      "Generic pop stars, abstract neon or an unnamed girl group do not satisfy the requested identity",
    ],
  },
  {
    id: "paw-patrol",
    label: "PAW Patrol",
    trigger: /\bpaw patro(?:l|ll)\b/i,
    cues: ["PAW Patrol", "Rescue pups", "Adventure Bay energy", "Teamwork + celebration"],
    palette: ["#1D4F7A", "#E33B32", "#F3F0E8", "#F4C441"],
    requirements: [
      "The PAW Patrol identity is unmistakable through recognizable rescue pups with their distinct roles and gear—not generic puppies in colored hats",
      "The rescue-team world and the requested celebration are both visibly present",
    ],
  },
  {
    id: "bluey",
    label: "Bluey",
    trigger: /\bbluey\b/i,
    cues: ["Bluey", "Playful family energy", "Australian-home warmth", "Imaginative games"],
    palette: ["#245B87", "#4A90D9", "#F6EFE4", "#F1C66B"],
    requirements: [
      "The Bluey animated-series identity is unmistakable through the recognizable blue-heeler family world—not generic blue cartoon dogs",
      "The requested celebration remains visible rather than becoming an unrelated character portrait",
    ],
  },
];

/** Curated fast path only. Zero I/O, zero latency, unchanged behavior for these five. */
function detectCuratedNamedCreativeReference(text: string): NamedCreativeReference | null {
  for (const reference of NAMED_REFERENCES) {
    if (reference.trigger.test(text)) return reference;
  }
  return null;
}

export const NAMED_THEME_DETECTION_MODEL = "claude-sonnet-4-6";

const NAMED_THEME_DETECTION_SYSTEM = `You help a premium invitation studio understand whether a host's free-text event description names a SPECIFIC, identifiable entertainment property: a TV show, movie, streaming series, book series, video game, toy line, band/artist, or a named fictional character from one of those (e.g. "Sesame Street", "Cocomelon", "Frozen", "Spider-Man", "Pokemon", "Mickey Mouse", "Barbie", "Minecraft", "Taylor Swift"). This is different from a purely generic theme with no owned intellectual property (e.g. "unicorn party", "dinosaur party", "princess party", "jungle safari", "under the sea", "superhero party" with no named hero).

If, and only if, a specific named property or character is identifiable, respond with strict JSON only (no markdown fences, no commentary):
{"named": true, "label": "the real, correctly capitalized name of the show/movie/character/franchise", "cues": ["four short (2-4 word) visual cue phrases distinctive to this property"], "palette": ["#hex1", "#hex2", "#hex3", "#hex4"], "requirements": ["two or three sentences, each describing a concrete visual fact a reviewer could check for, phrased like: 'The <property> identity is unmistakable through <specific recognizable visual detail>—not a generic substitute.' Avoid vague phrases like 'themed' or 'inspired by'."]}

The four palette hex colors should be four DISTINCT colors that evoke this property's real, recognizable brand palette: [dominant/ink color, accent color, light paper/background color, soft secondary color].

If no specific named property is identifiable, respond with strict JSON only:
{"named": false}

Only ever output that one JSON object.`;

interface NamedThemeDetectionDependencies {
  client?: Anthropic;
}

interface LlmNamedThemeResult {
  named: boolean;
  label?: string;
  cues?: string[];
  palette?: string[];
  requirements?: string[];
}

function extractJsonObject(raw: string): Record<string, any> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_GENERIC_PALETTE: [string, string, string, string] = [
  "#445248", "#C9866B", "#F4EEE6", "#879887",
];

function slugifyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `named-theme-${slug}` : "named-theme-unlabeled";
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coerceLlmDetection(parsed: Record<string, any> | null): NamedCreativeReference | null {
  if (!parsed || parsed.named !== true) return null;
  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  if (!label) return null;

  const rawCues = Array.isArray(parsed.cues)
    ? parsed.cues.filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  const cues = rawCues.length > 0
    ? rawCues.slice(0, 4)
    : [label, "Recognizable visual world", "Event-specific setting", "No generic substitute"];

  const rawPalette = Array.isArray(parsed.palette)
    ? parsed.palette.filter((c: unknown): c is string => typeof c === "string" && HEX_COLOR.test(c))
    : [];
  const palette: [string, string, string, string] = [
    rawPalette[0] ?? FALLBACK_GENERIC_PALETTE[0],
    rawPalette[1] ?? FALLBACK_GENERIC_PALETTE[1],
    rawPalette[2] ?? FALLBACK_GENERIC_PALETTE[2],
    rawPalette[3] ?? FALLBACK_GENERIC_PALETTE[3],
  ];

  const rawRequirements = Array.isArray(parsed.requirements)
    ? parsed.requirements.filter((r: unknown): r is string => typeof r === "string" && r.trim().length > 0)
    : [];
  const requirements = rawRequirements.length > 0
    ? rawRequirements.slice(0, 3)
    : [
        `The ${label} identity is unmistakable through its real, recognizable visual details—not a generic adjacent category`,
        "The requested event setting and activities remain visibly present alongside the named identity",
      ];

  return {
    id: slugifyLabel(label),
    label,
    trigger: new RegExp(escapeForRegExp(label), "i"),
    cues,
    palette,
    requirements,
  };
}

/** Normalized-text memoization so a single generation/polling session never
 * pays for the same classification twice. Not a substitute for the curated
 * fast path above — this only guards the general LLM path. */
const NAMED_THEME_DETECTION_CACHE_TTL_MS = 15 * 60 * 1000;
const namedThemeDetectionCache = new Map<string, { expiresAt: number; value: NamedCreativeReference | null }>();

function cacheKeyFor(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function clearNamedThemeDetectionCache(): void {
  namedThemeDetectionCache.clear();
}

async function detectGeneralNamedCreativeReference(
  text: string,
  dependencies: NamedThemeDetectionDependencies,
): Promise<NamedCreativeReference | null> {
  const key = cacheKeyFor(text);
  const cached = namedThemeDetectionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!process.env.ANTHROPIC_API_KEY && !dependencies.client) return null;
  const client = dependencies.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let result: NamedCreativeReference | null = null;
  try {
    const response = await client.messages.create({
      model: NAMED_THEME_DETECTION_MODEL,
      max_tokens: 500,
      system: NAMED_THEME_DETECTION_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = extractJsonObject(raw) as LlmNamedThemeResult | null;
    result = coerceLlmDetection(parsed);
  } catch (error) {
    // Fail closed to "no named theme detected" rather than breaking the
    // preview flow — same fail-open-to-safe-default posture as visionGate.
    console.warn("[prepayment-preview] named-theme detection call failed:", error);
    return null;
  }

  namedThemeDetectionCache.set(key, { expiresAt: Date.now() + NAMED_THEME_DETECTION_CACHE_TTL_MS, value: result });
  return result;
}

/**
 * Recognizes ANY named entertainment property the host types, not just a
 * hardcoded shortlist. The five curated entries below stay a synchronous,
 * zero-latency fast path with hand-authored quality-gate requirements and
 * known-good reference images; everything else — Sesame Street, Cocomelon,
 * Frozen, Spider-Man, Pokemon, or any future franchise — is classified by an
 * LLM call whose (memoized) result feeds the same downstream direction card,
 * brief enrichment and reference-resolution pipeline.
 */
export async function detectNamedCreativeReference(
  text: string,
  dependencies: NamedThemeDetectionDependencies = {},
): Promise<NamedCreativeReference | null> {
  if (!text.trim()) return null;
  const curated = detectCuratedNamedCreativeReference(text);
  if (curated) return curated;
  return detectGeneralNamedCreativeReference(text, dependencies);
}

interface CueRule {
  trigger: RegExp;
  label: string;
}

const CUE_RULES: readonly CueRule[] = [
  { trigger: /soft[- ]play|foam blocks?|climbing blocks?|tunnels?|slides?/i, label: "Indoor soft play" },
  { trigger: /bubbles?|bubble wands?/i, label: "Bubbles" },
  { trigger: /ice[ -]?cream|frozen treats?/i, label: "Ice-cream treats" },
  { trigger: /igloo/i, label: "Glowing igloo" },
  { trigger: /snow[ -]?globe/i, label: "Snow-globe atmosphere" },
  { trigger: /winter wonderland|\bwinter\b|snowy|snow\b/i, label: "Winter wonderland" },
  { trigger: /unicorn/i, label: "Magical unicorns" },
  { trigger: /candlelit|candlelight/i, label: "Candlelit atmosphere" },
  { trigger: /rooftop/i, label: "Rooftop setting" },
  { trigger: /garden|botanical|floral|flowers?/i, label: "Garden florals" },
  { trigger: /construction|builder|digger|excavator|dump truck/i, label: "Little-builder details" },
  { trigger: /pool|swim|splash/i, label: "Poolside energy" },
  { trigger: /disco|dance/i, label: "Dancing" },
  { trigger: /brunch/i, label: "Brunch gathering" },
  { trigger: /dinner|seated meal/i, label: "Seated dinner" },
  { trigger: /outdoor/i, label: "Outdoor setting" },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parsedEventPalette(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
    );
  } catch {
    return [];
  }
}

export interface DirectionCard {
  eventName: string;
  eyebrow: string;
  headline: string;
  supportingCopy: string;
  cues: string[];
  palette: [string, string, string, string];
  namedReference: { id: string; label: string } | null;
  referenceRecommended: boolean;
}

export async function buildDirectionCard(event: Event): Promise<DirectionCard> {
  const brief = prePaymentPreviewSourceBrief(event);
  const named = await detectNamedCreativeReference(brief);
  const detectedCues = CUE_RULES
    .filter((rule) => rule.trigger.test(brief))
    .map((rule) => rule.label);
  const fallbackCue = event.eventType?.trim() || "Personal celebration";
  const cues = unique([...(named?.cues ?? []), ...detectedCues, fallbackCue]).slice(0, 4);
  while (cues.length < 4) {
    const fallback = ["Made from your details", "Invitation-ready direction", "Event-specific styling", "Editable after unlock"][cues.length];
    cues.push(fallback);
  }

  const eventPalette = parsedEventPalette(event.paletteColors).slice(0, 2);
  const fallbackPalette: [string, string, string, string] = named?.palette ?? ["#445248", "#C9866B", "#F4EEE6", "#879887"];
  const palette = [
    eventPalette[0] ?? fallbackPalette[0],
    eventPalette[1] ?? fallbackPalette[1],
    fallbackPalette[2],
    fallbackPalette[3],
  ] as [string, string, string, string];

  return {
    eventName: event.eventName?.trim() || "Your celebration",
    eyebrow: named ? "THEME RECOGNIZED" : "POSY CREATIVE DIRECTION",
    headline: named?.label || cues[0],
    supportingCopy: named
      ? "Posy captured the named visual world and every defining detail. Weak or generic artwork is never shown."
      : "A reliable first direction assembled from the details you shared. Weak or off-brief artwork is never shown.",
    cues,
    palette,
    namedReference: named ? { id: named.id, label: named.label } : null,
    referenceRecommended: Boolean(named),
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWords(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines[lines.length - 1] ?? "";
    if (!current || `${current} ${word}`.length > maxCharacters) {
      if (lines.length >= maxLines) break;
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.!,;:—-]+$/, "")}…`;
  }
  return lines;
}

function textBlock(lines: string[], x: number, y: number, lineHeight: number, className: string): string {
  return `<text x="${x}" y="${y}" class="${className}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("")}</text>`;
}

export function renderDirectionCardSvg(card: DirectionCard): string {
  const [ink, accent, paper, soft] = card.palette;
  const eventLines = wrapWords(card.eventName, 31, 2);
  const headlineLines = wrapWords(card.headline, 26, 2);
  const copyLines = wrapWords(card.supportingCopy, 44, 3);
  const cueRows = card.cues.slice(0, 4).map((cue, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const x = 92 + column * 424;
    const y = 584 + row * 96;
    return `<g transform="translate(${x} ${y})">
      <rect width="390" height="68" rx="34" fill="#ffffff" fill-opacity="0.72" stroke="${escapeXml(soft)}" stroke-width="2"/>
      <circle cx="34" cy="34" r="8" fill="${escapeXml(accent)}"/>
      <text x="58" y="43" class="cue">${escapeXml(cue)}</text>
    </g>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${escapeXml(card.eventName)} creative direction">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(paper)}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1b211d" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" fill="${escapeXml(paper)}"/>
  <circle cx="886" cy="126" r="220" fill="${escapeXml(accent)}" fill-opacity="0.16"/>
  <circle cx="86" cy="932" r="260" fill="${escapeXml(soft)}" fill-opacity="0.22"/>
  <path d="M0 748 C240 668 354 842 590 760 C760 700 872 712 1024 646 L1024 1024 L0 1024 Z" fill="${escapeXml(ink)}" fill-opacity="0.055"/>
  <rect x="56" y="54" width="912" height="916" rx="38" fill="url(#wash)" stroke="${escapeXml(ink)}" stroke-opacity="0.16" stroke-width="2" filter="url(#softShadow)"/>
  <text x="92" y="116" class="eyebrow">${escapeXml(card.eyebrow)}</text>
  <text x="932" y="116" text-anchor="end" class="posy">posy</text>
  ${textBlock(eventLines, 92, 220, 62, "event")}
  <line x1="92" y1="350" x2="224" y2="350" stroke="${escapeXml(accent)}" stroke-width="5" stroke-linecap="round"/>
  ${textBlock(headlineLines, 92, 432, 72, "headline")}
  ${cueRows}
  ${textBlock(copyLines, 92, 826, 38, "copy")}
  <text x="92" y="946" class="foot">FIRST LOOK · BUILT FROM YOUR DETAILS</text>
  <style>
    .eyebrow { font: 700 18px system-ui, -apple-system, sans-serif; letter-spacing: 4px; fill: ${escapeXml(ink)}; opacity: .72; }
    .posy { font: 400 38px Georgia, serif; letter-spacing: 6px; fill: ${escapeXml(ink)}; }
    .event { font: 500 50px Georgia, serif; fill: ${escapeXml(ink)}; }
    .headline { font: 700 62px Georgia, serif; fill: ${escapeXml(ink)}; }
    .cue { font: 600 26px system-ui, -apple-system, sans-serif; fill: ${escapeXml(ink)}; }
    .copy { font: 400 27px system-ui, -apple-system, sans-serif; fill: ${escapeXml(ink)}; opacity: .76; }
    .foot { font: 700 18px system-ui, -apple-system, sans-serif; letter-spacing: 3px; fill: ${escapeXml(ink)}; opacity: .58; }
  </style>
</svg>`;
}

export async function directionCardDataUrl(event: Event): Promise<string> {
  const svg = renderDirectionCardSvg(await buildDirectionCard(event));
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function enrichBriefForNamedReference(brief: EventBrief, named: NamedCreativeReference | null): EventBrief {
  return {
    ...brief,
    themeName: named?.label ?? brief.themeName,
    requirements: {
      required: unique([
        ...brief.requirements.required,
        ...(named?.requirements ?? []),
      ]),
      preferred: brief.requirements.preferred,
      excluded: unique([
        ...brief.requirements.excluded,
        ...(named
          ? [
              `a generic adjacent aesthetic standing in for ${named.label}`,
              "isolated accessories or palette-only shorthand standing in for the requested characters or world",
            ]
          : []),
        "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",
        "a lead character's face or head cropped off by the canvas edge",
      ]),
    },
  };
}

export async function buildQualityLockedPreviewBrief(
  event: Event,
  inspirationNotes = "",
): Promise<{ brief: EventBrief; concept: AiFirstConcept; namedReference: NamedCreativeReference | null }> {
  const sourceBrief = prePaymentPreviewSourceBrief(event);
  const namedReference = await detectNamedCreativeReference(sourceBrief);
  const baseBrief = buildEventBrief({
    event,
    dna: {},
    guestCount: event.estimatedGuestCount ?? null,
    inspirationNotes,
  });
  const brief = enrichBriefForNamedReference(baseBrief, namedReference);
  const card = await buildDirectionCard(event);
  const prompt = [
    "Premium editorial invitation artwork that proves the host's specific event was understood at a glance.",
    `ORIGINAL HOST BRIEF — authoritative: ${sourceBrief}`,
    "LAYOUT CONTRACT: reserve a naturally calm, low-detail typography zone at approximately left 21%, top 32%, width 58%, height 40%. Keep every required person, face, creature, signature object and defining interaction fully visible outside that zone. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box—the quiet area must remain part of the continuous full-bleed scene.",
    inspirationNotes ? `HOST-PROVIDED VISUAL REFERENCE NOTES — authoritative: ${inspirationNotes}` : "",
    "Depict the actual people, characters, setting, activities and defining objects requested. The event scene—not an accessory, logo-like symbol, pattern, palette or abstract shorthand—must dominate the composition.",
    "FINISH CONTRACT: create bespoke editorial stationery artwork with layered depth, tactile material detail, controlled lighting and refined art direction. It must not resemble generic clipart, stock illustration, a television promo still, a merchandising graphic or a flat commercial poster. Keep faces, hands, limbs and object interactions anatomically coherent.",
  ].filter(Boolean).join(" ");

  const concept: AiFirstConcept = {
    conceptName: `${(event.eventName || "Personalized event").slice(0, 42)} preview`,
    description: sourceBrief.slice(0, 220),
    focalStrategy: "narrative-scene",
    visualMood: "cinematic-narrative",
    styleLaneId: "editorial-premium",
    layoutStyle: "full-bleed",
    borderStyle: "thin-frame",
    fontPairingId: "editorial-serif",
    baseThemeId: "garden-editorial",
    placementId: "centre",
    texture: { style: "cotton", intensity: 0.45 },
    dividerStyle: "diamond-rule",
    motif: { id: "botanical-sprig", placement: "side-mirrored" },
    semanticPalette: {
      textSurface: card.palette[2],
      headlineColor: card.palette[0],
      bodyColor: card.palette[0],
      accentColor: card.palette[0],
    },
    art: {
      medium: namedReference ? "premium character-led editorial illustration" : "premium narrative editorial illustration",
      composition: "portrait scene-led full-bleed composition arranged around a naturally quiet central typography zone; all required subjects, faces and defining objects remain fully visible, with no visible panel, blank rectangle or cropped head",
      prompt: prompt.slice(0, 1200),
    },
    safeTypographyRegion: "center",
    minOverlay: "veil",
  };

  return { brief, concept, namedReference };
}

export interface PreviewQualityReview {
  tier1: Tier1Result;
  vision?: VisionVerdict;
  failureCodes: string[];
  notes: string;
}

export type QualityLockedPreviewResult =
  | {
      kind: "approved-image";
      dataUrl: string;
      attempts: number;
      model: ArtworkModel;
      reviews: PreviewQualityReview[];
    }
  | {
      kind: "rejected" | "unavailable";
      attempts: number;
      model: ArtworkModel;
      reviews: PreviewQualityReview[];
      error?: string;
    };

export interface PreviewQualityDependencies {
  generateImage?: ArtworkGenerator;
  runTier1?: typeof runTier1Checks;
  runVision?: typeof runVisionGate;
  inspirationNotes?: string;
  /** Original uploaded pixels used as high-fidelity identity anchors. */
  referenceImages?: ArtworkReferenceImage[];
  /** Reference-led named themes use high output quality; generic previews stay medium. */
  quality?: ArtworkQuality;
  /** Two internal candidates maximum; neither is customer-visible before approval. */
  maxCandidates?: 1 | 2;
}

/**
 * The guarantee is customer-visible, not provider-first: raw candidates may
 * fail privately, but only a candidate that clears deterministic and vision
 * review is returned. A failed or unavailable gate returns no pixels.
 */
export async function generateQualityLockedPreview(
  event: Event,
  dependencies: PreviewQualityDependencies = {},
): Promise<QualityLockedPreviewResult> {
  const generateImage = dependencies.generateImage ?? generateArtwork;
  const runTier1 = dependencies.runTier1 ?? runTier1Checks;
  const runVision = dependencies.runVision ?? runVisionGate;
  const maxCandidates = dependencies.maxCandidates ?? 2;
  const referenceLed = Boolean(dependencies.referenceImages?.length);
  const quality = dependencies.quality ?? (referenceLed ? "high" : "medium");
  const modelForCandidate = (candidate: number): ArtworkModel =>
    referenceLed && candidate > 1 ? REFERENCE_ARTWORK_MODEL : DEFAULT_ARTWORK_MODEL;
  let lastModel: ArtworkModel = modelForCandidate(1);
  const { brief, concept } = await buildQualityLockedPreviewBrief(
    event,
    dependencies.inspirationNotes ?? "",
  );
  const referenceImageRule = dependencies.referenceImages?.length
    ? "ATTACHED REFERENCE IMAGES ARE AUTHORITATIVE IDENTITY ANCHORS. Match the defining face, hair, outfit, creature markings, proportions, silhouette and visual-world details that make the requested subjects recognizable at a glance. Create a new event-specific scene; never copy wording, logos, watermarks or an invitation layout from the references."
    : "";
  const basePrompt = [
    buildArtworkPrompt(concept),
    buildArtworkConstraints(brief),
    referenceImageRule,
  ].filter(Boolean).join("\n\n");
  const reviews: PreviewQualityReview[] = [];
  let failureCodes: string[] = [];
  let concreteNotes = "";

  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {
    const model = modelForCandidate(candidate);
    lastModel = model;
    const prompt = candidate === 1
      ? basePrompt
      : `${buildRetryPrompt(basePrompt, failureCodes)}\n\nPRIVATE ART-DIRECTOR CORRECTION FROM THE REJECTED CANDIDATE:\n${concreteNotes || "The first candidate did not meet every required quality dimension. Rebuild the scene from the original brief rather than making a cosmetic variation."}`;

    let generated: Awaited<ReturnType<ArtworkGenerator>>;
    try {
      generated = await generateImage({
        prompt,
        aspectRatio: aspectRatioForLayout(concept.layoutStyle),
        model,
        quality,
        inputFidelity: referenceLed && model === REFERENCE_ARTWORK_MODEL ? "high" : undefined,
        referenceImages: dependencies.referenceImages,
      });
    } catch (error) {
      return {
        kind: "unavailable",
        attempts: candidate - 1,
        model,
        reviews,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let tier1: Tier1Result;
    let vision: VisionVerdict | undefined;
    try {
      tier1 = runTier1({
        bytes: generated.bytes,
        concept,
        overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay],
        artworkOpacity: 1,
        ocr: true,
      });
      if (tier1.passed) {
        vision = await runVision({ bytes: generated.bytes, concept, brief });
      }
    } catch (error) {
      return {
        kind: "unavailable",
        attempts: candidate,
        model,
        reviews,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const passed = tier1.passed && vision?.passed === true;
    failureCodes = tier1.passed
      ? (vision?.failureCodes ?? ["vision-unavailable"])
      : retryCodesFor(tier1.findings);
    concreteNotes = [
      ...tier1.findings.filter((finding) => finding.critical).map((finding) => finding.message),
      vision?.notes ?? "",
      ...(vision?.requiredPresent ?? [])
        .filter((item) => !item.present)
        .map((item) => `Missing required visual: ${item.requirement}`),
      ...(vision?.excludedFound ?? []).map((item) => `Remove excluded visual: ${item}`),
    ].filter(Boolean).join(" ").slice(0, 1200);
    reviews.push({ tier1, vision, failureCodes: passed ? [] : failureCodes, notes: concreteNotes });

    if (passed) {
      return {
        kind: "approved-image",
        dataUrl: generated.dataUrl,
        attempts: candidate,
        model,
        reviews,
      };
    }
  }

  return {
    kind: "rejected",
    attempts: maxCandidates,
    model: lastModel,
    reviews,
  };
}
