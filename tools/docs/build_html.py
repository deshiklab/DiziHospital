#!/usr/bin/env python3
"""
Render the documentation set into one print-ready HTML file that the CI job
converts to PDF with headless Chromium.

  docs/WIKI.md              -> "Part 1 - Operator handbook"
  docs/FEATURE-CATALOG.md   -> "Part 2 - Feature catalogue"
  docs/IMPROVEMENT-BACKLOG.md (if present) -> "Part 3 - Improvement backlog"

Output: docs/build/guide.html
"""
import os
import json
import datetime
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
BUILD = os.path.join(DOCS, 'build')


def md_to_html(path):
    with open(path) as f:
        text = f.read()
    md = markdown.Markdown(extensions=['tables', 'attr_list', 'toc', 'sane_lists', 'fenced_code'],
                           extension_configs={'toc': {'permalink': False, 'toc_depth': '2-3'}})
    html = md.convert(text)
    return html, md.toc


CSS = """
:root { --brand:#1bbed3; --brand-dark:#0f6f88; --ink:#1f2d3d; --muted:#6b7c93; --line:#e3e8ef; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif; color: var(--ink); font-size: 10pt; line-height: 1.55; margin:0; }
@page { size: A4; margin: 18mm 14mm 16mm 14mm; }
.cover { page-break-after: always; height: 250mm; display:flex; flex-direction:column; justify-content:space-between; }
.cover-top { border-top: 8px solid var(--brand); padding-top: 24px; }
.cover h1 { font-size: 34pt; line-height:1.15; margin: 0 0 8px; color: var(--brand-dark); }
.cover h2 { font-size: 15pt; font-weight: normal; color: var(--muted); margin: 0 0 28px; }
.cover .meta { border:1px solid var(--line); border-radius:10px; padding:14px 18px; background:#f8fbfd; }
.cover .meta table { width:100%; border:none; font-size:10pt; }
.cover .meta td { border:none; padding:3px 0; }
.cover .meta td:first-child { color:var(--muted); width:38%; }
.cover .strip { display:flex; gap:6px; margin-top:18px; }
.cover .strip img { width:32%; border:1px solid var(--line); border-radius:6px; }
.cover .foot { color:var(--muted); font-size:9pt; border-top:1px solid var(--line); padding-top:10px; }
.toc { page-break-after: always; }
.toc h2 { color: var(--brand-dark); }
.toc ul { list-style:none; padding-left:0; }
.toc ul ul { padding-left: 16px; }
.toc a { text-decoration:none; color: var(--ink); }
.toc > ul > li { margin-top:6px; font-weight:600; }
h1.part { page-break-before: always; font-size: 22pt; border-bottom:3px solid var(--brand); padding-bottom:8px; color:var(--brand-dark); }
h2 { font-size: 15pt; margin-top: 22px; color: var(--brand-dark); border-bottom:1px solid var(--line); padding-bottom:4px; page-break-after: avoid; }
h3 { font-size: 12.5pt; margin-top:18px; color:#14506b; page-break-after: avoid; }
h4 { font-size: 11pt; margin-top:14px; color:#14506b; page-break-after: avoid; }
p, li { orphans: 2; widows: 2; }
img { max-width: 100%; border:1px solid var(--line); border-radius:6px; margin: 8px 0 14px; page-break-inside: avoid; }
table { width:100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 8.6pt; page-break-inside: avoid; }
th { background: #eef6f9; text-align:left; }
th, td { border:1px solid var(--line); padding: 5px 7px; vertical-align: top; }
tr:nth-child(even) td { background:#fcfdfe; }
code { background:#f3f5f8; padding:1px 4px; border-radius:3px; font-size: 8.6pt; }
pre { background:#f3f5f8; padding:10px; border-radius:6px; font-size:8.5pt; page-break-inside: avoid; white-space: pre-wrap; }
blockquote { border-left:4px solid var(--brand); background:#f6fbfc; margin:10px 0; padding:8px 12px; color:#31505d; }
a { color: var(--brand-dark); }
hr { border:none; border-top:1px solid var(--line); margin:18px 0; }
.screen-shot-note { color: var(--muted); font-size: 8.5pt; }
"""


