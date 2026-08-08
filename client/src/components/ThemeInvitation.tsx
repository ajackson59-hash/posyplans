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
import { borderStyleCss, getFontPairing } from "@shared/inviteDesign";
import {
  LAYOUT_FRAMES,
  projectPlacement,
  withinSafeArea,
  type Frame,
} from "@shared/inviteLayout";
import { cn } from "@/lib/utils";
import { ThemeArt } from "./ThemeArt";

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
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

/** Measures the set type so the block can be kept inside the safe area. */
function useTypeHeight() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setHeight(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setHeight(entries[0]?.contentRect.height ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
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
  /**
   * Overrides the layout archetype's artwork opacity. Only the AI-first
   * pipeline sets this, and only to rescue a focal subject that `backdrop`'s
   * 30% wash would erase. Left undefined — as every curated theme leaves it —
   * the layout's own opacity is used, so studio compositions are untouched.
   */
  artworkOpacity?: number;
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
  artworkOpacity,
  className,
}: ThemeInvitationProps) {
  const { ref, width } = useCardWidth();
  const { ref: typeRef, height: typeHeight } = useTypeHeight();

  const palette = getPaletteVariant(theme, paletteVariantId);
  const placement = getPlacement(theme, placementId);
  const treatment = getOverlay(theme, overlay ?? theme.defaultOverlay);
  const font = getFontPairing(getFontPairingIdFor(theme, fontPairingId));
  const layout = LAYOUT_FRAMES[theme.layoutStyle];
  const artColors = paletteVariantColors(palette);

  const band = withinSafeArea(layout.type);
  const typeBox = withinSafeArea(projectPlacement(placement.box, layout.type));
  // Type scales with its own column, not the card, so a split panel is set at a
  // column size rather than at headline size squeezed into half the width.
  const rootSize = (width / 100) * Math.max(0.62, layout.type.width / 100);
  const frameUnit = Math.max(0.6, width / 380);
  const texture = textureLayer(theme.texture);
  const border = borderStyleCss(theme.borderStyle, palette.accent, frameUnit);

  // Anchor the set type on the curated placement, then slide it back inside the
  // safe band if the copy has grown taller than the box the theme reserved.
  const cardHeight = (width * 4) / 3;
  const typeHeightPct = cardHeight > 0 ? (typeHeight / cardHeight) * 100 : 0;
  const bandBottom = band.top + band.height;
  const boxBottom = typeBox.top + typeBox.height;
  const anchored =
    placement.justify === "center"
      ? (typeBox.top + boxBottom - typeHeightPct) / 2
      : placement.justify === "end"
        ? boxBottom - typeHeightPct
        : typeBox.top;
  const typeTop = typeHeightPct
    ? Math.min(Math.max(anchored, band.top), Math.max(band.top, bandBottom - typeHeightPct))
    : typeBox.top;
  const textBlock: Frame = {
    top: typeTop,
    left: typeBox.left,
    width: typeBox.width,
    height: typeHeightPct || typeBox.height,
  };

  // Decoration recedes behind the words: the motif layer is masked out over the
  // block of type, so no theme can drop a petal or a confetti chip on a line.
  const typeMask =
    `radial-gradient(ellipse ${textBlock.width * 0.85}% ${textBlock.height * 0.92}% at ` +
    `${textBlock.left + textBlock.width / 2}% ${textBlock.top + textBlock.height / 2}%, ` +
    `rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) 55%, rgba(0,0,0,1) 100%)`;

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
            // A blurred plate, not a radial gradient: a gradient wide enough to
            // still cover the first and last line leaves a visible rectangular
            // seam where it meets the edge of its own box.
            style={{
              top: `${textBlock.top - 3}%`,
              left: `${textBlock.left - 3}%`,
              width: `${textBlock.width + 6}%`,
              height: `${textBlock.height + 6}%`,
              backgroundColor: rgba(palette.surface, 0.86),
              borderRadius: `${rootSize * 4}px`,
              filter: `blur(${rootSize * 2.6}px)`,
            }}
          />
        );
      case "plate":
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: `${textBlock.top - 4}%`,
              left: `${textBlock.left - 5}%`,
              width: `${textBlock.width + 10}%`,
              height: `${textBlock.height + 8}%`,
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
        const size = `${24 * scale}%`;
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
        return art({ top: "4%", right: "-4%", width: `${40 * scale}%`, aspectRatio: "1 / 1" }, "asymmetric");
      default: {
        // Tiled at the card's own 3:4 ratio, so each tile is square and the
        // motif keeps its drawn proportions. Stretching one instance across the
        // whole card turned confetti chips into hand-sized capsules.
        const cols = 3;
        const rows = 4;
        return Array.from({ length: cols * rows }, (_, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return art(
            {
              top: `${(row * 100) / rows}%`,
              left: `${(col * 100) / cols}%`,
              width: `${100 / cols}%`,
              height: `${100 / rows}%`,
              transform: `scale(${col % 2 ? -1 : 1}, ${row % 2 ? -1 : 1})`,
            },
            `scatter-${i}`,
          );
        });
      }
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
          opacity: artworkOpacity ?? layout.artOpacity,
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
        style={{ opacity: theme.art.opacity, WebkitMaskImage: typeMask, maskImage: typeMask }}
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
        ref={typeRef}
        data-testid="theme-invitation-type"
        data-safe-top={band.top}
        data-safe-bottom={bandBottom}
        className="absolute flex flex-col"
        style={{
          top: `${typeTop}%`,
          left: `${typeBox.left}%`,
          width: `${typeBox.width}%`,
          fontSize: `${rootSize}px`,
          gap: "2.1em",
          textAlign: placement.align,
          alignItems:
            placement.align === "center" ? "center" : placement.align === "right" ? "flex-end" : "flex-start",
        }}
      >
        {copy.eyebrow && (
          <p
            style={{
              fontFamily: font.bodyFontFamily,
              color: palette.accent,
              fontSize: "2.7em",
              fontWeight: 600,
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
              marginTop: "1.2em",
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
  const spacing: React.CSSProperties = { marginTop: "0.7em", marginBottom: "0.7em", opacity: 0.85 };

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
