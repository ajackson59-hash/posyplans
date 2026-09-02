import Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import {
  ARTWORK_EDGE_REQUIREMENT,
  ARTWORK_TEXT_REQUIREMENT,
  aspectRatioForLayout,
  type AiFirstConcept,
} from "@shared/aiFirstInvite";
import { OVERLAY_COVERAGE } from "@shared/aiFirstLayout";
import {
  DEFAULT_ARTWORK_MODEL,
  REFERENCE_ARTWORK_MODEL,
  estimateImageCostUsdMicros,
  generateArtwork,
  sizeForAspect,
  type ArtworkGenerator,
  type ArtworkModel,
  type ArtworkQuality,
  type ArtworkReferenceImage,
  type ArtworkSize,
} from "./aiFirst/artwork";
import type { AiFirstArtworkAttemptStore } from "./aiFirst/artworkAttemptStore";
import { boxDownsampleRgb, decodePng, encodePng } from "./aiFirst/png";
import { ageFromMilestone, buildEventBrief, type EventBrief } from "./aiFirst/brief";
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
import { PRE_PAYMENT_PREVIEW_LONG_EDGE } from "./prePaymentPreview";
import { prePaymentPreviewSourceBrief } from "./prePaymentPreviewConcept";

export const PREPAYMENT_PREVIEW_MODE_ENV = "POSY_PREPAYMENT_PREVIEW_MODE";
export const PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS = Date.UTC(2026, 7, 31, 2, 0, 0);

export type PrePaymentPreviewMode = "off" | "direction-card" | "quality-image";

/**
 * Produces the exact low-resolution PNG bytes an unpaid customer receives.
 * Quality review runs on these bytes—not a larger source that the browser later
 * transforms—so the approved pixels and the served pixels are equivalent.
 */
export function customerVisiblePreviewBytes(source: Buffer): Buffer {
  const decoded = decodePng(source);
  return encodePng(boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE));
}

/** The first-look image is standalone artwork, not the later invitation card. */
function buildTeaserArtworkPrompt(concept: AiFirstConcept): string {
  return [
    `${concept.art.medium}.`,
    `${concept.art.composition}.`,
    concept.art.prompt.trim().replace(/\s+$/, ""),
    ARTWORK_EDGE_REQUIREMENT,
    ARTWORK_TEXT_REQUIREMENT,
  ].filter(Boolean).join(" ");
}

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
      "Meekah is visibly identifiable as a distinct full co-host through her natural curly hair and recognizable purple play-and-learn wardrobe with warm orange/yellow accents—not a generic second adult",
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

/**
 * Synchronous, network-free detection for read/poll-only call sites
 * (readiness, direction-card rendering, asset delivery). Deliberately does
 * NOT consult the general LLM classifier — customer routes must stay
 * deterministic, zero-cost and zero-latency. A future explicitly budgeted
 * workflow may call the asynchronous detector and pass its resolved result
 * back into the card/generator; the launch request path does not.
 */
