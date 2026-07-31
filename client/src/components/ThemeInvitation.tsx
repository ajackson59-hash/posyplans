// The composed portrait invitation: curated artwork as an editable background
// with live HTML typography set on top of it.
//
// This is deliberately the ONE renderer shared by the gallery card, the studio
// preview, and the guest RSVP page — if a host sees it while choosing, that is
// exactly what a guest receives. It is a true 3:4 portrait design, never a
// photographed mockup.
//
// Type scales with the card rather than with the viewport: the container's own
// width drives a root size of 1% of card width, so a 200px gallery thumbnail
// and a 640px studio preview are the same design at different sizes.
//
// Composition is theme-directed, not uniform. Each theme names one of the
// existing layout archetypes, a border treatment, a paper texture and a
// palette-coloured vector motif — so the eight themes differ structurally
// rather than reading as one card in eight colourways.

import { useLayoutEffect, useRef, useState } from "react";
import {
  getFontPairingIdFor,
  getOverlay,
  getPaletteVariant,
  getPlacement,
  paletteVariantColors,
  type LaunchTheme,
  type OverlayTreatment,
  type PaperTexture,
  type TextureStyle,
  type ThemeCopy,
} from "@shared/themeCatalog";
import { borderStyleCss, getFontPairing, type LayoutStyle } from "@shared/inviteDesign";
import { cn } from "@/lib/utils";
import { ThemeArt } from "./ThemeArt";

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/** A rectangle on the 3:4 canvas, in percentages of the card. */
interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The existing layout archetypes, expressed as the region the artwork occupies
 * and the region the type sits in. These are the same five compositions the
 * live editor draws for AI concepts — banner puts art across the top, split
 * runs it down one side, centered insets it as a vignette, backdrop drops it
 * behind the words, full-bleed fills the card.
 */
