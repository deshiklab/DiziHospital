#!/usr/bin/env python3
"""
Mirror the Smart Hospital vendor help library (smart-hospital.in/articles) into
the repository so the documentation is self-contained and searchable offline.

Runs where smart-hospital.in is reachable (GitHub Actions runner).

  /articles                  -> category list
  /category/<slug>           -> articles of that category
  /article/<slug>            -> article body (+ screenshots)

Output
  docs/help-library/<category>/<article>.md
  docs/help-library/assets/<article>/<n>.jpg
  docs/help-library/<category>/_index.md
  docs/help-library/index.json
  docs/help-library/parse-report.json
"""
import json
import os
import re
import sys
import time
import io
import urllib.parse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import markdownify
from PIL import Image

BASE = 'https://smart-hospital.in'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'docs', 'help-library')
ASSETS = os.path.join(OUT, 'assets')
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/126.0 Safari/537.36')
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': UA, 'Accept-Language': 'en'})
MAX_IMG_W = 820
IMG_QUALITY = 66
MAX_IMG_BYTES = 250 * 1024  # skip images that stay oversized after conversion
SKIP_IMAGE_HOSTS = ('qd-new.png', 'logo')

report = {'categories': 0, 'articles': 0, 'failed': [], 'images': 0, 'warnings': []}


def slugify(s):
    s = re.sub(r'[^a-zA-Z0-9]+', '-', (s or '').lower())
    return re.sub(r'-+', '-', s).strip('-')[:80] or 'item'


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            r = SESSION.get(url, timeout=45)
            if r.status_code == 200:
                return r
            last = f'HTTP {r.status_code}'
        except Exception as e:  # noqa: BLE001
            last = str(e)[:120]
        time.sleep(1.5 * (i + 1))
    report['warnings'].append(f'{url}: {last}')
    return None


