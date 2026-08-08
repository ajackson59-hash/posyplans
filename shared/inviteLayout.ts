// The invitation layout geometry, in one place.
//
// This was previously private to client/src/components/ThemeInvitation.tsx.
// It moved here unchanged so the server-side layout-compatibility validator
// measures the *same* rectangles the renderer paints — a validator working
// from its own copy of the geometry is a validator that drifts.
//
// Values are identical to the ones the renderer has always used; nothing here
// changes how any existing theme composes.

import type { LayoutStyle } from "./inviteDesign";

/** A rectangle on the 3:4 canvas, in percentages of the card. */
export interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The five layout archetypes, expressed as the region the artwork occupies and
 * the region the type sits in — banner puts art across the top, split runs it
 * down one side, centered insets it as a vignette, backdrop drops it behind
 * the words, full-bleed fills the card.
 */
export const LAYOUT_FRAMES: Record<LayoutStyle, { art: Frame; type: Frame; artOpacity: number }> = {
  "full-bleed": {
    art: { top: 0, left: 0, width: 100, height: 100 },
    type: { top: 0, left: 0, width: 100, height: 100 },
    artOpacity: 1,
  },
  backdrop: {
    art: { top: 0, left: 0, width: 100, height: 100 },
    type: { top: 0, left: 0, width: 100, height: 100 },
    artOpacity: 0.3,
  },
  banner: {
    art: { top: 0, left: 0, width: 100, height: 44 },
    type: { top: 46, left: 6, width: 88, height: 50 },
    artOpacity: 1,
  },
  split: {
    art: { top: 0, left: 0, width: 40, height: 100 },
    type: { top: 4, left: 44, width: 52, height: 92 },
    artOpacity: 1,
  },
  centered: {
    art: { top: 6, left: 12, width: 76, height: 34 },
    type: { top: 44, left: 8, width: 84, height: 52 },
    artOpacity: 1,
  },
};

/**
 * Maps a theme's curated placement — authored against the full canvas — into
 * whichever region the layout archetype reserves for type.
 */
export function projectPlacement(box: Frame, frame: Frame): Frame {
  return {
    top: frame.top + (box.top * frame.height) / 100,
    left: frame.left + (box.left * frame.width) / 100,
    width: (box.width * frame.width) / 100,
    height: (box.height * frame.height) / 100,
  };
}

/** No text ever crosses this margin. */
export const SAFE_INSET = { x: 8, y: 7 };

export function withinSafeArea(frame: Frame): Frame {
  const top = Math.max(frame.top, SAFE_INSET.y);
  const left = Math.max(frame.left, SAFE_INSET.x);
  const bottom = Math.min(frame.top + frame.height, 100 - SAFE_INSET.y);
  const right = Math.min(frame.left + frame.width, 100 - SAFE_INSET.x);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The sub-rectangle of a source image that survives CSS `object-fit: cover`
 * into a destination box, in fractions (0-1) of the source. This is how the
 * gate answers "will the crop eat the focal subject?" before paying for a
 * second image.
 *
 * `objectPosition` is the same 0-1 pair CSS uses (0.5/0.5 is centre).
 */
export function objectCoverSourceRect(
  source: { width: number; height: number },
  destination: { width: number; height: number },
  objectPosition: { x: number; y: number } = { x: 0.5, y: 0.5 },
): { x: number; y: number; width: number; height: number } {
  if (source.width <= 0 || source.height <= 0 || destination.width <= 0 || destination.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const sourceAspect = source.width / source.height;
  const destAspect = destination.width / destination.height;

  if (sourceAspect > destAspect) {
    // Source is wider: full height is kept, the sides are cropped.
    const visibleWidth = destAspect / sourceAspect;
    return { x: (1 - visibleWidth) * objectPosition.x, y: 0, width: visibleWidth, height: 1 };
  }
  // Source is taller: full width is kept, top/bottom are cropped.
  const visibleHeight = sourceAspect / destAspect;
  return { x: 0, y: (1 - visibleHeight) * objectPosition.y, width: 1, height: visibleHeight };
}

/** Parses a CSS `object-position` like "50% 30%" into 0-1 fractions. */
export function parseObjectPosition(value: string | undefined): { x: number; y: number } {
  const parts = (value || "50% 50%").trim().split(/\s+/);
  const read = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const m = /^(-?[\d.]+)%$/.exec(raw);
    if (m) return Math.min(1, Math.max(0, parseFloat(m[1]) / 100));
    if (raw === "left" || raw === "top") return 0;
    if (raw === "right" || raw === "bottom") return 1;
    if (raw === "center") return 0.5;
    return fallback;
  };
  return { x: read(parts[0], 0.5), y: read(parts[1], 0.5) };
}
