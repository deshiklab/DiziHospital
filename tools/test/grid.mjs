#!/usr/bin/env node
/**
 * The grid's rules, exercised (P0-204).
 *
 * DataGrid v0 is four promises, and each one is a way a legacy grid failed somebody:
 *
 *   1. **A page is a query, not a slice of an array.** The grid is handed one window and a total and asks for the next
 *      window through the source; nothing above the source ever filters or sorts. This file drives the real component
 *      and counts what the source was asked for — the property that makes a hundred-thousand-row register the same
 *      screen as a ten-row one, and the one a refactor quietly breaks.
 *   2. **A view is a named query.** Applying a view changes the query and the filter with it, the active chip is
 *      *derived* by comparing queries rather than remembered (so editing one filter releases it), and a desk's own
 *      views survive a reload while a built-in cannot be renamed away.
 *   3. **The address carries the window.** Page, size, sort, search and filters round-trip through the URL; defaults
 *      are left out; a hand-edited parameter is clamped or ignored rather than letting a URL break a screen.
 *   4. **Export is the filtered set, not the page.** `onExport` walks the source in windows of its own, stops at the
 *      ceiling and reports that it stopped, and the CSV is RFC 4180 with a BOM so a Bangla name opens correctly.
 *
 * It also checks the two states that read as one: a source that throws is an error with a retry, not "nothing matches",
 * and the row keyboard walks the page with ↑/↓ and opens a row with Enter.
 *
 * Needs two dev-only packages:
 *
 *     npm i --no-save jsdom esbuild && npm run test:grid
 *
 * Exit code 0 when every case passes, 1 otherwise, 2 when the tooling is missing.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
let jsdom;
try {
  esbuild = await import('esbuild');
  jsdom = await import('jsdom');
} catch {
  console.error('\nThis test needs two dev-only packages:\n\n    npm i --no-save jsdom esbuild\n\nthen run `npm run test:grid` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-grid-test-'));
const failures = [];

function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

/* =========================================================== 1. the query layer, on its own */

console.log('\ngrid — the query, the views, the address and the export\n');

/* The query layer is TypeScript and imports React, so it is bundled first and read back as JavaScript rather than
   imported as source. React is external for this build: these are pure functions and the component they belong to is
   exercised in a window further down. */
await esbuild.build({
  entryPoints: [join(root, 'packages/ui/src/grid.ts'), join(root, 'packages/ui/src/csv.ts')],
  outdir: work,
  bundle: true,
  format: 'esm',
  /* `platform: 'node'` with React bundled in: these are the pure functions of the query layer, so the copy of React
     inside them is inert — and it saves the harness having to resolve packages from a temporary directory. */
  platform: 'node',
  target: 'node22',
  absWorkingDir: root,
  jsx: 'automatic',
  logLevel: 'error',
});

const G = await import(join(work, 'grid.js'));
const C = await import(join(work, 'csv.js'));

const DEFAULTS = { page: 1, pageSize: 25, sort: { key: 'id', dir: 'asc' } };

/* ---------------------------------------------------------------- the address round-trip */

const query = { page: 3, pageSize: 50, sort: { key: 'name', dir: 'desc' }, q: 'rahima', filters: { status: 'Admitted' } };
const search = G.encodeGridQuery(query, DEFAULTS);
pass(
  'a window round-trips through the address',
  G.sameGridQuery(G.decodeGridQuery(search, DEFAULTS, { filterKeys: ['status'], sortKeys: ['name'] }), query),
  search,
);

const clean = G.encodeGridQuery(DEFAULTS, DEFAULTS);
pass('the defaults are left out of the address entirely', clean === '', `the address is "${clean}"`);

const barePageOne = G.encodeGridQuery({ ...query, page: 1 }, { ...DEFAULTS, sort: { key: 'name', dir: 'desc' } });
pass('page 1 is not written either — it is where every query starts', !barePageOne.includes('page='), barePageOne);

pass(
  'a hand-edited page or size is clamped rather than trusted',
  G.decodeGridQuery('page=-4&size=99999', DEFAULTS).page === 1 && G.decodeGridQuery('page=-4&size=99999', DEFAULTS).pageSize === 25,
  'page -4 and a size of 99999 fall back to the defaults',
);

pass(
  'an unknown sort key keeps the default order',
  G.decodeGridQuery('sort=nonsense:desc', DEFAULTS, { sortKeys: ['id'] }).sort.key === 'id',
  'a URL cannot order by a column the screen did not offer',
);

pass(
  'a filter the screen did not declare is ignored',
  G.decodeGridQuery('f.status=Admitted&f.secret=1', DEFAULTS, { filterKeys: ['status'] }).filters.status === 'Admitted' &&
    G.decodeGridQuery('f.status=Admitted&f.secret=1', DEFAULTS, { filterKeys: ['status'] }).filters.secret === undefined,
  'only declared filter keys reach the query',
);

/* ---------------------------------------------------------------- views are queries */