def clean_text(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def save_image(src, folder, idx):
    try:
        url = urllib.parse.urljoin(BASE, src)
        if any(s in url.lower() for s in SKIP_IMAGE_HOSTS):
            return None
        r = get(url, tries=2)
        if not r or not r.content:
            return None
        img = Image.open(io.BytesIO(r.content))
        if img.width > MAX_IMG_W:
            h = int(img.height * MAX_IMG_W / img.width)
            img = img.resize((MAX_IMG_W, h), Image.LANCZOS)
        if img.mode in ('RGBA', 'P', 'LA'):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert('RGB')
        os.makedirs(folder, exist_ok=True)
        name = f'{idx}.jpg'
        out_path = os.path.join(folder, name)
        img.save(out_path, 'JPEG', quality=IMG_QUALITY, optimize=True)
        if os.path.getsize(out_path) > MAX_IMG_BYTES:
            # try harder before giving up on a heavy screenshot
            img.save(out_path, 'JPEG', quality=52, optimize=True)
            if os.path.getsize(out_path) > MAX_IMG_BYTES:
                os.remove(out_path)
                return None
        report['images'] += 1
        return name
    except Exception as e:  # noqa: BLE001
        report['warnings'].append(f'image {src}: {str(e)[:90]}')
        return None


CHROME_MARKERS = ('select category', 'latest articles', 'related articles', 'buy now',
                  'categories', 'smart school', 'all rights reserved')


def drop_chrome(node):
    """Remove site chrome (menus, category picker, related/latest lists) from a container."""
    for el in list(node.find_all(['div', 'ul', 'section', 'nav', 'footer', 'aside'])):
        try:
            text = clean_text(el.get_text(' ')).lower()
        except Exception:  # noqa: BLE001
            continue
        if not text:
            el.decompose()
            continue
        if any(m in text for m in CHROME_MARKERS) and len(text) < 4000:
            # never drop the article body itself
            if el.find(['p', 'h4', 'h3']) and len(text) > 1200 and 'related articles' not in text and 'select category' not in text:
                continue
            el.decompose()


def parse_article(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    title_tag = soup.find('title')
    page_title = clean_text(title_tag.get_text()) if title_tag else ''
    page_title = re.sub(r'\s*-\s*Smart Hospital.*$', '', page_title)

    # the article heading is an h1/h2/h3/h4 whose text matches the page title
    heading = None
    for h in soup.find_all(['h1', 'h2', 'h3', 'h4']):
        if clean_text(h.get_text()).lower() == page_title.lower():
            heading = h
            break
    if heading is None:
        for h in soup.find_all(['h1', 'h2', 'h3', 'h4']):
            t = clean_text(h.get_text())
            if t and t.lower() not in ('articles', 'categories') and len(t) > 5:
                heading = h
                page_title = page_title or t
                break

    date = ''
    cat_name, cat_slug = '', ''
    container = None
    if heading is not None:
        parent = heading.parent
        # climb while the parent still looks like the article (contains the date line)
        for _ in range(4):
            if parent is None or parent.name in ('body', 'html'):
                break
            txt = clean_text(parent.get_text(' '))
            if len(txt) > 200:
                container = parent
                break
            parent = parent.parent
        scope = heading.parent
        m = re.search(r'([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2},?\s+\d{4})', clean_text(scope.get_text(' ')))
        if not m and container is not None:
            m = re.search(r'([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2},?\s+\d{4})', clean_text(container.get_text(' '))[:600])
        if m:
            date = m.group(1)
        cat_link = None
        for a in (container or scope).find_all('a', href=True):
            if '/category/' in a['href']:
                cat_link = a
                break
        if cat_link is None:
            for a in soup.find_all('a', href=True):
                if '/category/' in a['href'] and clean_text(a.get_text()).lower() == 'articles':
                    continue
                if '/category/' in a['href']:
                    cat_link = a
                    break
        if cat_link is not None:
            cat_name = clean_text(cat_link.get_text())
            cat_slug = slugify(cat_link['href'].rstrip('/').split('/')[-1])

    if container is None:
        # fallback: the article body is the block that carries the publication date
        m = re.search(r'([A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2},?\s+\d{4})', soup.get_text(' '))
        if m:
            needle = m.group(1)
            for el in soup.find_all(['div', 'section', 'article', 'main']):
                t = clean_text(el.get_text(' '))
                if needle in t and 200 < len(t) < 120000:
                    if container is None or len(t) < len(clean_text(container.get_text(' '))):
                        container = el
                        date = needle
        if container is None:
            return None
        if heading is None:
            hs = container.find_all(['h1', 'h2', 'h3', 'h4'])
            heading = hs[0] if hs else None

    article_slug = url.rstrip('/').split('/')[-1]
    folder = os.path.join(ASSETS, article_slug)

    # collect body: from the heading to the end of the container, minus chrome
    body = soup.new_tag('div')
    for el in list(container.children):
        if el is heading:
            continue
        if isinstance(el, NavigableString):
            continue
        body.append(el.extract())
    drop_chrome(body)

    # images -> local assets
    n = 0
    for img in body.find_all('img'):
        src = img.get('src') or img.get('data-src') or ''
        n += 1
        local = save_image(src, folder, n) if src else None
        if local:
            img['src'] = f"../assets/{article_slug}/{local}"
            for attr in ('srcset', 'data-src', 'width', 'height', 'style', 'class', 'loading'):
                if attr in img.attrs:
                    del img[attr]
        else:
            img.decompose()

    for a in body.find_all(['a', 'span', 'div', 'i']):
        if a.name == 'a' and a.get('href'):
            a['href'] = urllib.parse.urljoin(BASE, a['href'])

    md = markdownify(str(body), heading_style='ATX', strip=['script', 'style', 'iframe', 'svg']).strip()
    md = re.sub(r'\n{3,}', '\n\n', md)
    # drop leftover navigation-ish lines
    lines = [ln for ln in md.split('\n') if not re.match(r'^\s*(Select Category|Latest Articles|Related Articles|Categories)\s*$', ln)]
    md = '\n'.join(lines).strip()

    return {
        'title': page_title,
        'date': date,
        'category': {'name': cat_name, 'slug': cat_slug},
        'url': url,
        'slug': article_slug,
        'body': md,
        'chars': len(md),
        'images': n,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    r = get(BASE + '/articles')
    if not r:
        print('FATAL: cannot reach /articles', file=sys.stderr)
        return 1
    soup = BeautifulSoup(r.text, 'html.parser')

    cats = []
    for a in soup.find_all('a', href=True):
        if '/category/' in a['href']:
            name = clean_text(a.get_text())
            href = a['href'].rstrip('/')
            slug = href.split('/')[-1]
            if not name or slug in ('changelog',):
                continue
            if slug.startswith('smart-hospital-'):
                continue  # changelog sub-feeds
            if not any(c['slug'] == slug for c in cats):
                cats.append({'name': name, 'slug': slug, 'url': urllib.parse.urljoin(BASE, href)})
    report['categories'] = len(cats)
    print(f'categories: {len(cats)}')

    index = []
    debug_written = False
    canonical = {}  # article slug -> category dir that holds the mirrored file
    for ci, cat in enumerate(cats, start=1):
        cr = get(cat['url'])
        if not cr:
            report['failed'].append(cat['url'])
            continue
        csoup = BeautifulSoup(cr.text, 'html.parser')
        art_urls = []
        for a in csoup.find_all('a', href=True):
            if '/article/' in a['href']:
                u = urllib.parse.urljoin(BASE, a['href'])
                if u not in art_urls:
                    art_urls.append(u)
        # category description = first paragraph-ish text before the article list
        desc = ''
        for p in csoup.find_all(['p', 'div']):
            t = clean_text(p.get_text(' '))
            if 60 < len(t) < 400 and 'select category' not in t.lower() and 'buy now' not in t.lower():
                desc = t
                break
        cat_entry = {'name': cat['name'], 'slug': slugify(cat['slug']), 'url': cat['url'],
                     'description': desc, 'articles': []}
        catdir = os.path.join(OUT, cat_entry['slug'])
        os.makedirs(catdir, exist_ok=True)
        print(f'[{ci}/{len(cats)}] {cat["name"]}: {len(art_urls)} articles')
        for u in art_urls:
            slug = u.rstrip('/').split('/')[-1]
            if slug in canonical:
                # the same article is listed by more than one category - link to the mirrored copy
                c = canonical[slug]
                cat_entry['articles'].append({'title': c['title'], 'slug': slug, 'url': u,
                                              'date': c['date'], 'chars': c['chars'],
                                              'file': f"{c['dir']}/{slug}.md", 'mirrored_in': c['dir']})
                continue
            ar = get(u)
            if not ar:
                report['failed'].append(u)
                continue
            if not debug_written:
                os.makedirs(os.path.join(OUT, '_debug'), exist_ok=True)
                with open(os.path.join(OUT, '_debug', 'sample.html'), 'w') as f:
                    f.write(ar.text[:400000])
                debug_written = True
            parsed = parse_article(ar.text, u)
            if not parsed:
                report['failed'].append(u + ' (parse)')
                continue
            parsed['category'] = {'name': (parsed.get('category') or {}).get('name') or cat['name'],
                                  'slug': (parsed.get('category') or {}).get('slug') or cat_entry['slug']}
            with open(os.path.join(catdir, slug + '.md'), 'w') as f:
                f.write(f"# {parsed['title']}\n\n")
                if parsed.get('date'):
                    f.write(f"_{parsed['date']}_ · ")
                f.write(f"[{cat['name']}]({cat['url']}) · vendor article: {parsed['url']}\n\n")
                f.write(parsed['body'] + '\n')
            canonical[slug] = {'dir': cat_entry['slug'], 'title': parsed['title'],
                               'date': parsed.get('date', ''), 'chars': parsed.get('chars', 0)}
            report['articles'] += 1
            cat_entry['articles'].append({'title': parsed['title'], 'slug': slug, 'url': u,
                                          'date': parsed.get('date', ''), 'chars': parsed.get('chars', 0),
                                          'file': f"{cat_entry['slug']}/{slug}.md"})
            time.sleep(0.25)
        index.append(cat_entry)

        # per-category index page
        with open(os.path.join(catdir, '_index.md'), 'w') as f:
            f.write(f"# {cat['name']}\n\n")
            if desc:
                f.write(desc + '\n\n')
            for a in cat_entry['articles']:
                if a.get('mirrored_in') and a['mirrored_in'] != cat_entry['slug']:
                    link = f"../{a['mirrored_in']}/{a['slug']}.md"
                else:
                    link = f"{a['slug']}.md"
                title = a['title'] or a['slug'].replace('-', ' ')
                date = f" — {a['date']}" if a.get('date') else ''
                f.write(f"- [{title}]({link}){date}\n")
        with open(os.path.join(OUT, 'index.json'), 'w') as f:
            json.dump({'categories': index, 'generated': time.strftime('%Y-%m-%d')}, f, indent=1)

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'parse-report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    total = sum(len(c['articles']) for c in index)
    print(f"\nDONE categories={len(index)} articles={total} images={report['images']} failed={len(report['failed'])}")
    uniq = sorted({re.sub(r' \(parse\)$', '', x) for x in report['failed']})
    print(f"unique failures: {len(uniq)}")
    for x in uniq[:20]:
        print('  failed:', x)
    return 0


if __name__ == '__main__':
    sys.exit(main())
