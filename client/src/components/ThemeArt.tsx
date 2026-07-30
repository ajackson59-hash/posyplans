/**
 * ThemeArt — SVG decorative art components for curated invitation themes.
 *
 * Each component renders sophisticated, layered SVG art — not flat shapes.
 * These replace AI-generated illustrations with instant, pre-designed
 * artwork that looks competitive with Paperless Post / Greenvelope.
 *
 * All components accept a `size` prop and use `currentColor` or explicit
 * colors passed via the `colors` prop so they adapt to each theme's palette.
 */

import type { DecorativeArtId } from "@shared/themeLibrary";

interface ArtProps {
  colors: string[];
  className?: string;
  /** Scale factor 0-1 for thumbnail rendering */
  scale?: number;
}

// ── Garden Rose Corner ──────────────────────────────────────────────
function RoseCorner({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      style={{ width: `${200 * s}px`, height: `${200 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="rose-petal-1" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.9" />
          <stop offset="70%" stopColor={primary} stopOpacity="0.6" />
          <stop offset="100%" stopColor={secondary || primary} stopOpacity="0.3" />
        </radialGradient>
        <radialGradient id="rose-petal-2" cx="40%" cy="50%" r="50%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.7" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id="leaf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={secondary || "#a3b8a3"} stopOpacity="0.8" />
          <stop offset="100%" stopColor={secondary || "#a3b8a3"} stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Outer rose petals — layered for depth */}
      <g transform="translate(20, 20)">
        <ellipse cx="40" cy="40" rx="38" ry="34" fill="url(#rose-petal-2)" transform="rotate(-15 40 40)" />
        <ellipse cx="50" cy="35" rx="32" ry="28" fill="url(#rose-petal-1)" transform="rotate(20 50 35)" />
        <ellipse cx="35" cy="50" rx="28" ry="24" fill="url(#rose-petal-2)" transform="rotate(-40 35 50)" />
        {/* Inner petals */}
        <ellipse cx="45" cy="42" rx="20" ry="18" fill={primary} fillOpacity="0.5" transform="rotate(10 45 42)" />
        <ellipse cx="42" cy="45" rx="14" ry="12" fill={primary} fillOpacity="0.7" />
        <ellipse cx="44" cy="43" rx="8" ry="7" fill={primary} fillOpacity="0.85" />
        {/* Gold center */}
        <circle cx="44" cy="43" r="3" fill={accent} fillOpacity="0.9" />
      </g>
      {/* Leaves */}
      <g transform="translate(10, 80)">
        <path d="M 0 10 Q 15 0 30 8 Q 20 18 0 10" fill="url(#leaf-grad)" />
        <path d="M 10 25 Q 25 15 45 20 Q 30 32 10 25" fill="url(#leaf-grad)" fillOpacity="0.7" />
      </g>
      {/* Small accent buds */}
      <g transform="translate(90, 15)">
        <circle cx="0" cy="0" r="6" fill={primary} fillOpacity="0.4" />
        <circle cx="0" cy="0" r="3" fill={primary} fillOpacity="0.7" />
        <circle cx="0" cy="0" r="1.5" fill={accent} fillOpacity="0.9" />
      </g>
    </svg>
  );
}

// ── Botanical Sprig ────────────────────────────────────────────────
function BotanicalSprig({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  return (
    <svg
      viewBox="0 0 120 200"
      className={className}
      style={{ width: `${120 * s}px`, height: `${200 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="sprig-leaf" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={primary} stopOpacity="0.9" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {/* Central stem */}
      <path d="M 60 190 Q 58 120 62 60 Q 60 30 58 10" stroke={secondary || primary} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Leaves on stem — alternating sides, decreasing in size */}
      <g>
        <ellipse cx="40" cy="160" rx="22" ry="8" fill="url(#sprig-leaf)" transform="rotate(-25 40 160)" />
        <ellipse cx="82" cy="145" rx="20" ry="7" fill="url(#sprig-leaf)" transform="rotate(20 82 145)" />
        <ellipse cx="38" cy="120" rx="18" ry="6" fill="url(#sprig-leaf)" transform="rotate(-30 38 120)" />
        <ellipse cx="84" cy="105" rx="16" ry="6" fill="url(#sprig-leaf)" transform="rotate(25 84 105)" />
        <ellipse cx="42" cy="80" rx="14" ry="5" fill="url(#sprig-leaf)" transform="rotate(-35 42 80)" />
        <ellipse cx="80" cy="68" rx="12" ry="4.5" fill="url(#sprig-leaf)" transform="rotate(30 80 68)" />
        <ellipse cx="48" cy="45" rx="9" ry="3.5" fill="url(#sprig-leaf)" transform="rotate(-40 48 45)" />
        <ellipse cx="72" cy="35" rx="7" ry="3" fill="url(#sprig-leaf)" transform="rotate(35 72 35)" />
      </g>
      {/* Small berries at top */}
      <circle cx="58" cy="12" r="3" fill={accent} fillOpacity="0.7" />
      <circle cx="63" cy="8" r="2.5" fill={accent} fillOpacity="0.6" />
      <circle cx="56" cy="6" r="2" fill={accent} fillOpacity="0.5" />
    </svg>
  );
}

// ── Art Deco Fan ────────────────────────────────────────────────────
function ArtDecoFan({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      style={{ width: `${200 * s}px`, height: `${200 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="deco-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={primary} stopOpacity="1" />
          <stop offset="50%" stopColor={primary} stopOpacity="0.8" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {/* Fan rays radiating from bottom-left corner */}
      <g transform="translate(0, 200)">
        {Array.from({ length: 9 }).map((_, i) => {
          const angle = -10 - i * 12;
          const rad = (angle * Math.PI) / 180;
          const x2 = Math.cos(rad) * 160;
          const y2 = Math.sin(rad) * 160;
          return (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={x2}
              y2={y2}
              stroke={primary}
              strokeWidth={i % 2 === 0 ? "3" : "1.5"}
              strokeOpacity={i % 2 === 0 ? "0.9" : "0.5"}
              strokeLinecap="round"
            />
          );
        })}
        {/* Concentric arcs */}
        {[40, 70, 100, 130].map((r, i) => (
          <path
            key={r}
            d={`M ${r} 0 A ${r} ${r} 0 0 0 ${-r * 0.3} ${-r * 0.95}`}
            fill="none"
            stroke={primary}
            strokeWidth={i === 1 ? "2.5" : "1"}
            strokeOpacity={i % 2 === 0 ? "0.7" : "0.4"}
          />
        ))}
        {/* Decorative dots along outer arc */}
        {Array.from({ length: 7 }).map((_, i) => {
          const angle = -10 - i * 12;
          const rad = (angle * Math.PI) / 180;
          const x = Math.cos(rad) * 130;
          const y = Math.sin(rad) * 130;
          return <circle key={i} cx={x} cy={y} r="2.5" fill={primary} fillOpacity="0.8" />;
        })}
      </g>
      {/* Accent diamond at center */}
      <g transform="translate(15, 175)">
        <path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z" fill={primary} fillOpacity="0.9" />
        <path d="M 0 -4 L 4 0 L 0 4 L -4 0 Z" fill={accent} fillOpacity="0.6" />
      </g>
    </svg>
  );
}

// ── Vintage Lace ────────────────────────────────────────────────────
function VintageLace({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  return (
    <svg
      viewBox="0 0 400 60"
      className={className}
      style={{ width: `${400 * s}px`, height: `${60 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="lace-pattern" x="0" y="0" width="40" height="60" patternUnits="userSpaceOnUse">
          {/* Scallop edge */}
          <path d="M 0 20 Q 10 0 20 20 Q 30 0 40 20" fill="none" stroke={primary} strokeWidth="1" strokeOpacity="0.6" />
          <path d="M 0 25 Q 10 5 20 25 Q 30 5 40 25" fill="none" stroke={primary} strokeWidth="0.5" strokeOpacity="0.4" />
          {/* Dot details */}
          <circle cx="20" cy="15" r="1.5" fill={primary} fillOpacity="0.5" />
          <circle cx="10" cy="22" r="0.8" fill={primary} fillOpacity="0.3" />
          <circle cx="30" cy="22" r="0.8" fill={primary} fillOpacity="0.3" />
          {/* Flower motif */}
          <g transform="translate(20, 35)">
            <circle cx="0" cy="0" r="2" fill={primary} fillOpacity="0.4" />
            <circle cx="-4" cy="0" r="1.5" fill={primary} fillOpacity="0.3" />
            <circle cx="4" cy="0" r="1.5" fill={primary} fillOpacity="0.3" />
            <circle cx="0" cy="-4" r="1.5" fill={primary} fillOpacity="0.3" />
            <circle cx="0" cy="4" r="1.5" fill={primary} fillOpacity="0.3" />
          </g>
          {/* Connecting lines */}
          <line x1="0" y1="50" x2="40" y2="50" stroke={primary} strokeWidth="0.5" strokeOpacity="0.3" />
          <line x1="0" y1="55" x2="40" y2="55" stroke={primary} strokeWidth="0.3" strokeOpacity="0.2" />
        </pattern>
      </defs>
      <rect width="400" height="60" fill="url(#lace-pattern)" />
    </svg>
  );
}

// ── Confetti Scatter ───────────────────────────────────────────────
function ConfettiScatter({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  // Pre-computed positions for organic scatter
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
    // Circles
    { x: 55, y: 10, r: 0, w: 4, h: 4, c: accent, circle: true },
    { x: 25, y: 45, r: 0, w: 3, h: 3, c: primary, circle: true },
    { x: 85, y: 80, r: 0, w: 3.5, h: 3.5, c: secondary, circle: true },
    { x: 40, y: 95, r: 0, w: 4, h: 4, c: accent, circle: true },
  ];
  return (
    <svg
      viewBox="0 0 110 110"
      className={className}
      style={{ width: `${110 * s}px`, height: `${110 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      {pieces.map((p, i) =>
        p.circle ? (
          <circle key={i} cx={p.x} cy={p.y} r={p.w / 2} fill={p.c} fillOpacity="0.7" />
        ) : (
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
        ),
      )}
    </svg>
  );
}

// ── Terrazzo ────────────────────────────────────────────────────────
function Terrazzo({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
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
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={{ width: `${100 * s}px`, height: `${100 * s}px` }}
      preserveAspectRatio="xMidYMid slice"
    >
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
function SunburstRays({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      style={{ width: `${200 * s}px`, height: `${200 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="sun-center" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
          <stop offset="60%" stopColor={accent} stopOpacity="0.3" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Glow center */}
      <circle cx="100" cy="100" r="80" fill="url(#sun-center)" />
      {/* Radiating rays — alternating widths and opacities */}
      <g transform="translate(100, 100)">
        {Array.from({ length: 16 }).map((_, i) => {
          const angle = (i * 360) / 16;
          const rad = (angle * Math.PI) / 180;
          const isWide = i % 2 === 0;
          const len = isWide ? 90 : 75;
          const w = isWide ? 6 : 3;
          const x2 = Math.cos(rad) * len;
          const y2 = Math.sin(rad) * len;
          return (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={x2}
              y2={y2}
              stroke={isWide ? primary : accent}
              strokeWidth={w}
              strokeOpacity={isWide ? 0.7 : 0.4}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {/* Center circle */}
      <circle cx="100" cy="100" r="12" fill={accent} fillOpacity="0.8" />
      <circle cx="100" cy="100" r="7" fill={primary} fillOpacity="0.6" />
    </svg>
  );
}

// ── Bunting Garland ────────────────────────────────────────────────
function BuntingGarland({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  const flags = [primary, accent, secondary, primary, accent, secondary, primary, accent];
  return (
    <svg
      viewBox="0 0 400 80"
      className={className}
      style={{ width: `${400 * s}px`, height: `${80 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* String */}
      <path d="M 0 10 Q 100 35 200 20 Q 300 5 400 15" stroke={secondary || "#8b7355"} strokeWidth="1" fill="none" strokeOpacity="0.5" />
      {/* Pennant flags */}
      {flags.map((color, i) => {
        const x = 25 + i * 45;
        // Curve the flag positions along the string
        const y = 10 + Math.sin((i / flags.length) * Math.PI) * 15 + 5;
        return (
          <g key={i}>
            <path
              d={`M ${x} ${y} L ${x + 22} ${y} L ${x + 11} ${y + 35} Z`}
              fill={color}
              fillOpacity="0.8"
            />
            {/* Highlight fold */}
            <path
              d={`M ${x} ${y} L ${x + 11} ${y} L ${x + 11} ${y + 35} Z`}
              fill={color}
              fillOpacity="0.15"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Balloon Bouquet ────────────────────────────────────────────────
function BalloonBouquet({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  const balloons = [
    { x: 30, y: 10, r: 18, c: primary, sx: 1, sy: 1.1 },
    { x: 65, y: 5, r: 15, c: accent, sx: 1, sy: 1.1 },
    { x: 95, y: 15, r: 16, c: secondary || primary, sx: 1, sy: 1.1 },
    { x: 50, y: 30, r: 13, c: accent, sx: 1, sy: 1.1 },
    { x: 80, y: 35, r: 14, c: primary, sx: 1, sy: 1.1 },
  ];
  return (
    <svg
      viewBox="0 0 130 160"
      className={className}
      style={{ width: `${130 * s}px`, height: `${160 * s}px` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="balloon-shine" cx="35%" cy="30%" r="40%">
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      {balloons.map((b, i) => (
        <g key={i}>
          {/* String */}
          <path
            d={`M ${b.x} ${b.y + b.r * 1.1} Q ${b.x + (i % 2 === 0 ? 3 : -3)} ${b.y + b.r + 40} ${b.x + (i % 2 === 0 ? 5 : -5)} ${b.y + b.r + 80}`}
            stroke={secondary || "#8b7355"}
            strokeWidth="0.6"
            fill="none"
            strokeOpacity="0.4"
          />
          {/* Balloon body */}
          <ellipse
            cx={b.x}
            cy={b.y}
            rx={b.r}
            ry={b.r * 1.1}
            fill={b.c}
            fillOpacity="0.75"
          />
          {/* Shine */}
          <ellipse cx={b.x - b.r * 0.25} cy={b.y - b.r * 0.3} rx={b.r * 0.5} ry={b.r * 0.6} fill="url(#balloon-shine)" />
          {/* Knot */}
          <path d={`M ${b.x - 2} ${b.y + b.r * 1.05} L ${b.x} ${b.y + b.r * 1.15} L ${b.x + 2} ${b.y + b.r * 1.05}`} fill={b.c} fillOpacity="0.6" />
        </g>
      ))}
    </svg>
  );
}

// ── Starry Night ───────────────────────────────────────────────────
function StarryNight({ colors, className, scale = 1 }: ArtProps) {
  const [primary, accent, bg, secondary] = colors;
  const s = scale;
  // Pre-computed star positions
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
    <svg
      viewBox="0 0 170 130"
      className={className}
      style={{ width: `${170 * s}px`, height: `${130 * s}px` }}
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Crescent moon */}
      <g transform="translate(135, 30)">
        <circle cx="0" cy="0" r="14" fill={primary} fillOpacity="0.85" />
        <circle cx="5" cy="-3" r="12" fill={bg || "#1b2845"} fillOpacity="0.95" />
      </g>
      {/* Stars — 4-point sparkle shape */}
      {stars.map((star, i) => (
        <g key={i} transform={`translate(${star.x}, ${star.y})`}>
          <path
            d={`M 0 ${-star.r} L ${star.r * 0.3} ${-star.r * 0.3} L ${star.r} 0 L ${star.r * 0.3} ${star.r * 0.3} L 0 ${star.r} L ${-star.r * 0.3} ${star.r * 0.3} L ${-star.r} 0 L ${-star.r * 0.3} ${-star.r * 0.3} Z`}
            fill={primary}
            fillOpacity={star.o}
          />
        </g>
      ))}
      {/* Small dot stars */}
      <circle cx="40" cy="20" r="0.8" fill={primary} fillOpacity="0.4" />
      <circle cx="75" cy="15" r="0.8" fill={primary} fillOpacity="0.3" />
      <circle cx="125" cy="65" r="0.8" fill={primary} fillOpacity="0.4" />
      <circle cx="60" cy="90" r="0.8" fill={primary} fillOpacity="0.3" />
      <circle cx="100" cy="120" r="0.8" fill={primary} fillOpacity="0.4" />
    </svg>
  );
}

// ── Dispatcher ─────────────────────────────────────────────────────
const ART_MAP: Record<DecorativeArtId, (props: ArtProps) => React.ReactElement> = {
  "rose-corner": RoseCorner,
  "botanical-sprig": BotanicalSprig,
  "art-deco-fan": ArtDecoFan,
  "vintage-lace": VintageLace,
  "confetti-scatter": ConfettiScatter,
  terrazzo: Terrazzo,
  "sunburst-rays": SunburstRays,
  "bunting-garland": BuntingGarland,
  "balloon-bouquet": BalloonBouquet,
  "starry-night": StarryNight,
};

export function ThemeArt({
  artId,
  colors,
  className,
  scale,
}: {
  artId: DecorativeArtId;
  colors: string[];
  className?: string;
  scale?: number;
}) {
  const Component = ART_MAP[artId];
  if (!Component) return null;
  return <Component colors={colors} className={className} scale={scale} />;
}

export { ART_MAP };
