#!/usr/bin/env node
/**
 * display-order.mjs — a class list may carry only one *base* display utility.
 *
 * Why this is a check and not a style note. When two utilities of equal specificity set `display`, the winner is
 * decided by the order of the rules in the stylesheet, not by the order in the `class` attribute. In this
 * Tailwind build the base display utilities come out in this order:
 *
 *     block · flex · grid · hidden · inline · inline-block · inline-flex · inline-grid · table
 *
 * so `.hidden` beats `flex`/`grid` — but *loses* to `inline-grid`, which is emitted after it. That produced a real
 * bug: `cx(ICON_BTN, 'hidden lg:inline-grid')`, where `ICON_BTN` carried `inline-grid`, stayed
 * `display: inline-grid` at every width, so the “Expand sidebar” button sat in the mobile header toggling a
 * desktop rail that does not exist there — a control that looked live and did nothing.
 *
 * The fix is always the same: keep the display utility in the same string as `hidden` and put the other
 * breakpoint behind a variant (`hidden lg:inline-grid`); never two base display utilities in one class list.
 *
 * What it understands: `className="…"`, `className={…}`, `cx(…)`, same-file class constants (including template
 * literals that interpolate them), and ternaries — `cond ? 'flex …' : 'grid …'` is one element with two
 * exclusive class lists, so each branch is judged on its own, while separate arguments of the same `cx()` call
 * are combined the way the browser combines them.
 *
 * Known limitation: it flags a display utility behind a runtime conditional (`cx('flex', open && 'hidden')`)
 * even though there the outcome may be intentional. Such a selector is worth rewriting anyway.
 *
 * Usage:  node tools/ci/display-order.mjs [file …]      (defaults to every .tsx under apps/ and packages/)
 * Exit:   1 if any class list carries two base display utilities, 0 otherwise.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const DISPLAY = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'table', 'inline-table',
  'grid', 'inline-grid', 'contents', 'flow-root', 'list-item', 'hidden',
]);

/** Emitted order observed in the compiled stylesheet, earliest first. `hidden` sits before the inline-* family. */
const ORDER = ['block', 'flex', 'grid', 'hidden', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'table'];

/* ------------------------------------------------------------------ walking the tree */
function tsxFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/* ------------------------------------------------------------------ source text helpers */
/** Comments talk about class lists (this file does); blank them out so only real code is scanned. */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, head) => head + ' '.repeat(m.length - head.length));
}

/** Text between `openIndex` and its matching close, honouring quotes. Returns [text, endIndex]. */
function balanced(src, openIndex, openCh, closeCh) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return [src.slice(openIndex + 1, i), i + 1];
    }
  }
  return [src.slice(openIndex + 1), src.length];
}

/** Split at top level on any of `chars`. `?.` and `??` are not separators; quotes and brackets are respected. */
function splitTop(text, chars) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (depth === 0 && chars.includes(ch)) {
      const next = text[i + 1];
      if (ch === '?' && (next === '.' || next === '?')) continue;
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/* ------------------------------------------------------------------ expressions and tokens */
function candidates(src) {
  const found = [];
  for (const m of src.matchAll(/className\s*=\s*"([^"]*)"/g)) {
    found.push({ index: m.index, end: m.index + m[0].length, expr: `"${m[1]}"` });
  }
  for (const m of src.matchAll(/className\s*=\s*\{/g)) {
    const [text, end] = balanced(src, m.index + m[0].length - 1, '{', '}');
    found.push({ index: m.index, end, expr: text });
  }
  for (const m of src.matchAll(/\bcx\(/g)) {
    const [text, end] = balanced(src, m.index + m[0].length - 1, '(', ')');
    found.push({ index: m.index, end, expr: `cx(${text})` });
  }
  return found;
}

/** Same-file `const NAME = …` table, so `cx(ICON_BTN, 'hidden …')` can be judged as one class list. */
function constTable(src) {
  const table = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    while (src[start] === ' ') {
      // keep the expression text verbatim; nothing to skip
      break;
    }
    const next = src.indexOf(';', start);
    table.set(m[1], src.slice(start, next === -1 ? start + 400 : next));
  }
  return table;
}

function literalTokens(expr) {
  const tokens = new Set();
  for (const m of expr.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const token of text.split(/\s+/)) if (token) tokens.add(token);
  }
  return tokens;
}

const union = (a, b) => new Set([...a, ...b]);

/**
 * Every class list this expression can produce, as a set of token sets: separate arguments of a call are
 * combined, the branches of a ternary are not.
 */
function classLists(expr, consts, depth = 0) {
  if (depth > 4) return [new Set()];
  const trimmed = expr.trim();
  const call = /^[A-Za-z_$][\w$.]*\s*\(/.exec(trimmed);
  if (call) {
    const open = expr.indexOf('(', expr.indexOf(call[0]));
    const [inner] = balanced(expr, open, '(', ')');
    let acc = [new Set()];
    for (const arg of splitTop(inner, [','])) {
      const next = [];
      for (const base of acc) for (const v of classLists(arg, consts, depth + 1)) next.push(union(base, v));
      acc = next;
    }
    return acc;
  }
  const alternatives = splitTop(expr, ['?', ':']);
  if (alternatives.length > 1) return alternatives.flatMap((a) => classLists(a, consts, depth + 1));

  let tokens = literalTokens(expr);
  for (const m of expr.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
    const next = consts.get(m[1]);
    if (next) tokens = union(tokens, union(literalTokens(next), classLists(next, consts, depth + 1).reduce(union, new Set())));
  }
  return [tokens];
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/* ------------------------------------------------------------------ the check */
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = args.length
  ? args.map((a) => (a.startsWith('/') ? a : join(ROOT, a)))
  : [...tsxFiles(join(ROOT, 'apps')), ...tsxFiles(join(ROOT, 'packages'))];

let checked = 0;
const findings = [];

for (const file of files) {
  const src = withoutComments(readFileSync(file, 'utf8'));
  const consts = constTable(src);
  const spans = candidates(src);
  const outermost = spans.filter((c) => !spans.some((o) => o !== c && o.index <= c.index && o.end >= c.end));
  for (const { index, expr } of outermost) {
    checked += 1;
    for (const list of classLists(expr, consts)) {
      const distinct = [...list].filter((t) => DISPLAY.has(t));
      const unique = [...new Set(distinct)];
      if (unique.length < 2) continue;
      const ordered = unique.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      findings.push({
        file: relative(ROOT, file).startsWith('..') ? file : relative(ROOT, file),
        line: lineOf(src, index),
        classes: unique,
        winner: ordered[ordered.length - 1],
        verified: unique.every((c) => ORDER.includes(c)),
      });
    }
  }
}

if (findings.length === 0) {
  console.log(`display-order check passed (${checked} class expressions, no single list carries two base display utilities)`);
  process.exit(0);
}

console.error(`display-order check failed — ${findings.length} class list(s) carry two base display utilities:\n`);
for (const f of findings) {
  const how = f.verified
    ? `\`${f.winner}\` wins over ${f.classes.filter((c) => c !== f.winner).map((c) => `\`${c}\``).join(', ')}`
    : 'the winner is decided by the emitted stylesheet order';
  console.error(`  ${f.file}:${f.line}  { ${f.classes.join(', ')} } — ${how}`);
  console.error('      keep one base display utility; move the other breakpoint behind a variant: `hidden lg:inline-grid`');
}
process.exit(1);
