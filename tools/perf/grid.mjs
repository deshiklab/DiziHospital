#!/usr/bin/env node
/**
 * The grid's performance claim, measured (P0-204).
 *
 * The acceptance line for DataGrid v0 is "renders 100 k rows with < 1 s first page in the perf harness". This is that
 * harness, and it is built to measure the claim rather than to flatter it:
 *
 *   · **A hundred thousand records behind a source.** The grid is handed a window and a total; it never receives the
 *     set. That is *why* the number is small, so the harness counts what the source was asked for as well as timing
 *     the render — a regression that starts materialising the whole register shows up as a memory figure and a
 *     request size long before it shows up as a slow first paint.
 *   · **The real component, in a real window.** The same bundle the correctness harness mounts, rendered with React 19
 *     into jsdom. jsdom has no layout engine, so this is not a painting benchmark: it is the JavaScript the grid does
 *     per page — build the cells, apply the columns, wire the handlers.
 *   · **The development build of React.** Production React cannot be driven by `act`, and it is faster than the dev
 *     build — so a budget that holds here holds with room to spare where it ships. Every number below is therefore a
 *     ceiling on the real one rather than an estimate of it.
 *
 * The budget, in the grid's own terms:
 *
 *   first page        < 1000 ms   the acceptance line
 *   a page turn       <  250 ms   what "the list moves when I click" costs
 *   the export walk   < 6000 ms   a hundred thousand rows, written a thousand at a time, on the thread
 *   rows in the DOM   = pageSize  structural, not a budget: a page is what exists
 *
 * The export deliberately stops at `GRID_EXPORT_LIMIT` (50 000 rows) and says so, so the harness checks both: that the
 * walk reaches the ceiling inside its budget, and that the screen tells the reader it stopped rather than handing over a
 * short file that looks complete.
 *
 * Needs two dev-only packages:
 *
 *     npm i --no-save jsdom esbuild && npm run perf:grid
 *
 * Exit code 0 when every budget holds, 1 when one is missed, 2 when the tooling is missing. The numbers are printed
 * either way, because a harness whose output has to be trusted is a harness nobody reads.
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
  console.error('\nThis test needs two dev-only packages:\n\n    npm i --no-save jsdom esbuild\n\nthen run `npm run perf:grid` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-grid-perf-'));

const budgets = {
  firstPage: 1_000,
  pageTurn: 250,
  exportAll: 6_000,
  rows: 25,
};

const measurements = {};
const failures = [];

const report = (label, value, budget, unit = 'ms') => {
  const ok = value <= budget;
  measurements[label] = value;
  if (!ok) failures.push(`${label} took ${value.toFixed(1)} ${unit} against a budget of ${budget} ${unit}`);
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(26)} ${value.toFixed(1).padStart(8)} ${unit}   budget ${budget} ${unit}`);
};

/* ------------------------------------------------------------------ build the real grid */
const harness = join(work, 'grid-entry.cjs');
await esbuild.build({
  entryPoints: [join(root, 'tools/test/grid-entry.tsx')],
  outfile: harness,
  bundle: true,
  format: 'cjs',
  /* The **development** build of React, on purpose. Production React has no `act`, and it is also the faster of the
     two: a page that renders inside the budget here renders inside it in production with room to spare, which is the
     direction a budget should err in. */
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  absWorkingDir: root,
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});

const { JSDOM } = jsdom;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://dizi.test/perf' });
const { window } = dom;

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'Blob', 'URL']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let written = null;
window.URL.createObjectURL = () => 'blob:perf';
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function click() {
  written = { name: this.download };
};

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
/* The harness bundle is CommonJS, so it is loaded through `require` rather than imported: an ESM import of a CJS file
   hands back the module namespace, whose `default` is the exports object. */
const loaded = require(harness);
const { mount, act, asked } = loaded.mount ? loaded : loaded.default;

const doc = window.document;
const host = doc.getElementById('root');

/**
 * The time this work took on the thread.
 *
 * Measured around the interaction and the settle that follows it, on the high-resolution clock. React schedules by
 * default, so an `act()`-wrapped wall clock would include the scheduler waiting for an idle slot it does not have to
 * wait for in a browser; the busy span is the part a ward's laptop cannot hide.
 */
const busy = async (work) => {
  let elapsed = 0;
  const start = process.hrtime.bigint();
  await act(async () => {
    await work();
    await new Promise((r) => setTimeout(r, 0));
  });
  elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return elapsed;
};

const rowsInDom = () => doc.querySelectorAll('tbody tr[data-row-id]').length;

console.log('\nperf:grid — a hundred thousand records through the real DataGrid\n');

/* ------------------------------------------------------------------ first page */
const firstPage = await busy(async () => {
  mount(host, { scenario: 'huge' });
  await new Promise((r) => setTimeout(r, 0));
});

report('first page', firstPage, budgets.firstPage);

const domRows = rowsInDom();
const rowsOk = domRows === budgets.rows;
if (!rowsOk) failures.push(`${domRows} rows are in the document for a ${budgets.rows}-row page`);
console.log(`  ${rowsOk ? '✓' : '✗'} ${'rows in the document'.padEnd(26)} ${String(domRows).padStart(8)} rows  budget ${budgets.rows} rows`);

const askedOnce = asked.largest === budgets.rows;
if (!askedOnce) failures.push(`the source was asked for ${asked.largest} rows at once, not a page of ${budgets.rows}`);
console.log(`  ${askedOnce ? '✓' : '✗'} ${'largest request'.padEnd(26)} ${String(asked.largest).padStart(8)} rows  budget ${budgets.rows} rows`);

/* ------------------------------------------------------------------ a page turn */
const pageTwo = doc.createElement('button');
pageTwo.textContent = '2';
const turn = await busy(async () => {
  const next = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Next page');
  next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
});

report('a page turn', turn, budgets.pageTurn);

/* ------------------------------------------------------------------ sorting re-reads the source */
const sorted = await busy(async () => {
  const header = Array.from(host.querySelectorAll('th button')).find((b) => b.textContent?.includes('Patient'));
  header.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
});

report('re-sort through the source', sorted, budgets.pageTurn);

/* ------------------------------------------------------------------ the export walk */
const exportButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Export'));
const exported = await busy(async () => {
  exportButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    if ((host.textContent ?? '').includes('Wrote all')) break;
  }
});

report('the export walk', exported, budgets.exportAll);

/* The ceiling is a product decision, not a failure: 50 000 rows is more than anybody opens in a spreadsheet, and the
   point being checked is that the screen *says* it stopped. */
const note = (host.textContent ?? '').match(/Wrote [^.]*\./)?.[0] ?? 'no note';
const saidItStopped = /of 100,000 matching rows/.test(note);
if (!saidItStopped) failures.push(`the export did not say it stopped at its ceiling: ${note}`);
console.log(`  ${saidItStopped ? '✓' : '✗'} the export says how much it wrote  — ${note}`);
console.log(`  · the source served ${asked.calls.toLocaleString()} requests, ${(asked.rows / asked.calls).toFixed(1)} rows on average, ${asked.largest} at most\n`);

rmSync(work, { recursive: true, force: true });

if (failures.length) {
  console.error(`perf:grid — ${failures.length} budget(s) missed\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log('perf:grid — every budget held\n');
process.exit(0);

