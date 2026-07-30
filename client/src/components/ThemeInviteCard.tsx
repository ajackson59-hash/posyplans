/**
 * ThemeInviteCard — renders a curated theme as a complete, premium invitation
 * card with SVG decorative art, proper typography hierarchy, and beautiful
 * composition. This is what replaces AI-generated illustrations.
 *
 * The card is designed to look competitive with Paperless Post / Greenvelope:
 * - Layered SVG decorative elements (not flat colors)
 * - Proper invitation hierarchy (title, date, venue, RSVP)
 * - Sophisticated border/frame treatments
 * - Texture overlays for depth
 */

import { ThemeArt } from "./ThemeArt";
import { conceptHeadingStyle, conceptBodyStyle, conceptBorderStyle, getFontPairing } from "@shared/inviteDesign";
import { linerPatternStyle, stampGlyph, shadeHex, readableInk } from "@shared/themeDna";
import type { CuratedTheme } from "@shared/themeLibrary";
import { applyInviteTokens } from "@shared/inviteTokens";
import type { EventRecord } from "@/lib/types";

interface ThemeInviteCardProps {
  theme: CuratedTheme;
  event?: EventRecord;
  /** "full" = full-size card, "thumb" = compact preview for gallery grid */
  variant?: "full" | "thumb";
  className?: string;
}

