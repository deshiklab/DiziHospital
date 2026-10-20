#!/usr/bin/env python3
"""
Assemble the repository's documentation set into a static site, for GitHub Pages.

What this is: the documents this repository writes about the product — the
operator handbook and feature catalogue (also rendered as one printable guide),
the delivery plan, the research notes, the migration notes, and the mirrored
help library — as a browsable site. It is a *preview of the repository's own
documentation*, not a web version of the product: no part of `apps/web` is built
here, and nothing is served from an API.

What it is not: the help library is a mirror of the vendor's public help centre,
kept for reference. It is not product content, and the clean-room rule still
applies to everything under `apps/`, `services/` and `packages/` — this site
renders text that is already in the public repository and nothing else.

Reads:
  docs/build/guide.html        the print-ready guide (built by build_html.py)
  docs/*.md                    the five top-level documents
  docs/{plan,research,migration}/**/*.md
  docs/help-library/**         the mirror: markdown rendered, images copied
  docs/assets/**               the screenshots the guide and catalogue use

Writes: docs/build/site/  (ignored by git — the Pages workflow uploads it as an
artifact rather than committing half a gigabyte of HTML)

Run:
  python3 tools/docs/build_html.py && python3 tools/docs/build_site.py
"""
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
from html import escape
from urllib.parse import unquote

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
BUILD = os.path.join(DOCS, 'build')
SITE = os.path.join(BUILD, 'site')
HELP = os.path.join(DOCS, 'help-library')
GITHUB = 'https://github.com/deshiklab/DiziHospital'

#: top-level documents, in the order a reader should meet them
TOP_DOCUMENTS = [
    ('WIKI.md', 'Operator handbook', 'How the hospital runs on the system: the day at a desk, the registers, the hand-offs, and what to do when something is wrong.'),
    ('FEATURE-CATALOG.md', 'Feature catalogue', 'Every screen of the vendor product, captured and described: fields, grids, dialogs, roles and the workflows behind them.'),
    ('HELP-LIBRARY.md', 'Help library notes', 'What the mirrored help library holds, how it is organised, and how to search it.'),
    ('COVERAGE.md', 'Coverage', 'Which screens and features the exploration reached, and what it could not see.'),
    ('IMPROVEMENT-BACKLOG.md', 'Improvement backlog', 'What the legacy product does badly, ranked, with the evidence beside each item.'),
]

SECTIONS = [
    ('plan', 'Delivery plan', 'The strategy, the architecture, the screen map, the execution backlog and the decisions behind them.'),
    ('research', 'Research', 'Shadowing, baselines, infrastructure, branches and the usability protocol — the ground truth the plan is built on.'),
    ('migration', 'Migration', 'How a branch moves off the legacy system without losing a record or a promise.'),
]

