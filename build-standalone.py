#!/usr/bin/env python3
"""styles.css · config.js · app.js 를 index.html 하나에 인라인해
   '한 파일로 여는' 데모용 HTML을 만든다.

   python3 build-standalone.py
   → dist/이솔-비서실-데모.html
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "dist" / "이솔-비서실-데모.html"

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
config = (ROOT / "config.js").read_text(encoding="utf-8")
app = (ROOT / "app.js").read_text(encoding="utf-8")

html = html.replace(
    '<link rel="stylesheet" href="styles.css" />',
    "<style>\n" + css + "\n</style>",
)
html = html.replace(
    '<script src="config.js"></script>\n<script src="app.js"></script>',
    "<script>\n" + config + "\n</script>\n<script>\n" + app + "\n</script>",
)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print("wrote", OUT, len(html), "bytes")
