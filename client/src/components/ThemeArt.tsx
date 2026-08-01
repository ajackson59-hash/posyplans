/**
 * ThemeArt — layered SVG motifs drawn over a theme's artwork.
 *
 * Every motif takes its colours from the live palette variant, so switching
 * colourway repaints the art in the same frame the type changes. Nothing here
 * is a flat shape: each motif layers gradients, opacities and mirrored parts so
 * it reads as printed decoration rather than an icon.
 *
 * Purely decorative — the invitation renderer marks the whole layer aria-hidden
 * and pointer-events-none. This is never used in app or dashboard chrome.
 */

import { useId } from "react";
import type { ThemeArtId } from "@shared/themeCatalog";

interface ArtProps {
  /** [ink, accent, surface, body] — the palette variant's semantic colours. */
  colors: string[];
  className?: string;
}

/** SVGs fill their placement box; the box is sized in % of the card. */
const FILL = { width: "100%", height: "100%" } as const;

// ── Garden Rose Corner ──────────────────────────────────────────────
function RoseCorner({ colors, className }: ArtProps) {
  const [primary, accent, , secondary] = colors;
  const uid = useId();
  return (
    <svg viewBox="0 0 200 200" className={className} style={FILL} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${uid}-petal-1`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.9" />
          <stop offset="70%" stopColor={primary} stopOpacity="0.6" />
          <stop offset="100%" stopColor={secondary || primary} stopOpacity="0.3" />
        </radialGradient>
        <radialGradient id={`${uid}-petal-2`} cx="40%" cy="50%" r="50%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.7" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id={`${uid}-leaf`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={secondary || primary} stopOpacity="0.8" />
          <stop offset="100%" stopColor={secondary || primary} stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <g transform="translate(20, 20)">
        <ellipse cx="40" cy="40" rx="38" ry="34" fill={`url(#${uid}-petal-2)`} transform="rotate(-15 40 40)" />
        <ellipse cx="50" cy="35" rx="32" ry="28" fill={`url(#${uid}-petal-1)`} transform="rotate(20 50 35)" />
        <ellipse cx="35" cy="50" rx="28" ry="24" fill={`url(#${uid}-petal-2)`} transform="rotate(-40 35 50)" />
        <ellipse cx="45" cy="42" rx="20" ry="18" fill={primary} fillOpacity="0.5" transform="rotate(10 45 42)" />
        <ellipse cx="42" cy="45" rx="14" ry="12" fill={primary} fillOpacity="0.7" />
        <ellipse cx="44" cy="43" rx="8" ry="7" fill={primary} fillOpacity="0.85" />
        <circle cx="44" cy="43" r="3" fill={accent} fillOpacity="0.9" />
      </g>
      <g transform="translate(10, 80)">
        <path d="M 0 10 Q 15 0 30 8 Q 20 18 0 10" fill={`url(#${uid}-leaf)`} />
        <path d="M 10 25 Q 25 15 45 20 Q 30 32 10 25" fill={`url(#${uid}-leaf)`} fillOpacity="0.7" />
      </g>
      <g transform="translate(90, 15)">
        <circle cx="0" cy="0" r="6" fill={primary} fillOpacity="0.4" />
        <circle cx="0" cy="0" r="3" fill={primary} fillOpacity="0.7" />
        <circle cx="0" cy="0" r="1.5" fill={accent} fillOpacity="0.9" />
      </g>
    </svg>
  );
}

// ── Botanical Sprig ────────────────────────────────────────────────
function BotanicalSprig({ colors, className }: ArtProps) {
  const [primary, accent, , secondary] = colors;
  const uid = useId();
  return (
    <svg viewBox="0 0 120 200" className={className} style={FILL} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`${uid}-leaf`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.9" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <path
        d="M 60 190 Q 58 120 62 60 Q 60 30 58 10"
        stroke={secondary || primary}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <g fill={`url(#${uid}-leaf)`}>
        <ellipse cx="40" cy="160" rx="22" ry="8" transform="rotate(-25 40 160)" />
        <ellipse cx="82" cy="145" rx="20" ry="7" transform="rotate(20 82 145)" />
        <ellipse cx="38" cy="120" rx="18" ry="6" transform="rotate(-30 38 120)" />
        <ellipse cx="84" cy="105" rx="16" ry="6" transform="rotate(25 84 105)" />
        <ellipse cx="42" cy="80" rx="14" ry="5" transform="rotate(-35 42 80)" />
        <ellipse cx="80" cy="68" rx="12" ry="4.5" transform="rotate(30 80 68)" />
        <ellipse cx="48" cy="45" rx="9" ry="3.5" transform="rotate(-40 48 45)" />
        <ellipse cx="72" cy="35" rx="7" ry="3" transform="rotate(35 72 35)" />
      </g>
      <circle cx="58" cy="12" r="3" fill={accent} fillOpacity="0.7" />
      <circle cx="63" cy="8" r="2.5" fill={accent} fillOpacity="0.6" />
      <circle cx="56" cy="6" r="2" fill={accent} fillOpacity="0.5" />
    </svg>
  );
}

// ── Art Deco Fan ────────────────────────────────────────────────────
function ArtDecoFan({ colors, className }: ArtProps) {
  const [primary, accent] = colors;
  return (
    <svg viewBox="0 0 200 200" className={className} style={FILL} preserveAspectRatio="xMidYMid meet">
      <g transform="translate(0, 200)">
        {Array.from({ length: 9 }).map((_, i) => {
          const rad = ((-10 - i * 12) * Math.PI) / 180;
          return (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={Math.cos(rad) * 160}
              y2={Math.sin(rad) * 160}
              stroke={primary}
              strokeWidth={i % 2 === 0 ? 3 : 1.5}
              strokeOpacity={i % 2 === 0 ? 0.9 : 0.5}
              strokeLinecap="round"
            />
          );
        })}
        {[40, 70, 100, 130].map((r, i) => (
          <path
            key={r}
            d={`M ${r} 0 A ${r} ${r} 0 0 0 ${-r * 0.3} ${-r * 0.95}`}
            fill="none"
            stroke={primary}
            strokeWidth={i === 1 ? 2.5 : 1}
            strokeOpacity={i % 2 === 0 ? 0.7 : 0.4}
          />
        ))}
        {Array.from({ length: 7 }).map((_, i) => {
          const rad = ((-10 - i * 12) * Math.PI) / 180;
          return <circle key={i} cx={Math.cos(rad) * 130} cy={Math.sin(rad) * 130} r="2.5" fill={primary} fillOpacity="0.8" />;
        })}
      </g>
      <g transform="translate(15, 175)">
        <path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z" fill={primary} fillOpacity="0.9" />
        <path d="M 0 -4 L 4 0 L 0 4 L -4 0 Z" fill={accent} fillOpacity="0.6" />
      </g>
    </svg>
  );
}

// ── Confetti Scatter ───────────────────────────────────────────────
function ConfettiScatter({ colors, className }: ArtProps) {
  const [primary, accent, , secondary] = colors;
  const pieces = [
    { x: 15, y: 20, r: -20, w: 8, h: 3, c: primary },
    { x: 45, y: 15, r: 35, w: 10, h: 3, c: accent },
    { x: 75, y: 25, r: -10, w: 6, h: 2, c: primary },
    { x: 30, y: 35, r: 45, w: 9, h: 3, c: accent },
    { x: 60, y: 40, r: -30, w: 7, h: 2.5, c: primary },
    { x: 90, y: 30, r: 15, w: 8, h: 3, c: secondary },
    { x: 20, y: 55, r: 60, w: 6, h: 2, c: accent },
    { x: 50, y: 60, r: -25, w: 10, h: 3, c: primary },
    { x: 80, y: 50, r: 40, w: 7, h: 2.5, c: secondary },
    { x: 10, y: 70, r: 10, w: 8, h: 3, c: accent },
    { x: 65, y: 75, r: -50, w: 9, h: 2.5, c: primary },
    { x: 95, y: 65, r: 25, w: 6, h: 2, c: accent },
    { x: 35, y: 85, r: -15, w: 7, h: 2.5, c: secondary },
    { x: 70, y: 90, r: 55, w: 8, h: 3, c: primary },
  ];
  const dots = [
    { x: 55, y: 10, r: 2, c: accent },
    { x: 25, y: 45, r: 1.5, c: primary },
    { x: 85, y: 80, r: 1.75, c: secondary },
    { x: 40, y: 95, r: 2, c: accent },
  ];
  return (
    <svg viewBox="0 0 110 110" className={className} style={FILL} preserveAspectRatio="xMidYMid slice">
      {pieces.map((p, i) => (
        <rect
          key={i}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx="1"
          fill={p.c}
          fillOpacity="0.7"
          transform={`rotate(${p.r} ${p.x + p.w / 2} ${p.y + p.h / 2})`}
        />
      ))}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} fillOpacity="0.7" />
      ))}
    </svg>
  );
}