CSS = """
:root { --brand:#1bbed3; --brand-dark:#0f6f88; --ink:#1f2d3d; --muted:#6b7c93; --line:#e3e8ef; --bg:#f7fafc; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
a { color:var(--brand-dark); }
a:hover { color:var(--brand); }
header.site { background:#fff; border-bottom:1px solid var(--line); }
header.site .inner { max-width:62rem; margin:0 auto; padding:14px 20px; display:flex; flex-wrap:wrap; gap:10px 18px; align-items:baseline; }
header.site .brand { font-weight:700; letter-spacing:-.01em; }
header.site nav { display:flex; gap:14px; flex-wrap:wrap; font-size:14px; }
header.site nav a { text-decoration:none; }
main { max-width:62rem; margin:0 auto; padding:28px 20px 64px; }
h1,h2,h3 { line-height:1.25; color:#12212f; }
h1 { font-size:1.9rem; margin:0 0 .3em; }
h2 { font-size:1.35rem; margin:1.8em 0 .6em; padding-bottom:.3em; border-bottom:1px solid var(--line); }
h3 { font-size:1.1rem; margin:1.4em 0 .4em; }
p.lede { color:var(--muted); font-size:1.05rem; margin-top:0; }
.meta { color:var(--muted); font-size:.85rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(16rem,1fr)); gap:14px; margin:18px 0; }
.card { display:block; background:#fff; border:1px solid var(--line); border-radius:10px; padding:16px 18px; text-decoration:none; color:inherit; }
.card:hover { border-color:var(--brand); }
.card strong { display:block; color:var(--brand-dark); margin-bottom:4px; }
.card span { color:var(--muted); font-size:.9rem; }
.card .count { display:block; margin-top:8px; font-size:.78rem; color:var(--muted); font-variant-numeric:tabular-nums; }
ul.pages { list-style:none; padding:0; margin:0; }
ul.pages li { background:#fff; border:1px solid var(--line); border-radius:8px; margin:8px 0; padding:10px 14px; }
ul.pages li a { font-weight:600; text-decoration:none; }
ul.pages li p { margin:2px 0 0; color:var(--muted); font-size:.88rem; }
.note { background:#fff; border-left:4px solid var(--brand); border-radius:0 8px 8px 0; padding:12px 16px; color:#2b3a4a; font-size:.94rem; }
.note strong { color:var(--brand-dark); }
article :is(h1,h2,h3,h4) { scroll-margin-top:16px; }
article table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; margin:1em 0; font-size:.92rem; }
article th, article td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
article th { background:#eef6f9; }
article code { background:#eef2f6; border-radius:4px; padding:.1em .35em; font-size:.9em; }
article pre { background:#0f1c26; color:#dbe9f2; border-radius:8px; padding:14px 16px; overflow-x:auto; }
article pre code { background:none; padding:0; color:inherit; }
article blockquote { margin:1em 0; padding:.2em 1em; border-left:4px solid var(--line); color:#415468; }
article img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px; }
article hr { border:none; border-top:1px solid var(--line); margin:2em 0; }
nav.toc { background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin:18px 0 26px; font-size:.92rem; }
nav.toc p { margin:0 0 6px; font-weight:700; color:var(--brand-dark); }
nav.toc ul { margin:0; padding-left:18px; }
nav.toc ul ul { padding-left:16px; }
nav.toc a { text-decoration:none; }
.crumbs { font-size:.85rem; color:var(--muted); margin-bottom:14px; }
.crumbs a { text-decoration:none; }
footer.site { border-top:1px solid var(--line); background:#fff; }
footer.site .inner { max-width:62rem; margin:0 auto; padding:18px 20px 28px; color:var(--muted); font-size:.85rem; }
footer.site a { color:var(--muted); }
@media (max-width:640px) { main { padding:20px 14px 48px; } h1 { font-size:1.55rem; } }
"""

MD_EXTENSIONS = ['tables', 'fenced_code', 'toc', 'attr_list', 'sane_lists']
SCHEME = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|#|//)', re.I)
ATTR = re.compile(r'(href|src)="([^"]+)"')


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')


def git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ''


BRANCH = os.environ.get('GITHUB_REF_NAME') or git('rev-parse', '--abbrev-ref', 'HEAD') or 'unknown'
SHA = os.environ.get('GITHUB_SHA') or git('rev-parse', 'HEAD') or ''
SHORT = SHA[:7] if SHA else 'unknown'
BUILT = datetime.datetime.now(datetime.timezone.utc).strftime('%d %B %Y, %H:%M UTC')
REVISION_LINE = f'Built from <code>{escape(BRANCH)}</code> at <code>{escape(SHORT)}</code> on {BUILT}.'


# ------------------------------------------------------------------------------------------------- the page map

def slug(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name[:-3].lower()).strip('-')


def plan_pages() -> dict:
    """source path → site path, for every markdown file this site renders."""
    pages = {}
    for name, _, _ in TOP_DOCUMENTS:
        pages[os.path.join(DOCS, name)] = f'{slug(name)}.html'
    for section, _, _ in SECTIONS:
        base = os.path.join(DOCS, section)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for filename in sorted(filenames):
                if not filename.endswith('.md'):
                    continue
                src = os.path.join(dirpath, filename)
                out = os.path.join(section, os.path.relpath(src, base))[:-3] + '.html'
                if os.path.basename(out) == '_index.html':
                    out = os.path.join(os.path.dirname(out), 'index.html')
                pages[src] = out.replace(os.sep, '/')
    for dirpath, dirnames, filenames in os.walk(HELP):
        dirnames.sort()
        dirnames[:] = [d for d in dirnames if d != '_debug']
        for filename in sorted(filenames):
            if not filename.endswith('.md'):
                continue
            src = os.path.join(dirpath, filename)
            out = os.path.join('help', os.path.relpath(src, HELP))[:-3] + '.html'
            if os.path.basename(out) == '_index.html':
                out = os.path.join(os.path.dirname(out), 'index.html')
            pages[src] = out.replace(os.sep, '/')
    return pages