export default function ThemeInviteCard({ theme, event, variant = "full", className }: ThemeInviteCardProps) {
  const { concept, decorativeArt, accentColor, cardBackground, envelopeColor, linerPattern, linerColor, stampStyle, stampColor } = theme;
  const font = getFontPairing(concept.fontPairingId);
  const isThumb = variant === "thumb";
  const scale = isThumb ? 0.45 : 1;

  // Preview text — use event data if available, otherwise elegant placeholder
  const tokenCtx = {
    eventName: event?.eventName || "Sofia's Garden Party",
    eventDate: event?.eventDate || "Saturday, June 15th",
    location: event?.location || "The Rosewood Terrace",
    hostNames: event?.hostNames || "Sofia Taylor",
  };
  const subject = applyInviteTokens(event?.inviteSubject || "You're invited to {{eventName}}!", tokenCtx);
  const message = applyInviteTokens(event?.inviteMessage || "Join us on {{eventDate}} at {{location}}. We can't wait to celebrate with you!", tokenCtx);

  // Ink color for text on the card background
  const ink = readableInk(cardBackground || concept.paletteColors[2] || "#fef7ed");
  const headingColor = concept.paletteColors[0];
  const bodyColor = shadeHex(ink, -0.15);
  const stampMark = stampGlyph(stampStyle);
  const isDark = readableInk(cardBackground || "#ffffff") === "#fdfbf7";

  // Layout varies by theme — each decorative art type has a natural composition
  const isCornerArt = decorativeArt === "rose-corner" || decorativeArt === "art-deco-fan";
  const isTopBanner = decorativeArt === "botanical-sprig" || decorativeArt === "bunting-garland" || decorativeArt === "vintage-lace";
  const isFullBleed = decorativeArt === "confetti-scatter" || decorativeArt === "terrazzo" || decorativeArt === "sunburst-rays" || decorativeArt === "starry-night" || decorativeArt === "balloon-bouquet";

  return (
    <div
      className={`relative overflow-hidden rounded-lg shadow-xl ring-1 ring-black/5 ${className || ""}`}
      style={{
        backgroundColor: cardBackground || concept.paletteColors[2],
        ...conceptBorderStyle(concept),
        minHeight: isThumb ? "200px" : "360px",
      }}
    >
      {/* Paper texture overlay — subtle grain that reads as premium paper stock */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23n)' opacity='0.03' /%3E%3C/svg%3E")`,
          opacity: 0.5,
        }}
      />

      {/* ═══ Corner art (rose, deco fan) — positioned in top corners ═══ */}
      {isCornerArt && (
        <>
          <div className="absolute left-0 top-0" style={{ opacity: 0.9 }}>
            <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} />
          </div>
          <div className="absolute right-0 top-0" style={{ transform: "scaleX(-1)", opacity: 0.9 }}>
            <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} />
          </div>
        </>
      )}

      {/* ═══ Top banner art (sprig, bunting, lace) ═══ */}
      {isTopBanner && decorativeArt === "vintage-lace" && (
        <div className="absolute inset-x-0 top-0">
          <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} className="w-full" />
        </div>
      )}
      {isTopBanner && decorativeArt !== "vintage-lace" && (
        <div className="flex justify-center pt-2" style={{ opacity: 0.9 }}>
          <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} />
        </div>
      )}

      {/* ═══ Full-bleed background art (confetti, terrazzo, sunburst, stars, balloons) ═══ */}
      {isFullBleed && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0.4 }}>
          <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale * 1.5} className="w-full h-full" />
        </div>
      )}

      {/* ═══ Invitation content ═══ */}
      <div
        className={`relative flex flex-col items-center justify-center text-center ${isThumb ? "p-4" : "p-8"}`}
        style={{ minHeight: isThumb ? "200px" : "360px" }}
      >
        {/* Decorative top accent line for elegant themes */}
        {theme.category === "elegant" && (
          <div
            className="mb-3 flex items-center gap-2"
            style={{ opacity: 0.6 }}
          >
            <div className="h-px w-8" style={{ backgroundColor: accentColor }} />
            <div className="h-1 w-1 rotate-45" style={{ backgroundColor: accentColor }} />
            <div className="h-px w-8" style={{ backgroundColor: accentColor }} />
          </div>
        )}

        {/* Subject / Title */}
        <p
          className={isThumb ? "text-sm font-semibold leading-tight" : "text-xl font-semibold leading-tight"}
          style={{
            ...conceptHeadingStyle(concept),
            color: isDark ? headingColor : shadeHex(headingColor, 0.1),
            maxWidth: "85%",
          }}
        >
          {subject}
        </p>

        {/* Divider */}
        <div
          className={`my-3 ${isThumb ? "w-12" : "w-20"} h-px`}
          style={{ backgroundColor: accentColor, opacity: 0.5 }}
        />

        {/* Message / Details */}
        <p
          className={isThumb ? "text-[9px] leading-relaxed" : "text-sm leading-relaxed"}
          style={{
            ...conceptBodyStyle(concept),
            color: isDark ? bodyColor : shadeHex(bodyColor, 0.05),
            maxWidth: "80%",
          }}
        >
          {isThumb ? message.slice(0, 80) + "…" : message}
        </p>

        {/* RSVP line */}
        {!isThumb && (
          <p
            className="mt-4 text-xs uppercase tracking-widest"
            style={{
              ...conceptBodyStyle(concept),
              color: accentColor,
              opacity: 0.7,
            }}
          >
            Kindly RSVP
          </p>
        )}

        {/* Palette dots — subtle color reference at bottom */}
        {isThumb && (
          <div className="mt-auto flex gap-1 pt-2">
            {concept.paletteColors.slice(0, 4).map((color, i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color, opacity: 0.6 }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom corner art (mirror of top) */}
      {isCornerArt && (
        <>
          <div className="absolute bottom-0 left-0" style={{ transform: "scaleY(-1)", opacity: 0.9 }}>
            <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} />
          </div>
          <div className="absolute bottom-0 right-0" style={{ transform: "scale(-1, -1)", opacity: 0.9 }}>
            <ThemeArt artId={decorativeArt} colors={concept.paletteColors} scale={scale} />
          </div>
        </>
      )}

      {/* Envelope preview strip at bottom (thumb only) */}
      {isThumb && (
        <div className="relative flex items-center gap-2 border-t border-black/5 px-3 py-1.5" style={{ backgroundColor: shadeHex(cardBackground || "#ffffff", -0.03) }}>
          <div
            className="h-4 w-6 rounded-sm"
            style={{ backgroundColor: envelopeColor }}
          />
          <span className="text-[8px]" style={{ color: bodyColor, opacity: 0.5 }}>
            {stampMark.glyph} {stampMark.label}
          </span>
          <div
            className="ml-auto h-4 w-8 rounded-sm"
            style={linerPatternStyle(linerPattern, linerColor, cardBackground || "#ffffff") as React.CSSProperties}
          />
        </div>
      )}
    </div>
  );
}
