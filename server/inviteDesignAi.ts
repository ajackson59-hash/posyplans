import Anthropic from "@anthropic-ai/sdk";
import { FONT_PAIRINGS, BORDER_STYLES, LAYOUT_STYLES, STYLE_LANES, isValidInviteDesignConcept, type InviteDesignConcept, type ArtDirection } from "@shared/inviteDesign";
import { CONCEPT_INFERABLE_AXES, DNA_AXES } from "@shared/eventDna";
import { selectTopConcepts } from "./conceptQualityGate";

// "Invitation Intelligence": given a free-text theme prompt, generates 4
// distinct, coordinated design concepts (palette + font pairing + border +
// layout + a bounded illustration idea) a host can preview and apply across
// their invite, RSVP page, and thank-you card in one click. Requires the
// server to have been started with api_credentials=["llm-api:website"] so
// the Anthropic client can pick up its credentials from the environment.

const FONT_PAIRING_IDS = FONT_PAIRINGS.map((f) => f.id).join(", ");
const BORDER_STYLE_IDS = BORDER_STYLES.join(", ");
const LAYOUT_STYLE_IDS = LAYOUT_STYLES.join(", ");
const DNA_HINT_AXIS_DESCRIPTIONS = CONCEPT_INFERABLE_AXES.map((axis) => {
  const def = DNA_AXES.find((a) => a.key === axis)!;
  return `"${axis}": -1 = fully ${def.poleA}, +1 = fully ${def.poleB}`;
}).join("; ");

// Build a description of each style lane for the LLM prompt
const STYLE_LANE_DESCRIPTIONS = STYLE_LANES.map((lane) => {
  const layouts = lane.preferredLayouts.join(" or ");
  return [
    `Lane "${lane.id}":`,
    `  Label: ${lane.label}`,
    `  Illustration mediums: ${lane.illustrationMediums.join(", ")}`,
    `  Palette mood: ${lane.paletteMood}`,
    `  Typography mood: ${lane.typographyMood}`,
    `  Composition: ${lane.compositionGuidance}`,
    `  Preferred layouts: ${layouts}`,
    `  AVOID: ${lane.avoid}`,
  ].join("\n");
}).join("\n\n");

