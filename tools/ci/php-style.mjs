#!/usr/bin/env node
/**
 * The PHP style rules this repository pins, checked without PHP.
 *
 * `pint.json` in `services/api` is the authority, and `ci-api` runs the real thing: `vendor/bin/pint --test` on PHP
 * 8.4. This tool exists because that job only runs when `services/**` changes, and because the development
 * environment has no PHP at all — so the rules that can be checked by reading a file are checked here, on every pull
 * request, in a second and with no dependencies.
 *
 * It checks the half of that style a reader can check without a parser: unused imports, import order, quoting, `!`
 * spacing, the `declare(strict_types=1)` prologue, comment and brace conventions, and the whitespace and encoding
 * rules. A rule that
 * needs a real parser — anything about types, docblocks or trailing commas in calls — is deliberately left to Pint
 * rather than approximated here, because an approximation that disagrees with Pint is worse than no check at all.
 *
 * Exits non-zero and prints file:line for each finding, so it can gate a build.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const target = process.argv[2] ?? join(root, 'services/api');

/** Every `.php` file under a directory, skipping what a checkout never tracks. */
function phpFiles(dir) {
  const skip = new Set(['vendor', 'node_modules', '.git']);
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (skip.has(entry)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.php')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The lines of a file, each with a flag saying whether it is inside a comment.
 *
 * Comments matter here: prose may quote things (`the sentence says "connected"`), and a rule about string literals
 * must not fire on it. Tracking block comments is enough — this is not a tokenizer and does not pretend to be.
 */
function annotatedLines(text) {
  const out = [];
  let inBlock = false;
  text.split('\n').forEach((line, index) => {
    const stripped = line.trim();
    if (inBlock) {
      out.push({ number: index + 1, line, comment: true });
      if (stripped.includes('*/')) inBlock = false;
      return;
    }
    if (stripped.startsWith('/*')) {
      out.push({ number: index + 1, line, comment: true });
      if (!stripped.slice(2).includes('*/')) inBlock = true;
      return;
    }
    out.push({ number: index + 1, line, comment: stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('#') });
  });
  return out;
}

/** A line with its string literals blanked out, for the rules that are about syntax rather than about prose. */
function unquoted(line) {
  return line.replace(/'((?:[^'\\]|\\.)*)'/g, "''").replace(/"((?:[^"\\]|\\.)*)"/g, '""');
}

const findings = [];
const files = phpFiles(target);

/*
 * The service's manifest, first, because it is the one file whose failure mode is not a style nit: composer refuses to
 * do anything at all when composer.json does not parse, and a namespace written with one backslash instead of two
 * (`"App\": "app/"`) is a valid-looking line that JSON reads as an escaped quote. That is a CI round trip to discover
 * and a second to prevent, so it is checked here — and the psr-4 keys are checked to end in a backslash, which is the
 * mistake itself rather than a proxy for it.
 */
const manifestPath = join(target, 'composer.json');
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, 'utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(manifest);
  } catch (error) {
    findings.push({ rel: relative(root, manifestPath), line: 1, rule: 'valid_json', detail: `composer.json does not parse: ${error.message}` });
  }
  for (const section of ['autoload', 'autoload-dev']) {
    for (const [namespace, dir] of Object.entries(parsed?.[section]?.['psr-4'] ?? {})) {
      if (!namespace.endsWith('\\')) {
        findings.push({ rel: relative(root, manifestPath), line: 1, rule: 'psr4_namespace', detail: `${section}.psr-4["${namespace}"] must end in a backslash (it is a namespace prefix)` });
      }
      if (!existsSync(join(target, dir))) {
        findings.push({ rel: relative(root, manifestPath), line: 1, rule: 'psr4_namespace', detail: `${section}.psr-4["${namespace}"] points at ${dir}, which does not exist` });
      }
    }
  }
}

