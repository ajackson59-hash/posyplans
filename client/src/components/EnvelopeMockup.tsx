/**
 * EnvelopeMockup — the physical envelope presentation shared by the host-facing
 * Design Studio preview and the guest-facing RSVP page.
 *
 * This exists as one component precisely so those two views cannot drift: a host
 * who styles an envelope in the editor is looking at the same renderer a guest
 * will see. Any change here lands in both places at once.
 *
 * Rendering finish is driven by the concept's style lane (see envelopeFinish):
 *   premium — heavier stock, tighter shadow, wax seal, slower flap
 *   playful — brighter contrast, springier flap, postage-style stamp
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
function WaxSeal({ color, glyph, opened }: { color: string; glyph: string; opened: boolean }) {
  const ink = readableInk(color);
  return (
    <span
      className="absolute left-1/2 top-[50%] z-40 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full text-base transition-all duration-500"
      style={{
        // Off-centre highlight reads as wax catching light; the inset ring is the
        // rim left behind when a seal is pressed.
        background: `radial-gradient(circle at 34% 28%, ${shadeHex(color, 0.3)} 0%, ${color} 46%, ${shadeHex(color, -0.28)} 100%)`,
        boxShadow: `inset 0 0 0 1.5px ${shadeHex(color, -0.35)}, 0 2px 5px rgba(0,0,0,0.28)`,
        color: ink,
        opacity: opened ? 0 : 1,
        transform: opened ? "translate(-50%, 6px) scale(0.82)" : "translate(-50%, 0) scale(1)",
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

  const body = (
    <div
      className={`relative mx-auto aspect-[7/5] w-full max-w-sm rounded-[6px] ${className}`}
      style={{
        backgroundColor: envelopeColor,
        perspective: "1100px",
        transformStyle: "preserve-3d",
        // Layered shadow: a tight contact shadow plus a wider ambient one, which
        // is what lifts the envelope off the page instead of shadow-sm's haze.
        boxShadow: premium
          ? "0 1px 2px rgba(24,18,12,0.13), 0 10px 24px -6px rgba(24,18,12,0.28), 0 24px 48px -20px rgba(24,18,12,0.22)"
          : "0 2px 4px rgba(24,18,12,0.14), 0 14px 30px -8px rgba(24,18,12,0.3)",
      }}
    >
      {/* Liner + front pocket, clipped so rounded corners stay masked while the
          flap above is free to rotate past the top edge. */}
      <div className="absolute inset-0 overflow-hidden rounded-[6px]">
        {/* Liner, clipped to the flap's own triangle. A closed envelope must not
            show its liner — filling the whole top edge with it left bare wedges
            either side of the flap, which read as torn paper. Matching the shapes
            means the liner is revealed as a triangular recess as the flap lifts. */}
        <div
          className="absolute inset-x-0 top-0 h-[60%]"
          style={{
            ...linerPatternStyle(linerPattern, linerColor, linerBaseColor),
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
        {/* Envelope back showing either side of the flap triangle. */}
        <div
          className="absolute inset-x-0 top-0 h-[60%]"
          style={{
            backgroundColor: shadeHex(envelopeColor, -0.03),
            clipPath: "polygon(0 0, 50% 100%, 0 100%)",
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-[60%]"
          style={{
            backgroundColor: shadeHex(envelopeColor, -0.03),
            clipPath: "polygon(100% 0, 100% 100%, 50% 100%)",
          }}
        />
        {/* Front pocket. The faint vertical gradient is the light falloff on a
            paper face; without it the pocket reads as a flat swatch. */}
        <div
          className="absolute inset-x-0 bottom-0 top-[45%]"
          style={{
            background: `linear-gradient(to bottom, ${pocketTop} 0%, ${envelopeColor} 38%, ${shadeHex(envelopeColor, -0.07)} 100%)`,
          }}
        />
        {/* Pocket seam — the top edge of the front panel catches a highlight. */}
        <div
          className="absolute inset-x-0 top-[45%] h-px"
          style={{ backgroundColor: shadeHex(envelopeColor, 0.22), opacity: 0.55 }}
        />
        {/* Paper fibre. Overlay blend keeps it reading as texture on both dark
            and light stock rather than a grey film. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: PAPER_GRAIN,
            backgroundSize: "120px 120px",
            mixBlendMode: "overlay",
            opacity: premium ? 0.16 : 0.09,
          }}
        />
      </div>

      {/* Stamp sits on the front pocket in the top-right corner, where franking
          actually goes. Sized as a proportion of the envelope so it holds its
          scale from the 240px editor preview up to the full-width guest view. */}
      {showPostage && (
        <span
          className="absolute right-[6%] top-[52%] z-20 w-[15%]"
          style={{
            aspectRatio: "44 / 52",
            filter: "drop-shadow(0 1px 2px rgba(24,18,12,0.3))",
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

      <span
        className="absolute inset-x-0 bottom-5 z-20 px-6 text-center text-sm font-medium tracking-wide"
        style={{ color: ink }}
        data-testid="text-envelope-addressee"
      >
        {addressee}
      </span>

      {/* Flap. Back face hidden so it doesn't flip hard past 90deg; the opacity
          fade covers the hand-off so it doesn't read as a pop. */}
      <div
        className="absolute inset-x-0 top-0 z-30 h-[60%]"
        style={{
          // Gradient runs toward the fold, so the crease darkens the way a
          // folded sheet does. A single flat fill is what made this look printed.
          background: `linear-gradient(to bottom, ${flapTop} 0%, ${shadeHex(envelopeColor, -0.1)} 62%, ${flapFold} 100%)`,
          clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          transformOrigin: "top",
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
          transform: opened ? "rotateX(-168deg)" : "rotateX(0deg)",
          opacity: opened ? 0 : 1,
          // Playful lanes overshoot slightly on open; premium stays measured.
          // Duration comes from flapAnimationMs so the RSVP page's collapse timer
          // cannot drift out of sync with it.
          transition: premium
            ? `transform ${flapAnimationMs("premium")}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${flapAnimationMs("premium")}ms ease-in-out`
            : `transform ${flapAnimationMs("playful")}ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity ${flapAnimationMs("playful")}ms ease-in-out`,
        }}
      />

      {/* Wax seal holding the flap shut. */}
      {/* Wax seal on the fold. Once postage is a control of its own, the seal
          control owns stampStyle/stampColor outright and always uses them. */}
      <WaxSeal
        color={postage || stampIsWax ? stampColor : shadeHex(envelopeColor, -0.3)}
        glyph={glyph}
        opened={opened}
      />
    </div>
  );

  if (!interactive) return body;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opened}
      aria-label="Open your invitation"
      className="block w-full cursor-pointer transition-transform duration-300 hover:-translate-y-0.5 disabled:cursor-default disabled:hover:translate-y-0"
      data-testid="button-open-envelope"
    >
      {body}
    </button>
  );
}
