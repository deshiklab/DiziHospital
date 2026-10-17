#!/usr/bin/env node
/**
 * Shell navigation test — the drawer and the rail, driven for real.
 *
 * Why this exists: the shell has twice shipped a navigation button that was on screen but could not do what it
 * promised. Both times the cause was that the *width the button appeared at* was decided in one place (a
 * Tailwind class list, resolved by stylesheet order) and *what the button did* in another (`window.innerWidth`),
 * with the drawer's own visibility resolved somewhere else again. There is now one decision — `data-nav` on
 * <html>, written by the shell and honoured by globals.css — and this test drives that decision at five widths
 * and pointer types by rendering the real AppShell.
 *
 * It needs `jsdom` and `esbuild`, which the product does not depend on (CI deliberately installs nothing):
 *
 *     npm i --no-save jsdom esbuild && npm run test:shell
 *
 * What it can and cannot see: it runs the components, the state and the CSS class names, so it proves which
 * chrome is rendered, which mode was chosen and that the buttons open and close things. jsdom has no layout
 * engine, so it cannot prove anything about pixels, stacking or what is visible — that is what the stylesheet
 * assertions at the end are for, and what a browser-based check (P0 CI hardening) will add later. Those
 * assertions read whichever server `DIZI_BASE` points at — the dev server or the minified production build — so
 * they match the rule, not its spelling.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** Where the app is served from: the dev server by default, or DIZI_BASE (CI serves a production build). */
const BASE = process.env.DIZI_BASE ?? 'http://127.0.0.1:3000';
const root = join(here, '..', '..');

