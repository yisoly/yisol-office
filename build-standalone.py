#!/usr/bin/env python3
"""styles.css · config.js · app.js 를 index.html 하나에 인라인해
   '한 파일로 여는' 데모용 HTML을 만든다.

   python3 build-standalone.py
   → dist/이솔-비서실-데모.html

   · index.html 의 ?v=... 캐시 버전이 붙어 있어도 정규식으로 찾아 바꾼다.
   · 데모 파일에는 Supabase 주소·키를 비워 넣어 로컬 데모 모드로 열린다
     (로그인 화면 없이 파일 하나로 바로 열 수 있게).
"""
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "dist" / "이솔-비서실-데모.html"

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
config = (ROOT / "config.js").read_text(encoding="utf-8")
app = (ROOT / "app.js").read_text(encoding="utf-8")

# 데모 파일은 오프라인 로컬 모드로: Supabase 값을 비운다.
config = re.sub(r'(SUPABASE_URL:\s*)"[^"]*"', r'\1""', config)
config = re.sub(r'(SUPABASE_ANON_KEY:\s*)"[^"]*"', r'\1""', config)

html, n_link = re.subn(
    r'<link rel="stylesheet" href="styles\.css(\?[^"]*)?"\s*/?>',
    lambda _m: "<style>\n" + css + "</style>",
    html,
    count=1,
)
html, n_cfg = re.subn(
    r'<script src="config\.js(\?[^"]*)?"></script>',
    lambda _m: "<script>\n" + config + "\n</script>",
    html,
    count=1,
)
html, n_app = re.subn(
    r'<script src="app\.js(\?[^"]*)?"></script>',
    lambda _m: "<script>\n" + app + "\n</script>",
    html,
    count=1,
)

missing = [name for name, n in (("styles.css", n_link), ("config.js", n_cfg), ("app.js", n_app)) if n != 1]
if missing:
    raise SystemExit("인라인하지 못한 파일: " + ", ".join(missing) + " — index.html의 태그를 확인하세요.")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")

# 데모 파일은 dist/ 안에 있으므로, 비서 프로필 사진도 dist/assets 로 같이 복사한다.
# (같이 두지 않으면 사진 대신 이모지 폴백으로 보인다.)
src_assets = ROOT / "assets"
if src_assets.is_dir():
    shutil.copytree(src_assets, OUT.parent / "assets", dirs_exist_ok=True)

print("wrote", OUT, len(html), "bytes")
