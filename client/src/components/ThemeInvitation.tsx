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

import { useLayoutEffect, useRef, useState } from "react";
import {
  getFontPairingIdFor,
  getOverlay,
  getPaletteVariant,
  getPlacement,
  type LaunchTheme,
  type OverlayTreatment,
  type ThemeCopy,
} from "@shared/themeCatalog";
import { getFontPairing } from "@shared/inviteDesign";
import { cn } from "@/lib/utils";

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
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

  // 1em === 1% of the card's width, so every size below reads as a percentage.
  const rootSize = width / 100;

  const headingFont: React.CSSProperties = {
    fontFamily: font.headingFontFamily,
    fontWeight: font.headingWeight,
    fontStyle: font.headingStyle,
    letterSpacing: font.headingLetterSpacing,
  };

  const box: React.CSSProperties = {
    top: `${placement.box.top}%`,
    left: `${placement.box.left}%`,
    width: `${placement.box.width}%`,
    height: `${placement.box.height}%`,
  };

  const overlayNode = (() => {
    switch (treatment) {
      case "veil":
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: `${placement.box.top - 4}%`,
              left: `${placement.box.left - 4}%`,
              width: `${placement.box.width + 8}%`,
              height: `${placement.box.height + 8}%`,
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
              top: `${placement.box.top - 5}%`,
              left: `${placement.box.left - 5}%`,
              width: `${placement.box.width + 10}%`,
              height: `${placement.box.height + 10}%`,
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

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[3/4] w-full overflow-hidden", className)}
      style={{ backgroundColor: palette.surface }}
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
      />

      {overlayNode}

      <div
        className="absolute flex flex-col"
        style={{
          ...box,
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

        <div
          aria-hidden
          style={{
            width: "18%",
            height: Math.max(1, rootSize * 0.14),
            backgroundColor: palette.accent,
            marginTop: "4em",
            marginBottom: "4em",
            opacity: 0.85,
          }}
        />

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
