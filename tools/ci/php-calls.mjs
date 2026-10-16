/**
 * A call this service's own classes do not answer.
 *
 * `php-lint` parses one file at a time and `php-style` judges one file at a time, so neither can see the failure this
 * gate exists for: `Diary` called `$availability->slotMinutes()` for a whole slice, `Availability` never had that
 * method, every booking answered 500, and the first four CI runs each showed one more layer of the same mistake. The
 * type that was called was named three lines above the call, in the constructor — this reads it.
 *
 * What it checks is narrow on purpose, because a checker that guesses is worse than no checker:
 *
 *   * only promoted constructor properties whose type is a class in this repository (`private readonly Diary $diary`),
 *   * only calls and reads made through those properties (`$this->diary->day(...)`, `$this->diary->find`),
 *   * and only the *presence* of a name on the target class — a public method, a public static method, a public
 *     constant, a public property, or anything Eloquent provides on a model.
 *
 * It is deliberately not a type checker: arguments, return types and `$this->` inside the target are PHPUnit's and
 * Pint's business, and pretending otherwise here would produce a second opinion that disagrees with the first.
 *
 * Exit code 0 when every call resolves, 1 when one does not, 2 when there is nothing to check (which is a broken
 * invocation rather than a passing tree).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const target = process.argv[2] ?? join(root, 'services/api/app');

/** Every PHP file under a directory. */
function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...files(path));
    else if (path.endsWith('.php')) found.push(path);
  }
  return found.sort();
}

const sources = files(target).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
if (sources.length === 0) {
  console.error(`\nNo PHP files under ${target}.\n`);
  process.exit(2);
}

/** The names a class answers to: methods, constants and properties, plus what every Eloquent model answers. */
const MODEL = new Set(['query', 'save', 'count', 'find', 'where', 'get', 'first', 'exists', 'newQuery', 'create', 'update', 'delete', 'fill', 'fresh', 'toApiArray', 'each', 'orderBy', 'whereIn']);

function names(text) {
  const found = new Set();
  for (const match of text.matchAll(/public (?:static )?function ([a-zA-Z_]\w*)\s*\(/g)) found.add(match[1]);
  for (const match of text.matchAll(/public const ([A-Z_]\w*)/g)) found.add(match[1]);
  for (const match of text.matchAll(/public (?:static )?(?:readonly )?(?:\??[A-Za-z_\\]+ )?\$([a-zA-Z_]\w*)/g)) found.add(match[1]);
  if (/extends Model\b/.test(text)) for (const name of MODEL) found.add(name);
  return found;
}

/** The class a file declares, if it declares exactly one. */
function declared(text) {
  const match = text.match(/^(?:final |abstract )?(?:class|interface|trait|enum) ([A-Za-z_]\w*)/m);
  return match?.[1] ?? null;
}

/** short class name → what it answers to, for every class this repository declares. */
const classes = new Map();
for (const { text } of sources) {
  const name = declared(text);
  if (name !== null) classes.set(name, { names: names(text), model: /extends Model\b/.test(text) });
}

/** `private readonly Diary $diary` — the properties a class can reach its collaborators through. */
function collaborators(text) {
  const found = new Map();
  for (const match of text.matchAll(/(?:private|public|protected) (?:readonly )?(?:[A-Za-z_\\]+ )?\$([a-zA-Z_]\w*)/g)) {
    found.set(match[1], null);
  }
  for (const match of text.matchAll(/(?:private|public|protected) (?:readonly )?([A-Za-z_]\w*) \$([a-zA-Z_]\w*)/g)) {
    found.set(match[2], match[1]);
  }
  return found;
}

const findings = [];
let checked = 0;

for (const { path, text } of sources) {
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const properties = collaborators(text);

  for (const match of text.matchAll(/\$this->([a-zA-Z_]\w*)->([a-zA-Z_]\w*)/g)) {
    const [, property, member] = match;
    const type = properties.get(property);
    /* Only a property whose type this repository declares: `$this->app->bind()` is Laravel's, and guessing what
       Laravel answers to is exactly the second opinion this gate must not offer. */
    if (!type || !classes.has(type)) continue;

    const target = classes.get(type);
    checked += 1;

    if (!target.names.has(member)) {
      findings.push({
        path: relative(root, path),
        line: lineOf(match.index),
        message: `\`$${property}\` is a \`${type}\`, and ${type} has no \`${member}\` — called as ${type}::${member}()`,
      });
    }
  }
}

if (findings.length > 0) {
  console.error(`\n${findings.length} call(s) this service cannot answer, in ${checked} checked:\n`);
  for (const finding of findings) console.error(`  ✗ ${finding.path}:${finding.line}  ${finding.message}`);
  console.error('\nThe type is named in the constructor, three lines above the call. A method that is missing there is a\n500 at runtime rather than a failing test, which is how this check came to exist.\n');
  process.exit(1);
}

console.log(`\nphp-calls — ${checked} call(s) through a property whose type this repository declares, all answered.\n`);