for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const annotated = annotatedLines(text);

  const report = (line, rule, detail) => findings.push({ rel, line, rule, detail });
  const rule = (name, detail, predicate) => {
    for (const { number, line, comment } of annotated) {
      if (!comment && predicate(line, number)) report(number, name, detail(line));
    }
  };

  // declare_strict_types — the prologue, after at most a file docblock.
  if (!text.slice(0, 4000).includes('declare(strict_types=1);')) {
    report(1, 'declare_strict_types', 'missing declare(strict_types=1)');
  }

  // single_blank_line_at_eof, no_trailing_whitespace, no_whitespace_in_blank_line, indentation_type, line_ending.
  if (!text.endsWith('\n')) report(lines.length, 'single_blank_line_at_eof', 'no newline at end of file');
  if (text.endsWith('\n\n')) report(lines.length, 'single_blank_line_at_eof', 'blank line(s) at end of file');
  if (text.includes('\r')) report(1, 'line_ending', 'CRLF line ending');
  rule('indentation_type', () => 'tab character', (line) => line.includes('\t'));
  rule('no_trailing_whitespace', (line) => `trailing whitespace after ${JSON.stringify(line.trim().slice(-30))}`, (line) => line !== line.replace(/\s+$/, ''));

  // no_closing_tag, full_opening_tag.
  if (/^[ \t]*\?>/m.test(text)) report(1, 'no_closing_tag', 'a PHP closing tag');
  if (!text.startsWith('<?php')) report(1, 'full_opening_tag', 'does not open with <?php');

  // blank_line_after_namespace.
  annotated.forEach(({ number, line, comment }, index) => {
    if (comment) return;
    if (!/^namespace\s+[^;]+;$/.test(line.trim())) return;
    const next = lines[index + 1];
    if (next === undefined || next.trim() !== '') report(number, 'blank_line_after_namespace', 'no blank line after the namespace');
    else if (lines[index + 2] !== undefined && lines[index + 2].trim() === '') report(number, 'blank_line_after_namespace', 'more than one blank line after the namespace');
  });

  // not_operator_with_successor_space, single_quote, braces.
  rule('not_operator_with_successor_space', (line) => line.trim().slice(0, 70), (line) => /!(?=[A-Za-z_$([\]]|\\)/.test(line.replace(/!=/g, ' ')));
  rule('single_quote', (line) => `double-quoted string with nothing to interpolate: ${line.trim().slice(0, 60)}`, (line) => {
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const body = match[1];
      // A `$` or an escape means the double quote is doing work; an inner single quote means converting would need one.
      if (!body.includes('$') && !body.includes('\\') && !body.includes("'")) return true;
    }
    return false;
  });
  rule('braces', (line) => line.trim().slice(0, 70), (line) => line.trim() === 'else {' || /^else\s+if\b/.test(line.trim()));

  /* `if($x)` — a keyword with no space before its bracket. Pint's single_space_around_construct rewrites it, and it
     is invisible in review because it reads like a function call. */
  rule('single_space_around_construct', (line) => `no space between the keyword and its bracket: ${line.trim().slice(0, 60)}`, (line) =>
    /(?<![\w:$>\\])(if|elseif|for|foreach|while|switch|catch|match)\(/.test(unquoted(line)));

  // no_unused_imports, ordered_imports — top-level imports only: a `use Trait;` inside a class body is not an import.
  const uses = [];
  for (const { number, line, comment } of annotated) {
    if (comment || /^[ \t]/.test(line)) continue;
    if (/^(final\s+|abstract\s+)?(class|trait|interface|enum)\s/.test(line)) break;
    const match = /^use\s+([^;]+);/.exec(line.trim());
    if (match && !match[1].includes('(')) uses.push({ number, target: match[1] });
  }
  for (const { number, target: importTarget } of uses) {
    const name = importTarget.split(' as ').pop().trim().split('\\').pop();
    const body = lines.filter((_, i) => i + 1 !== number).join('\n');
    if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body)) {
      report(number, 'no_unused_imports', name);
    }
  }
  const order = uses.map((u) => u.target.toLowerCase());
  const sorted = [...order].sort();
  if (order.length > 1 && order.join('\u0000') !== sorted.join('\u0000')) {
    report(uses[0].number, 'ordered_imports', uses.map((u) => u.target.split('\\').pop()).join(' -> '));
  }

  /* A control structure whose body is one unbraced statement. Pint adds the braces; this reports the header, which
     is the line that has to change. */
  annotated.forEach(({ number, line, comment }, index) => {
    if (comment) return;
    if (!/^\s*(if|elseif|else|for|foreach|while|do|switch|try|catch|finally)\b/.test(line)) return;
    const trimmed = line.trim();
    if (trimmed.endsWith('{') || trimmed.endsWith(';')) return;
    const next = lines[index + 1]?.trim() ?? '';
    if (next && !next.startsWith('{')) report(number, 'braces', `control structure without braces: ${trimmed.slice(0, 60)}`);
  });

  /* ordered_traits and class_attributes_separation — `use Trait;` inside a class body. Pint sorts them, and the
     spacing between them is not one rule but two, which cost this repository a CI round each before they were
     counted rather than guessed:

       * two trait imports in a row carry **no** blank line between them (`trait_import` is not an element Pint
         separates), and
       * a comment between two traits gets **one** blank line above it, because the comment belongs to the trait
         under it and Pint separates a trait import from the element that follows it.

     Both spellings exist in this service, so the rule below asks what sits between the two imports rather than
     applying one number to both. The leading indentation is what marks a line as a trait import rather than one of
     the file's imports. */
  const traits = [];
  annotated.forEach(({ number, line, comment }) => {
    if (comment) return;
    if (!/^[ \t]+use\s+[A-Za-z_\\][\w\\]*;$/.test(line)) return;
    traits.push({ number, name: line.trim().slice('use '.length, -1) });
  });
  for (let i = 1; i < traits.length; i += 1) {
    const previous = traits[i - 1];
    const current = traits[i];
    if (previous.name.toLowerCase() > current.name.toLowerCase()) {
      report(current.number, 'ordered_traits', `${current.name} comes after ${previous.name}`);
    }
    const between = lines.slice(previous.number, current.number - 1);
    const blanks = between.filter((line) => line.trim() === '').length;
    const comment = between.some((line) => /^\s*(\/\/|\/\*|\*)/.test(line));
    const want = comment ? 1 : 0;

    if (blanks !== want) {
      report(
        current.number,
        'class_attributes_separation',
        `${blanks} blank line(s) between ${previous.name} and ${current.name}, and the rule is ${want}${comment ? ' (a comment sits between them, and it belongs to the trait under it)' : ' (two trait imports in a row are not separated)'}`,
      );
    }
  }

  /* class_attributes_separation, the other half of what Pint printed for it: an element ends where its closing brace
     is, so whitespace above that brace is trimmed. It is reported under Pint's own rule name because a reader who
     sees the failure here should find the same sentence in the CI log. */
  lines.forEach((line, index) => {
    if (line.trim() !== '}' || index === 0) return;
    let above = index - 1;
    while (above >= 0 && lines[above].trim() === '') above -= 1;
    const blanks = index - 1 - above;
    if (blanks > 0) report(index + 1, 'class_attributes_separation', `${blanks} blank line(s) before a closing brace`);
  });

  /* integer_literal_case — a hexadecimal literal spells its digits in upper case. The CI failure this would have
     caught was one character (`0xff` in a DER encoder); strings come out first, because a claim or a message may
     legitimately quote a hex value. */
  rule('integer_literal_case', (line) => `hexadecimal literal with lower-case digits: ${line.trim().slice(0, 60)}`, (line) =>
    /0[xX][0-9a-fA-F]*[a-f][0-9a-fA-F]*/.test(unquoted(line)));

  /* fully_qualified_strict_types — a class named by its full path where an import would do. The rule applies to
     docblocks as well as to code (a `@throws \App\Support\ProblemException` is exactly the case Pint fixed), so this
     reads every line rather than only the uncommented ones, and leaves global functions (`\strlen`) alone: a run of
     segments means a class, and the roots below are the ones this service can import. */
  for (const { number, line } of annotated) {
    if (/^\s*use\s+/.test(line)) continue;
    if (/(^|[^\w$\\])\\(App|Tests|Illuminate|Symfony|Database|OpenApi)\\[A-Z]\w*\\\w+/.test(line)) {
      report(number, 'fully_qualified_strict_types', `names a class by its full path: ${line.trim().slice(0, 60)}`);
    }
  }
}

if (findings.length) {
  const byRule = new Map();
  for (const finding of findings) {
    if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
    byRule.get(finding.rule).push(finding);
  }
  for (const [rule, list] of [...byRule].sort()) {
    console.error(`${rule} (${list.length})`);
    for (const { rel, line, detail } of list.slice(0, 15)) console.error(`  ${rel}:${line} ${detail}`);
  }
  console.error(`\nPHP STYLE FAILED: ${findings.length} finding(s) in ${files.length} file(s).`);
  console.error('The rules are pinned in services/api/pint.json, where the real Pint run reads them.');
  process.exit(1);
}

console.log(`php style passed (${files.length} file(s) checked against the rules pinned in services/api/pint.json)`);
