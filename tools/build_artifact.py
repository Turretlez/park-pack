"""Builds dist/artifact.html (the claude.ai shared preview) from index.html."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
src = (root / "index.html").read_text(encoding="utf-8")
body = src.split("<!-- APP START -->", 1)[1].split("<!-- APP END -->", 1)[0]
head = '<title>Downtown Park Pack</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "artifact.html").write_text(head + body.strip() + "\n", encoding="utf-8")
print("wrote dist/artifact.html")
