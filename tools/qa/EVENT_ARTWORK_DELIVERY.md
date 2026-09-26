# Event artwork response regression

Event JSON must stay small after an approved preview is reused or an AI-first
design is applied. Inline artwork remains in the database; owner/public views
replace its three invitation fields and AI-first snapshot image with versioned
binary URLs. Prepayment source and approval markers never leave through event
JSON. Guests receive an explicit invitation-field allowlist and no draft assets.

Run `npx vitest run tests/eventArtworkDelivery.test.ts` for the actual Express
reuse, owner reload, PATCH and public/owner asset handlers with synthetic
in-memory persistence and entitlement. The default valid PNG has enough pixels
to reproduce the old multi-megabyte JSON failure. Both approval versions must
preserve the original PNG bytes and decoded pixels, with JSON below 5 KB.

For a saved local artwork, set `POSY_QA_ARTWORK_PATH` to its absolute PNG path
and optionally `POSY_QA_ARTWORK_REPORT` to an absolute output JSON path. Never
commit private art, event credentials, or captured live responses. The fixture
approval and paid flag are test setup, not a new vision review or Stripe proof.

Returned image URLs can be round-tripped by the wording/design editor: resolve
only a matching current version of this event before persistence. Unknown,
cross-event or already changed references fail without writing. Asset GETs do
not follow URLs or generate artwork. Public asset access stops on unpublish.

Limits: source storage is unchanged. Originals above 4,500,000 bytes receive a
clear 413 and still need an object-storage delivery solution; they are never
silently reduced. Raster PNG/JPEG/WebP/GIF are served; inline SVG/HTML is not.
External catalog URLs remain unchanged. This is not a browser visual check,
payment settlement, new image generation, or full launch benchmark.