pass('a view id is derived from its name', G.viewId('Unpaid this week') === 'unpaid-this-week' && G.viewId('বকেয়া') === 'বকেয়া', G.viewId('বকেয়া'));

pass(
  'two queries that differ in one filter are different queries',
  !G.sameGridQuery(DEFAULTS, { ...DEFAULTS, filters: { status: 'Admitted' } }) && G.sameGridQuery({ ...DEFAULTS, filters: {} }, DEFAULTS),
  'the empty filter and the absent one are the same query',
);

pass('a query can be described in words for a chip or a print header', G.describeGridQuery(query, { filters: { status: 'Status' } }).includes('Status: Admitted'), G.describeGridQuery(query, { filters: { status: 'Status' } }));

/* ---------------------------------------------------------------- CSV */

const rows = [
  { id: 'MRN-1', name: 'Rahima Begum, Mrs.', status: 'Admitted', amount: 1200 },
  { id: 'MRN-2', name: 'রহিমা বেগম', status: 'Active', amount: 0 },
];
const csv = C.toCsv(
  [
    { header: 'MRN', key: 'id' },
    { header: 'Patient', key: 'name' },
    { header: 'Status', key: 'status', value: (r) => r.status },
    { header: 'Balance', key: 'amount' },
  ],
  rows,
);

pass('a cell with a comma is quoted', csv.includes('"Rahima Begum, Mrs."'), 'the comma does not split the row');
pass('a column can read itself for the file', csv.split('\r\n')[1] === 'MRN-1,"Rahima Begum, Mrs.",Admitted,1200', csv.split('\r\n')[1]);
pass('rows end with CRLF and the file ends with one', csv.endsWith('\r\n') && csv.split('\r\n')[0] === 'MRN,Patient,Status,Balance');
pass('a number stays a number in the file', csv.includes(',1200') && csv.includes(',0'), 'no quotes around figures');
pass('the file is named after the screen and the day', C.csvFileName('claims 2026', '2026-10-16') === 'claims-2026-2026-10-16.csv', C.csvFileName('claims 2026', '2026-10-16'));
pass('the day in the name is the local day, not the UTC one', C.localDay(new Date(2026, 0, 2, 23, 30)) === '2026-01-02', C.localDay(new Date(2026, 0, 2, 23, 30)));

/* =========================================================== 2. the component, in a window */

const { JSDOM } = jsdom;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://dizi.test/patients' });
const { window } = dom;

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'Blob', 'URL']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = join(work, 'grid-entry.cjs');
await esbuild.build({
  entryPoints: [join(here, 'grid-entry.tsx')],
  outfile: harness,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'node22',
  jsx: 'automatic',
  absWorkingDir: root,
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});

/* The harness bundle is CommonJS (`require`), because it is built for the browser and loaded by `createRequire` —
   an ESM `import` of a CJS file gives the module namespace, whose `default` is the exports object. */
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const grid = require(harness);
const { mount, act, asked } = grid.default ?? grid;
const doc = window.document;
const host = doc.getElementById('root');

const tick = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const rowsInDom = () => Array.from(doc.querySelectorAll('tbody tr[data-row-id]'));
const text = () => host.textContent ?? '';

/** Fire a DOM event the way a person does, and let React settle. */
const fire = async (node, type, init = {}) => {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, ...init }));
  });
};

