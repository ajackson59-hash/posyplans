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
    `Lane "${lane.id}" — ${lane.label}:`,
    `  Mediums: ${lane.illustrationMediums.join(", ")}`,
    `  Palette: ${lane.paletteMood}`,
    `  Typography: ${lane.typographyMood}`,
    `  Composition: ${lane.compositionGuidance}`,
    `  Layouts: ${layouts}`,
    `  Subject guidance: ${lane.subjectGuidance}`,
    `  AVOID: ${lane.avoid}`,
  ].join("\n");
}).join("\n\n");

// Few-shot examples that demonstrate the quality bar. These show the LLM
// what "excellent" looks like — evocative descriptions, specific palettes,
// and illustration prompts that read like professional art briefs.
const FEW_SHOT_EXAMPLES = `Here are two examples of the quality bar. Your output must match this level of specificity and craft:

Example 1 (editorial-premium lane, theme "enchanted garden tea party"):
{
  "conceptName": "Twilight Bloom",
  "description": "A moody, romantic palette of deep plum and brushed gold with a single watercolor iris — feels like a luxury garden party spread.",
  "paletteColors": ["#4A2C3D", "#C9A961", "#E8D5C4", "#2D1B2E"],
  "fontPairingId": "editorial-serif",
  "borderStyle": "thin-frame",
  "layoutStyle": "centered",
  "styleLaneId": "editorial-premium",
  "artDirection": {
    "illustrationMedium": "watercolor",
    "subjectFocus": "a single elegant iris stem with two blooms, one fully open and one budding, painted in deep plum and gold",
    "compositionType": "centered focal with asymmetric stem",
    "negativeSpace": "45% — generous breathing room around the single stem",
    "colorTreatment": "muted wash with gold leaf accents on the petal edges",
    "texture": "smooth watercolor paper texture",
    "avoidList": "no text, no letters, no words, no numbers, no clipart, no photorealistic faces, no busy backgrounds"
  },
  "illustrationPrompt": "Elegant watercolor illustration of a single iris stem with two blooms, one fully open in deep plum and one budding, with delicate gold leaf accents on the petal edges. Centered composition with generous negative space around the stem. Muted watercolor wash background in soft cream. Professional editorial illustration quality, clean and refined. No text, no letters, no words, no numbers.",
  "dnaHints": { "elegantCasual": 0.7, "traditionalModern": 0.3, "indoorOutdoor": 0.2, "formalPlayful": 0.6, "diyCatered": 0.4, "familyCorporate": 0.3 }
}

Example 2 (bold-graphic lane, theme "retro arcade birthday"):
{
  "conceptName": "Neon Drop",
  "description": "High-contrast black and electric magenta with pixel-art geometry — an 80s arcade aesthetic that hits like a spotlight.",
  "paletteColors": ["#FF006E", "#1A1A2E", "#F5F5F5", "#3A0CA3"],
  "fontPairingId": "bold-editorial",
  "borderStyle": "none",
  "layoutStyle": "full-bleed",
  "styleLaneId": "bold-graphic",
  "artDirection": {
    "illustrationMedium": "flat graphic design",
    "subjectFocus": "abstract geometric arcade shapes — triangles, circles, and grid lines in electric magenta and deep purple on black",
    "compositionType": "full-bleed geometric grid",
    "negativeSpace": "minimal — fills the frame with bold shapes",
    "colorTreatment": "saturated flat colors with high contrast",
    "texture": "smooth digital, slight pixel-art feel",
    "avoidList": "no text, no letters, no words, no numbers, no photorealistic elements, no gradients, no clipart"
  },
  "illustrationPrompt": "Bold flat graphic design illustration of abstract geometric arcade shapes — triangles, circles, and grid lines in electric magenta and deep purple on a black background. Full-bleed composition filling the frame. Saturated flat colors with high contrast. Pixel-art influenced but clean and modern. Professional graphic design quality. No text, no letters, no words, no numbers.",
  "dnaHints": { "elegantCasual": -0.8, "traditionalModern": 0.7, "indoorOutdoor": -0.5, "formalPlayful": -0.7, "diyCatered": -0.3, "familyCorporate": -0.4 }
}`;