const LAYOUT_FRAMES: Record<LayoutStyle, { art: Frame; type: Frame; artOpacity: number }> = {
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
 * whichever region the layout archetype reserves for type. A "left column"
 * placement stays a left column inside a split panel; a "raised" placement
 * stays raised inside a banner's lower half.
 */
function projectPlacement(box: Frame, frame: Frame): Frame {
  return {
    top: frame.top + (box.top * frame.height) / 100,
    left: frame.left + (box.left * frame.width) / 100,
    width: (box.width * frame.width) / 100,
    height: (box.height * frame.height) / 100,
  };
}

/** Grey paper grain, tuned per stock. Kept low so type contrast is untouched. */
const TEXTURE_STOCK: Record<TextureStyle, { frequency: string; octaves: number; opacity: number }> = {
  none: { frequency: "0", octaves: 1, opacity: 0 },
  cotton: { frequency: "0.72", octaves: 4, opacity: 0.13 },
  laid: { frequency: "0.03 0.9", octaves: 2, opacity: 0.12 },
  grain: { frequency: "0.95", octaves: 3, opacity: 0.17 },
  gloss: { frequency: "1.6", octaves: 1, opacity: 0.09 },
};

function textureLayer(texture: PaperTexture): React.CSSProperties | null {
  const stock = TEXTURE_STOCK[texture.style];
  const opacity = stock.opacity * texture.intensity;
  if (opacity <= 0) return null;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>` +
    `<filter id='t'><feTurbulence type='fractalNoise' baseFrequency='${stock.frequency}' numOctaves='${stock.octaves}' stitchTiles='stitch'/>` +
    `<feColorMatrix type='saturate' values='0'/></filter>` +
    `<rect width='140' height='140' filter='url(#t)'/></svg>`;
  return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, opacity };
}

/** Measures the rendered width so type can be expressed as a share of the card. */
function useCardWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Layout effect, not effect: the first measurement lands before paint, so the
  // type is set at the right size on the very first frame.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/**
 * Long event names must not overflow their placement box, and shrinking the
 * whole card would shrink the artwork with it — so the headline alone steps
 * down through a few sizes as it gets longer.
 */
function headlineScale(headline: string): number {
  const length = headline.trim().length;
  if (length <= 14) return 9.4;
  if (length <= 22) return 8;
  if (length <= 32) return 6.6;
  if (length <= 46) return 5.4;
  return 4.6;
}

export interface ThemeInvitationProps {
  theme: LaunchTheme;
  headline: string;
  copy: ThemeCopy;
  paletteVariantId?: string;
  placementId?: string;
  overlay?: OverlayTreatment;
  fontPairingId?: string;
  /** Optional host note, shown beneath the details. */
  message?: string;
  /** Use the smaller artwork file — for gallery grids. */
  thumbnail?: boolean;
  /** Suppresses the alt text when a caption already names the theme. */
  decorative?: boolean;
  className?: string;
}

export function ThemeInvitation({
  theme,
  headline,
  copy,
  paletteVariantId,
  placementId,
  overlay,
  fontPairingId,
  message,
  thumbnail = false,
  decorative = false,
  className,
}: ThemeInvitationProps) {
  const { ref, width } = useCardWidth();

  const palette = getPaletteVariant(theme, paletteVariantId);
  const placement = getPlacement(theme, placementId);
  const treatment = getOverlay(theme, overlay ?? theme.defaultOverlay);
  const font = getFontPairing(getFontPairingIdFor(theme, fontPairingId));
  const layout = LAYOUT_FRAMES[theme.layoutStyle];
  const artColors = paletteVariantColors(palette);

  const typeBox = projectPlacement(placement.box, layout.type);
  // Type scales with its own column, not the card, so a split panel is set at a
  // column size rather than at headline size squeezed into half the width.
  const rootSize = (width / 100) * Math.max(0.62, layout.type.width / 100);
  const frameUnit = Math.max(0.6, width / 380);
  const texture = textureLayer(theme.texture);
  const border = borderStyleCss(theme.borderStyle, palette.accent, frameUnit);

  const headingFont: React.CSSProperties = {
    fontFamily: font.headingFontFamily,
    fontWeight: font.headingWeight,
    fontStyle: font.headingStyle,
    letterSpacing: font.headingLetterSpacing,
  };

  const overlayNode = (() => {
    switch (treatment) {
      case "veil":
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: `${typeBox.top - 4}%`,
              left: `${typeBox.left - 4}%`,
              width: `${typeBox.width + 8}%`,
              height: `${typeBox.height + 8}%`,
              background: `radial-gradient(ellipse at center, ${rgba(palette.surface, 0.82)} 45%, ${rgba(palette.surface, 0)} 78%)`,
            }}
          />
        );
      case "plate":
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: `${typeBox.top - 5}%`,
              left: `${typeBox.left - 5}%`,
              width: `${typeBox.width + 10}%`,
              height: `${typeBox.height + 10}%`,
              backgroundColor: rgba(palette.surface, 0.94),
              boxShadow: `0 ${rootSize * 0.6}px ${rootSize * 2.4}px ${rgba("#000000", 0.12)}`,
            }}
          />
        );
      case "gradient":
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, ${rgba(palette.surface, 0.72)} 0%, ${rgba(palette.surface, 0.34)} 45%, ${rgba(palette.surface, 0)} 78%)`,
            }}
          />
        );
      default:
        return null;
    }
  })();

  const artNode = (() => {
    const { id, placement: spot, opacity, scale } = theme.art;
    const art = (extra?: React.CSSProperties, key?: string) => (
      <div key={key} className="absolute" style={extra}>
        <ThemeArt artId={id} colors={artColors} />
      </div>
    );

    switch (spot) {
      case "corner-mirrored": {
        const size = `${34 * scale}%`;
        const corners: React.CSSProperties[] = [
          { top: 0, left: 0 },
          { top: 0, right: 0, transform: "scaleX(-1)" },
          { bottom: 0, left: 0, transform: "scaleY(-1)" },
          { bottom: 0, right: 0, transform: "scale(-1, -1)" },
        ];
        return corners.map((c, i) => art({ ...c, width: size, aspectRatio: "1 / 1" }, `corner-${i}`));
      }
      case "side-mirrored": {
        const size = `${20 * scale}%`;
        return [
          art({ top: 0, left: 0, height: "100%", width: size }, "side-l"),
          art({ top: 0, right: 0, height: "100%", width: size, transform: "scaleX(-1)" }, "side-r"),
        ];
      }
      case "band": {
        const size = `${13 * scale}%`;
        return [
          art({ top: 0, left: 0, right: 0, height: size }, "band-t"),
          art({ bottom: 0, left: 0, right: 0, height: size, transform: "scaleY(-1)" }, "band-b"),
        ];
      }
      case "asymmetric":
        return art({ top: "3%", right: "-6%", width: `${48 * scale}%`, aspectRatio: "1 / 1" }, "asymmetric");
      default:
        return art({ inset: 0 }, "scatter");
    }
  })();

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[3/4] w-full overflow-hidden", className)}
      style={{ backgroundColor: palette.surface }}
      data-theme-id={theme.id}
      data-layout={theme.layoutStyle}
      data-border={theme.borderStyle}
      data-texture={theme.texture.style}
      data-art={theme.art.id}
    >
      <div
        className="absolute overflow-hidden"
        style={{
          top: `${layout.art.top}%`,
          left: `${layout.art.left}%`,
          width: `${layout.art.width}%`,
          height: `${layout.art.height}%`,
          opacity: layout.artOpacity,
        }}
      >
        <img
          src={thumbnail ? theme.artwork.thumbUrl : theme.artwork.fullUrl}
          alt={decorative ? "" : theme.artwork.alt}
          aria-hidden={decorative || undefined}
          width={theme.artwork.width}
          height={theme.artwork.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover"
          style={{ objectPosition: theme.artFocus }}
        />
      </div>

      {texture && <div aria-hidden className="pointer-events-none absolute inset-0" style={texture} />}

      <div
        aria-hidden
        data-art-layer
        className="pointer-events-none absolute inset-0"
        style={{ opacity: theme.art.opacity }}
      >
        {artNode}
      </div>

      {overlayNode}

      {theme.borderStyle !== "none" && (
        <div
          aria-hidden
          data-testid="theme-invitation-frame"
          className="pointer-events-none absolute"
          style={{ top: "3.2%", left: "2.4%", right: "2.4%", bottom: "3.2%", ...border }}
        />
      )}

      <div
        className="absolute flex flex-col"
        style={{
          top: `${typeBox.top}%`,
          left: `${typeBox.left}%`,
          width: `${typeBox.width}%`,
          height: `${typeBox.height}%`,
          fontSize: `${rootSize}px`,
          textAlign: placement.align,
          alignItems:
            placement.align === "center" ? "center" : placement.align === "right" ? "flex-end" : "flex-start",
          justifyContent:
            placement.justify === "center" ? "center" : placement.justify === "end" ? "flex-end" : "flex-start",
        }}
      >
        {copy.eyebrow && (
          <p
            style={{
              fontFamily: font.bodyFontFamily,
              color: palette.accent,
              fontSize: "2.7em",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              lineHeight: 1.5,
            }}
          >
            {copy.eyebrow}
          </p>
        )}

        <h2
          style={{
            ...headingFont,
            color: palette.ink,
            fontSize: `${headlineScale(headline)}em`,
            lineHeight: 1.08,
            marginTop: "1.6em",
            textWrap: "balance",
          }}
        >
          {headline}
        </h2>

        <Divider style={theme.divider} accent={palette.accent} rootSize={rootSize} />

        <div style={{ fontFamily: font.bodyFontFamily, color: palette.body, lineHeight: 1.65 }}>
          {copy.dateLine && <p style={{ fontSize: "3.3em" }}>{copy.dateLine}</p>}
          {copy.timeLine && <p style={{ fontSize: "3em" }}>{copy.timeLine}</p>}
          {copy.locationLine && (
            <p style={{ fontSize: "3em", marginTop: "0.7em" }}>{copy.locationLine}</p>
          )}
        </div>

        {message && (
          <p
            style={{
              fontFamily: font.bodyFontFamily,
              color: palette.body,
              fontSize: "2.8em",
              lineHeight: 1.7,
              marginTop: "1.6em",
              maxWidth: "34em",
            }}
          >
            {message}
          </p>
        )}

        {copy.rsvpLine && (
          <p
            style={{
              fontFamily: font.bodyFontFamily,
              color: palette.accent,
              fontSize: "2.5em",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              lineHeight: 1.6,
              marginTop: "3.4em",
            }}
          >
            {copy.rsvpLine}
          </p>
        )}
      </div>
    </div>
  );
}

function Divider({
  style,
  accent,
  rootSize,
}: {
  style: LaunchTheme["divider"];
  accent: string;
  rootSize: number;
}) {
  if (style === "none") return null;
  const weight = Math.max(1, rootSize * 0.14);
  const spacing: React.CSSProperties = { marginTop: "4em", marginBottom: "4em", opacity: 0.85 };

  if (style === "dots") {
    return (
      <div aria-hidden style={{ ...spacing, display: "flex", gap: "1.2em" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{ width: weight * 2.4, height: weight * 2.4, borderRadius: "50%", backgroundColor: accent }}
          />
        ))}
      </div>
    );
  }

  if (style === "diamond-rule") {
    return (
      <div aria-hidden style={{ ...spacing, display: "flex", alignItems: "center", gap: "1.4em" }}>
        <span style={{ width: "6em", height: weight, backgroundColor: accent }} />
        <span style={{ width: weight * 3, height: weight * 3, backgroundColor: accent, transform: "rotate(45deg)" }} />
        <span style={{ width: "6em", height: weight, backgroundColor: accent }} />
      </div>
    );
  }

  return <div aria-hidden style={{ ...spacing, width: "18%", height: weight, backgroundColor: accent }} />;
}
