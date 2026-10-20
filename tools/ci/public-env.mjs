#!/usr/bin/env node
/**
 * `NEXT_PUBLIC_*` has to be read the way a bundler can replace it.
 *
 * Next inlines public environment variables at build time by replacing the *text* `process.env.NEXT_PUBLIC_X`. A read
 * through a variable — `env.NEXT_PUBLIC_X`, `const env = process.env; env.NEXT_PUBLIC_X` — is not that text, so it is
 * left alone and evaluates to `undefined` in the browser. The build succeeds, the deployed page renders, and the
 * feature it configures quietly does nothing.
 *
 * That is not hypothetical: the sign-in page's OIDC switch was written the second way, so a production build with
 * `NEXT_PUBLIC_OIDC_ISSUER` set went on showing the "no single sign-on is configured" preview and never handed off to
 * the realm. The full proof is a build probe (`tools/test/oidc-page.mjs`, which wants a build with the variable set);
 * this is the second-long version that runs on every pull request.
 *
 *     npm run check:env
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const apps = ['apps/web'];

const SKIP = new Set(['node_modules', '.next', '.next-build', '.next-build-oidc', 'dist', 'out', 'coverage']);

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const findings = [];
let checked = 0;

for (const app of apps) {
  for (const file of files(resolve(root, app))) {
    const text = readFileSync(file, 'utf8');
    /* The functions that take an environment as a parameter are the pattern this file exists for: the default comes
       from `process.env.NEXT_PUBLIC_X` (the spelling the bundler replaces) and the body reads `env.NEXT_PUBLIC_X`
       (which the *tests* pass in by hand). Both are correct together, and only wrong apart — so what is reported is a
       variable read whose name is never read in the full spelling in the same file. */
    const inFull = new Set([...text.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)].map((m) => m[1]));

    text.split('\n').forEach((line, index) => {
      if (!/NEXT_PUBLIC_/.test(line)) return;
      checked += 1;
      for (const match of line.matchAll(/([\w$.\[\]'"]*)\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
        const [whole, prefix, name] = match;
        if (prefix === 'process.env' || inFull.has(name)) continue;
        findings.push({ file: relative(root, file), line: index + 1, text: whole });
      }
    });
  }
}

if (findings.length) {
  console.error(`\n${findings.length} public environment variable(s) read in a way the bundler cannot replace:\n`);
  for (const { file, line, text } of findings) console.error(`  ${file}:${line}  ${text}`);
  console.error('\nWrite it as `process.env.NEXT_PUBLIC_X` — that exact text — or it reads as undefined in the browser.');
  console.error('See apps/web/lib/auth.ts for the case that shipped this way and tools/test/oidc-page.mjs for the proof.\n');
  process.exit(1);
}

console.log(`public environment check passed (${checked} reference(s), all written as process.env.NEXT_PUBLIC_*)`);
