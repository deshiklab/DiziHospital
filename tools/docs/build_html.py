from pathlib import Path
import markdown

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
SITE = DOCS / "build" / "site"
SITE.mkdir(parents=True, exist_ok=True)

source = DOCS / "index.md"
if not source.exists():
    raise FileNotFoundError(f"Missing documentation source: {source}")

text = source.read_text(encoding="utf-8")
html_body = markdown.markdown(text, extensions=["extra", "sane_lists"])
page = f"""<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>DiziHospital Docs</title>
    <style>
      body {{
        font-family: Arial, sans-serif;
        max-width: 960px;
        margin: 2rem auto;
        padding: 0 1rem;
        line-height: 1.6;
      }}
      h1, h2 {{
        color: #1f2937;
      }}
    </style>
  </head>
  <body>
    {html_body}
  </body>
</html>
"""

output = SITE / "index.html"
output.write_text(page, encoding="utf-8")
print(f"Generated documentation site: {output}")