const RESPONSE_SHAPE_INSTRUCTIONS = `You are a party invitation designer helping a non-professional host turn a short theme description into complete, coordinated invitation design concepts. Produce concepts as STRICT JSON only — no markdown fences, no commentary, just the JSON object.

CRITICAL — CREATIVE DIRECTION MATRIX:
Each concept MUST be assigned to a DIFFERENT style lane. The style lanes are:

${STYLE_LANE_DESCRIPTIONS}

${"```"}If the host specified preferred style lanes below, generate exactly 4 concepts (one per preferred lane). Otherwise, use ALL 6 lanes — generate one concept per lane. The quality gate will automatically select the best 4.${"```"}

Return exactly this shape:
{
  "concepts": [
    {
      "conceptName": "short, evocative name for this look, 2-4 words",
      "description": "one sentence selling the vibe of this concept to the host",
      "paletteColors": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"],
      "fontPairingId": "one of: ${FONT_PAIRING_IDS}",
      "borderStyle": "one of: ${BORDER_STYLE_IDS}",
      "layoutStyle": "one of: ${LAYOUT_STYLE_IDS}",
      "styleLaneId": "the id of the style lane this concept belongs to (e.g. \"editorial-premium\", \"playful-illustrated\", \"bold-graphic\", \"storybook-whimsical\", \"minimal-modern\", \"handcrafted-rustic\")",
      "artDirection": {
        "illustrationMedium": "the specific medium from this lane's options, e.g. \"watercolor\" or \"flat vector illustration\"",
        "subjectFocus": "the primary subject of the illustration, e.g. \"a single elegant birthday cake with floral elements\"",
        "compositionType": "e.g. \"centered focal\", \"full-bleed\", \"asymmetric\", \"split composition\"",
        "negativeSpace": "e.g. \"40%+\", \"minimal\", \"balanced\"",
        "colorTreatment": "how to apply the palette, e.g. \"muted wash\", \"saturated flat\", \"duotone\"",
        "texture": "e.g. \"smooth\", \"grain\", \"paper texture\", \"foil accent\"",
        "avoidList": "what the image generator must NOT include, e.g. \"no text, no letters, no numbers, no clipart, no photorealistic faces\""
      },
      "illustrationPrompt": "a detailed prompt for an image generator — combine the medium, subject, composition, color treatment, and texture into one flowing description. MUST include \"no text, no letters, no words, no numbers\" from the avoidList. Keep under 80 words.",
      "dnaHints": { ${DNA_HINT_AXIS_DESCRIPTIONS} }
    }
  ]
}

Rules:
-       Generate exactly 6 concepts, each in a DIFFERENT style lane. You have 6 lanes available — use all 6. The 6 concepts should look like they came from 6 different designers — different font pairings, different border styles, different layout styles, different color moods, different illustration mediums. The quality gate will automatically select the best 4 to show the host.
- styleLaneId MUST be one of the lane ids listed above, and each concept MUST use a different lane.
- artDirection is REQUIRED for every concept — it's what gives the image generator real design intent.
- illustrationPrompt: combine the artDirection fields into one flowing description for the image generator. It MUST explicitly instruct "no text, no letters, no words, no numbers" since this image has zero tolerance for garbled AI-generated text. Keep each prompt under 80 words.
- paletteColors: exactly 4 hex colors, harmonious together, matching the lane's palette mood AND the theme. paletteColors[0] is the primary accent, paletteColors[1] is a secondary/border accent.
- fontPairingId must be exactly one of the listed ids — never invent a new one.
- borderStyle must be exactly one of the listed ids.
- layoutStyle: choose from the lane's preferred layouts when possible. Use "banner" when the illustration works well as a standalone top image; "backdrop" for soft texture behind text; "split" for side-by-side art and text; "centered" for small focal art with margins; "full-bleed" when art fills the card with text overlaid.
- dnaHints: your honest read of where THIS SPECIFIC concept sits on each listed axis, as a number from -1 to 1. Every concept should read a little differently here — don't give all concepts the same hints.
- Ground every concept in the given theme and event details — don't produce generic designs unrelated to the theme.
- If a "Host's established style so far" line is given below, treat it as useful context about this host's taste, not a hard constraint: let it influence the overall mood and at least 2 of the concepts, while still keeping all concepts in different lanes.
- If a "Guest count and scale guidance" line is given below, follow it for layoutStyle and overall formality/polish across at least 3 of the concepts, while still keeping all concepts in different lanes.
- If a "Previous concepts the host has already seen" section and a "Host's refinement feedback" line are given below, treat this as a refinement pass: produce NEW concepts that directly address the feedback while keeping the same party theme and event details. Don't simply re-emit the previous concepts — evolve them in the direction the feedback asks for.
- Output raw JSON only.`;

// Supported by both the Anthropic vision API and the browser upload helper.
type VisionMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const VISION_MEDIA_TYPES: VisionMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Parses a browser data URL ("data:image/jpeg;base64,…") into the parts an
// Anthropic image block needs, or null if it isn't a supported base64 image.
function parseImageDataUrl(dataUrl: string): { mediaType: VisionMediaType; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mediaType = match[1] as VisionMediaType;
  if (!VISION_MEDIA_TYPES.includes(mediaType)) return null;
  return { mediaType, data: match[2] };
}

const INSPIRATION_EXTRACTION_SYSTEM = `You are a design analyst. You are shown 1-3 inspiration images a party host uploaded to steer the mood of their invitation. Describe ONLY the abstract, reusable style attributes across the images in one or two compact sentences: overall mood/tone, color palette, key motifs or textures, and style descriptors (e.g. "modern minimalist", "whimsical hand-drawn").

Critical rules:
- Extract abstract style direction ONLY. Do NOT identify, copy, or describe any specific character, mascot, logo, brand, celebrity, or another party's exact invitation design/artwork.
- Never suggest reproducing a recognizable copyrighted or trademarked element. If the image contains such elements, describe only the generic style around them (colors, composition, texture, mood).
- Output plain prose, no lists, no preamble, under 45 words.`;

// Makes ONE vision LLM call (reusing the same Anthropic client as concept
// generation) to distill uploaded inspiration images into a short, abstract
// style-direction string. Returns "" when no usable images are provided.
export async function extractInspirationNotes(inspirationImages: string[]): Promise<string> {
  const images = inspirationImages
    .map(parseImageDataUrl)
    .filter((x): x is { mediaType: VisionMediaType; data: string } => x !== null)
    .slice(0, 3);
  if (images.length === 0) return "";

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: INSPIRATION_EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
          })),
          { type: "text" as const, text: "Describe the shared style direction of these inspiration image(s) for a party invitation, following your rules." },
        ],
      },
    ],
  });

  const block = message.content.find((c) => c.type === "text");
  return block && "text" in block ? block.text.trim() : "";
}

