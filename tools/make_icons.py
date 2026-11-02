"""Draws the Park Pack paw icons used by the installable app."""
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (47, 107, 69, 255)
BALL = (212, 236, 63, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"

def paw(draw, size, scale):
    c = size / 2
    u = size * scale / 64  # design units on a 64 grid
    def ell(cx, cy, rx, ry):
        x, y = c + (cx - 32) * u, c + (cy - 32) * u
        draw.ellipse([x - rx * u, y - ry * u, x + rx * u, y + ry * u], fill=BALL)
    ell(32, 40, 11, 9.5)
    ell(18.5, 27, 5, 6.2); ell(27, 19.5, 5, 6.5); ell(37, 19.5, 5, 6.5); ell(45.5, 27, 5, 6.2)

def icon(size, *, rounded, scale, name):
    big = size * 4
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=GREEN)
    else:
        d.rectangle([0, 0, big, big], fill=GREEN)
    paw(d, big, scale)
    img = img.resize((size, size), Image.LANCZOS)
    if not rounded:
        img = img.convert("RGB")
    img.save(OUT / name)

icon(192, rounded=True, scale=1.0, name="icon-192.png")
icon(512, rounded=True, scale=1.0, name="icon-512.png")
icon(512, rounded=False, scale=0.72, name="icon-maskable-512.png")  # safe zone for Android masks
icon(180, rounded=False, scale=0.9, name="apple-touch-icon.png")    # iOS rounds the corners itself
print("ok")