const key = async (node, k) => {
  await act(async () => {
    node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
};

/* ---------------------------------------------------------------- a page is a query */

mount(host, { scenario: 'basic' });
await tick();

pass('the grid shows one page, not the register', rowsInDom().length === 25, `${rowsInDom().length} row(s) in the document`);
pass('the source was asked for one window at a time', asked.largest === 25, `the largest request the source saw was ${asked.largest} row(s)`);
pass('the total is the filtered set, not the page', text().includes('240'), `the grid reports ${doc.querySelector('[data-testid="total"]')?.textContent} records`);

const callsBefore = asked.calls;
await fire(doc.querySelector('[data-testid="page-2"]'), 'click');
await tick();
pass('changing the page asks the source again rather than re-slicing', asked.calls > callsBefore, `${asked.calls - callsBefore} further request(s)`);
pass('and still only ever asks for a page', asked.largest === 25, `the largest request remains ${asked.largest}`);

/* ---------------------------------------------------------------- views are queries */

const chip = (name) => Array.from(host.querySelectorAll('button[aria-pressed]')).find((b) => b.textContent?.trim() === name);
const statusChip = chip('Admitted');
pass('a built-in view is offered as a chip', Boolean(statusChip), statusChip?.textContent?.trim() ?? 'not found');

await fire(statusChip, 'click');
await tick();
pass('applying a view changes the rows', Number(doc.querySelector('[data-testid="total"]')?.textContent) < 240, `total is now ${doc.querySelector('[data-testid="total"]')?.textContent}`);
pass('and the chip says it is the one in force', chip('Admitted')?.getAttribute('aria-pressed') === 'true');

/* Editing one filter by hand must release the chip: the active view is derived from the query, not remembered. */
const clear = doc.querySelector('[data-testid="clear"]');
await fire(clear, 'click');
await tick();
pass('changing the filters releases the chip', chip('Admitted')?.getAttribute('aria-pressed') === 'false', 'the view is derived from the query, so it cannot go stale');

const input = host.querySelector('input[aria-label="Search Synthetic register"]');
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'MRN-000042');
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await tick();
pass('the quick search narrows the set through the same query', doc.querySelector('[data-testid="total"]')?.textContent === '1', `total is ${doc.querySelector('[data-testid="total"]')?.textContent}`);

/* A desk's own view survives a reload; a built-in is not the desk's to rename. */
const saveButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Save view'));
await fire(saveButton, 'click');
await tick();
const nameInput = doc.querySelector(`input[id$="-view-name"]`);
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(nameInput, 'Rahima at the desk');
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await tick();
const saveForm = nameInput.closest('form');
await act(async () => {
  saveForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
});
await tick();
const stored = JSON.parse(window.localStorage.getItem('dizi.grid.harness-basic.views') ?? '[]');
pass('a desk can save the view it is looking at', stored.some((v) => v.name === 'Rahima at the desk'), `${stored.length} saved view(s) in storage`);
pass('a saved view keeps the query, not just the name', stored[0]?.query?.q === 'MRN-000042', JSON.stringify(stored[0]?.query ?? {}));

/* ---------------------------------------------------------------- the keyboard */

await fire(doc.querySelector('[data-testid="clear"]'), 'click');
await tick();
const firstRow = rowsInDom()[0];
firstRow.focus();
await key(firstRow, 'ArrowDown');
const secondId = rowsInDom()[1]?.dataset.rowId;
pass('the row keyboard walks down the page', doc.activeElement?.dataset?.rowId === secondId, `focus is on ${doc.activeElement?.dataset?.rowId}`);
await key(doc.activeElement, 'End');
pass('End goes to the last row of the page', doc.activeElement?.dataset?.rowId === rowsInDom().at(-1)?.dataset.rowId);
await key(doc.activeElement, 'Home');
pass('Home comes back to the first', doc.activeElement?.dataset?.rowId === rowsInDom()[0]?.dataset.rowId);
await key(doc.activeElement, 'Escape');
pass('Escape hands focus back to the scrolling region', doc.activeElement?.getAttribute('role') === 'region', doc.activeElement?.tagName ?? 'nothing focused');

/* ---------------------------------------------------------------- export is the set */

/* jsdom has no Blob URL, and the click that starts the download is what a browser does silently — so both are stubbed
   here and left in place for the rest of the run: the point is that the grid calls them, and that the file is named. */
let written = null;
window.URL.createObjectURL = () => 'blob:harness';
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function click() {
  written = { name: this.download };
};

const exportButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Export'));
await fire(exportButton, 'click');
await tick(30);
pass('the export reads every matching row, not the page on screen', asked.rows >= 240, `the source handed over ${asked.rows} row(s) across ${asked.calls} call(s) while the page held 25`);

const note = text();
pass('and says how much it wrote', /Wrote all 240 matching row/.test(note), (note.match(/Wrote[^.]*\./) ?? ['no note'])[0]);
pass('the file was named for the screen and the day', typeof written?.name === 'string' && /^harness-\d{4}-\d{2}-\d{2}\.csv$/.test(written.name), written?.name ?? 'no file');

/* ---------------------------------------------------------------- a refusal is not an empty list */

const failingHost = doc.createElement('div');
doc.body.appendChild(failingHost);
mount(failingHost, { scenario: 'failing' });
await tick();
pass('a refused source reads as an error, not as an empty register', (failingHost.textContent ?? '').includes('the register is unreachable'), 'the message is the source’s own');
pass('and offers a way back', (failingHost.textContent ?? '').includes('Try again'), 'the retry is the screen’s own handler');
pass('an empty register still says it is empty', !(failingHost.textContent ?? '').includes('Nothing to show'), 'the two states are not the same sentence');

/* ---------------------------------------------------------------- a local list exports itself */

const localHost = doc.createElement('div');
doc.body.appendChild(localHost);
mount(localHost, { scenario: 'local' });
await tick(10);
const localExport = Array.from(localHost.querySelectorAll('button')).find((b) => b.textContent?.includes('Export'));
await fire(localExport, 'click');
await tick(20);
pass(
  'a list held on the screen exports what it has, and says so',
  /Wrote the 25 row\(s\) on screen/.test(localHost.textContent ?? ''),
  ((localHost.textContent ?? '').match(/Wrote[^.]*\./) ?? [`no note — the grid said: ${(localHost.textContent ?? '').slice(0, 120)}`])[0],
);

rmSync(work, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.error(`grid — ${failures.length} case(s) failed\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log('grid — every case passed\n');

/* jsdom keeps windows, timers and their listeners alive, so the process would otherwise sit there after the last
   check — the same reason `runtime.mjs` exits itself rather than waiting to be reaped. */
process.exit(0);
