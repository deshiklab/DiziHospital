from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "docs" / "build" / "site"
INDEX = SITE / "index.html"

if not INDEX.exists():
    raise FileNotFoundError(f"Expected generated site at {INDEX} but it was not created.")

text = INDEX.read_text(encoding="utf-8")
links = re.findall(r'''href=["']([^"']+)["']''', text, flags=re.IGNORECASE)

for link in links:
    if link.startswith(("http://", "https://", "mailto:", "#", "javascript:")):
        continue

    target = (SITE / link).resolve()
    if not target.exists():
        raise FileNotFoundError(f"Broken link in generated site: {link}")

print(f"Documentation site validated successfully: {INDEX}")
