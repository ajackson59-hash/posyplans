// A row of color swatches where each swatch is also a native color picker
// trigger. Lets a host nudge any single color in a palette without giving
// up the AI-suggested starting point — used for both the Theme tab's
// palette and an applied Invitation Intelligence concept's palette.
// Kept free for every plan tier: color tweaking is cheap to serve and
// removes friction, so it isn't gated behind Posy Plus.

interface PaletteEditorProps {
  colors: string[];
  onChange: (index: number, color: string) => void;
  size?: "sm" | "md";
  testIdPrefix?: string;
}

export default function PaletteEditor({ colors, onChange, size = "md", testIdPrefix = "swatch" }: PaletteEditorProps) {
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  return (
    <div className="flex gap-1.5">
      {colors.map((color, i) => (
        <label
          key={i}
          className={`relative ${dim} cursor-pointer overflow-hidden rounded-full border border-border transition-transform hover:scale-110`}
          style={{ backgroundColor: color }}
          title={`Change this color (currently ${color})`}
          data-testid={`${testIdPrefix}-${i}`}
        >
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(i, e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`Change color ${i + 1}`}
            data-testid={`input-${testIdPrefix}-${i}`}
          />
        </label>
      ))}
    </div>
  );
}
