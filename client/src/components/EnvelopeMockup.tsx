/**
 * EnvelopeMockup — the physical envelope presentation shared by the host-facing
 * Design Studio preview and the guest-facing RSVP page.
 *
 * This exists as one component precisely so those two views cannot drift: a host
 * who styles an envelope in the editor is looking at the same renderer a guest
 * will see. Any change here lands in both places at once.
 *
 * Rendering finish is driven by the concept's style lane (see envelopeFinish):
 *   premium — heavier stock, tighter shadow, wax seal
 *   playful — brighter contrast, postage-style stamp
 *
 * The opening choreography is intentionally shared across both finishes. Theme
 * personality belongs in the stationery, not in a bouncy interaction.
 *
 * Palette colours arrive unconstrained from the model, so every piece of text
 * drawn here derives its own ink from the underlying colour's luminance rather
 * than trusting a palette token to be legible.
 */
import {
  linerPatternStyle,
  stampGlyph,
  readableInk,
  shadeHex,
  flapAnimationMs,
  ENVELOPE_TURN_MS,
  type EnvelopeFinish,
  type LinerPattern,
  type StampStyle,
} from "@shared/themeDna";
import type { EnvelopePostageOption } from "@shared/themeCatalog";
import { useId } from "react";

/** Subtle fibre texture so a solid hex fill reads as paper stock rather than plastic. */
const PAPER_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)'/%3E%3C/svg%3E\")";

interface StampProps {
  style: StampStyle;
  /** Ink for the motif and frame. */
  color: string;
  /** Paper colour behind the motif. */
  paperColor: string;
  /** Face value, printed top-left with a cent mark. Omitted on the legacy path. */
  denomination?: string;
  /** Series line along the foot of the stamp. Omitted on the legacy path. */
  caption?: string;
  /** Accessible name override, e.g. the curated stamp's own label. */
  label?: string;
}

/**
 * A postage stamp with genuinely punched perforations. The perforations are
 * masked out of the stamp body (rather than drawn as a dashed border) so the
 * envelope colour shows through the notches the way it does on real mail.
 *
 * Denomination and caption are what separate printed postage from a recoloured
 * icon; both are optional so the pre-curated path renders unchanged.
 */
