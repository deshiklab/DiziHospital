#!/usr/bin/env node
/**
 * Clean-room scan (plan `05` §11, ticket P0-214).
 *
 * The new platform must be our own work: no vendor product code, styles, fonts, icons or templates may appear
 * in product directories (`apps/`, `packages/`, `services/`). Documentation and analysis artefacts are allowed
 * to reference the vendor — captures in `docs/assets/screens/`, the mirrored public help library in
 * `docs/help-library/` and the analysis in `docs/` — because they are *reference material*: they are never
 * shipped in the product and never copied into it.
 *
 * Exits non-zero and prints file:line for each violation, so it can gate a build.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const root = process.cwd();
const productDirs = ['apps', 'packages', 'services'];

// Markers that indicate vendor product material rather than our own work.
const markers = [
  { re: /smart[-_ ]hospital/i, why: 'vendor product name in product code' },
  { re: /codecanyon|envato/i, why: 'vendor marketplace reference' },
  { re: /qdocs/i, why: 'vendor company name' },
  { re: /assets\/article-media\//i, why: 'vendor documentation asset path' },
  { re: /application\/views\//i, why: 'CodeIgniter vendor view path' },
  { re: /system\/core\/CodeIgniter/i, why: 'vendor framework file path' },
  { re: /bootstrap\.min\.css|jquery(-[0-9.]+)?\.min\.js|dataTables/i, why: 'vendored legacy front-end library' },
];

// Files that legitimately talk *about* the vendor (our own docs, ADRs, tests that assert the rule).
const allow = [
  /(^|\/)readme\.md$/i,
  /(^|\/)docs\//,
  /(^|\/)clean-room\.mjs$/,
  /\.test\.[cm]?[jt]sx?$/,
];

const skipDirs = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'vendor']);
const textExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.php', '.blade.php', '.json', '.html', '.svg', '.md', '.sql']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let violations = 0;
let scanned = 0;

for (const dir of productDirs) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relative(root, file);
    if (allow.some((a) => a.test(rel))) continue;
    if (!textExt.has(extname(file)) && !file.endsWith('.blade.php')) continue;
    scanned++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Escape hatch: a reviewed line may name the product it replaces (staff-facing copy only).
      const directive = /clean-room:\s*allow/.test(line) || (i > 0 && /clean-room:\s*allow/.test(lines[i - 1]));
      if (directive) return;
      for (const { re, why } of markers) {
        if (re.test(line)) {
          violations++;
          console.error(`${rel}:${i + 1}: ${why}  ->  ${line.trim().slice(0, 120)}`);
        }
      }
    });
  }
}

if (violations) {
  console.error(`\nCLEAN-ROOM SCAN FAILED: ${violations} violation(s) in ${scanned} product files.`);
  console.error('The platform must be written from our capture, the public documentation and agreed requirements.');
  process.exit(1);
}
console.log(`clean-room scan passed (${scanned} product files checked, docs excluded by design)`);
