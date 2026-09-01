from pathlib import Path


path = Path("script/patch_preview_background_abort.py")
text = path.read_text()

old_name = 'it("keeps original themes behind the separate quality-image release gate",'
new_name = 'it("stores original-theme artwork only after the private quality function approves it",'
if text.count(old_name) != 2:
    raise SystemExit(f"expected two drifted anchors, found {text.count(old_name)}")
text = text.replace(old_name, new_name)

old_get = '''    const response = await request(makeApp({ mode: "direction-card" }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);'''
new_get = '''    const response = await request(makeApp({ mode: "direction-card", unlocked: true }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);'''
if text.count(old_get) != 1:
    raise SystemExit(f"expected one arbitrary-image GET anchor, found {text.count(old_get)}")
text = text.replace(old_get, new_get, 1)

marker = 'quality_test = "tests/prePaymentPreviewQuality.test.ts"\n'
if text.count(marker) != 1:
    raise SystemExit("quality-test insertion marker drifted")

extra = """one(
    test,
    '''  it(\"stores original-theme artwork only after the private quality function approves it\", async () => {
    stored = genericEvent();
    generate.mockResolvedValue({
      kind: \"approved-image\",
      dataUrl: APPROVED_PNG,
      attempts: 2,
      model: \"gpt-image-2\",
      reviews: [],
    });

    const response = await request(makeApp({ mode: \"quality-image\" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: \"host@example.com\" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe(\"approved-image\");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString(\"base64\")}`);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
  });''',
    '''  it(\"stores original-theme artwork only after the scheduled private quality function approves it\", async () => {
    stored = genericEvent();
    generate.mockResolvedValue({
      kind: \"approved-image\",
      dataUrl: APPROVED_PNG,
      attempts: 1,
      model: \"gpt-image-2\",
      reviews: [],
    });

    const response = await request(makeApp({ mode: \"quality-image\" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: \"host@example.com\" });

    expect(response.status).toBe(202);
    expect(response.body.kind).toBe(\"none\");
    expect(classifyNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();

    await runScheduledTask();

    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      quality: \"medium\",
      maxCandidates: 1,
      namedReference: null,
      signal: expect.any(AbortSignal),
    }));
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString(\"base64\")}`);
    expect(stored.prePaymentPreviewAttempts).toBe(1);

    const ready = await request(makeApp({ mode: \"quality-image\" }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.status).toBe(200);
    expect(ready.body.kind).toBe(\"approved-image\");
  });''',
)

"""

text = text.replace(marker, extra + marker, 1)
path.write_text(text)
