# Construction gouache v1 — style-approved source

The project owner approved this illustration's **art direction for original
children's themes**. Preserve that decision: no return to generic clipart,
stock photography or an invented celebrant. This is not approval of a live
customer result, every possible construction brief, named-character art,
commercial terms, or a measured latency claim.

`source.png` identifies the exact original 1024×1536 RGB PNG shown to the owner.
Its hash is bound in `manifest.json`. The full-resolution master is deliberately
excluded from the published Git tree and public asset folder. The original
approval artifact is retained separately; private deployment storage is still
required before customer activation. Do not put the master in a public bucket,
repository tree or static asset directory to make a test or deployment pass.
`prepareSceneStyleSource` verifies that source and makes the existing exact
560px transform without changing the original, cropping, or upscaling it.

This first pack contains **one complete scene**, not separable layers. A crane,
excavator and sand-play imagery are visibly present; those observations are
not a certificate covering arbitrary future host requirements. Additional
details, exclusions, palettes or named themes must not be ignored to reuse it.
There is no automatic selection or customer activation.

Verify an authorized local copy without making any provider calls:

```bash
node --import tsx tools/qa/verifySceneStyleSource.ts /absolute/path/to/source.png
```

CI uses clearly labeled synthetic pixels to test the preparation contract; the
above command checks the actual approved master against its committed checksum.

Before use in a customer-facing recipe: certify explicit requirement coverage,
complete the source/commercial review, run the strict final-composite gate,
retain the result, and complete the budgeted repeated benchmark. Style approval
must never be copied into those pending fields. No paid test is scheduled here.

## Generation brief and provenance

Created using built-in image generation, separately from Posy's API and timing
benchmark. No uploaded personal image or named-character reference was used.

Use case: illustration-story.
Asset type: one private art-direction proof for Posy's original construction-themed children's event artwork. This is NOT a screenshot, template mockup, presentation board, or completed invitation. Generate a single full-bleed portrait illustration, 2:3 aspect ratio.
Primary request: a beautiful construction-themed play landscape containing an unmistakable excavator, a complete recognizable crane, and a substantial sand-play area, composed together as one coherent, joyful environment. These three requested elements must be easy to identify at a small phone-preview size.
Style/medium: genuinely premium commissioned children's editorial illustration, with sophisticated hand-painted gouache shapes, restrained dry-brush detail, beautiful matte texture, spatial depth and intentional asymmetrical art direction. Inviting and celebratory without clipart or babyish cartoon faces. Tactile warm ochre machinery and sandy earth, with deep blue-green accents; avoid a beige wash. The machines must have clear believable mechanical silhouettes, coherent boom and bucket connections, grounded tracks/wheels and consistent perspective.
Composition/framing: one integrated scene, not separately pasted objects. The excavator is the foreground hero, the crane is a substantial co-hero set a little farther back, and the sand-play area is visually distinct and naturally integrated. Give all equipment clean separation and generous breathing room. Keep the entire crane boom/hook, excavator bucket/arm and vehicle bodies inside the canvas. Use visual depth and textured scenery across the full canvas; do not leave a blank card, paper panel, rectangle, border or reserved text area.
Lighting/mood: warm afternoon light from one direction with coherent, subtle contact shadows; imaginative, welcoming, elegant and playful. The original event-world illustration itself should be desirable, not merely a generic stock construction picture.
Text: none.
Constraints: no people, children, faces on machines, copyrighted characters, logos, lettering, signatures, watermarks, signs, banners, candles, numerals or countable age props. No balloons, cake or unrequested vehicle collection. No photo-realism, glossy 3D plastic, flat vector clipart, collage, sticker sheet, paper cutout edges or split panels. Produce only the illustration.
