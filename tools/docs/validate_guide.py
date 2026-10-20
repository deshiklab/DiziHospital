#!/usr/bin/env python3
"""
Validate the generated guide before it becomes a PDF.

  * every <img src> in docs/build/guide.html must resolve to a real file
  * every referenced file must be a readable, non-truncated image
  * writes docs/build/image-report.json and exits non-zero when anything is wrong

Run: python3 tools/docs/validate_guide.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GUIDE = os.path.join(ROOT, 'docs', 'build', 'guide.html')
REPORT = os.path.join(ROOT, 'docs', 'build', 'image-report.json')


def _jpg_ok(path):
    """Dependency-free JPEG sanity check: SOI marker at the start, EOI at the end."""
    with open(path, 'rb') as f:
        head = f.read(3)
        if head[:3] != b'\xff\xd8\xff':
            return False
        f.seek(-2, os.SEEK_END)
        return f.read(2) == b'\xff\xd9'


def _png_ok(path):
    with open(path, 'rb') as f:
        return f.read(8) == b'\x89PNG\r\n\x1a\n'


def _check_image(path):
    """Return None when the file is a valid image, otherwise a short reason."""
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in ('.jpg', '.jpeg'):
            if not _jpg_ok(path):
                return 'not a complete JPEG (truncated or wrong format)'
        elif ext == '.png':
            if not _png_ok(path):
                return 'not a valid PNG'
        try:
            from PIL import Image  # stronger check when Pillow is available
            with Image.open(path) as im:
                im.verify()
        except ImportError:
            pass
        except Exception as e:  # noqa: BLE001
            return f'Pillow verify failed: {str(e)[:100]}'
    except Exception as e:  # noqa: BLE001
        return str(e)[:120]
    return None


def main():
    if not os.path.exists(GUIDE):
        print('guide.html not found:', GUIDE)
        return 1
    html = open(GUIDE).read()
    srcs = re.findall(r'<img[^>]+src="([^"]+)"', html)
    base = os.path.dirname(GUIDE)
    missing, unreadable = [], []
    ok = 0
    seen = set()
    for s in srcs:
        if s.startswith(('http://', 'https://', 'data:')):
            continue
        p = os.path.normpath(os.path.join(base, s))
        if s in seen:
            continue
        seen.add(s)
        if not os.path.exists(p):
            missing.append({'src': s, 'resolved': p})
            continue
        if os.path.getsize(p) == 0:
            unreadable.append({'src': s, 'reason': 'zero bytes'})
            continue
        reason = _check_image(p)
        if reason:
            unreadable.append({'src': s, 'reason': reason})
        else:
            ok += 1

    # screenshots referenced by the markdown sources but absent from the asset folder
    declared = sorted({m for m in re.findall(r'\((\.\./assets/screens/[^)]+)\)', html)
                       + re.findall(r'src="(\.\./assets/screens/[^"]+)"', html)})
    report = {
        'img_tags': len(srcs),
        'distinct_images': len(seen),
        'resolved_ok': ok,
        'missing': missing,
        'unreadable': unreadable,
        'distinct_screens_in_docs': len(declared),
    }
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w') as f:
        json.dump(report, f, indent=1)

    print(f"images: {len(srcs)} tags, {len(seen)} distinct, {ok} verified")
    if missing:
        print(f"MISSING ({len(missing)}):")
        for m in missing[:20]:
            print('   ', m['src'])
    if unreadable:
        print(f"UNREADABLE ({len(unreadable)}):")
        for m in unreadable[:20]:
            print('   ', m['src'], '->', m['reason'])
    if missing or unreadable:
        print('VALIDATION FAILED')
        return 1
    print('VALIDATION PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
