"""Makes park-pack-qr.png: a shareable card with a QR code that opens the install screen."""
from pathlib import Path
import qrcode
from PIL import Image, ImageDraw, ImageFont

URL = "https://turretlez.github.io/park-pack/?join"
root = Path(__file__).resolve().parent.parent
GREEN, BALL, INK, BG = (47, 107, 69), (212, 236, 63), (23, 37, 29), (238, 242, 236)

def font(size, bold=True):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try: return ImageFont.truetype(name, size)
        except OSError: pass
    return ImageFont.load_default()

qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=18, border=2)
qr.add_data(URL); qr.make(fit=True)
code = qr.make_image(fill_color=INK, back_color="white").convert("RGB")

# paw badge in the middle of the code (H error correction covers it)
icon = Image.open(root / "icons" / "icon-192.png").convert("RGBA").resize((code.width // 5,) * 2)
pad = Image.new("RGB", (icon.width + 20, icon.height + 20), "white")
pad.paste(icon, (10, 10), icon)
code.paste(pad, ((code.width - pad.width) // 2, (code.height - pad.height) // 2))

W = code.width + 160
H = code.height + 420
card = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(card)
d.rectangle([0, 0, W, 220], fill=GREEN)
d.text((W // 2, 90), "Park Pack", font=font(84), fill="white", anchor="mm")
d.text((W // 2, 165), "Downtown Boston dogs", font=font(40, False), fill=BALL, anchor="mm")
card.paste(code, (80, 260))
y = 260 + code.height + 60
d.text((W // 2, y), "Scan with your phone camera", font=font(46), fill=INK, anchor="mm")
d.text((W // 2, y + 62), "to add Park Pack to your home screen. Free.", font=font(36, False), fill=(91, 107, 96), anchor="mm")
out = root / "park-pack-qr.png"
card.save(out)
print(out, card.size)