def title_of(src: str) -> str:
    try:
        with open(src, encoding='utf-8', errors='replace') as handle:
            for line in handle:
                if line.startswith('# '):
                    return line[2:].strip()
    except OSError:
        pass
    return os.path.basename(src)[:-3].replace('-', ' ').replace('_', ' ').strip().capitalize()


def summary_of(src: str) -> str:
    """The first paragraph that is not a heading, a list, an image or a table."""
    try:
        with open(src, encoding='utf-8', errors='replace') as handle:
            lines = handle.readlines()
    except OSError:
        return ''
    seen_heading = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#'):
            seen_heading = True
            continue
        if not seen_heading or not stripped:
            continue
        if stripped.startswith(('|', '-', '*', '>', '!', '<', '```')):
            continue
        text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', stripped)
        text = re.sub(r'[*_`]', '', text)
        if len(text) > 240:
            text = text[:237].rstrip() + '…'
        return escape(text, quote=False)
    return ''


# -------------------------------------------------------------------------------------------------- link rewriting

def rewrite(url: str, src: str, out_rel: str, pages: dict) -> str:
    """Point a link at the rendered page, the mirrored asset, or the repository — never at a path only the
    checkout has. A link nobody can resolve is left alone rather than silently turned into a 404 with a new name."""
    if SCHEME.match(url):
        return url

    target, _, fragment = url.partition('#')
    if target == '':
        return url
    suffix = f'#{fragment}' if fragment else ''
    path = unquote(target).lstrip('/')
    base = ROOT if target.startswith('/') else os.path.dirname(src)
    resolved = os.path.normpath(os.path.join(base, path))

    def relative_to_page(destination: str) -> str:
        here = os.path.dirname(out_rel)
        return os.path.relpath(destination, here or '.').replace(os.sep, '/')

    if resolved in pages:
        return relative_to_page(pages[resolved]) + suffix

    if os.path.isdir(resolved) and os.path.join(resolved, '_index.md') in pages:
        return relative_to_page(pages[os.path.join(resolved, '_index.md')]) + suffix

    if os.path.exists(resolved) and os.path.isfile(resolved):
        if resolved.startswith(HELP + os.sep):
            return relative_to_page(os.path.join('help', os.path.relpath(resolved, HELP)).replace(os.sep, '/')) + suffix
        if resolved.startswith(DOCS + os.sep):
            return relative_to_page(os.path.relpath(resolved, DOCS).replace(os.sep, '/')) + suffix
        # A file outside docs/ (a README, a contract, a migration): the repository is the honest place for it.
        if resolved.startswith(ROOT + os.sep) and SHA:
            return f'{GITHUB}/blob/{SHA}/{rel(resolved)}{suffix}'

    return url


def rewrite_html(body: str, src: str, out_rel: str, pages: dict) -> str:
    return ATTR.sub(lambda m: f'{m.group(1)}="{escape(rewrite(m.group(2), src, out_rel, pages), quote=True)}"', body)


# -------------------------------------------------------------------------------------------------- page furniture

def root_prefix(out_rel: str) -> str:
    depth = out_rel.count('/')
    return '../' * depth


def shell(title: str, out_rel: str, body: str, description: str = '') -> str:
    prefix = root_prefix(out_rel)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} · DiziHospital documentation</title>
