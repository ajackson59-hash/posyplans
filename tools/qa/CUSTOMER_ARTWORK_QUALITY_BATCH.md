# Customer artwork quality screen — 23 September 2026

Status: **prepared and rehearsed without paid calls; fresh paid allowance pending**.
This is Priority 2 of Alex's exact handoff. The customer flow is implemented;
this screen will test real generation, source-based correction and delivery.
Event 69's acceptance, Events 67–72, all closed studies and prior budgets stay
unchanged. No staff approval gate is restored to the customer journey.

## Fixed scope

Eight fresh, owner-private, unpaid Preview events. Each has at most one creation
and one saved-image edit: **8 creates + up to 8 edits = at most 16 image calls**.
GPT Image 2, medium quality, portrait 1024×1536 provider size, JPEG transport and
retained PNG source/delivery; zero automatic retries, fallback generations,
critic calls, classifier calls or paid reference lookups. The customer routes
send the complete saved brief directly; this screen does not use the retired
classifier/critic pipeline. No payment, email/SMS, guest publication, merge or
Production deployment is part of this allowance.

Proposed planning reserve: **US $5**. This is not a provider-enforced dollar cap
or a guaranteed invoice. Hard controls bound the number of requests. Run one
operation at a time, retain returned token usage, and stop on missing/unknown
billing, provider failure or a reserve concern before another request. Do not
claim an aborted or failed request was free. A remaining dollar reserve never
authorizes additional calls. Approval must cover this fresh, concrete scope;
the general instruction to proceed has authorized preparation and engineering,
but did not specify this newly defined paid allowance.

