// A stand-in for the Express routes, for visual QA only.
//
// It exists because this sandbox has no DATABASE_URL, so the real server
// cannot boot. It replays the events the real pipeline actually emitted
// (pipeline-runs.json) over real SSE, at a real cadence, so the component,
// the SSE parser and the progressive reveal are all exercised for real —
// only the transport's origin is faked, not the payload.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { INVITATION_ASK_POSY_ACTIONS } from "../../shared/aiFirstAskPosy.ts";
import { AI_FIRST_CONCEPT_KEY, themeFromSnapshot } from "../../shared/aiFirstTheme.ts";
import { buildThemedConcept } from "../../shared/themeCatalog.ts";
import { deriveThemeDna } from "../../shared/themeDna.ts";

const EVIDENCE = "/home/user/workspace/posy-ai-first-implementation-review/evidence/pipeline-runs.json";
const data = JSON.parse(readFileSync(EVIDENCE, "utf8"));
const brief = process.env.QA_BRIEF ?? "A";
const run = data.runs.find((r) => r.id === brief);

const status = {
  plan: "Plus",
  ceilings: { eventSoft: 24, eventHard: 40, monthlySoft: 48, monthlyHard: 80 },
  usage: { eventBilled: run.summary.billedImages, monthlyBilled: run.summary.billedImages, activeGenerations: 0 },
  killSwitch: false,
  briefQuestion: null,
  askPosyActions: INVITATION_ASK_POSY_ACTIONS,
};

/**
 * A public event carrying an applied AI direction, assembled by the same
 * functions the real apply route uses — so the RSVP page and the envelope get
 * exactly the record production would have written.
 */
function publicEventWithAppliedDirection() {
  const direction = run.directions.find((d) => d.source === "ai-generated");
  const snapshot = {
    concept: direction.concept,
    previewId: direction.previewId,
    assetHash: direction.assetHash,
    artworkUrl: `/api/ai-first/preview/${direction.previewId}`,
    artworkOpacity: direction.artworkOpacity ?? undefined,
    source: direction.source,
  };
  const { theme } = themeFromSnapshot(snapshot);
  const concept = { ...buildThemedConcept(theme), [AI_FIRST_CONCEPT_KEY]: snapshot };
  const dna = deriveThemeDna(concept);
  const meta = {
    A: { eventName: "Ada's 4th Birthday", eventDate: "2026-09-12", eventTime: "14:00", location: "The back garden, 14 Fennel Road" },
    B: { eventName: "Marianne's 40th Birthday Dinner", eventDate: "2026-11-07", eventTime: "19:30", location: "Ferrier's, 8 Lamb Street" },
    C: { eventName: "Theo's 3rd Birthday", eventDate: "2027-03-21", eventTime: "10:30", location: "Weald Park Pavilion" },
  }[brief];

  return {
    id: 1,
    shareSlug: "qa",
    eventType: "birthday",
    hostName: "Posy QA",
    ...meta,
    inviteDesignConceptJson: JSON.stringify(concept),
    inviteIllustrationUrl: snapshot.artworkUrl,
    paletteColors: JSON.stringify(concept.paletteColors),
    envelopeColor: dna.primaryColor,
    envelopeLinerPattern: dna.linerPattern,
    stampStyle: dna.stampStyle,
    inviteSubject: meta.eventName,
    inviteMessage: "We would love you to join us.",
    rsvpEnabled: true,
    guestRestriction: "plus_one",
  };
}

const json = (res, body) => {
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  if (url.pathname.endsWith("/ai-first/status")) return json(res, status);

  if (url.pathname.startsWith("/api/events/public/")) {
    if (url.pathname.endsWith("/search-guests")) {
      return json(res, [{ id: 1, name: "Jamie Fisher", group: "Family", rsvpStatus: "pending" }]);
    }
    if (url.pathname.includes("/rsvp")) return json(res, { ok: true });
    return json(res, publicEventWithAppliedDirection());
  }

  if (url.pathname.startsWith("/api/ai-first/preview/")) {
    const id = url.pathname.split("/").pop();
    const dataUrl = data.assetUrls[id];
    if (!dataUrl) {
      res.writeHead(404);
      return res.end();
    }
    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return res.end(bytes);
  }

  if (url.pathname.endsWith("/ai-first/generate")) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // The recorded messages, paced so the progressive reveal is observable
    // rather than arriving as one frame.
    send({ type: "progress", message: run.progressMessages[0], at: Date.now() });
    const sorted = [...run.directions].sort((a, b) => a.msFromStart - b.msFromStart);
    for (const [i, direction] of sorted.entries()) {
      await wait(500);
      send({
        type: "progress",
        message: run.progressMessages[Math.min(i + 1, run.progressMessages.length - 3)],
        at: Date.now(),
      });
      await wait(400);
      send({
        type: "direction",
        at: Date.now(),
        direction: {
          ...direction,
          illustrationUrl: data.assetUrls[direction.previewId]
            ? `/api/ai-first/preview/${direction.previewId}`
            : direction.illustrationUrl,
        },
      });
    }
    for (const message of run.warnings) send({ type: "warning", message, at: Date.now() });
    send({ type: "progress", message: run.progressMessages.at(-1), at: Date.now() });
    send({ type: "done", summary: run.summary, at: Date.now() });
    return res.end();
  }

  if (url.pathname.endsWith("/ai-first/apply")) return json(res, { event: { id: 1 } });

  res.writeHead(404, { "access-control-allow-origin": "*" });
  res.end("{}");
}).listen(5200, () => console.log("mock api on 5200 replaying brief", brief));