export function PostageStamp({
  style,
  color,
  paperColor,
  denomination,
  caption,
  label: labelOverride,
}: StampProps) {
  const { glyph, label: motifLabel } = stampGlyph(style);
  const label = labelOverride ?? motifLabel;
  const franked = Boolean(denomination || caption);
  // Perforation geometry. Radius and pitch are tuned so notches read at the
  // ~40px rendered size without dissolving the stamp's silhouette.
  const w = 44;
  const h = 52;
  const r = 2.3;
  const pitch = 6;
  const notches: Array<{ cx: number; cy: number }> = [];
  for (let x = pitch / 2; x < w; x += pitch) {
    notches.push({ cx: x, cy: 0 }, { cx: x, cy: h });
  }
  for (let y = pitch / 2; y < h; y += pitch) {
    notches.push({ cx: 0, cy: y }, { cx: w, cy: y });
  }
  // Unique per instance: the studio draws several stamps at once and a shared
  // mask id would make every one of them resolve to the first stamp's mask.
  const maskId = `perf-${useId()}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-full w-full"
      role="img"
      aria-label={`${label} stamp`}
      data-testid="svg-envelope-stamp"
    >
      <defs>
        <mask id={maskId}>
          <rect width={w} height={h} fill="white" />
          {notches.map((n, i) => (
            <circle key={i} cx={n.cx} cy={n.cy} r={r} fill="black" />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        {/* Stamp paper */}
        <rect width={w} height={h} fill={paperColor} />
        {/* Inner frame, the way engraved stamps carry a ruled border */}
        <rect
          x={3.5}
          y={3.5}
          width={w - 7}
          height={h - 7}
          fill="none"
          stroke={color}
          strokeWidth={0.9}
          opacity={0.55}
        />
        <text
          x={w / 2}
          y={franked ? h / 2 - 1.5 : h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={franked ? 16 : 19}
          fill={color}
        >
          {glyph}
        </text>
        {denomination && (
          <text
            x={7}
            y={11.5}
            fontSize={7}
            fontWeight={700}
            letterSpacing={-0.2}
            fill={color}
            data-testid="text-stamp-denomination"
          >
            {denomination}
            <tspan fontSize={4.6} dy={-1.6}>
              ¢
            </tspan>
          </text>
        )}
        {caption && (
          <text
            x={w / 2}
            y={h - 8}
            textAnchor="middle"
            fontSize={4}
            letterSpacing={0.5}
            fill={color}
            opacity={0.9}
            data-testid="text-stamp-caption"
          >
            {caption}
          </text>
        )}
      </g>
    </svg>
  );
}

/** A dimensional wax seal — radial shading plus a pressed rim, not a flat disc. */
function WaxSeal({ color, glyph, opened, delayMs = 0 }: { color: string; glyph: string; opened: boolean; delayMs?: number }) {
  const ink = readableInk(color);
  return (
    <span
      className="absolute left-1/2 top-[50%] z-40 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-sm sm:h-10 sm:w-10"
      style={{
        // Off-centre highlight reads as wax catching light; the inset ring is the
        // rim left behind when a seal is pressed.
        background: `radial-gradient(circle at 34% 28%, ${shadeHex(color, 0.3)} 0%, ${color} 46%, ${shadeHex(color, -0.28)} 100%)`,
        boxShadow: `inset 0 0 0 1.5px ${shadeHex(color, -0.35)}, 0 2px 5px rgba(0,0,0,0.28)`,
        color: ink,
        opacity: opened ? 0 : 1,
        transform: opened ? "translate(-50%, 0) scale(0.94)" : "translate(-50%, 0) scale(1)",
        transition: "opacity 300ms ease, transform 360ms cubic-bezier(0.4, 0, 0.2, 1)",
        transitionDelay: opened ? `${delayMs}ms` : "0ms",
      }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

export interface EnvelopeMockupProps {
  envelopeColor: string;
  linerPattern: LinerPattern;
  /** Colour of the liner pattern motif. */
  linerColor: string;
  /** Colour behind the liner pattern. */
  linerBaseColor: string;
  stampStyle: StampStyle;
  stampColor: string;
  /**
   * Curated postage, when the event is on a launch theme. Postage and the wax
   * seal are separate objects on real mail — a franked corner and a sealed flap
   * — so supplying this renders both. Without it the legacy behaviour stands,
   * where a "wax-seal" stampStyle moves the motif onto the flap.
   */
  postage?: EnvelopePostageOption;
  finish: EnvelopeFinish;
  /** Text across the envelope front, e.g. "For Maya". */
  addressee: string;
  opened: boolean;
  onOpen?: () => void;
  /** Suppresses the button affordance for a non-interactive preview. */
  interactive?: boolean;
  /** Lets the guest-facing reveal lead at a more generous desktop scale. */
  displaySize?: "standard" | "hero";
  className?: string;
}

export default function EnvelopeMockup({
  envelopeColor,
  linerPattern,
  linerColor,
  linerBaseColor,
  stampStyle,
  stampColor,
  postage,
  finish,
  addressee,
  opened,
  onOpen,
  interactive = true,
  displaySize = "standard",
  className = "",
}: EnvelopeMockupProps) {
  const premium = finish === "premium";
  // Ink derives from the envelope itself — palettes are unconstrained, so the
  // model may hand back anything from near-black to near-white.
  const ink = readableInk(envelopeColor);
  const flapTop = shadeHex(envelopeColor, premium ? -0.05 : -0.02);
  const flapFold = shadeHex(envelopeColor, premium ? -0.2 : -0.14);
  const pocketTop = shadeHex(envelopeColor, 0.04);
  const stampPaper = shadeHex(envelopeColor, 0.82);
  const { glyph } = stampGlyph(stampStyle);
  // Without curated postage the single stamp control has to serve both jobs, so
  // a "wax-seal" choice moves the motif onto the fold instead of the corner.
  // With curated postage the two are independent and both are drawn.
  const stampIsWax = !postage && stampStyle === "wax-seal";
  const showPostage = Boolean(postage) || !stampIsWax;
  const flapDurationMs = flapAnimationMs(finish);
  const flapDelayMs = ENVELOPE_TURN_MS - 80;
  const cardLiftDelayMs = ENVELOPE_TURN_MS + Math.round(flapDurationMs * 0.42);

  const faceShadow = premium
    ? `inset 0 0 0 1px ${ink}26, 0 1px 2px rgba(24,18,12,0.13), 0 12px 28px -8px rgba(24,18,12,0.3), 0 28px 54px -24px rgba(24,18,12,0.24)`
    : `inset 0 0 0 1px ${ink}24, 0 2px 4px rgba(24,18,12,0.14), 0 16px 34px -10px rgba(24,18,12,0.3)`;
  const paperTexture = {
    backgroundImage: PAPER_GRAIN,
    backgroundSize: "120px 120px",
    mixBlendMode: "overlay" as const,
    opacity: premium ? 0.15 : 0.09,
  };

  const body = (
    <div
      className={`relative mx-auto aspect-[7/5] w-full ${displaySize === "hero" ? "max-w-lg" : "max-w-sm"} ${className}`}
      style={{ perspective: "1300px" }}
      data-testid="envelope-stage"
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: "preserve-3d",
          transform: opened ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: `transform ${ENVELOPE_TURN_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          willChange: "transform",
        }}
        data-testid="envelope-mailpiece"
      >
        {/* Address side: postage and recipient belong here. Keeping the seal and
            flap off this face fixes the physically impossible hybrid that made
            the old envelope feel like a flat illustration. */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[7px]"
          style={{
            background: `linear-gradient(145deg, ${shadeHex(envelopeColor, 0.08)} 0%, ${envelopeColor} 48%, ${shadeHex(envelopeColor, -0.06)} 100%)`,
            backfaceVisibility: "hidden",
            boxShadow: faceShadow,
          }}
          data-testid="envelope-front"
        >
          <div className="pointer-events-none absolute inset-0" style={paperTexture} />
          <div
            className="pointer-events-none absolute inset-[2.5%] rounded-[5px] border"
            style={{ borderColor: `${ink}18` }}
          />

          {showPostage && (
            <span
              className="absolute right-[7%] top-[8%] z-20 w-[13%]"
              style={{
                aspectRatio: "44 / 52",
                filter: "drop-shadow(0 1px 2px rgba(24,18,12,0.25))",
                transform: premium ? "rotate(-1.5deg)" : "rotate(2.5deg)",
              }}
            >
              <PostageStamp
                style={postage?.motif ?? stampStyle}
                color={postage?.inkColor ?? stampColor}
                paperColor={postage?.paperColor ?? stampPaper}
                denomination={postage?.denomination}
                caption={postage?.caption}
                label={postage?.label}
              />
            </span>
          )}

          <div className="absolute inset-x-[16%] top-[41%] z-10 text-center" style={{ color: ink }}>
            <span className="block text-[8px] font-semibold uppercase tracking-[0.3em] opacity-55 sm:text-[9px]">
              Posy correspondence
            </span>
            <span
              className="mt-2 block font-serif text-base font-medium tracking-[0.08em] sm:text-lg"
              data-testid="text-envelope-addressee"
            >
              {addressee}
            </span>
            <span className="mx-auto mt-3 block h-px w-14" style={{ backgroundColor: `${ink}3d` }} />
          </div>
        </div>

        {/* Back side: the addressed envelope turns over first, then this lined
            flap lifts automatically. */}
        <div
          className="absolute inset-0 rounded-[7px]"
          style={{
            backgroundColor: envelopeColor,
            backfaceVisibility: "hidden",
            boxShadow: faceShadow,
            transform: "rotateY(180deg)",
            transformStyle: "preserve-3d",
          }}
          data-testid="envelope-back"
        >
          <div className="absolute inset-0 overflow-hidden rounded-[7px]">
            <div className="absolute inset-0" style={{ backgroundColor: shadeHex(envelopeColor, -0.025) }} />
            <div
              className="absolute inset-x-0 top-0 h-[62%]"
              style={{
                ...linerPatternStyle(linerPattern, linerColor, linerBaseColor),
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              }}
            />
            {/* A single quiet card edge rising from the pocket bridges the
                physical envelope to the full invitation that follows. It is
                intentionally unillustrated: the finished invitation remains
                the focal point rather than becoming a second mini mockup. */}
            <div
              className="absolute bottom-[5%] left-[9%] z-10 h-[70%] w-[82%] rounded-[3px]"
              style={{
                background: `linear-gradient(150deg, ${shadeHex(linerBaseColor, 0.5)} 0%, ${shadeHex(linerBaseColor, 0.7)} 100%)`,
                border: `1px solid ${shadeHex(linerBaseColor, -0.08)}`,
                boxShadow: "0 -8px 24px -16px rgba(24,18,12,0.34)",
                opacity: opened ? 1 : 0,
                transform: opened ? "translateY(-28%)" : "translateY(5%)",
                transition: `transform 680ms cubic-bezier(0.22, 0.72, 0.24, 1), opacity 260ms ease`,
                transitionDelay: opened ? `${cardLiftDelayMs}ms` : "0ms",
                willChange: "transform, opacity",
              }}
              data-testid="envelope-card-reveal"
            >
              <span
                className="absolute left-1/2 top-[18%] h-px w-10 -translate-x-1/2"
                style={{ backgroundColor: `${readableInk(shadeHex(linerBaseColor, 0.65))}24` }}
              />
            </div>
            <div
              className="absolute inset-0 z-20"
              style={{
                background: `linear-gradient(135deg, ${shadeHex(envelopeColor, 0.02)}, ${shadeHex(envelopeColor, -0.04)})`,
                clipPath: "polygon(0 0, 0 100%, 51% 70%)",
              }}
            />
            <div
              className="absolute inset-0 z-20"
              style={{
                background: `linear-gradient(225deg, ${shadeHex(envelopeColor, 0.02)}, ${shadeHex(envelopeColor, -0.04)})`,
                clipPath: "polygon(100% 0, 100% 100%, 49% 70%)",
              }}
            />
            <div
              className="absolute inset-0 z-20"
              style={{
                background: `linear-gradient(to bottom, ${pocketTop} 0%, ${envelopeColor} 44%, ${shadeHex(envelopeColor, -0.08)} 100%)`,
                clipPath: "polygon(0 42%, 50% 70%, 100% 42%, 100% 100%, 0 100%)",
              }}
            />
            <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" viewBox="0 0 700 500" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M0 210 L350 350 L700 210"
                fill="none"
                stroke={shadeHex(envelopeColor, -0.16)}
                strokeOpacity="0.35"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M0 212 L350 352 L700 212"
                fill="none"
                stroke={shadeHex(envelopeColor, 0.2)}
                strokeOpacity="0.4"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 z-20" style={paperTexture} />
          </div>

          <div
            className="absolute inset-x-0 top-0 z-30 h-[62%]"
            style={{
              transformOrigin: "top",
              transformStyle: "preserve-3d",
              transform: opened ? "rotateX(-168deg)" : "rotateX(0deg)",
              transition: `transform ${flapDurationMs}ms cubic-bezier(0.22, 0.72, 0.24, 1)`,
              transitionDelay: opened ? `${flapDelayMs}ms` : "0ms",
              willChange: "transform",
            }}
            data-testid="envelope-flap"
          >
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to bottom, ${flapTop} 0%, ${shadeHex(envelopeColor, -0.1)} 62%, ${flapFold} 100%)`,
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                backfaceVisibility: "hidden",
                boxShadow: `inset 0 1px 0 ${shadeHex(envelopeColor, 0.18)}, inset 0 -1px 0 ${flapFold}`,
              }}
              data-testid="envelope-flap-front"
            />
            <div
              className="absolute inset-0"
              style={{
                ...linerPatternStyle(linerPattern, linerColor, linerBaseColor),
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                backfaceVisibility: "hidden",
                transform: "rotateX(180deg)",
                boxShadow: `inset 0 0 0 1px ${shadeHex(linerBaseColor, -0.12)}`,
              }}
              data-testid="envelope-flap-liner"
            />
          </div>

          <WaxSeal
            color={postage || stampIsWax ? stampColor : shadeHex(envelopeColor, -0.3)}
            glyph={glyph}
            opened={opened}
            delayMs={flapDelayMs}
          />
        </div>
      </div>
    </div>
  );

  if (!interactive) return body;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opened}
      aria-label="Open your invitation"
      className="block w-full cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 disabled:cursor-default"
      data-testid="button-open-envelope"
    >
      {body}
    </button>
  );
}