Current official source checked September 23:
[GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2),
[pricing](https://developers.openai.com/api/docs/pricing), and
[image generation costs](https://developers.openai.com/api/docs/guides/image-generation).
Rates are $2.50/million text-input tokens, $4/million image-input tokens and
$15/million image-output tokens before any applicable discounts or adjustments.
Use returned detailed usage, not a fixed price per request; do not use the
older-model output-token table as a GPT Image 2 invoice. If usage details or
account charges cannot be reconciled, keep the amount unknown and stop.

## Frozen cases

Full requests, hashes and proposed refinements are in
[CUSTOMER_ARTWORK_QUALITY_PREFLIGHT.json](CUSTOMER_ARTWORK_QUALITY_PREFLIGHT.json).
The eight existing brief texts are retained verbatim for comparison. These are
new trial IDs, not permission to reuse any consumed event or old allowance.

| Order | Fresh trial suffix | Request | Treatment |
| --- | --- | --- | --- |
| 1 | 01 | Excavator, crane, sand-play area and bunting in a garden | Watercolor |
| 2 | 02 | Blippi and Meekah dancing in soft play, bubbles and ice-cream counter | Gouache |
| 3 | 03 | Elsa and Anna, original costumes, snowy garden, ice arch and blue cake | Cel shading |
| 4 | 04 | Rumi, Mira and Zoey on a rooftop stage | Anime |
| 5 | 05 | Moana and Maui, canoe, waves, hibiscus and picnic | Stylized 3D |
| 6 | 06 | Garden dinner with exactly six place settings | Photographic realism |
| 7 | 07 | Cobalt arches, terracotta circles, ivory planes and negative space | Flat vector |
| 8 | 08 | Moon garden, silver foliage, blue lilies and reflective pond | Lacquer inlay |

Use trial prefix `customer-flow-20260923-`. Their initial generation prompts
are captured from the real new customer route with synthetic event logistics.
Actual live event facts, prompt/hash and edit source hashes must be registered
again before spending. The rehearsal edit prompt uses synthetic pixels; it is
not a live image/correction or a promised final edit prompt.

## Activation and enforced request boundary

1. Confirm exact Preview SHA/CI and the separate paid allowance. Create only
   fresh private events using the normal intake, retaining the frozen brief.
   Register actual event IDs, ownership, brief hashes and zero-attempt state.
2. Set `POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS` to a JSON object mapping ONLY the
   active event ID to `2`, for example `{"123":2}` (123 is illustrative, not an
   authorized existing event). Keep all other events absent. The optional map
   rejects malformed values, unknown IDs and limits outside 1–4. A present empty
   object disables new dispatch for all events. This does not change enrollment
   or staff-review precedence.
3. Only then enable `POSY_CUSTOMER_ARTWORK_GENERATION=true` on the exact intended
   Preview. Do not activate an older deployment without the evaluation envelope.
   All route requests count durable lifetime claims, including brief changes;
   concurrent requests use the existing compare-and-set boundary. Replays,
   selection, assets and refresh cannot buy another image.
4. Complete case 1 create/edit/keep/reload first. Advance sequentially only after
   mechanics, usage and visual screening are sound. Adjust the map to the next
   registered event without replenishing an earlier event's budget. No case may
   be replaced with an easier request. Close spending after the screen or on a
   stop condition. Preserve all claims/results and report unrun cases.

The optional cap does not create authorization or alter the default four-call
product limit when absent. Changing or removing the evaluation map during a
study is not a way to replenish its allowance. Production is still excluded by
the existing enrollment/route policy. No database migration is needed.

## Customer procedure and evidence

Use the actual customer screen: submit the complete brief, request the preview,
inspect the decoded image, keep it, request one change, compare both versions,
choose the desired version, reload and verify that choice and exact pixel hash.
Do not submit checkout. Exercise original/revision choice with the retained
versions without extra model calls. An owner choice is not a quality verdict.

Record the first-image result before an edit. If a visible defect is repairable
without changing the request, describe that defect precisely and freeze the
correction text/hash before the one allowed edit. If it already meets the brief,
use the case's prewritten refinement; label it a preference edit, not a repair.
Preserve both outputs. A correction must repair the target without damaging
previously correct identity, anatomy, quantities, composition or treatment.
Do not call an edit successful merely because its image rendered.

Record each outcome against the exact delivered pixels:

- Full request and exclusions; independently recognizable named subjects;
  quantities, required objects and plausible anatomy/connections.
- Requested treatment, composition, finish and legibility space; no stray
  lettering, logos, clipping, placeholder surfaces or silent theme substitution.
- First-pass success, repair success vs preference-edit fidelity, new defects,
  final choice, customer revision burden and staff intervention.
- Request IDs, provider calls, complete prompts, source/delivery/input hashes,
  all returned usage, known charge estimate and unknown billing separately.
- Button-to-visible-image timing, edit timing and cumulative journey time,
  including user/inspection time as a separate recorded component.

For browser timing, record the observation clock immediately BEFORE the actual
button click and check the visible image element's completion, natural dimensions
and kept candidate hash. Record the last not-ready and first decoded observations.
Tool/polling overhead remains in the conservative upper bound. Do not substitute
server generation duration or claim millisecond-exact decode timing. If first
decoded observation is within 90 seconds, delivery is confirmed by that time; if
the interval straddles 90 seconds, the result is indeterminate, not a pass.
Record fresh-load timing separately from cached/reload recovery. No hidden
browser state or synthetic timer may stand in for observed image delivery.

Agent visual inspection is labeled as such. Human qualification fields remain
pending until an actual independent human assessment exists. This is temporary
release evaluation, not a plan for Alex to approve every customer order.

## Stop and advancement rules

- Stop immediately on provider moderation/refusal, unknown outcome/billing,
  wrong source/brief, source corruption, persistence or ownership failure,
  duplicate spending or an exhausted allowance. Retain evidence; do not reword
  blocked requests to get around a provider boundary.
- A visual first-pass defect stays a first-pass failure. One authorized edit
  may diagnose repairability. If the edit still fails or damages correct details,
  stop that screen and identify the component needing work. No second edit.
- A 90-second miss remains a timing failure. Do not buy more cases to hide it
  in a larger denominator or silently exclude failed/missing outputs.
- Full screen success only supports proceeding to representative repeated and
  held-out evaluation. The existing release gate remains at least 20 independent
  trials per each of eight directions, at least 95% per-direction human-accepted
  final images delivered within 90 seconds. Eight pairs cannot prove 95%
  reliability, arbitrary-theme correctness or commercial readiness.
- Payment/automatic unlock/Plus, invitations/personal RSVP/recovery/mobile and
  release controls remain the next distinct priorities. Prior passes carry forward.

## Offline verification

`tests/customerArtworkQualityBatch.test.ts` exercises all eight briefs through
real Express customer routes with injected synthetic generation. It checks full
brief retention, exact saved source edits, one request per operation, request
limits, explicit choice, revert/reload/hash continuity and no-spend replays.
Every fetch is blocked. No quality, human score, live cost or customer timing is
reported. The separate boundary tests cover malformed/unlisted scopes,
concurrent final claims, closed-switch replay and no brief-change replenishment.

Reproduce only the offline preflight:

```sh
POSY_WRITE_CUSTOMER_FLOW_PREFLIGHT=1 ./node_modules/.bin/vitest run tests/customerArtworkQualityBatch.test.ts tests/customerArtworkFlow.test.ts --maxWorkers=2 --testTimeout=30000
```

Do not overwrite this preflight with live results. Save live evidence separately
with real event mappings and exact deployment identity; keep owner credentials private.
