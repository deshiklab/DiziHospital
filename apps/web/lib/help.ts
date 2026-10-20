import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* -----------------------------------------------------------------------------
 * Help library access (server side).
 *
 * The mirrored vendor help library lives in docs/help-library and is *reference material*: it is read here,
 * never copied into the product, and every page says where it came from (clean-room rule, plan 05 §11).
 *
 * Shape on disk:
 *   docs/help-library/<category>/_index.md      index of the category, lists its articles
 *   docs/help-library/<category>/<slug>.md      one article, images referenced as ../assets/<slug>/N.jpg
 *   docs/help-library/assets/<slug>/N.jpg       the images themselves
 */

const CANDIDATE_ROOTS = [
  resolve(process.cwd(), '../../docs/help-library'),
  resolve(process.cwd(), 'docs/help-library'),
  resolve(process.cwd(), '../docs/help-library'),
];

function helpRoot(): string | null {
  for (const root of CANDIDATE_ROOTS) {
    try {
      if (statSync(root).isDirectory()) return root;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export interface HelpCategory {
  slug: string;
  title: string;
  description: string;
  articleCount: number;
}

export interface HelpArticleRef {
  slug: string;
  title: string;
  date?: string;
  category: string;
}

export interface HelpArticle extends HelpArticleRef {
  body: string;
  sourceUrl?: string;
}

const SKIP_DIRS = new Set(['assets', '_debug', 'node_modules']);

function humanise(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function readIndex(category: string): { description: string; articles: HelpArticleRef[] } {
  const root = helpRoot();
  if (!root) return { description: '', articles: [] };
  try {
    const text = readFileSync(join(root, category, '_index.md'), 'utf8');
    const lines = text.split('\n');
    const heading = lines.find((l) => l.startsWith('# '))?.replace(/^#\s*/, '') ?? humanise(category);
    const description = lines.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('-'))?.trim() ?? '';
    const articles: HelpArticleRef[] = [];
    for (const line of lines) {
      const m = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*—\s*(.+))?/);
      if (!m) continue;
      const [, title, href, date] = m;
      // Links to sibling categories (e.g. changelogs) are resolved relative to the index file.
      const isExternalCategory = href.startsWith('../');
      const cleanHref = href.replace(/^\.\//, '');
      const [targetCategory, ...rest] = isExternalCategory ? cleanHref.replace(/^\.\.\//, '').split('/') : [category, cleanHref];
      const slug = (rest.join('/') || cleanHref).replace(/\.md$/, '');
      if (!slug) continue;
      articles.push({ slug, title: title.trim(), date: date?.trim(), category: targetCategory });
    }
    return { description: description === heading ? '' : description, articles };
  } catch {
    return { description: '', articles: [] };
  }
}

export function listCategories(): HelpCategory[] {
  const root = helpRoot();
  if (!root) return [];
  return readdirSync(root)
    .filter((entry) => !SKIP_DIRS.has(entry) && !entry.startsWith('.'))
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((slug) => {
      const { description, articles } = readIndex(slug);
      return {
        slug,
        title: humanise(slug),
        description,
        articleCount: articles.length,
      };
    })
    .filter((c) => c.articleCount > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function listArticles(category: string): HelpArticleRef[] {
  const { articles } = readIndex(category);
  return articles.map((a) => ({ ...a, category }));
}

export function categoryTitle(slug: string): string {
  return humanise(slug);
}

export function readArticle(category: string, slug: string): HelpArticle | null {
  const root = helpRoot();
  if (!root) return null;
  try {
    const raw = readFileSync(join(root, category, `${slug}.md`), 'utf8');
    const lines = raw.split('\n');

    const title = (lines.find((l) => l.startsWith('# ')) ?? `# ${humanise(slug)}`).replace(/^#\s*/, '');
    const sourceLine = lines.find((l) => l.includes('vendor article:'));
    // Take the URL that follows the "vendor article:" marker, not the first URL on the line (the line also
    // carries the breadcrumb link back to the category).
    const sourceUrl = sourceLine?.match(/vendor article:\s*(https?:\/\/[^\s)]+)/)?.[1];
    const date = lines.find((l) => /^_.*_\s*·/.test(l))?.match(/_([^_]+)_/)?.[1];

    // Strip the mirrored vendor banner (breadcrumb links and duplicated title) so the article reads cleanly,
    // and rewrite image paths to the asset route that serves them from the library.
    const body = raw
      .replace(/^#\s.*$/m, '') // the title becomes the page heading, not a body heading
      .replace(/^_.*vendor article:.*$/m, '') // the mirror banner becomes the page header
      .replace(/\n\[Articles\]\([^)]*\)\[[^\]]*\]\([^)]*\)\n/g, '\n') // the mirror's own nav row
      .replace(/\(\.\.\/assets\//g, '(/api/help-asset/')
      // The mirror repeats the title and its date as the first body lines, then a rule. Remove them only when
      // they match the article, so an article that legitimately opens with a heading keeps it.
      .replace(/^\s*###\s+(.+)\n+/, (match: string, heading: string) =>
        heading.trim().toLowerCase() === title.trim().toLowerCase() ? '' : match)
      .replace(/^\s*[A-Z][a-z]{2},\s+\d{1,2}\s+[A-Z][a-z]{2},\s+\d{4}\s*\n+/, '')
      .replace(/^-{3,}\s*\n+/, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { slug, title, date, category, body, sourceUrl };
  } catch {
    return null;
  }
}

export interface HelpHit {
  category: string;
  categoryTitle: string;
  slug: string;
  title: string;
  snippet: string;
}

/** Simple substring search over the mirror. A real deployment gets an index (plan 08 §3) — this is honest and fast enough for 600 files. */
export function searchHelp(query: string, limit = 40): HelpHit[] {
  const root = helpRoot();
  const q = query.trim().toLowerCase();
  if (!root || q.length < 2) return [];

  const hits: HelpHit[] = [];
  for (const category of readdirSync(root)) {
    if (SKIP_DIRS.has(category) || category.startsWith('.')) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, category));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md') || entry === '_index.md') continue;
      let text = '';
      try {
        text = readFileSync(join(root, category, entry), 'utf8');
      } catch {
        continue;
      }
      const title = (text.split('\n').find((l) => l.startsWith('# ')) ?? '').replace(/^#\s*/, '') || humanise(entry);
      const haystack = text.toLowerCase();
      const index = haystack.indexOf(q);
      const titleHit = title.toLowerCase().includes(q);
      if (index === -1 && !titleHit) continue;

      const from = Math.max(0, (titleHit ? haystack.indexOf(q) : index) - 90);
      const snippet = text
        .slice(from, from + 240)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#*_>`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      hits.push({
        category,
        categoryTitle: humanise(category),
        slug: entry.replace(/\.md$/, ''),
        title,
        snippet,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Absolute path of an asset inside the library, guarded against traversal. */
export function resolveAssetPath(parts: string[]): string | null {
  const root = helpRoot();
  if (!root) return null;
  const target = resolve(root, 'assets', ...parts);
  if (!target.startsWith(resolve(root, 'assets'))) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

export const helpAvailable = (): boolean => helpRoot() !== null;