// ── Terrazzo ────────────────────────────────────────────────────────
function Terrazzo({ colors, className }: ArtProps) {
  const [primary, accent, , secondary] = colors;
  const chips = [
    { x: 10, y: 15, w: 18, h: 12, r: 15, c: primary },
    { x: 40, y: 8, w: 14, h: 10, r: -25, c: accent },
    { x: 65, y: 18, w: 16, h: 11, r: 40, c: secondary },
    { x: 88, y: 12, w: 10, h: 8, r: 10, c: primary },
    { x: 15, y: 38, w: 12, h: 9, r: -30, c: accent },
    { x: 38, y: 32, w: 15, h: 10, r: 20, c: primary },
    { x: 62, y: 40, w: 13, h: 9, r: -15, c: secondary },
    { x: 82, y: 35, w: 16, h: 11, r: 35, c: accent },
    { x: 8, y: 60, w: 14, h: 10, r: 25, c: secondary },
    { x: 30, y: 55, w: 11, h: 8, r: -40, c: primary },
    { x: 50, y: 62, w: 16, h: 11, r: 10, c: accent },
    { x: 75, y: 58, w: 13, h: 9, r: -20, c: primary },
    { x: 20, y: 80, w: 15, h: 10, r: 30, c: accent },
    { x: 45, y: 85, w: 12, h: 8, r: -15, c: secondary },
    { x: 68, y: 80, w: 14, h: 10, r: 45, c: primary },
    { x: 88, y: 85, w: 10, h: 7, r: -25, c: accent },
  ];
  return (
    <svg viewBox="0 0 100 100" className={className} style={FILL} preserveAspectRatio="xMidYMid slice">
      {chips.map((chip, i) => (
        <rect
          key={i}
          x={chip.x}
          y={chip.y}
          width={chip.w}
          height={chip.h}
          rx="3"
          fill={chip.c}
          fillOpacity="0.75"
          transform={`rotate(${chip.r} ${chip.x + chip.w / 2} ${chip.y + chip.h / 2})`}
        />
      ))}
    </svg>
  );
}