export async function generateInviteDesignConcepts(params: {
  themePrompt: string;
  eventName: string;
  eventType: string;
  eventDate: string;
  location: string;
  hostNames: string;
  themeName: string;
  /** Event DNA summary line (see shared/eventDna.ts) — omit/null when there isn't enough signal yet. */
  dnaSummary?: string | null;
  /** Guest-count + DNA scale guidance for layoutStyle/formality (see shared/inviteFormatRecommendation.ts) — omit/null when there isn't enough signal yet. */
  formatGuidance?: string | null;
  /** The 4 concepts the host is refining, when this is a "Not quite right?" refinement pass — omit/null on a fresh generate. */
  previousConcepts?: InviteDesignConcept[] | null;
  /** The host's plain-English refinement feedback (e.g. "more elegant") — omit/null on a fresh generate. */
  feedback?: string | null;
  /** Style direction extracted from host-uploaded inspiration images (see extractInspirationNotes) — omit/null when none uploaded. */
  inspirationNotes?: string | null;
  /** Optional: the host's preferred style lane ids (1-4). When 4 are provided, concepts are generated in those lanes. When 1-3 are provided, the AI fills the remaining lanes. When null/empty, the AI uses all 6 lanes. */
  preferredStyleLanes?: string[] | null;
}): Promise<InviteDesignConcept[]> {
  const client = new Anthropic();
  const previousConceptsSummary =
    params.feedback && params.previousConcepts && params.previousConcepts.length > 0
      ? [
          "Previous concepts the host has already seen:",
          ...params.previousConcepts.map(
            (c, i) =>
              `${i + 1}. "${c.conceptName}" (${c.styleLaneId ?? "unknown lane"}) — ${c.description} (palette: ${c.paletteColors.join(", ")}; layout: ${c.layoutStyle})`,
          ),
        ].join("\n")
      : null;

  const preferredStyleLanesLine =
    params.preferredStyleLanes && params.preferredStyleLanes.length > 0
      ? params.preferredStyleLanes.length === 4
        ? `Host's preferred style lanes: ${params.preferredStyleLanes.join(", ")}. Generate exactly 4 concepts, one per preferred lane.`
        : `Host's preferred style lanes: ${params.preferredStyleLanes.join(", ")}. Generate 6 concepts: one per preferred lane (${params.preferredStyleLanes.length} lane(s)) plus one per each of the remaining lanes. The quality gate will select the best 4.`
      : null;

  const userPrompt = [
    `Theme prompt from host: "${params.themePrompt}"`,
    `Event name: "${params.eventName}"`,
    params.eventType && `Event type: ${params.eventType}`,
    params.eventDate && `Date: ${params.eventDate}`,
    params.location && `Location: ${params.location}`,
    params.hostNames && `Host(s): ${params.hostNames}`,
    params.themeName && `Existing app theme on file: ${params.themeName}`,
    params.dnaSummary && `Host's established style so far: ${params.dnaSummary}`,
    params.formatGuidance && `Guest count and scale guidance: ${params.formatGuidance}`,
    params.inspirationNotes && `Style direction from the host's inspiration images (use for mood/palette/style only; do NOT copy any specific character, logo, brand, or another party's exact design): ${params.inspirationNotes}`,
    preferredStyleLanesLine,
    previousConceptsSummary,
    params.feedback && `Host's refinement feedback: "${params.feedback}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4500,
    system: RESPONSE_SHAPE_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.concepts) || parsed.concepts.length === 0) {
    throw new Error("AI response JSON did not match expected shape");
  }

  const concepts = parsed.concepts.filter(isValidInviteDesignConcept);
  if (concepts.length === 0) {
    throw new Error("AI response did not contain any valid design concepts");
  }
  // Quality gate: if we generated more than 4 concepts (6 lanes),
  // score and select the top 4. When the host specified preferred lanes
  // (4 concepts), pass through as-is.
  if (concepts.length > 4) {
    return selectTopConcepts(concepts, params.themePrompt, 4);
  }
  return concepts;
}
