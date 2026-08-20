export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <img
      src="/brand/posy-bouquet-icon.png"
      alt="Posy"
      className={`object-contain ${className}`}
    />
  );
}

// Approved lockup (bouquet + "posy" wordmark) from the brand kit's alternate
// horizontal logo, sized for constrained header space. The brand kit's baked-in
// tagline pixels are too small to read at header scale, so the tagline pixels
// were removed from the image and replaced below with real, crisply-rendered
// text at a legible size — same visual intent as the brand kit, just readable.
// Used wherever the full brand name needs to appear alongside the mark, rather
// than the bouquet icon alone (see Logo above).
export function Wordmark({
  className = "",
  showTagline = true,
}: {
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-center text-center">
      <img
        src="/brand/posy-logo-header.png"
        alt="Posy — Your Planning Concierge"
        className={`h-9 w-auto object-contain sm:h-11 ${className}`}
      />
      {showTagline && (
        <span className="mt-0.5 pl-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-primary sm:text-[10px]">
          Your Planning Concierge
        </span>
      )}
    </span>
  );
}
