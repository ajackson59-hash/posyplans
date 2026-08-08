// Renders every direction the three verification briefs produced, using the
// real ThemeInvitation renderer and the real synthetic-theme builder — the
// same code path a customer's browser runs.
//
// The concepts are the live model's, the layout/overlay/opacity decisions are
// whatever the pipeline actually resolved, and the artwork is the PNG the
// pipeline actually stored. Nothing here re-decides anything; it draws what
// pipeline-runs.json recorded.

import { createRoot } from "react-dom/client";
import { ThemeInvitation } from "@/components/ThemeInvitation";
import { buildAiFirstTheme } from "@shared/aiFirstTheme";
import { getLaunchTheme, defaultThemeCopy, type ThemeCopy } from "@shared/themeCatalog";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { OverlayTreatment } from "@shared/themeCatalog";
import runs from "../../../posy-ai-first-implementation-review/evidence/pipeline-runs.json";
import "@/index.css";

interface Direction {
  index: number;
  conceptName: string;
  source: string;
  layoutStyle: string;
  overlay: OverlayTreatment;
  artworkOpacity: number | null;
  previewId: string;
  assetHash: string;
}

const COPY: Record<string, ThemeCopy & { headline: string }> = {
  A: {
    headline: "Ada is Four",
    eyebrow: "Please join us",
    dateLine: "Saturday 12 September 2026",
    timeLine: "2:00 in the afternoon",
    locationLine: "The back garden, 14 Fennel Road",
    rsvpLine: "RSVP by 1 September",
  },
  B: {
    headline: "Marianne at Forty",
    eyebrow: "An evening of",
    dateLine: "Saturday 7 November 2026",
    timeLine: "7:30 in the evening",
    locationLine: "Ferrier's, 8 Lamb Street",
    rsvpLine: "RSVP by 20 October",
  },
  C: {
    headline: "Theo is Three",
    eyebrow: "Hard hats on for",
    dateLine: "Sunday 21 March 2027",
    timeLine: "10:30 in the morning",
    locationLine: "Weald Park Pavilion",
    rsvpLine: "RSVP by 10 March",
  },
};

/** The stored preview bytes, as a data URL, exactly as the renderer receives them. */
const assets = (runs as any).assetUrls as Record<string, string> | undefined;

function Card({ brief, direction, concept }: { brief: string; direction: Direction; concept: AiFirstConcept }) {
  const copy = COPY[brief];
  const url =
    assets?.[direction.previewId] ??
    // A fallback direction has no generated preview; it uses its curated theme's artwork.
    getLaunchTheme(concept.baseThemeId)?.artwork.fullUrl ??
    "";

  const { theme } = buildAiFirstTheme(concept, {
    themeId: `ai-${brief}-${direction.index}`,
    artwork: { url, width: 1024, height: 1024 },
    overlay: direction.overlay,
    layoutStyle: direction.layoutStyle as never,
  });

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="w-full">
        <ThemeInvitation
          theme={theme}
          headline={copy.headline}
          copy={copy}
          paletteVariantId={theme.palettes[0].id}
          placementId={concept.placementId}
          overlay={direction.overlay}
          fontPairingId={concept.fontPairingId}
          artworkOpacity={direction.artworkOpacity ?? undefined}
        />
      </div>
      <figcaption className="font-mono text-[10px] leading-snug text-neutral-600">
        <strong>
          {brief}
          {direction.index + 1}. {direction.conceptName}
        </strong>
        <br />
        {direction.layoutStyle} · {direction.overlay}
        {direction.artworkOpacity !== null ? ` · opacity ${direction.artworkOpacity}` : ""}
        <br />
        {direction.source}
      </figcaption>
    </figure>
  );
}

const params = new URLSearchParams(location.search);
const mobile = params.get("view") === "mobile";
const only = params.get("brief");

function Board() {
  const rows = (runs as any).runs.filter((r: any) => !only || r.id === only);
  return (
    <div className="bg-white p-6" style={{ width: mobile ? 390 : 1440 }}>
      {rows.map((row: any) => (
        <section key={row.id} className="mb-8">
          <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-wide text-neutral-800">
            Brief {row.id} — {row.label}
          </h2>
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: mobile ? "1fr" : "repeat(4, minmax(0, 1fr))" }}
          >
            {[...row.directions]
              .sort((a: Direction, b: Direction) => a.index - b.index)
              .map((d: Direction) => (
                <Card key={d.previewId} brief={row.id} direction={d} concept={(d as any).concept} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Board />);
