# Preview image resolution

15 September 2026. This changes image delivery, not the likeness reviewer's
semantic decisions or image generation model. No paid call is needed to verify
the transforms. Both previously judged Meekah illustrations remain human-accepted
for likeness; Illustration 2 also has a separate slight-blur concern.

## Finding and implementation

The previous customer transform reduced a 1024x1536 image to373x560. The real
DraftGenerating card has max-w-sm (384 CSS px), a1px border and a w-full image;
its parent uses px-6. At default16px root sizing, the inferred content widths
are340px in a390px viewport and382px on desktop. These are code-derived bounds,
not browser measurements. A2x display needs680/764 raster pixels respectively.

Fresh ordinary named/original customer generation requests now use detail-v1.
The source is proportionally bounded to1536px, never upscaled, and encoded with
lossless PNG Sub filtering. Exceptionally large encoded outputs fall back from
the ORIGINAL source to1280 then1024px until <=4,000,000bytes. The bounded payload
stays below Vercel's documented4.5MB function response limit:
https://vercel.com/docs/functions/limitations#request-body-size

The same deterministic helper supplies tier1/vision input and the private unpaid
GET response. Approval metadata retains the profile and reviewed hash. A new
internal data-URL marker binds detail-v1 to those approvals. Legacy markers keep
the exact historical560px transform and default PNG encoding. Old controls and
fixed customer evaluations remain legacy; all consumed budgets remain closed.
No image is silently marked re-reviewed at a new resolution.

Paid delivery/reuse retains the original source and the existing entitlement
check. Both marker versions normalize to browser-renderable PNG URLs on reuse.
This code does not prove the complete paid flow, resolve existing large event
JSON responses, or measure its deployed latency.

## Reproducible checks

- `npm run check`
- `npx vitest run tests/prePaymentPreviewImage.test.ts tests/prePaymentPreviewQuality.test.ts tests/prePaymentPreviewQualityRoutes.test.ts tests/initialPreviewRoute.test.ts`
- Other affected regression coverage: customerArtworkEvaluation,
  customerArtworkEvaluationSafety, googleArtwork, retainedLikenessReview.
- Full Verify Posy CI must pass on the exact pushed commit.

The read-only `previewResolutionServer.ts` uses real Express readiness/asset
routes with synthetic in-memory event/entitlement and an existing saved PNG.
Its fixture approval markers are NOT live review results. All POSTs/mutations,
generation, scheduling and classification are disabled. Set DATABASE_URL to a
dummy local test URL and POSY_QA_ARTWORK_PATH to an existing PNG, then run:

```bash
node --import tsx tools/qa/previewResolutionServer.ts
npx vite --config tools/qa/vite.config.ts --host 127.0.0.1 --port 5173
```

Open `/preview-resolution.html?profile=legacy`, then the Detailed approval link.
The390px and1024px frames mount the real customer component and application CSS.
They test CSS viewport sizes, not a physical high-density mobile display. For
in-process route capture without a browser, also set POSY_QA_CAPTURE_DIR; the
server captures GET responses with Supertest and exits instead of listening.

## Recorded evidence and limits

Saved Illustration2 legacy response:373x560,588621bytes,
SHA dbf07a910f2462984365b69f8b510aaa3f6f898196f5c842d76eb3fa785cf31c.
Detail response:1024x1536,2525458bytes,
SHA4b119778dcf3cd684e10425988b339859194c9b9a081fe54944fe7096cb6d747.
Pillow independently confirms every decoded detail pixel equals the saved
original; the original is4116018bytes, so lossless filtering saves38.64% versus
the original encoding. Detail transfer is larger than the old small preview.

The cloud browser blocked localhost and then explicitly blocked file URLs under
its URL security policy. No workaround, alternate browser surface or raw CDP
was used. Desktop/mobile visual verification is OPEN; do not label these
code-derived widths or captured route payloads as browser observations.

No fresh provider request, customer-event mutation, activation, merge or
Production action belongs to this resolution check. Remaining work includes
actual desktop/mobile visual verification, a separately labeled difficult
facial mismatch, medium/craft calibration, customer reviewer integration and
the original eight-direction/20+ independent trials/>=95% human-approved
within90s gates, plus Plus/payment/reuse/refinement/recovery/RSVP/planner checks.
