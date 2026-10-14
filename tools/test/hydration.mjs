#!/usr/bin/env node
/**
 * Hydration test — the app's own JavaScript, run against the pages the dev server serves.
 *
 * React renders every page on the server and then hydrates the same markup in the browser. When the two do not
 * agree, React throws the server tree away and renders again from scratch: the page works, but it is slower to
 * become interactive and it costs a console error — and a page whose buttons are dead for the first second is
 * exactly the sort of thing that gets reported as "the button does not work". A clock read while rendering is
 * the classic cause, and it is what this catches.
 *
 * Needs the dev server running (http://127.0.0.1:3000) and two dev-only packages:
 *
 *     npm i --no-save jsdom && npm run test:hydration
 *
 * It is not a browser: jsdom has no layout or CSS engine, so this proves hydration and nothing visual. The CSS
 * side lives in `npm run test:shell` and, later, in the P0 browser checks.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let jsdom;
try {
  jsdom = await import('jsdom');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save jsdom\n\nthen run `npm run test:hydration` again.\n');
  process.exit(2);
}

const BASE = process.env.DIZI_BASE ?? 'http://127.0.0.1:3000';
const ROUTES = ['/', '/patients', '/patients/new', '/appointments', '/clinical', '/diagnostics', '/pharmacy', '/billing', '/inventory', '/reports', '/help'];

const HYDRATION = /hydrat|did not match|server rendered|server-rendered/i;

async function check(route) {
  const { JSDOM, VirtualConsole } = jsdom;
  const problems = [];
  const vc = new VirtualConsole();
  const record = (line) => {
    const text = String(line).slice(0, 400);
    if (HYDRATION.test(text)) problems.push(`hydration: ${text}`);
  };
  vc.on('error', (...args) => record(args.map(String).join(' ')));
  vc.on('jsdomError', (e) => record(e?.message ?? e));

  const dom = await JSDOM.fromURL(`${BASE}${route}`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = (q) => ({
        matches: false,
        media: String(q),
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      });
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      window.scrollTo = () => {};
      // jsdom stops short of a few globals the Next runtime expects.
      const { TextEncoder, TextDecoder } = require('node:util');
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      try {
        window.ReadableStream = require('node:stream/web').ReadableStream;
      } catch {}
      try {
        window.MessageChannel = require('node:worker_threads').MessageChannel;
      } catch {}
      window.queueMicrotask = queueMicrotask;
      window.structuredClone = structuredClone;
      window.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);
      window.cancelIdleCallback = (id) => clearTimeout(id);
    },
  });

  await new Promise((r) => setTimeout(r, 2500));

  // A tree that hydrated has live handlers: prove it by pressing the one control every screen shares.
  const doc = dom.window.document;
  const trigger = doc.getElementById('mobile-nav-trigger');
  let interactive = 'no shared control';
  if (trigger) {
    trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 250));
    interactive = doc.getElementById('mobile-nav-panel') ? 'live' : 'DEAD';
    if (interactive === 'DEAD') problems.push('the drawer did not open after hydration');
  }
  dom.window.close();
  return { problems, interactive };
}

let failed = 0;
console.log(`\nhydration — ${ROUTES.length} routes against ${BASE}\n`);
for (const route of ROUTES) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const { problems, interactive } = await check(route);
    const mark = problems.length ? '✗' : '✓';
    console.log(`  ${mark} ${route.padEnd(18)} handlers=${interactive}`);
    for (const p of problems) {
      console.log(`      ${p}`);
      failed += 1;
    }
  } catch (error) {
    console.log(`  ✗ ${route.padEnd(18)} could not load: ${error.message}`);
    failed += 1;
  }
}

if (failed) {
  console.log(`\n${failed} problem(s)\n`);
  process.exit(1);
}
console.log('\nall routes hydrated with no mismatch\n');