def main():
    os.makedirs(BUILD, exist_ok=True)
    catalog_json = {}
    cj = os.path.join(BUILD, 'catalog.json')
    if os.path.exists(cj):
        catalog_json = json.load(open(cj))

    wiki_html, _ = md_to_html(os.path.join(DOCS, 'WIKI.md'))
    cat_html, cat_toc = md_to_html(os.path.join(DOCS, 'FEATURE-CATALOG.md'))
    backlog_html = ''
    bp = os.path.join(DOCS, 'IMPROVEMENT-BACKLOG.md')
    if os.path.exists(bp):
        backlog_html, _ = md_to_html(bp)

    counts = catalog_json.get('counts', {})
    today = datetime.date.today().isoformat()

    def part(title, subtitle, body, toc_html=''):
        return (f'<h1 class="part">{title}</h1>'
                f'<p style="color:#6b7c93;margin-top:-6px">{subtitle}</p>{toc_html}{body}')

    cover_shots = ['001-dashboard.jpg', '005-opd-out-patient.jpg', '006-ipd-in-patient.jpg']
    strip = ''.join(f'<img src="../assets/screens/{s}" alt="">' for s in cover_shots
                    if os.path.exists(os.path.join(DOCS, 'assets', 'screens', s)))

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Smart Hospital — Complete Guide, Feature Catalogue &amp; Wiki</title>
<style>{CSS}</style></head><body>
<section class="cover">
  <div class="cover-top">
    <h1>Smart Hospital<br>Complete Guide</h1>
    <h2>Feature catalogue · Screenshot reference · Operator wiki &amp; help</h2>
    <div class="meta">
      <table>
        <tr><td>Product</td><td><b>Smart Hospital</b> — Hospital Management System (QDOCS)</td></tr>
        <tr><td>Explored instance</td><td>demo.smart-hospital.in — Smart Hospital &amp; Research Center</td></tr>
        <tr><td>Screens documented</td><td>{counts.get('screens', 76)} application screens, {counts.get('forms', 0)} forms/dialogs, {counts.get('subs', 0)} sub-screens, {counts.get('detail', 0)} record &amp; tab views</td></tr>
        <tr><td>Roles covered</td><td>Super Admin, Admin, Doctor, Nurse, Pharmacist, Pathologist, Radiologist, Accountant, Receptionist + Patient portal</td></tr>
        <tr><td>Method</td><td>Automated browser exploration (login → every menu screen → every add/edit form → real records → all roles → public site)</td></tr>
        <tr><td>Generated</td><td>{today}</td></tr>
      </table>
    </div>
    <div class="strip">{strip}</div>
  </div>
  <div class="foot">
    Contents: Part 1 Operator wiki &amp; help handbook · Part 2 Screen-by-screen feature catalogue with screenshots ·
    Part 3 Improvement backlog for the next phase. Screenshots were taken on the live demo instance.
  </div>
</section>
{part('Contents', 'How this guide is organised', '')}
<div class="toc"><h2>Part 1 — Operator wiki &amp; help handbook</h2>
<ul>
<li><a href="#1-getting-started">1. Getting started</a></li>
<li><a href="#2-initial-configuration">2. Initial configuration</a></li>
<li><a href="#3-front-desk-workflows">3. Front-desk workflows</a></li>
<li><a href="#4-clinical-services">4. Clinical services</a></li>
<li><a href="#5-administration-human-resources">5. Administration &amp; HR</a></li>
<li><a href="#6-communication-content-and-documents">6. Communication, content &amp; documents</a></li>
<li><a href="#7-reports">7. Reports</a></li>
<li><a href="#8-patient-portal-public-website">8. Patient portal &amp; public website</a></li>
<li><a href="#9-roles-permissions-and-security">9. Roles, permissions &amp; security</a></li>
<li><a href="#10-troubleshooting-faq">10. Troubleshooting &amp; FAQ</a></li>
<li><a href="#11-glossary">11. Glossary</a></li>
</ul>
<h2>Part 2 — Feature catalogue</h2>
{cat_toc}
</div>
{part('Part 1 — Operator wiki &amp; help handbook', 'Task-oriented help: how to run every module, day to day.', wiki_html)}
{part('Part 2 — Feature catalogue', 'Every screen, every form, every field — captured from the live application.', cat_html)}
{('<h1 class="part">Part 3 — Improvement backlog</h1>' + backlog_html) if backlog_html else ''}
</body></html>"""

    out = os.path.join(BUILD, 'guide.html')
    with open(out, 'w') as f:
        f.write(html)
    print('wrote', out, len(html), 'bytes')


if __name__ == '__main__':
    main()
