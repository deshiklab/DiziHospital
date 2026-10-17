#!/usr/bin/env python3
"""
Fail the build when the guide would ship with missing screenshots.

Reads the reports written by:
  * tools/docs/validate_guide.py  -> docs/build/image-report.json          (paths + file integrity)
  * tools/docs/pdf.js             -> docs/build/image-report-browser.json  (images decoded by Chromium)

Also compares the images embedded in the produced PDF against the number the
guide declares, so a silent render failure cannot slip through.

Usage: python3 tools/docs/assert_images.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD = os.path.join(ROOT, 'docs', 'build')
GUIDE = os.path.join(BUILD, 'guide.html')
PDF = os.path.join(ROOT, 'docs', 'Smart-Hospital-Complete-Guide.pdf')

problems = []


def load(name):
    p = os.path.join(BUILD, name)
    if not os.path.exists(p):
        return None
    try:
        return json.load(open(p))
    except Exception as e:  # noqa: BLE001
        problems.append(f'{name} unreadable: {e}')
        return None


def main():
    html_report = load('image-report.json')
    browser_report = load('image-report-browser.json')

    if html_report is None:
        problems.append('image-report.json missing - validate_guide.py did not run')
    else:
        missing = html_report.get('missing', [])
        unreadable = html_report.get('unreadable', [])
        print(f"paths: {html_report.get('distinct_images')} distinct images, "
              f"{html_report.get('resolved_ok')} verified, {len(missing)} missing, {len(unreadable)} unreadable")
        for m in missing[:25]:
            print('   MISSING:', m.get('src'))
            problems.append(f"missing image: {m.get('src')}")
        for m in unreadable[:25]:
            print('   UNREADABLE:', m.get('src'), '->', m.get('reason'))
            problems.append(f"unreadable image: {m.get('src')}")

    if browser_report is None:
        problems.append('image-report-browser.json missing - pdf.js browser check did not run')
    else:
        broken = browser_report.get('broken', [])
        print(f"browser: {browser_report.get('ok')}/{browser_report.get('total')} images decoded, {len(broken)} broken")
        for b in broken[:25]:
            print('   BROKEN:', b.get('src'))
            problems.append(f"did not decode in browser: {b.get('src')}")

    # cross-check the embedded image objects of the PDF against the html
    if os.path.exists(PDF) and os.path.exists(GUIDE):
        try:
            from pypdf import PdfReader  # optional dependency
            expected = len(re.findall(r'<img[^>]+src="[^"]+"', open(GUIDE).read()))
            reader = PdfReader(PDF)
            embedded = 0
            for page in reader.pages:
                try:
                    xo = page.get('/Resources', {}).get('/XObject', {})
                    for name in list(xo.keys()):
                        obj = xo[name].get_object()
                        if obj.get('/Subtype') == '/Image':
                            embedded += 1
                except Exception:  # noqa: BLE001
                    continue
            print(f"pdf: {len(reader.pages)} pages, {embedded} embedded images (guide declares {expected} img tags)")
            if expected and embedded < expected * 0.9:
                problems.append(f'PDF embeds only {embedded} images for {expected} image tags')
            if len(reader.pages) < 100:
                problems.append(f'PDF looks truncated: {len(reader.pages)} pages')
        except ImportError:
            print('pdf cross-check skipped (pypdf not installed)')
        except Exception as e:  # noqa: BLE001
            problems.append(f'pdf cross-check failed: {e}')

    if problems:
        print(f'\nFAILED - {len(problems)} problem(s):')
        for p in problems[:30]:
            print('  -', p)
        return 1
    print('\nPASSED - every screenshot is present, readable and rendered')
    return 0


if __name__ == '__main__':
    sys.exit(main())