// ── Sunburst Rays ──────────────────────────────────────────────────
function SunburstRays({ colors, className }: ArtProps) {
  const [primary, accent] = colors;
  const uid = useId();
  return (
    <svg viewBox="0 0 200 200" className={className} style={FILL} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
          <stop offset="60%" stopColor={accent} stopOpacity="0.3" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill={`url(#${uid}-glow)`} />
      <g transform="translate(100, 100)">
        {Array.from({ length: 16 }).map((_, i) => {
          const rad = ((i * 360) / 16) * (Math.PI / 180);
          const isWide = i % 2 === 0;
          const len = isWide ? 90 : 75;
          return (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={Math.cos(rad) * len}
              y2={Math.sin(rad) * len}
              stroke={isWide ? primary : accent}
              strokeWidth={isWide ? 6 : 3}
              strokeOpacity={isWide ? 0.7 : 0.4}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      <circle cx="100" cy="100" r="12" fill={accent} fillOpacity="0.8" />
      <circle cx="100" cy="100" r="7" fill={primary} fillOpacity="0.6" />
    </svg>
  );
}

// ── Bunting Garland ────────────────────────────────────────────────
function BuntingGarland({ colors, className }: ArtProps) {
  const [primary, accent, , secondary] = colors;
  const flags = [primary, accent, secondary, primary, accent, secondary, primary, accent];
  return (
    <svg viewBox="0 0 400 80" className={className} style={FILL} preserveAspectRatio="none">
      <path
        d="M 0 10 Q 100 35 200 20 Q 300 5 400 15"
        stroke={secondary || primary}
        strokeWidth="1"
        fill="none"
        strokeOpacity="0.5"
      />
      {flags.map((color, i) => {
        const x = 25 + i * 45;
        const y = 15 + Math.sin((i / flags.length) * Math.PI) * 15;
        return (
          <g key={i}>
            <path d={`M ${x} ${y} L ${x + 22} ${y} L ${x + 11} ${y + 35} Z`} fill={color} fillOpacity="0.8" />
            <path d={`M ${x} ${y} L ${x + 11} ${y} L ${x + 11} ${y + 35} Z`} fill={color} fillOpacity="0.15" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Starry Night ───────────────────────────────────────────────────
function StarryNight({ colors, className }: ArtProps) {
  const [primary, accent] = colors;
  const stars = [
    { x: 20, y: 15, r: 2.5, o: 0.9 },
    { x: 55, y: 25, r: 1.5, o: 0.6 },
    { x: 85, y: 10, r: 3, o: 1 },
    { x: 110, y: 30, r: 1.8, o: 0.7 },
    { x: 140, y: 18, r: 2, o: 0.8 },
    { x: 30, y: 45, r: 1.5, o: 0.5 },
    { x: 65, y: 50, r: 2.2, o: 0.8 },
    { x: 100, y: 55, r: 1.5, o: 0.6 },
    { x: 130, y: 45, r: 2.5, o: 0.9 },
    { x: 15, y: 70, r: 1.8, o: 0.5 },
    { x: 45, y: 80, r: 2, o: 0.7 },
    { x: 90, y: 75, r: 1.5, o: 0.5 },
    { x: 120, y: 85, r: 2.2, o: 0.8 },
    { x: 150, y: 70, r: 1.8, o: 0.6 },
    { x: 25, y: 100, r: 1.5, o: 0.5 },
    { x: 70, y: 105, r: 2.5, o: 0.9 },
    { x: 110, y: 100, r: 1.8, o: 0.6 },
    { x: 145, y: 110, r: 2, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 170 130" className={className} style={FILL} preserveAspectRatio="xMidYMid slice">
      {/* A field, not a scene: the painted sheet already carries the moon, and a
          single focal shape repeats badly once the field is tiled. */}
      <g stroke={accent} strokeOpacity="0.5" strokeWidth="0.6" fill="none">
        <path d="M 20 15 L 55 25 L 85 10 L 110 30" />
        <path d="M 45 80 L 90 75 L 120 85 L 150 70" />
      </g>
      {stars.map((star, i) => (
        <path
          key={i}
          transform={`translate(${star.x}, ${star.y})`}
          d={`M 0 ${-star.r} L ${star.r * 0.3} ${-star.r * 0.3} L ${star.r} 0 L ${star.r * 0.3} ${star.r * 0.3} L 0 ${star.r} L ${-star.r * 0.3} ${star.r * 0.3} L ${-star.r} 0 L ${-star.r * 0.3} ${-star.r * 0.3} Z`}
          fill={primary}
          fillOpacity={star.o}
        />
      ))}
    </svg>
  );
}

const ART_MAP: Record<ThemeArtId, (props: ArtProps) => React.ReactElement> = {
  "rose-corner": RoseCorner,
  "botanical-sprig": BotanicalSprig,
  "art-deco-fan": ArtDecoFan,
  "confetti-scatter": ConfettiScatter,
  terrazzo: Terrazzo,
  "sunburst-rays": SunburstRays,
  "bunting-garland": BuntingGarland,
  "starry-night": StarryNight,
};

export function ThemeArt({ artId, colors, className }: { artId: ThemeArtId; colors: string[]; className?: string }) {
  const Component = ART_MAP[artId];
  if (!Component) return null;
  return <Component colors={colors} className={className} />;
}