const RESPONSE_SHAPE_INSTRUCTIONS = `You are a senior art director at a premium invitation studio. A non-professional host has described their party theme, and you need to produce complete, coordinated invitation design concepts that look like they came from a professional stationery designer — not generic AI output.

Your output must be STRICT JSON only — no markdown fences, no commentary.

## CREATIVE DIRECTION MATRIX

Each concept MUST be assigned to a DIFFERENT style lane. The lanes are:

${STYLE_LANE_DESCRIPTIONS}

${"```"}Always generate 6 concepts, one per style lane. If the host specified preferred style lanes below, include those lanes first, then fill remaining concepts with complementary distinct lanes. The quality gate will automatically select the best 4 to show the host.${"```"}

## QUALITY BAR

${FEW_SHOT_EXAMPLES}

## COLOR THEORY RULES

- paletteColors[0] = primary accent (used for headings, key UI elements)
- paletteColors[1] = secondary accent (borders, dividers, small details)
- paletteColors[2] = background or base tone (the card's overall wash)
- paletteColors[3] = contrast tone (used sparingly for emphasis or depth)
- Use proven color relationships:
  - Analogous: 3 hues adjacent on the color wheel (e.g. #4A90D9, #5B5EA6, #6B4E9E)
  - Complementary: base + opposite (e.g. #2D5F8A + #D49A3F with neutrals)
  - Monochromatic: same hue, different lightness (e.g. #1B3A5C, #4A7BA8, #B8D4E8, #F0F5FA)
  - Earthy tetrad: warm + cool naturals (e.g. #6B5344, #8B9D6F, #E8D5C4, #3D4A3D)
- AVOID clashing palettes — if two colors vibrate when placed next to each other, they clash
- AVOID using the same hue family across all 4 colors — a palette of all blues or all pinks looks flat
- Always include one light and one dark tone for contrast range

## ILLUSTRATION PROMPT RULES

The illustrationPrompt is the most important field — it directly controls the AI image generator. Write it like a professional art brief:

1. Start with the medium and style: "Elegant watercolor illustration" or "Bold flat vector illustration"
2. Describe the specific subject with sensory detail: "a single iris stem with two blooms, one fully open in deep plum and one budding"
3. Specify composition: "centered focal point with generous negative space" or "full-bleed geometric pattern"
4. Include color treatment: "muted wash in cream and plum with gold leaf accents"
5. End with the quality bar: "Professional illustration quality, clean and refined"
6. ALWAYS end with: "No text, no letters, no words, no numbers."
- Keep under 80 words but make every word count — this is an art brief, not a checkbox
- Be specific about what TO draw, not just what NOT to draw

## RESPONSE SHAPE

{
  "concepts": [
    {
      "conceptName": "short, evocative name — 2-4 words that capture the mood (e.g. 'Twilight Bloom', 'Neon Drop', 'Golden Hour')",
      "description": "one vivid sentence that sells the vibe — use sensory language, not generic adjectives. 'A moody palette of deep plum and brushed gold with a single watercolor iris' not 'An elegant design with nice colors'",
      "paletteColors": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"],
      "fontPairingId": "one of: ${FONT_PAIRING_IDS}",
      "borderStyle": "one of: ${BORDER_STYLE_IDS}",
      "layoutStyle": "one of: ${LAYOUT_STYLE_IDS}",
      "styleLaneId": "the id of the style lane (e.g. \"editorial-premium\", \"playful-illustrated\", \"bold-graphic\", \"storybook-whimsical\", \"minimal-modern\", \"handcrafted-rustic\")",
      "artDirection": {
        "illustrationMedium": "specific medium from this lane's options",
        "subjectFocus": "the exact subject of the illustration with visual detail",
        "compositionType": "how the subject is arranged in the frame",
        "negativeSpace": "how much empty space and where",
        "colorTreatment": "how the palette colors are applied to the illustration",
        "texture": "surface quality — paper, smooth, grain, foil, etc.",
        "avoidList": "what the image generator must NOT include"
      },
      "illustrationPrompt": "professional art brief combining all artDirection fields into one flowing description. MUST end with 'No text, no letters, no words, no numbers.'",
      "dnaHints": { ${DNA_HINT_AXIS_DESCRIPTIONS} }
    }
  ]
}

## RULES

- CRITICAL — SUBJECT SELECTION: First classify the theme, then choose subjects accordingly. Read each lane's "Subject guidance" carefully for how to render, but WHAT to render depends on theme type:

  A) SUBJECT-DRIVEN THEMES (the theme names a concrete subject that IS the party): construction, dinosaur, princess, superhero, unicorn, mermaid, space/astronaut, pirate, dragon, cars/trucks, safari/jungle, under-the-sea, farm (for kids), fairy, ninja, sports (basketball/soccer/etc.), music/rock, movie/character themes, holiday themes (halloween, christmas), etc. For these, the subject IS the point — hosts and guests EXPECT to see that subject prominently illustrated. Feature the subject in at least 3 of the 4 shown concepts, rendered in each lane's style (a construction party gets: watercolor bulldozer for editorial-premium, cartoon dump truck for playful-illustrated, bold flat hard-hat icon for bold-graphic, storybook excavator scene for storybook-whimsical, single minimal orange cone for minimal-modern, hand-drawn wooden-toy truck for handcrafted-rustic). NEVER default to generic confetti, geometric shapes, or botanicals when the theme names a specific subject. NEVER produce a concept that a host would look at and think "that has nothing to do with my theme".

  B) AESTHETIC/MOOD THEMES (the theme names a vibe, era, or aesthetic — not a subject): rustic farmhouse, minimalist beach, moody garden, tropical, boho, industrial, art deco, mid-century, coastal, Tuscan, garden party (adult), cocktail party, dinner party, holiday-mood (fall, winter), etc. For these, use abstract/botanical/geometric design-forward interpretations. Rustic farmhouse → wildflowers, eucalyptus, wheat stalks (NEVER roosters, pigs, cows, barns). Minimalist beach → abstract wave lines, single shell, sand-tone gradients (NEVER literal sand castles or beach umbrellas). Garden party → botanical florals (NEVER literal picnic tables). Think like a premium stationery designer.

  C) INSPIRATION IMAGES TAKE PRECEDENCE: If the host uploaded inspiration images and the extracted notes mention concrete subjects (hard hats, machinery, dinosaurs, specific characters, etc.), those subjects are the source of truth — feature them, don't override them with abstract shapes. The host chose those images to show you exactly what they want. Ignore the "aesthetic themes stay abstract" guidance when inspiration images provide concrete subject direction.

  When in doubt: would a designer at Minted, Papier, or Paperless Post feature this subject on an invitation for this theme? If yes, feature it. If the theme is a kid's party naming a specific subject (construction, dinosaur, etc.), the answer is always yes.
- Generate exactly 6 concepts, each in a DIFFERENT style lane. Use all 6 lanes. The quality gate will select the best 4 to show the host.
- Each concept should look like it came from a different professional designer — different font pairings, different border styles, different layout styles, different color moods, different illustration mediums.
- styleLaneId MUST be one of the lane ids listed above, and each concept MUST use a different lane.
- artDirection is REQUIRED for every concept.
- illustrationPrompt: write this like a professional art brief, NOT a field concatenation. Read the few-shot examples above for the quality bar.
- paletteColors: exactly 4 hex colors using proven color relationships (see COLOR THEORY RULES). Never use the same hue family for all 4.
- fontPairingId must be exactly one of the listed ids.
- borderStyle must be exactly one of the listed ids.
- layoutStyle: choose from the lane's preferred layouts. Use "banner" for standalone top art, "backdrop" for texture behind text, "split" for side-by-side, "centered" for small focal art with margins, "full-bleed" for art filling the card.
- dnaHints: honest read of where THIS concept sits on each axis, -1 to 1. Vary across concepts.
- Ground every concept in the given theme — don't produce generic designs unrelated to the party.
- conceptName and description: use vivid, sensory language. Make the host feel excited about each concept.
- If a "Host's established style so far" line is given below, let it influence at least 2 concepts while keeping all in different lanes.
- If a "Guest count and scale guidance" line is given below, follow it for layoutStyle and formality across at least 3 concepts.
- If "Previous concepts" and "Host's refinement feedback" are given below, produce NEW concepts that address the feedback while keeping the same theme.
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

const INSPIRATION_EXTRACTION_SYSTEM = `You are a design analyst. You are shown 1-3 inspiration images a party host uploaded to steer the direction of their invitation. Describe the shared visual direction in two compact sentences covering BOTH:

1) Subject matter — what generic objects, creatures, or scenes appear across the images (e.g. "construction vehicles and hard hats", "dinosaurs and prehistoric plants", "floral wreaths and wildflowers", "abstract geometric shapes"). Be concrete about generic subject types — the host chose these images to show you WHAT they want illustrated.
2) Style attributes — mood/tone, color palette, textures, and style descriptors (e.g. "cartoon-style, playful, primary colors", "delicate watercolor, muted earth tones").

Critical rules:
- DO extract generic subject types (hard hats, dinosaurs, flowers, mountains, animals-by-generic-category). These guide what appears in the illustration.
- Do NOT identify, name, or suggest copying any specific character, mascot, logo, brand, celebrity, or another party's exact invitation design/artwork. Generic "a cartoon dinosaur" is fine; naming a specific character or franchise is not.
- Never suggest reproducing a recognizable copyrighted or trademarked element. If the image contains such elements, describe only the generic subject category and style (colors, composition, texture, mood).
- Output plain prose, no lists, no preamble, under 60 words.`;

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
    params.inspirationNotes && `Direction from the host's inspiration images — use BOTH the generic subject matter AND the style/mood/palette. The host chose these images to show you what they want illustrated. Do NOT copy any specific named character, logo, brand, or another party's exact design, but generic subjects (hard hats, dinosaurs, wildflowers, etc.) SHOULD be featured in the concepts: ${params.inspirationNotes}`,
    preferredStyleLanesLine,
    previousConceptsSummary,
    params.feedback && `Host's refinement feedback: "${params.feedback}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
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