<meta name="description" content="{escape(description or title, quote=True)}">
<link rel="stylesheet" href="{prefix}style.css">
</head>
<body>
<header class="site"><div class="inner">
<span class="brand">DiziHospital · documentation</span>
<nav>
<a href="{prefix}index.html">Home</a>
<a href="{prefix}guide.html">Guide</a>
<a href="{prefix}help/index.html">Help library</a>
<a href="{GITHUB}">Repository</a>
</nav>
</div></header>
<main>
{body}
</main>
<footer class="site"><div class="inner">
<p>{REVISION_LINE} This site is generated from the repository’s own documentation set by
<code>tools/docs/build_site.py</code>. The help library is a mirror of the vendor’s public help centre, kept for
reference: it is not product content, and nothing here is a running system.</p>
</div></footer>
</body>
</html>
"""


def crumbs(out_rel: str, section: str | None) -> str:
    prefix = root_prefix(out_rel)
    parts = [f'<a href="{prefix}index.html">Documentation</a>']
    if section:
        parts.append(f'<a href="{prefix}index.html#{section}">{escape(section.capitalize())}</a>')
    return '<p class="crumbs">' + ' / '.join(parts) + '</p>'


def render_markdown(src: str, out_rel: str, pages: dict, section: str | None) -> str:
    with open(src, encoding='utf-8', errors='replace') as handle:
        text = handle.read()
    md = markdown.Markdown(extensions=MD_EXTENSIONS, extension_configs={'toc': {'permalink': False, 'toc_depth': '2-3'}})
    body = md.convert(text)
    body = rewrite_html(body, src, out_rel, pages)
    toc = ''
    if len(re.findall(r'<h[23][ >]', body)) > 2:
        toc = f'<nav class="toc"><p>On this page</p>{md.toc}</nav>'
    heading = escape(title_of(src))
    source = f'{GITHUB}/blob/{SHA}/{rel(src)}' if SHA else GITHUB
    return shell(
        title_of(src),
        out_rel,
        f'{crumbs(out_rel, section)}<article>{toc}{body}</article>'
        f'<p class="meta">Source: <a href="{source}">{escape(rel(src))}</a></p>',
        summary_of(src) or title_of(src),
    )


# --------------------------------------------------------------------------------------------------- the landing page

def landing(pages: dict, counts: dict) -> str:
    cards = [
        ('guide.html', 'The guide, in one page', 'The handbook and the catalogue rendered as one printable document — the same file the PDF is made from.', f'{counts.get("assets", 0)} screenshots beside it'),
        ('documents.html', 'The five documents', 'The handbook, the catalogue, the coverage note, the help-library notes and the improvement backlog, each on its own page.', 'Hand-written and generated together'),
        ('index.html#plan', 'Delivery plan', 'Strategy, architecture, screen map, execution backlog and the decisions they rest on.', f'{counts.get("plan", 0)} documents'),
        ('index.html#research', 'Research', 'Shadow shifts, baselines, infrastructure, branches and the usability protocol.', f'{counts.get("research", 0)} documents'),
        ('index.html#migration', 'Migration', 'How a branch moves without losing a record or a promise.', f'{counts.get("migration", 0)} documents'),
        ('help/index.html', 'Help library', 'The vendor’s public help centre, mirrored and browsable. Reference only — not product content.', f'{counts.get("help", 0)} articles'),
    ]
    grid = '\n'.join(
        f'<a class="card" href="{escape(href)}"><strong>{escape(title)}</strong><span>{escape(blurb)}</span><span class="count">{escape(count)}</span></a>'
        for href, title, blurb, count in cards
    )

    def listing(entries, anchor):
        rows = []
        for src, out in entries:
            rows.append(
                f'<li><a href="{escape(out)}">{escape(title_of(src))}</a>'
                + (f'<p>{summary_of(src)}</p>' if summary_of(src) else '')
                + f'<p class="meta">{escape(out)}</p></li>'
            )
        return f'<h2 id="{anchor}">{escape(anchor.capitalize())}</h2><ul class="pages">' + '\n'.join(rows) + '</ul>'

    documents = [(os.path.join(DOCS, name), pages[os.path.join(DOCS, name)]) for name, _, _ in TOP_DOCUMENTS if os.path.join(DOCS, name) in pages]
    sections_html = ''
    for section, title, blurb in SECTIONS:
        entries = sorted(((src, out) for src, out in pages.items() if out.startswith(section + '/')), key=lambda pair: pair[1])
        if not entries:
            continue
        sections_html += f'<h2 id="{section}">{escape(title)}</h2><p class="lede">{escape(blurb)}</p>'
        sections_html += '<ul class="pages">' + '\n'.join(
            f'<li><a href="{escape(out)}">{escape(title_of(src))}</a>'
            + (f'<p>{summary_of(src)}</p>' if summary_of(src) else '')
            + f'<p class="meta">{escape(out)}</p></li>'
            for src, out in entries
        ) + '</ul>'

    body = f"""
