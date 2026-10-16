#!/usr/bin/env node
/**
 * PHP syntax gate for the API service, without PHP on the machine.
 *
 * `services/api` is a Laravel application, and this repository's development sandbox has no PHP and no composer —
 * packagist is reachable from GitHub Actions and nowhere else, which `services/api/README.md` states. That makes it
 * very easy to push fifty hand-written PHP files and discover the first typo four minutes later in CI, one file per
 * run. This tool closes that hole: it parses every PHP file with PHP itself (compiled to WebAssembly) and reports the
 * files that do not parse, so a syntax error costs a second rather than a CI round trip.
 *
 * It is a *syntax* gate and nothing more. It does not load the framework, run a route or touch a database: types,
 * behaviour and the contract are proved by `php artisan test` in the ci-api job, against real PHP 8.4 and Postgres.
 *
 * Needs one dev-only package:
 *
 *     npm i --no-save php-wasm && node tools/ci/php-lint.mjs
 *
 * Exit code 0 when every file parses, 1 when one does not, 2 when the tooling is missing.
 *
 * How a file is parsed: the wasm runtime is handed the file's own text and asks PHP's parser for tokens, so PHP's
 * own compiler reports a `ParseError` (catchable since PHP 7) instead of the process dying. Anything that is not a
 * `ParseError` — an unknown class, a missing extension — means the file *compiled* and then failed at runtime, which
 * is exactly what this gate wants to ignore.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const target = process.argv[2] ?? join(root, 'services/api');

let PhpNode;
try {
  ({ PhpNode } = await import('php-wasm/PhpNode.mjs'));
} catch {
  console.error('\nThis gate needs one dev-only package:\n\n    npm i --no-save php-wasm\n\nthen run `node tools/ci/php-lint.mjs` again.\n');
  process.exit(2);
}

/** Every `.php` file under a directory, skipping the directories a checkout never tracks. */
function phpFiles(dir) {
  const skip = new Set(['vendor', 'node_modules', '.git', 'storage', 'bootstrap/cache']);
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (skip.has(entry) || skip.has(relative(target, full))) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.php')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

const files = phpFiles(target);
if (files.length === 0) {
  console.error(`No PHP files under ${relative(root, target)} — nothing to check, which is itself a failure.\n`);
  process.exit(1);
}

const php = new PhpNode();
const output = [];
php.addEventListener('output', (event) => output.push(String(event.detail)));
await php.mkdir('/lint');

/** Run one snippet and collect what PHP printed, waiting for the runtime to flush it. */
async function drain(code) {
  const before = output.length;
  await php.exec(code);
  for (let i = 0; i < 200 && output.length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return output.slice(before).join('');
}

const failures = [];
console.log(`\nphp — parsing ${files.length} file(s) with the wasm runtime, since this machine has no PHP\n`);

for (const [index, file] of files.entries()) {
  const path = `/lint/f${index}.php`;
  await php.writeFile(path, readFileSync(file, 'utf8'));
  /* `token_get_all(..., TOKEN_PARSE)` is the parser on its own, and it is used rather than `include` for a reason
     that cost a false failure: including a file *declares* the classes in it, and PHP resolves a class-level
     `use TraitName;` at declaration time — so a controller whose trait lives in another file was reported as a parse
     error by a tool whose promise is "does this file parse". Parsing asks the parser and nothing else; the trait,
     the parent class and the imports are the test suite's business. The `return ""` keeps the snippet an expression,
     which is what `exec` evaluates. */
  const say = await drain(
    `(function () { try { token_get_all(file_get_contents(${JSON.stringify(path)}), TOKEN_PARSE); echo "PARSE-OK"; } catch (\\ParseError $e) { echo "PARSE-ERROR " . str_replace("\\n", " ", $e->getMessage()); } return ""; })()`,
  );
  const said = say.trim();
  const ok = said.includes('PARSE-OK');
  console.log(`  ${ok ? '✓' : '✗'} ${relative(root, file)}${ok ? '' : `  — ${said.replace('PARSE-ERROR ', '')}`}`);
  if (!ok) failures.push({ file: relative(root, file), said });
}

if (failures.length > 0) {
  console.log(`\n${failures.length} file(s) do not parse:\n`);
  for (const f of failures) console.log(`  · ${f.file}\n    ${f.said}`);
  console.log('\nReal PHP 8.4 is the authority: the ci-api job runs `php -l` over the same tree and then the tests.\n');
  process.exit(1);
}

console.log(`\nall ${files.length} file(s) parse.\n`);
process.exit(0);
