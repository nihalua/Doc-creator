"""Build the single, self-contained EWR-Olusturucu.html (works offline).

Usage: python tools/build.py path/to/pdf-lib.min.js
Inlines pdf-lib (v1.17.1, MIT) and template/ewr_template_blank.pdf into src/ewr.html.
"""
import base64
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "src" / "ewr.html").read_text(encoding="utf-8")
lib = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "</script" not in lib.lower()
tpl = base64.b64encode((root / "template" / "ewr_template_blank.pdf").read_bytes()).decode()
html = html.replace("/*PDFLIB*/", lib, 1).replace("__TEMPLATE_B64__", tpl, 1)
(root / "EWR-Olusturucu.html").write_text(html, encoding="utf-8")
print("written EWR-Olusturucu.html", len(html) // 1024, "KB")
