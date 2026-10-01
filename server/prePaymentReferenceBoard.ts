import type { Event } from "@shared/schema";
import type { ArtworkReferenceImage } from "./aiFirst/artwork";
import { buildDirectionCard } from "./prePaymentPreviewQuality";

export const REFERENCE_BOARD_DATA_URL_PREFIX =
  "data:image/svg+xml;posy-kind=reference-board;base64,";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

function textBlock(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  className: string,
): string {
  return `<text x="${x}" y="${y}" class="${className}">${lines
    .map((line, index) =>
      `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function embeddedImage(reference: ArtworkReferenceImage): string {
  return `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`;
}

/**
 * A named entertainment theme needs exact visual evidence, not an increasingly
 * confident AI approximation. This board presents only the host's own uploaded
 * reference pixels alongside the event details Posy captured. It is therefore
 * deterministic, private and free of image-provider spend.
 */
export async function renderReferenceBoardSvg(
  event: Event,
  references: ArtworkReferenceImage[],
): Promise<string> {
  if (references.length < 1 || references.length > 2) {
    throw new Error("A reference board requires one or two images.");
  }

  const card = await buildDirectionCard(event);
  const [ink, accent, paper, soft] = card.palette;
  const eventLines = wrapWords(card.eventName, 31, 2);
  const headlineLines = wrapWords(card.headline, 27, 2);
  const galleryY = 302;
  const galleryHeight = 422;
  const gap = 26;
  const galleryX = 72;
  const galleryWidth = 880;
  const panelWidth = references.length === 1
    ? galleryWidth
    : (galleryWidth - gap) / 2;

  const panels = references.map((reference, index) => {
    const x = galleryX + index * (panelWidth + gap);
    const imageX = x + 14;
    const imageY = galleryY + 14;
    const imageWidth = panelWidth - 28;
    const imageHeight = galleryHeight - 28;
    const clipId = `referenceClip${index + 1}`;
    return `
      <defs>
        <clipPath id="${clipId}">
          <rect x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" rx="22" />
        </clipPath>
      </defs>
      <rect x="${x}" y="${galleryY}" width="${panelWidth}" height="${galleryHeight}" rx="30"
        fill="#ffffff" fill-opacity="0.88" stroke="${escapeXml(ink)}" stroke-opacity="0.18" stroke-width="2" />
      <image x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}"
        preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"
        href="${embeddedImage(reference)}" />`;
  }).join("\n");

  const cueRows = card.cues.slice(0, 4).map((cue, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const x = 72 + column * 448;
    const y = 766 + row * 74;
    return `<g transform="translate(${x} ${y})">
      <rect width="422" height="54" rx="27" fill="#ffffff" fill-opacity="0.72"
        stroke="${escapeXml(soft)}" stroke-width="2" />
      <circle cx="29" cy="27" r="7" fill="${escapeXml(accent)}" />
      <text x="48" y="35" class="cue">${escapeXml(cue)}</text>
    </g>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"
  role="img" aria-label="${escapeXml(card.eventName)} visual reference board"
  data-posy-preview-kind="reference-board">
  <defs>
    <linearGradient id="referenceWash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(paper)}" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>
    <filter id="referenceShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#1b211d" flood-opacity="0.12" />
    </filter>
  </defs>
  <rect width="1024" height="1024" fill="${escapeXml(paper)}" />
  <circle cx="926" cy="70" r="220" fill="${escapeXml(accent)}" fill-opacity="0.14" />
  <circle cx="52" cy="972" r="240" fill="${escapeXml(soft)}" fill-opacity="0.24" />
  <rect x="38" y="38" width="948" height="948" rx="42" fill="url(#referenceWash)"
    stroke="${escapeXml(ink)}" stroke-opacity="0.16" stroke-width="2" filter="url(#referenceShadow)" />

  <text x="72" y="86" class="eyebrow">VISUAL REFERENCE CAPTURED</text>
  <text x="952" y="88" text-anchor="end" class="posy">posy</text>
  ${textBlock(eventLines, 72, 150, 52, "event")}
  ${textBlock(headlineLines, 72, eventLines.length > 1 ? 254 : 214, 58, "headline")}
  <text x="72" y="286" class="subcopy">Your exact inspiration, anchored to the event details you shared.</text>

  ${panels}
  ${cueRows}

  <text x="72" y="948" class="foot">REFERENCE-BACKED FIRST LOOK · NOT A GENERIC AI SUBSTITUTE</text>
  <style>
    .eyebrow { font: 700 17px system-ui, -apple-system, sans-serif; letter-spacing: 3.6px; fill: ${escapeXml(ink)}; opacity: .72; }
    .posy { font: 400 34px Georgia, serif; letter-spacing: 5px; fill: ${escapeXml(ink)}; }
    .event { font: 500 42px Georgia, serif; fill: ${escapeXml(ink)}; }
    .headline { font: 700 58px Georgia, serif; fill: ${escapeXml(ink)}; }
    .subcopy { font: 400 22px system-ui, -apple-system, sans-serif; fill: ${escapeXml(ink)}; opacity: .72; }
    .cue { font: 600 22px system-ui, -apple-system, sans-serif; fill: ${escapeXml(ink)}; }
    .foot { font: 700 15px system-ui, -apple-system, sans-serif; letter-spacing: 2.1px; fill: ${escapeXml(ink)}; opacity: .58; }
  </style>
</svg>`;
}

export async function referenceBoardDataUrl(
  event: Event,
  references: ArtworkReferenceImage[],
): Promise<string> {
  const svg = await renderReferenceBoardSvg(event, references);
  return `${REFERENCE_BOARD_DATA_URL_PREFIX}${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function isReferenceBoardDataUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(REFERENCE_BOARD_DATA_URL_PREFIX));
}