<h1>DiziHospital documentation</h1>
<p class="lede">A browsable preview of this repository’s documentation: the operator handbook and feature catalogue,
the delivery plan, the research notes, and the mirrored help library. Generated from the commit below — no product
code runs here, and nothing on this site is a live hospital.</p>
<p class="meta">{REVISION_LINE}</p>
<div class="grid">{grid}</div>
<h2 id="documents">The documents</h2>
<p class="lede">Each of these is a page of its own as well as part of the one-page guide.</p>
<ul class="pages">{''.join(f'<li><a href="{escape(out)}">{escape(title_of(src))}</a><p>{escape(blurb)}</p><p class="meta">{escape(out)}</p></li>' for (src, out), (_, _, blurb) in zip(documents, [d for d in TOP_DOCUMENTS if os.path.join(DOCS, d[0]) in pages]))}</ul>
{sections_html}
<h2 id="about">What this site is</h2>
<div class="note">
<p><strong>A preview, not a deployment.</strong> The pages here are rendered from markdown in the repository on every
push that touches <code>docs/</code>. There is no application server, no database and no API: the product’s screens are
not part of this site.</p>
<p><strong>The help library is a mirror.</strong> It reproduces the vendor’s public help centre so the team can cite it
while designing the replacement. The clean-room rule applies to code — <code>apps/</code>, <code>services/</code> and
<code>packages/</code> contain no vendor content — and this mirror is documentation, kept for reference and marked as
such wherever it is linked.</p>
<p><strong>The source of every page is one link away.</strong> Each rendered page ends with the file it came from on
GitHub, at the commit this site was built from.</p>
</div>
"""
    return shell('Documentation', 'index.html', body, 'DiziHospital documentation: the handbook, catalogue, plan, research and help library.')


def documents_index(pages: dict) -> str:
    rows = []
    for name, title, blurb in TOP_DOCUMENTS:
        src = os.path.join(DOCS, name)
        if src not in pages:
            continue
        rows.append(f'<li><a href="{escape(pages[src])}">{escape(title)}</a><p>{escape(blurb)}</p><p class="meta">{escape(pages[src])}</p></li>')
    body = f'<h1>The five documents</h1><p class="lede">The documentation this repository writes about the product, each on its own page. The same text is assembled into the <a href="guide.html">one-page guide</a>.</p><ul class="pages">{"".join(rows)}</ul>'
    return shell('Documents', 'documents.html', body)


# --------------------------------------------------------------------------------------------------- the help index

def mirrored_articles(category: dict) -> int:
    """How many article files this category actually has on disk.

    The vendor's index cross-lists: one article can be entered under every category, so summing its
    per-category entries says 686 where 306 files exist. A count printed on a page has to be a count of
    pages a reader can open, so it comes from the directory — falling back to the index only when the
    directory is not there at all (nothing to count, and nothing to open).
    """
    directory = os.path.join(HELP, category.get('slug') or '')
    if not os.path.isdir(directory):
        return len(category.get('articles') or [])
    return len([name for name in os.listdir(directory) if name.endswith('.md') and name != '_index.md'])


def help_index(pages: dict) -> tuple[str, int]:
    index_path = os.path.join(HELP, 'index.json')
    categories = []
    if os.path.exists(index_path):
        try:
            with open(index_path, encoding='utf-8') as handle:
                categories = json.load(handle).get('categories', [])
        except (OSError, ValueError):
            categories = []

    if not categories:
        for entry in sorted(os.listdir(HELP)):
            directory = os.path.join(HELP, entry)
            if os.path.isdir(directory) and os.path.exists(os.path.join(directory, '_index.md')):
                categories.append({'name': entry.replace('-', ' ').capitalize(), 'slug': entry, 'description': '', 'articles': []})

    cards = []
    articles = 0
    for category in categories:
        slug_name = category.get('slug') or ''
        directory = os.path.join(HELP, slug_name)
        count = mirrored_articles(category)
        articles += count
        # This page lives at `help/index.html`, so a category is its own directory beside it — not `help/` again.
        target = f"{slug_name}/index.html"
        if os.path.join(directory, '_index.md') not in pages:
            target = f'help/{slug_name}.html' if os.path.join(HELP, f'{slug_name}.md') in pages else ''
        blurb = re.sub(r'\s+', ' ', category.get('description') or '').strip()
        # Nine categories open their vendor page with a "Latest Articles" sidebar list, which the mirror captured
        # as the description: "Latest Articles Version 1.0 Version 1.0 …". That is navigation, not a description;
        # a card that repeats it is noise, so those categories get their name and their count and nothing else.
        if 'Latest Articles' in blurb:
            blurb = blurb.split('Latest Articles')[0].strip()
        if len(blurb) > 150:
            blurb = blurb[:147].rstrip() + '…'
        link_open = f'<a class="card" href="{escape(target)}">' if target else '<div class="card">'
        link_close = '</a>' if target else '</div>'
        cards.append(
            f'{link_open}<strong>{escape(category.get("name") or slug_name)}</strong>'
            f'<span>{escape(blurb)}</span><span class="count">{count} article(s)</span>{link_close}'
        )

    body = f"""
{crumbs('help/index.html', None)}
<h1>Help library</h1>
<p class="lede">The vendor’s public help centre, mirrored article by article so the team can cite the product’s own
words while designing its replacement. <strong>Reference only:</strong> this is not product content and none of it is
served by our application.</p>
<p class="meta">{len(categories)} categories · {articles} articles · mirrored into <code>docs/help-library/</code>.</p>
<div class="grid">{''.join(cards)}</div>
"""
    return shell('Help library', 'help/index.html', body), articles


# ----------------------------------------------------------------------------------------------------- the assembly

def copy_tree(source: str, destination: str, skip_markdown: bool = False) -> int:
    """Mirror a directory, optionally leaving the markdown behind (it is rendered separately)."""
    copied = 0
    for dirpath, dirnames, filenames in os.walk(source):
        dirnames.sort()
        dirnames[:] = [name for name in dirnames if name != '_debug']
        relative = os.path.relpath(dirpath, source)
        target_dir = destination if relative == '.' else os.path.join(destination, relative)
        os.makedirs(target_dir, exist_ok=True)
        for filename in sorted(filenames):
            if skip_markdown and filename.endswith('.md'):
                continue
            shutil.copy2(os.path.join(dirpath, filename), os.path.join(target_dir, filename))
            copied += 1
    return copied


def check_site() -> tuple[list, int]:
    """Follow every href and src that is not an external URL; return the ones the site cannot answer."""
    broken, checked = [], 0
    for dirpath, _, files in os.walk(SITE):
        for name in sorted(files):
            if not name.endswith('.html'):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = handle.read()
            for target in re.findall(r'(?:href|src)="([^"]+)"', text):
                if SCHEME.match(target) or target.startswith(('data:', '//')):
                    continue
                local = unquote(target.split('#')[0])
                if local == '':
                    continue
                checked += 1
                if not os.path.exists(os.path.normpath(os.path.join(dirpath, local))):
                    broken.append((os.path.relpath(path, SITE), target))
    return broken, checked


def main() -> None:
    if os.path.isdir(SITE):
        shutil.rmtree(SITE)
    os.makedirs(SITE, exist_ok=True)

    pages = plan_pages()
    rendered = 0
    for src, out_rel in pages.items():
        destination = os.path.join(SITE, out_rel)
        os.makedirs(os.path.dirname(destination) or SITE, exist_ok=True)
        section = out_rel.split('/', 1)[0] if '/' in out_rel and out_rel.split('/', 1)[0] in {name for name, _, _ in SECTIONS} else None
        if out_rel.startswith('help/'):
            section = None
        with open(destination, 'w', encoding='utf-8') as handle:
            handle.write(render_markdown(src, out_rel, pages, section))
        rendered += 1

    # The screenshots the guide and the top-level documents use.
    assets = copy_tree(os.path.join(DOCS, 'assets'), os.path.join(SITE, 'assets')) if os.path.isdir(os.path.join(DOCS, 'assets')) else 0

    # Anything non-markdown that lives beside the documents (one design-tokens JSON today) so relative links work.
    for section, _, _ in SECTIONS:
        base = os.path.join(DOCS, section)
        if os.path.isdir(base):
            copy_tree(base, os.path.join(SITE, section), skip_markdown=True)

    # The help library's images, JSON and logs; the markdown beside them is already a page.
    help_media = copy_tree(HELP, os.path.join(SITE, 'help'), skip_markdown=True)

    # The one-page guide, with its asset paths moved from docs/build/ to the site root.
    guide_source = os.path.join(BUILD, 'guide.html')
    guide_written = False
    if os.path.exists(guide_source):
        with open(guide_source, encoding='utf-8') as handle:
            guide = handle.read()
        guide = guide.replace('src="../assets/', 'src="assets/').replace('href="../assets/', 'href="assets/')
        # `build_html.py` inlines the help-library articles and rewrites their images to be relative to `docs/build/`
        # (`../help-library/assets/...`). The site mirrors that tree under `help/`, so the same refs are one level out.
        guide = guide.replace('src="../help-library/', 'src="help/').replace('href="../help-library/', 'href="help/')
        # The guide is three documents inlined into one page, so its links were written relative to `docs/`
        # (`plan/README.md`, `FEATURE-CATALOG.md`). Resolve them from there, the way the source documents meant them.
        guide = rewrite_html(guide, os.path.join(DOCS, 'WIKI.md'), 'guide.html', pages)
        with open(os.path.join(SITE, 'guide.html'), 'w', encoding='utf-8') as handle:
            handle.write(guide)
        guide_written = True

    with open(os.path.join(HELP, 'index.json'), encoding='utf-8') as handle:
        help_categories = json.load(handle).get('categories', [])
    help_article_total = sum(mirrored_articles(category) for category in help_categories)

    counts = {
        'plan': sum(1 for out in pages.values() if out.startswith('plan/')),
        'research': sum(1 for out in pages.values() if out.startswith('research/')),
        'migration': sum(1 for out in pages.values() if out.startswith('migration/')),
        'help': help_article_total,
        'assets': len(os.listdir(os.path.join(DOCS, 'assets'))) if os.path.isdir(os.path.join(DOCS, 'assets')) else 0,
    }

    with open(os.path.join(SITE, 'style.css'), 'w', encoding='utf-8') as handle:
        handle.write(CSS)

    with open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(landing(pages, counts))

    with open(os.path.join(SITE, 'documents.html'), 'w', encoding='utf-8') as handle:
        handle.write(documents_index(pages))

    help_page, help_articles = help_index(pages)
    os.makedirs(os.path.join(SITE, 'help'), exist_ok=True)
    with open(os.path.join(SITE, 'help', 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(help_page)

    # GitHub Pages serves this directory as-is; without .nojekyll it would hide every path that starts with an
    # underscore and run the markdown through Jekyll a second time.
    open(os.path.join(SITE, '.nojekyll'), 'w', encoding='utf-8').close()

    total = sum(len(files) for _, _, files in os.walk(SITE))
    size = sum(os.path.getsize(os.path.join(dirpath, name)) for dirpath, _, files in os.walk(SITE) for name in files)
    print(f'site: {rendered} page(s) rendered, {help_articles} help article(s) indexed, {assets} top-level asset(s), {help_media} help media file(s)')
    print(f'site: {total} file(s), {size / (1024 * 1024):.1f} MB → {rel(SITE)}' + ('' if guide_written else '  (no guide.html — run build_html.py first)'))

    # Every internal reference is followed through the generated tree. A page that points at a path only the checkout
    # had is the failure this build can see and a reader would only find — so it is a failure of the build.
    broken, checked = check_site()
    if broken:
        print(f'site: {len(broken)} of {checked} internal reference(s) do not resolve:')
        for page, target in broken[:30]:
            print(f'   {page} -> {target}')
        sys.exit(1)
    print(f'site: {checked} internal reference(s) checked, all resolve')


if __name__ == '__main__':
    main()
