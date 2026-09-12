# Meekah likeness correction — 12 September 2026

Status: CLOSED, allowance consumed. Preview research only. After an automatic
approval interruption with no server claim, the user explicitly approved sending
the saved scene and official reference to Posy Preview for one Google image edit
and one Anthropic review. Exactly one of each ran; zero classifiers or retries.

The user rated the existing finish an "OK option" and requested a more realistic,
accurate Meekah. This is a likeness correction within the existing painted scene;
it does not make the prior result a fully approved craft example or change the
original synthetic host brief. The old repaint registration stays consumed.

## Fixed inputs

- Dataset `google-meekah-likeness-20260912-v1`, event61, scene attempt287.
- Scene source SHA `f996272faa7870d529b62c798ce11af297e0e81581323082d966fe35505ffb29`.
- Original host SHA `e4634856bdea506e3b711bef789c1c94b5f6ee578725b407753fe61959da19ad`.
- Identity source: Meekah portrait labeled by the [official About page](https://www.blippi.com/about).
  Exact original: `https://static.wixstatic.com/media/d70790_9f3656b5950649a0b97994a75c065b84~mv2.png`.
  Original SHA `9668d4330ec2611c5f2700f55144dcb40e9070f0ddd24e49b7c222d888220c19`.
- Reference normalized offline to RGB PNG with alpha composited over white,
  proportionally resized inside1024×1024 without cropping or changing features.
  Final1024×1015,985466bytes, SHA
  `347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8`.
  These pixels were intended for both providers. The live generator received
  both references; the reviewer reference was omitted by the wiring defect below.

## Mechanism and boundaries

Image1 supplies scene/composition/acceptable finish. Image2 supplies Meekah's
facial likeness, hair arrangement and visible proportions only. The photograph's
medium, framing, pose, background, letter badge and logos are explicitly excluded
from copying. Full host scene, cast and exclusions remain binding. A different
host-specified version would take precedence; this experiment uses the verified
official pictured version and does not blend performers.

The exact560px candidate is the first image given to the current Sonnet reviewer;
the official identity reference is separately labeled. No scene reference is
labeled as human-approved premium craft. The reviewer receives neither the user's
rating nor prior verdict and must still evaluate every dimension and exclusion.
No scoring threshold is changed. Reference provenance must appear in the returned
review evidence before a result can qualify as an automated pass.

The existing durable single-use harness checks Preview branch, owner, original
brief and source hash before dispatch. The client may submit only the registered
identity bytes; unknown/changed/missing references fail before claim/spend. No
runtime image URL fetching occurs. Exact identity bytes are retained privately
and read back before the paid image call. All generated stages remain rejected
and customerActivation disabled. There is no event mutation, allowance reset or
automatic route to a customer preview.

## Decision

Independently inspect source and exact teaser against the identity reference.
Report face/hair resemblance and preservation of Blippi, dancing, ball pit, foam
structures, bubbles, ice-cream counter, palette, finish and no-lettering rule.
Report any reviewer disagreement. A pass supports only this bounded likeness
correction; consistency and the complete customer flow remain unproven.

Stop after this one result, or earlier on provider, deadline, accounting, claim
or retention failure. Do not generate until successful or bypass a refusal.
If the request outcome is uncertain, inspect durable rows with read-only calls;
never repeat the POST. Timing/cost must explicitly exclude previously incurred
scene generation/repaint stages and offline reference preparation from any
claimed uninterrupted customer measurement. All original launch gates remain.


## Live result and corrective action

Executed on `8fc417c8d3e77e1c6b0ae2b85666c5a80d14b518`, Preview
`https://posy-qntnp3vul-poseplans.vercel.app`. HTTP200, completed attempt293;
stages288–293, reference retained separately at289. Event snapshot unchanged,
all records rejected and customer activation disabled. No repeat request.

- New source SHA `3ed9ff2d1da11a7a8553272b071b16c521519efa638649ffb3c0bda430f6cc9e`.
- Exact313×560 reviewer image SHA `7d16340d64c38bf1a24f218b5db3f5e59666d6b1e2ff3d57ce26e972f18181f0`.
- Google edit9435ms (provider9054ms, normalization377ms); Sonnet28932ms.
  Measured stage elapsed39678ms, client request47984ms. This excludes previous
  scene work and is not an uninterrupted customer-flow measurement.
- Google2346input tokens (1830text,516image),1489output (1120image,
  369unitemized); Sonnet7268input/947output. Do not sum duplicate stage rows or
  treat the reference row as generated output. No final billed dollar total known.
- Critic scores: text5, artifact5, premium3, fidelity3, composition5, age5.
  It rejected medium/purchase while reporting identity accurate. However,
  `referenceEvidence` was absent, so the harness correctly recorded
  `review-unavailable` and `gatePassed:false`. This is not a valid
  reference-supported likeness verdict.

Root cause: the harness supplied `references` in a conditional object spread;
the real `runVisionGate` adapter reads `referenceImages`. TypeScript permitted the
extra spread property, and the old mocked test repeated the wrong property name.
The fix passes the correctly named explicit property. A regression now exercises
the real reviewer adapter with only the external transport stubbed, verifying
candidate/reference image hashes, identity-only labels, one transport call with
retries disabled, and returned/persisted provenance. The corrected contract test
and new adapter regression both failed before the fix. No threshold or prior
verdict was rewritten, and no further paid call was made to validate the fix.
Other customer-flow and calibration call sites already use `referenceImages`.

Independent inspection of both source and exact teaser: Meekah's face and smile
appear closer to the supplied portrait, with less exaggerated eyes and a yellow
headband now visible. Hair remains a broad rounded loose silhouette rather than
the reference's gathered asymmetric curls. This is partial improvement, not a
faithful-match or user approval. Dancing poses, Blippi, ball pit, foam structures,
bubbles, ice-cream counter and palette remain; two unrequested wall vents were
added. No readable lettering was observed. Painted marks remain on floor, walls
and blocks, so the critic's absolute claim of no brush-made edges anywhere is
not supported, while the characters still have prominent outlines and smooth
shading. Medium/craft calibration remains unresolved. This test is closed;
retain this image for human review instead of generating another variation.
