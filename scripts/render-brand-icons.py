#!/usr/bin/env python3
"""Render the committed Signal SVG into browser and installed-PWA icons.

Maintainer-only regeneration: pip install cairosvg==2.9.1 pillow==13.0.0
Then run: python3 scripts/render-brand-icons.py
The generated files are committed; application builds need no image libraries.
"""
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

PUBLIC = Path(__file__).resolve().parents[1] / "web" / "public"
SOURCE = PUBLIC / "icon.svg"


def render(size, *, opaque=False):
    png = cairosvg.svg2png(url=str(SOURCE), output_width=size, output_height=size)
    image = Image.open(BytesIO(png)).convert("RGBA")
    if opaque:
        background = Image.new("RGBA", image.size, "#0c192c")
        background.alpha_composite(image)
        image = background.convert("RGB")
    return image


for filename, size, opaque in (
    ("favicon-32.png", 32, False),
    ("apple-touch-icon.png", 180, True),
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
):
    render(size, opaque=opaque).save(PUBLIC / filename, optimize=True)

render(256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("Signal SVG rendered: favicon ICO/PNG, Apple 180, PWA 192/512, maskable 512")
