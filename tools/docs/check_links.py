#!/usr/bin/env python3
"""
Verify that every relative link and image reference inside docs/ resolves.

Catches the two mistakes we have actually made:
  * paths that are correct when inlined into the PDF but wrong when GitHub renders the markdown
  * links to de-duplicated help-library articles that live under a different category directory

Run: python3 tools/docs/check_links.py
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LINK = re.compile(r'\]\(([^)#\s]+?)(?:#[^)]*)?\)')
HTML_SRC = re.compile(r'src="([^"]+)"')


def main():
    missing = []
    checked = 0
    for path in glob.glob(os.path.join(ROOT, 'docs', '**', '*.md'), recursive=True):
        base = os.path.dirname(path)
        try:
            text = open(path).read()
        except Exception:
            continue
        for match in list(LINK.findall(text)) + list(HTML_SRC.findall(text)):
            if match.startswith(('http://', 'https://', 'mailto:', '#', 'data:')):
                continue
            checked += 1
            if not os.path.exists(os.path.normpath(os.path.join(base, match))):
                missing.append((os.path.relpath(path, ROOT), match))
    print(f'checked {checked} relative references in docs/')
    if missing:
        print(f'BROKEN ({len(missing)}):')
        for p, m in missing[:30]:
            print(f'   {p} -> {m}')
        return 1
    print('PASSED - every relative link and image resolves')
    return 0


if __name__ == '__main__':
    sys.exit(main())
