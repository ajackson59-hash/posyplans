#!/usr/bin/env python3
"""FIXTURE / NON-PROVIDER schematic renderer.

Draws one labeled PNG per QA scenario from the real DOM text content
captured by tests/aiFirstQaFixtureHarness.test.ts. This is a schematic, not
a pixel-accurate browser screenshot: the sandbox this was produced in has no
supported browser engine for Playwright/Chromium (see the note below), so
instead of skipping visual evidence entirely, the exact text the real
production component rendered is laid out here for a quick visual scan.

Every string drawn on these images came from a real render of the real
AiFirstInvitations component / useAiFirstSession hook, in jsdom, driven by a
stubbed fetch() replaying scripted SSE bodies. Nothing here calls a model or
an image provider, and nothing here is representative styling — it is a
labeled reading aid over real captured text, clearly marked as such.
"""
import json
import os
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

SCENARIO_TITLES = {
    "1-progress": "Scenario 1 — Progress (in flight)",
    "2-failure": "Scenario 2 — Failure (unexpected stream termination)",
    "3-recovery": "Scenario 3 — Recovery (fresh run after failure)",
    "4-duplicate-click-locked": "Scenario 4 — Duplicate-click prevention (server-locked)",
}


def font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def panel(canvas, draw, x, y, width, height, label, text):
    draw.rectangle([x, y, x + width, y + height], outline="#c9c9c9", width=2, fill="#ffffff")
    draw.rectangle([x, y, x + width, y + 34], fill="#f2f2f0")
    draw.text((x + 10, y + 8), label, fill="#333333", font=font(14, True))

    body_font = font(13)
    wrapped = textwrap.wrap(" ".join(text.split()), width=max(20, width // 8))
    ty = y + 46
    for line in wrapped[: (height - 56) // 18]:
        draw.text((x + 10, ty), line, fill="#111111", font=body_font)
        ty += 18


def main():
    data_path, out_dir = sys.argv[1], sys.argv[2]
    with open(data_path) as f:
        captured = json.load(f)

    pad = 24
    desktop_w, mobile_w = 640, 300
    panel_h = 260
    header_h = 90

    for scenario, widths in captured.items():
        title = SCENARIO_TITLES.get(scenario, scenario)
        W = pad * 3 + desktop_w + mobile_w
        H = header_h + panel_h + pad * 2

        canvas = Image.new("RGB", (W, H), "#fafaf9")
        draw = ImageDraw.Draw(canvas)
        draw.text((pad, 20), title, fill="#111111", font=font(22, True))
        draw.text(
            (pad, 52),
            "FIXTURE / NON-PROVIDER schematic — real DOM text, no model or image provider called.",
            fill="#a33333",
            font=font(13),
        )

        panel(canvas, draw, pad, header_h, desktop_w, panel_h, "Desktop (1024px container)", widths.get("desktop", ""))
        panel(
            canvas,
            draw,
            pad * 2 + desktop_w,
            header_h,
            mobile_w,
            panel_h,
            "Mobile (390px container)",
            widths.get("mobile", ""),
        )

        out_path = os.path.join(out_dir, f"schematic-{scenario}.png")
        canvas.save(out_path, optimize=True)
        print(f"wrote {out_path}  {canvas.width}x{canvas.height}")


if __name__ == "__main__":
    main()