export function detectNamedCreativeReferenceSync(text: string): NamedCreativeReference | null {
  if (!text.trim()) return null;
  return detectCuratedNamedCreativeReference(text);
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

  let result: NamedCreativeReference | null = null;
  try {
    // Client construction itself can throw (missing/invalid key, disallowed
    // runtime, SDK misconfiguration) — that must fail closed too, not bubble
    // out of this "never throws" detector.
    const client = dependencies.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
 * General detector retained for a future explicitly budgeted workflow. The
 * five curated entries stay a synchronous, zero-latency fast path; other
 * properties can be classified here only when a caller deliberately invokes
 * this asynchronous function. The customer POST schedules it once in the
 * background; pure GET/read paths never call it.
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

/**
 * Synchronous and network-free: renders the card customers see on every page
 * load and 2.5s poll from curated-only detection. Pass `resolvedNamed` when
 * the caller already paid for and awaited the general classifier (i.e. only
 * from the background job after the customer's explicit request) so the
 * real identity is reflected without this function ever awaiting anything
 * itself.
 */
export function buildDirectionCard(
  event: Event,
  resolvedNamed?: NamedCreativeReference | null,
): DirectionCard {
  const brief = prePaymentPreviewSourceBrief(event);
  const named = resolvedNamed !== undefined ? resolvedNamed : detectNamedCreativeReferenceSync(brief);
  const detectedCues = CUE_RULES
    .filter((rule) => rule.trigger.test(brief))
    .map((rule) => rule.label);
  const themeCue = event.themeName?.trim() || "";
  const fallbackCue = event.eventType?.trim() || "Personal celebration";
  const cues = unique([...(named?.cues ?? []), themeCue, ...detectedCues, fallbackCue]).slice(0, 4);
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
    headline: named?.label || themeCue || cues[0],
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

export function directionCardDataUrl(
  event: Event,
  resolvedNamed?: NamedCreativeReference | null,
): string {
  const svg = renderDirectionCardSvg(buildDirectionCard(event, resolvedNamed));
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

const CHILD_AGE_WORDS: Readonly<Record<number, string>> = {
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
  7: "seven", 8: "eight", 9: "nine",
};

/**
 * The general event brief deliberately keeps ambiguous vibe words soft. A
 * pre-purchase image has a stricter job: prove Posy heard the host. Clauses the
 * host explicitly framed as scene contents or setting are therefore binding
 * for this quality-locked preview and are audited against the final pixels.
 *
 * This stays deterministic/network-free and intentionally conservative. It
 * captures strong visual constructions ("include…", "featuring…", "set inside…",
 * and concrete "at …" setting clauses) rather than turning every adjective in
 * a vibe sentence into a must-have object.
 */
function explicitPreviewSceneRequirements(brief: EventBrief): string[] {
  const source = brief.vibe.trim();
  if (!source) return [];

  const clauses: string[] = [];
  const patterns = [
    /\b(?:include|including|features?|featuring|show|showing|depict|depicting)\s+([^.!?]{4,220})/gi,
    /\b(?:set|stage|staged|held)\s+(?:the\s+(?:celebration|party|scene)\s+)?(?:inside|within|in|at)\s+([^.!?]{4,220})/gi,
    /\b(?:inside|within)\s+([^.!?]{4,180})/gi,
    /\bat\s+([^.!?]{4,180})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of Array.from(source.matchAll(pattern))) {
      const clause = (match[1] || "")
        .replace(/\s+/g, " ")
        .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "")
        .trim();
      if (!clause) continue;
      // Do not turn clock times or meta/style instructions into visual objects.
      if (/^(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i.test(clause)) continue;
      if (/^(?:make|keep|feel|should|please|try)\b/i.test(clause)) continue;
      // A broader match can contain a narrower one; keep the most specific
      // useful clause once rather than multiplying near-duplicate requirements.
      if (clauses.some((existing) => existing.toLowerCase().includes(clause.toLowerCase()))) continue;
      const contained = clauses.findIndex((existing) => clause.toLowerCase().includes(existing.toLowerCase()));
      if (contained >= 0) clauses.splice(contained, 1);
      clauses.push(clause.slice(0, 220));
      if (clauses.length >= 4) break;
    }
    if (clauses.length >= 4) break;
  }

  const required = clauses.map((clause) => `[VISIBLE HOST DETAIL] ${clause}`);
  const age = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\bcandles?\b/i.test(source);
  if (hostExplicitlyRequestedCandles && age !== null && age >= 1 && age <= 9 && CHILD_AGE_WORDS[age]) {
    required.push(
      `[VISIBLE MILESTONE] exactly ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[age]}`,
    );
  }
  return unique(required);
}

function enrichBriefForNamedReference(brief: EventBrief, named: NamedCreativeReference | null): EventBrief {
  const age = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\bcandles?\b/i.test(brief.vibe);
  return {
    ...brief,
    themeName: named?.label ?? brief.themeName,
    requirements: {
      required: unique([
        ...brief.requirements.required,
        ...explicitPreviewSceneRequirements(brief),
        ...(named?.requirements.map((requirement) => `[VISIBLE NAMED IDENTITY] ${requirement}`) ?? []),
      ]),
      // Standalone teaser pixels are not stationery. Carry event mood but
      // remove shared invitation-furniture preferences that otherwise pull the
      // image model back toward a template/card treatment after the teaser
      // prompt explicitly forbids one.
      preferred: brief.requirements.preferred.filter((item) => !/stationery/i.test(item)),
      excluded: unique([
        ...brief.requirements.excluded,
        ...(named
          ? [
              `a generic adjacent aesthetic standing in for ${named.label}`,
              "isolated accessories or palette-only shorthand standing in for the requested characters or world",
              "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
              "any child in the foreground or central hero plane when the host did not supply a personal visual reference for the celebrant",
            ]
          : []),
        "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",
        "a collage, split panel, sticker sheet, merchandise mockup, pasted character cutout or television-promo layout",
        "a freestanding poster, banner, easel, title card, invitation card, menu board, screen or other rectangular surface reserved for text",
        "a lead character's face or head cropped off by the canvas edge",
        ...(age !== null && !hostExplicitlyRequestedCandles
          ? ["birthday candles, numeral-shaped props or other countable age markers when the host did not explicitly request a count"]
          : []),
      ]),
    },
  };
}

export async function buildQualityLockedPreviewBrief(
  event: Event,
  inspirationNotes = "",
  resolvedNamedReference?: NamedCreativeReference | null,
): Promise<{ brief: EventBrief; concept: AiFirstConcept; namedReference: NamedCreativeReference | null }> {
  const sourceBrief = prePaymentPreviewSourceBrief(event);
  // Launch-safe default: generation requests use the curated, synchronous
  // detector unless a caller explicitly supplies a reference it already
  // resolved under its own bounded budget. This keeps a generic first-look
  // request from silently adding an uncapped Sonnet classification call.
  const namedReference = resolvedNamedReference !== undefined
    ? resolvedNamedReference
    : detectNamedCreativeReferenceSync(sourceBrief);
  const baseBrief = buildEventBrief({
    event,
    dna: {},
    guestCount: event.estimatedGuestCount ?? null,
    inspirationNotes,
  });
  const brief = enrichBriefForNamedReference(baseBrief, namedReference);
  const card = buildDirectionCard(event, namedReference);
  // AiFirstConcept intentionally caps art.prompt at 1,200 characters. The
  // full host brief, REQUIRED/EXCLUDED constraints and identity-reference notes
  // are appended separately to the final provider prompt, so this layer carries
  // only the highest-leverage visual direction and is guaranteed to survive the cap.
  const identity = namedReference
    ? `${namedReference.label.slice(0, 80)} recognizable and central`
    : "the requested event world recognizable and central";
  const teaserAge = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\bcandles?\b/i.test(brief.vibe);
  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? hostExplicitlyRequestedCandles
      ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles; no extras or written numerals.`
      : "MILESTONE: age-appropriate energy only. Do not show birthday candles, numeral props or countable age markers; Posy UI carries the exact age."
    : "MILESTONE: age-appropriate tone only; no invented names, dates or logos.";
  const prompt = [
    "Premium event-world, full portrait canvas, one cinematic environment.",
    `IDENTITY: ${identity}; venue, activities and party details share the scene.`,
    "NATIVE STYLE: natural live-action materials/light; polished native animation; no generic mascots.",
    namedReference
      ? "STORY: candid named-character interaction; do not invent any child in the foreground or central hero plane without a supplied celebrant reference."
      : "STORY: asymmetric candid interaction and varied poses, not a front-facing catalog or character-promo pose.",
    "DEPTH/MATERIAL: natural depth falloff; directional key/fill/rim, contact/cast shadows, controlled saturation/color bounce; correct hands, scale, gravity/perspective. No waxy skin, plastic food, tiled/repeated object clusters, stamped bubbles or composite seams.",
    "HANDS/PROPS: natural hands/clean grips; unless required, put food/small props on stable surfaces at believable scale, not in hands.",
    milestoneDirection,
    "COMPOSITION: fully frame faces, hands and required objects; add breathing room; avoid dense repeated foreground clutter.",
    "NO DESIGN SURFACES: no card, panel, sign, frame, collage, poster, mockup or text box.",
  ].join(" ");

  const concept: AiFirstConcept = {
    conceptName: `${(event.eventName || "Personalized event").slice(0, 42)} preview`,
    description: sourceBrief.slice(0, 220),
    focalStrategy: "narrative-scene",
    visualMood: "cinematic-narrative",
    styleLaneId: "editorial-premium",
    layoutStyle: "full-bleed",
    // Teaser generation consumes only concept.art; keep schema-required invitation
    // furniture deliberately inert so retained QA evidence cannot imply a floral
    // frame, paper texture or typography treatment that was never requested.
    borderStyle: "none",
    fontPairingId: "modern-sans",
    baseThemeId: "garden-editorial",
    placementId: "centre",
    texture: { style: "none", intensity: 0 },
    dividerStyle: "none",
    motif: { id: "botanical-sprig", placement: "side-mirrored" },
    semanticPalette: {
      textSurface: card.palette[2],
      headlineColor: card.palette[0],
      bodyColor: card.palette[0],
      accentColor: card.palette[0],
    },
    art: {
      medium: namedReference ? "premium native-medium cinematic event image" : "premium cinematic event illustration",
      composition: "portrait scene-led full-bleed teaser using the full canvas; all required subjects, faces and defining objects remain fully visible, with no panel, blank rectangle, cropped head or edge-clipped hero subject",
      prompt: prompt.slice(0, 1200),
    },
    safeTypographyRegion: "center",
    minOverlay: "none",
  };

  return { brief, concept, namedReference };
}

export interface PreviewQualityReview {
  tier1: Tier1Result;
  vision?: VisionVerdict;
  failureCodes: string[];
  notes: string;
}

/**
 * A rejected preview candidate's gate evidence evaporated the moment this
 * function returned: `reviews[]` lived only in the caller's local variable
 * and was never logged in full or persisted, so once the request finished
 * the actual reason a candidate failed was unrecoverable — only the top
 * level `kind`/`model`/`attempts` survived in a warn log. This mirrors the
 * durable, owner-scoped evidence retention already used for the main
 * AI-first pipeline (see aiFirst/artworkAttemptStore.ts): every billed
 * attempt, accepted and rejected alike, is retained for protected review.
 */
export interface PreviewQualityAttemptRetention {
  store: AiFirstArtworkAttemptStore;
  eventId: number;
  ownerToken: string;
  runId?: string | null;
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
  /**
   * Optional named reference already resolved by a caller with an explicit
   * budget. Omitted means the zero-I/O curated detector is used.
   */
  namedReference?: NamedCreativeReference | null;
  /** Two internal candidates maximum; neither is customer-visible before approval. */
  maxCandidates?: 1 | 2;
  /**
   * Text-first named previews may privately render both candidates at once,
   * then quality-review both and choose the stronger approved result. This
   * spends two bounded image calls but avoids making conversion depend on one
   * stochastic draw or doubling customer latency with a sequential retry.
   */
  parallelCandidates?: boolean;
  /**
   * When provided, every billed candidate — accepted or rejected — is
   * durably recorded for protected owner-scoped review, matching the main
   * AI-first pipeline. Optional so existing tests/callers that don't pass a
   * store keep working exactly as before (fail-open: retention is
   * best-effort and never blocks the customer-visible result).
   */
  attemptRetention?: PreviewQualityAttemptRetention;
  /** Aborts active image generation and vision review at the route deadline. */
  signal?: AbortSignal;
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
    dependencies.namedReference,
  );
  const referenceIdentityNotes = dependencies.inspirationNotes?.trim()
    ? `AUTHORITATIVE IDENTITY NOTES: ${dependencies.inspirationNotes.trim()}`
    : "";
  const referenceImageRule = dependencies.referenceImages?.length
    ? "ATTACHED REFERENCE IMAGES ARE IDENTITY ANCHORS ONLY. Preserve the defining face, hair, outfit, creature markings, proportions, silhouette and world details that make the requested subjects recognizable. Integrate them naturally into a new event-specific environment. Do not copy the source background, pose, crop, wording, logo, watermark, card, poster or layout; do not paste cutout characters onto an unrelated scene."
    : "";
  const basePrompt = [
    buildTeaserArtworkPrompt(concept),
    buildArtworkConstraints(brief),
    referenceIdentityNotes,
    referenceImageRule,
  ].filter(Boolean).join("\n\n");
  const reviews: PreviewQualityReview[] = [];
  let failureCodes: string[] = [];
  let concreteNotes = "";

  if (dependencies.parallelCandidates && maxCandidates === 2 && !referenceLed) {
    type ParallelOutcome = {
      candidate: number;
      model: ArtworkModel;
      passed: boolean;
      sourceBytes?: Buffer;
      review?: PreviewQualityReview;
      error?: string;
    };

    const prompts = [
      basePrompt,
      `${basePrompt}

PRIVATE ALTERNATE TAKE: independently rebuild the same event world from a genuinely different camera position and staging while preserving every binding requirement and exclusion. Prioritize anatomically clean hands, coherent shadows, believable prop scale, natural foreground-to-background depth, controlled saturation and non-repeating physical detail. Do not make a cosmetic variation of the first take.`,
    ];

    const evaluateParallelCandidate = async (candidate: number): Promise<ParallelOutcome> => {
      const model = DEFAULT_ARTWORK_MODEL;
      if (dependencies.signal?.aborted) {
        return {
          candidate,
          model,
          passed: false,
          error: dependencies.signal.reason instanceof Error
            ? dependencies.signal.reason.message
            : "Preview generation was cancelled.",
        };
      }

      let generated: Awaited<ReturnType<ArtworkGenerator>>;
      try {
        generated = await generateImage({
          prompt: prompts[candidate - 1],
          aspectRatio: aspectRatioForLayout(concept.layoutStyle),
          model,
          quality,
          referenceImages: undefined,
          signal: dependencies.signal,
        });
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      let reviewedBytes: Buffer;
      try {
        reviewedBytes = customerVisiblePreviewBytes(generated.bytes);
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: `Generated artwork could not be prepared for customer review: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      let tier1: Tier1Result;
      let vision: VisionVerdict | undefined;
      try {
        tier1 = runTier1({
          bytes: reviewedBytes,
          concept,
          overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay],
          artworkOpacity: 1,
          layoutApplied: false,
          ocr: true,
        });
        if (tier1.passed) {
          vision = await runVision({
            bytes: generated.bytes,
            concept,
            brief,
            reviewMode: "teaser",
            signal: dependencies.signal,
          });
        }
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const passed = tier1.passed && vision?.passed === true;
      const candidateFailureCodes = tier1.passed
        ? (vision?.failureCodes ?? ["vision-unavailable"])
        : retryCodesFor(tier1.findings);
      const notes = [
        ...tier1.findings.filter((finding) => finding.critical).map((finding) => finding.message),
        vision?.notes ?? "",
        ...(vision?.requiredPresent ?? [])
          .filter((item) => !item.present)
          .map((item) => `Missing required visual: ${item.requirement}`),
        ...(vision?.excludedFound ?? []).map((item) => `Remove excluded visual: ${item}`),
      ].filter(Boolean).join(" ").slice(0, 1200);
      const review: PreviewQualityReview = {
        tier1,
        vision,
        failureCodes: passed ? [] : candidateFailureCodes,
        notes,
      };

      if (dependencies.attemptRetention) {
        const { store: attemptStore, eventId, ownerToken, runId } = dependencies.attemptRetention;
        const size: ArtworkSize = sizeForAspect(aspectRatioForLayout(concept.layoutStyle));
        try {
          await attemptStore.record({
            eventId,
            ownerToken,
            runId: runId ?? null,
            idempotencyKey: null,
            directionIndex: 0,
            attempt: candidate,
            status: passed ? "accepted" : "rejected",
            bytes: reviewedBytes,
            previewId: null,
            concept,
            failureCodes: passed ? [] : candidateFailureCodes,
            tier1Findings: tier1.findings,
            visionScores: vision?.scores ?? null,
            model,
            quality,
            size,
            costUsdMicros: estimateImageCostUsdMicros(model, quality, size),
          });
        } catch (error) {
          console.error("[prepayment-preview] failed to persist parallel attempt evidence (non-fatal):", error);
        }
      }

      return { candidate, model, passed, sourceBytes: generated.bytes, review };
    };

    const outcomes = await Promise.all([
      evaluateParallelCandidate(1),
      evaluateParallelCandidate(2),
    ]);
    reviews.push(...outcomes.flatMap((outcome) => outcome.review ? [outcome.review] : []));

    const approved = outcomes
      .filter((outcome): outcome is ParallelOutcome & { sourceBytes: Buffer; review: PreviewQualityReview } =>
        outcome.passed && Boolean(outcome.sourceBytes) && Boolean(outcome.review?.vision),
      )
      .sort((a, b) => {
        const av = a.review.vision!.scores;
        const bv = b.review.vision!.scores;
        const weighted = (scores: VisionVerdict["scores"]) =>
          scores.premiumFinish * 4
          + scores.briefFidelity * 4
          + scores.artifactFree * 3
          + scores.compositionQuality * 3
          + scores.textLogoWatermarkFree
          + scores.ageAppropriate;
        return weighted(bv) - weighted(av);
      })[0];

    if (approved) {
      return {
        kind: "approved-image",
        // The gate inspected the exact 560px teaser transform, but paid reuse
        // and protected evidence retain the original provider resolution.
        dataUrl: `data:image/png;base64,${approved.sourceBytes.toString("base64")}`,
        attempts: outcomes.filter((outcome) => outcome.sourceBytes || outcome.review).length,
        model: approved.model,
        reviews,
      };
    }

    const reviewedCount = outcomes.filter((outcome) => outcome.review).length;
    if (reviewedCount === 0) {
      return {
        kind: "unavailable",
        attempts: 0,
        model: DEFAULT_ARTWORK_MODEL,
        reviews,
        error: outcomes.map((outcome) => outcome.error).filter(Boolean).join(" | ") || "Both private preview candidates were unavailable.",
      };
    }

    return {
      kind: "rejected",
      attempts: reviewedCount,
      model: DEFAULT_ARTWORK_MODEL,
      reviews,
    };
  }

  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {
    if (dependencies.signal?.aborted) {
      return {
        kind: "unavailable",
        attempts: candidate - 1,
        model: lastModel,
        reviews,
        error: dependencies.signal.reason instanceof Error
          ? dependencies.signal.reason.message
          : "Preview generation was cancelled.",
      };
    }
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
        signal: dependencies.signal,
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

    let reviewedBytes: Buffer;
    try {
      reviewedBytes = customerVisiblePreviewBytes(generated.bytes);
    } catch (error) {
      return {
        kind: "unavailable",
        attempts: candidate,
        model,
        reviews,
        error: `Generated artwork could not be prepared for customer review: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    let tier1: Tier1Result;
    let vision: VisionVerdict | undefined;
    try {
      tier1 = runTier1({
        bytes: reviewedBytes,
        concept,
        overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay],
        artworkOpacity: 1,
        layoutApplied: false,
        ocr: true,
      });
      if (tier1.passed) {
        vision = await runVision({
          bytes: reviewedBytes,
          concept,
          brief,
          reviewMode: "teaser",
          signal: dependencies.signal,
        });
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

    // Every billed candidate is retained at its original resolution for
    // protected owner-scoped review and paid reuse, accepted and rejected
    // alike — mirroring aiFirst/artworkAttemptStore.ts. The gate evidence was
    // still computed from `reviewedBytes`, the exact deterministic 560px
    // transform served to an unpaid customer.
    // Best-effort and fail-open: a retention failure must never change the
    // customer-visible result or mask the real approve/reject outcome.
    if (dependencies.attemptRetention) {
      const { store: attemptStore, eventId, ownerToken, runId } = dependencies.attemptRetention;
      const size: ArtworkSize = sizeForAspect(aspectRatioForLayout(concept.layoutStyle));
      try {
        await attemptStore.record({
          eventId,
          ownerToken,
          runId: runId ?? null,
          idempotencyKey: null,
          directionIndex: 0,
          attempt: candidate,
          status: passed ? "accepted" : "rejected",
          bytes: generated.bytes,
          previewId: null,
          concept,
          failureCodes: passed ? [] : failureCodes,
          tier1Findings: tier1.findings,
          visionScores: vision?.scores ?? null,
          model,
          quality,
          size,
          costUsdMicros: estimateImageCostUsdMicros(model, quality, size),
        });
      } catch (error) {
        console.error("[prepayment-preview] failed to persist attempt evidence (non-fatal):", error);
      }
    }

    if (passed) {
      return {
        kind: "approved-image",
        // Persist the full provider result. The private unpaid asset route
        // derives the exact reviewed 560px pixels from these bytes; after an
        // unlock the same approved artwork remains available at full quality.
        dataUrl: `data:image/png;base64,${generated.bytes.toString("base64")}`,
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