let jsdom;
let esbuild;
try {
  jsdom = await import('jsdom');
  esbuild = await import('esbuild');
} catch {
  console.error(
    '\nThis test needs two dev-only packages:\n\n    npm i --no-save jsdom esbuild\n\nthen run `npm run test:shell` again.\n',
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ bundle the real shell */
const work = mkdtempSync(join(tmpdir(), 'dizi-shell-test-'));
const bundlePath = join(work, 'shell.bundle.cjs');

await esbuild.build({
  entryPoints: [join(here, 'entry-shell.tsx')],
  outfile: bundlePath,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'node22',
  jsx: 'automatic',
  absWorkingDir: root,
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  alias: {
    'next/link': join(here, 'mocks/next-link.tsx'),
    'next/navigation': join(here, 'mocks/next-navigation.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});

/* ------------------------------------------------------------------ scenarios */
const SCENARIOS = [
  { label: 'phone 390 · touch', width: 390, coarse: true, mode: 'drawer' },
  { label: 'narrow window 900 · mouse', width: 900, coarse: false, mode: 'drawer' },
  { label: 'tablet 1180 · touch', width: 1180, coarse: true, mode: 'drawer' },
  { label: 'desk 1180 · mouse', width: 1180, coarse: false, mode: 'rail' },
  { label: 'desk 1440 · mouse', width: 1440, coarse: false, mode: 'rail' },
];

const failures = [];
const notes = [];
const check = (scenario, condition, message) => {
  if (!condition) failures.push(`${scenario}: ${message}`);
};

/** The width/pointer stub jsdom lacks. It resolves the same queries the app and globals.css ask for. */
function matchMediaStub(width, coarse) {
  return (query) => {
    const q = String(query);
    let matches = false;
    const rem = q.match(/min-width:\s*([\d.]+)rem/);
    const px = q.match(/min-width:\s*(\d+)px/);
    if (rem) matches = width >= Number(rem[1]) * 16;
    else if (px) matches = width >= Number(px[1]);
    else if (/pointer:\s*coarse/.test(q)) matches = coarse;
    else if (/pointer:\s*fine/.test(q)) matches = !coarse;
    else if (/hover:\s*none/.test(q)) matches = coarse;
    else if (/hover:\s*hover/.test(q)) matches = !coarse;
    return {
      matches,
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
  };
}

async function runScenario(scenario) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;

  // jsdom is not a browser: give the app the handful of globals it expects before anything is imported.
  window.matchMedia = matchMediaStub(scenario.width, scenario.coarse);
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.getComputedStyle = window.getComputedStyle.bind(window);

  // Node 22 exposes some of these as getter-only globals, so define rather than assign.
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'getComputedStyle', {
    value: window.getComputedStyle.bind(window),
    configurable: true,
    writable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  delete require.cache[require.resolve(bundlePath)];
  const { mount, act } = require(bundlePath);
  const doc = window.document;

  mount(doc.getElementById('root'));
  act(() => {});

  const click = (el) => {
    act(() => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  /* --- the mode the shell decided, and that the CSS has anchors for each piece of chrome */
  check(scenario.label, doc.documentElement.dataset.nav === scenario.mode, `data-nav is "${doc.documentElement.dataset.nav}", expected "${scenario.mode}"`);
  check(scenario.label, !!doc.querySelector('.dizi-bar'), 'the thumb bar is not rendered');
  check(scenario.label, !!doc.querySelector('aside.dizi-aside'), 'the sidebar is not rendered');
  check(scenario.label, !!doc.querySelector('footer.dizi-footer'), 'the footer is not rendered');
  const railToggle = doc.querySelector('.dizi-rail-toggle');
  check(scenario.label, !!railToggle, 'the rail toggle is not rendered');

  if (scenario.mode === 'drawer') {
    check(scenario.label, !doc.getElementById('mobile-nav-panel'), 'the drawer is open before anyone asked');
    const trigger = doc.getElementById('mobile-nav-trigger');
    check(scenario.label, !!trigger, 'the drawer has no trigger in the bottom bar');
    if (trigger) {
      check(scenario.label, trigger.getAttribute('aria-expanded') === 'false', 'the trigger does not start collapsed');

      click(trigger);
      const panel = doc.getElementById('mobile-nav-panel');
      check(scenario.label, !!panel, 'pressing the bar’s menu button did not open the drawer');
      check(scenario.label, trigger.getAttribute('aria-expanded') === 'true', 'aria-expanded did not follow the drawer');
      check(scenario.label, trigger.getAttribute('aria-controls') === 'mobile-nav-panel', 'aria-controls does not point at the drawer');
      check(scenario.label, doc.body.style.overflow === 'hidden', 'the page behind the drawer still scrolls');
      check(scenario.label, !!doc.querySelector('.dizi-drawer'), 'the drawer container is missing its nav-mode class');
      if (panel) {
        check(scenario.label, panel.querySelectorAll('a').length > 0, 'the drawer carries no navigation links');
      }

      // the same button has to close it again — this is a toggle, not an "open" button
      click(trigger);
      check(scenario.label, !doc.getElementById('mobile-nav-panel'), 'pressing the button a second time did not close the drawer');
      check(scenario.label, doc.body.style.overflow !== 'hidden', 'the scroll lock survived the drawer closing');
      check(scenario.label, trigger.getAttribute('aria-expanded') === 'false', 'aria-expanded stayed true after closing');

      // and so does the drawer's own close control
      click(trigger);
      const close = doc.querySelector('#mobile-nav-panel button[aria-label="Close navigation"]');
      check(scenario.label, !!close, 'the drawer has no close button');
      if (close) {
        click(close);
        check(scenario.label, !doc.getElementById('mobile-nav-panel'), 'the drawer’s own close button did not close it');
      }
    }
    // In drawer mode the rail toggle is hidden by CSS, so it must never be the only way in — the bar is.
    check(scenario.label, !!doc.querySelector('.dizi-bar .dizi-drawer, .dizi-bar'), 'the bar is missing in drawer mode');
  }

  if (scenario.mode === 'rail') {
    const aside = doc.querySelector('aside.dizi-aside');
    const before = aside.className;
    check(scenario.label, before.includes('w-60'), `the sidebar is not expanded to start with (${before})`);
    click(railToggle);
    const half = aside.className;
    check(scenario.label, half.includes('w-16') && !half.includes('w-60'), `pressing the rail toggle did not collapse the sidebar (${half})`);
    check(scenario.label, railToggle.getAttribute('aria-pressed') === 'true', 'the toggle does not report the sidebar as present');
    check(scenario.label, railToggle.getAttribute('aria-label') === 'Expand sidebar', `collapsed, the button should offer to expand (${railToggle.getAttribute('aria-label')})`);
    click(railToggle);
    check(scenario.label, aside.className.includes('w-60'), 'pressing the rail toggle did not expand the sidebar again');
    check(scenario.label, railToggle.getAttribute('aria-label') === 'Collapse sidebar to icons', `expanded, the button should offer to collapse (${railToggle.getAttribute('aria-label')})`);
    check(scenario.label, !doc.getElementById('mobile-nav-panel'), 'a drawer opened on a desk');
  }

  // Every scenario must be able to reach the navigation: either the bar or the rail toggle.
  const reachable = Boolean(doc.getElementById('mobile-nav-trigger')) || Boolean(doc.querySelector('.dizi-rail-toggle'));
  check(scenario.label, reachable, 'nothing on this screen can open the navigation');

  notes.push(`  ${scenario.label.padEnd(26)} mode=${scenario.mode.padEnd(6)} bar=${doc.querySelector('.dizi-bar') ? 'yes' : 'no '}  drawer=${doc.getElementById('mobile-nav-panel') ? 'open' : 'closed'}`);

  window.close();
}

for (const scenario of SCENARIOS) {
  // eslint-disable-next-line no-await-in-loop
  await runScenario(scenario);
}

/* ------------------------------------------------------------------ the stylesheet the mode relies on */
try {
  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  const href = html.match(/href="(\/_next\/static\/css\/[^"]+\.css)/)?.[1];
  if (href) {
    // `next start` serves the minified stylesheet, and the minifier writes the same rules differently:
    // `html[data-nav='drawer']` loses its quotes and `(width >= 64rem)` becomes `(min-width:64rem)`. The check
    // therefore normalises the stylesheet and accepts either spelling — otherwise it only ever passes against
    // the dev server, which is the one place the rules are never minified.
    const css = (await (await fetch(`${BASE}${href}`)).text()).replace(/\[([a-zA-Z-]+)=['"]([^'"]*)['"]\]/g, '[$1=$2]');
    const want = [
      [['.dizi-bar'], 'the bar has no display rule'],
      [['.dizi-drawer'], 'the drawer has no display rule'],
      [['.dizi-aside'], 'the sidebar has no display rule'],
      [['.dizi-rail-toggle'], 'the rail toggle has no display rule'],
      [['.dizi-footer'], 'the footer has no offset rule'],
      [['html[data-nav=drawer]'], 'the drawer override did not survive the build'],
      [['html[data-nav=rail]'], 'the rail override did not survive the build'],
      [['(min-width:64rem)', '(width >= 64rem)'], 'the default breakpoint is not in the built stylesheet'],
    ];
    for (const [markers, message] of want) {
      check('stylesheet', markers.some((m) => css.includes(m)), `${message} (${markers.join(' or ')})`);
    }
    notes.push('  built stylesheet                  mode rules present');
  } else {
    const message = `the page served at ${BASE} has no /_next/static/css link, so the mode rules were not read`;
    if (process.env.DIZI_BASE) check('stylesheet', false, message);
    else notes.push(`  built stylesheet                  NOT checked (no DIZI_BASE; ${message})`);
  }
} catch (error) {
  /* The five scenarios above need no server — they bundle the real shell and render it. The stylesheet
   * assertions do need one, and silently skipping them is how a suite reports green while checking less than it
   * claims: if `DIZI_BASE` was set, somebody has named the app to check and it is not answering, so that is a
   * failure. With no `DIZI_BASE`, the skip is the documented behaviour and stays a note. */
  const message = `the app at ${BASE} could not be read for the stylesheet checks: ${error?.message ?? error}`;
  if (process.env.DIZI_BASE) check('stylesheet', false, message);
  else notes.push(`  built stylesheet                  NOT checked (no DIZI_BASE; ${message})`);
}

rmSync(work, { recursive: true, force: true });

/* ------------------------------------------------------------------ report */
console.log('\nshell navigation — drawer and rail');
console.log('  the five scenarios bundle the real shell and render it (no server needed);');
console.log(`  the stylesheet assertions read ${BASE} and fail if it was named but does not answer\n`);
console.log(notes.join('\n'));
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n${failures.length} check(s) failed\n`);
  process.exit(1);
}
console.log(`\nall checks passed (${SCENARIOS.length} scenarios)\n`);
