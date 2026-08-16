# Assembles the comparison boards from the captured screenshots.
#
# Board 1: all twelve composed directions, one row per brief.
# Board 2: the surfaces — progressive reveal, mobile, envelope, RSVP.

import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/home/user/workspace/posy-ai-first-implementation-review"
SHOTS = f"{ROOT}/screenshots"
OUT = f"{ROOT}/boards"
os.makedirs(OUT, exist_ok=True)


def font(size, bold=False):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def scaled(path, width):
    img = Image.open(path).convert("RGB")
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def board(name, title, subtitle, panels, columns, panel_width, pad=34):
    """panels: list of (caption, path)."""
    tiles = [(cap, scaled(p, panel_width)) for cap, p in panels]
    rows = (len(tiles) + columns - 1) // columns
    cap_h = 58
    row_heights = [
        max(t.height for _, t in tiles[r * columns:(r + 1) * columns]) + cap_h
        for r in range(rows)
    ]
    header = 132
    W = pad + columns * (panel_width + pad)
    H = header + sum(h + pad for h in row_heights) + pad

    canvas = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, 34), title, fill="#111111", font=font(38, True))
    draw.text((pad, 84), subtitle, fill="#555555", font=font(19))
    draw.line([(pad, header - 14), (W - pad, header - 14)], fill="#dddddd", width=2)

    y = header
    for r in range(rows):
        x = pad
        for cap, tile in tiles[r * columns:(r + 1) * columns]:
            canvas.paste(tile, (x, y))
            draw.rectangle([x, y, x + tile.width, y + tile.height], outline="#e2e2e2")
            ty = y + tile.height + 10
            for i, line in enumerate(cap.split("\n")[:2]):
                draw.text((x, ty + i * 20), line, fill="#333333", font=font(16, i == 0))
            x += panel_width + pad
        y += row_heights[r] + pad

    path = f"{OUT}/{name}.png"
    canvas.save(path, optimize=True)
    print(f"{path}  {canvas.width}x{canvas.height}")


runs = json.load(open(f"{ROOT}/evidence/pipeline-runs.json"))
labels = {r["id"]: r["label"] for r in runs["runs"]}

board(
    "board-1-twelve-directions",
    "Twelve composed invitation directions",
    "Brief A, B and C. Rendered by the production ThemeInvitation renderer from the live model's concepts. "
    "Artwork is synthetic — gpt-image-1 was unreachable (no OPENAI_API_KEY).",
    [(f"Brief {i} — {labels[i]}\nfour directions, desktop 1440px", f"{SHOTS}/board-desktop-brief{i}.png")
     for i in ("A", "B", "C")],
    columns=1,
    panel_width=1500,
)

board(
    "board-2-surfaces",
    "Surfaces: reveal, mobile, envelope, RSVP",
    "The flagged AI-first experience, the 390px mobile layout, and the public RSVP page showing an applied AI direction.",
    [
        ("Progressive reveal — mid-stream\none direction revealed while others still generate", f"{SHOTS}/experience-desktop-midstream.png"),
        ("Progressive reveal — complete\nfour directions, 'Browse the Posy collection' present", f"{SHOTS}/experience-desktop-complete.png"),
        ("Collection view\nAI subtree unmounted", f"{SHOTS}/experience-collection-view.png"),
        ("Returned from collection\nall four directions and typed steer preserved", f"{SHOTS}/experience-back-from-collection.png"),
        ("Mobile 390px — brief A\nno horizontal overflow", f"{SHOTS}/experience-mobile-390-briefA.png"),
        ("Mobile 390px — brief C\nno horizontal overflow", f"{SHOTS}/experience-mobile-390-briefC.png"),
        ("Public RSVP — envelope closed\ndesktop", f"{SHOTS}/rsvp-desktop-envelope-closed.png"),
        ("Public RSVP — envelope opened\nAI-applied design + RSVP form", f"{SHOTS}/rsvp-desktop-opened.png"),
        ("Public RSVP — mobile 390px closed", f"{SHOTS}/rsvp-mobile-390-envelope-closed.png"),
        ("Public RSVP — mobile 390px opened", f"{SHOTS}/rsvp-mobile-390-opened.png"),
    ],
    columns=2,
    panel_width=720,
)

board(
    "board-3-mobile-directions",
    "All twelve directions at 390px",
    "Every direction stacked at mobile width, verified free of horizontal overflow.",
    [(f"Brief {i} — 390px", f"{SHOTS}/board-mobile-390-brief{i}.png") for i in ("A", "B", "C")],
    columns=3,
    panel_width=430,
)
