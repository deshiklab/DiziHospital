#!/usr/bin/env node
/**
 * Runtime test — the app's own JavaScript, run against the pages the dev server serves.
 *
 * Two things are checked on every route:
 *
 *  1. **Hydration.** React renders each page on the server and then hydrates the same markup in the browser. If
 *     the two disagree, React throws the server tree away and renders again: it works, but it is slower to become
 *     interactive and it costs a console error. A clock read while rendering is the classic cause.
 *  2. **Errors.** Console errors, uncaught exceptions and unhandled promise rejections all fail the run. The
 *     clipboard is deliberately made to *reject* here, because that is what a browser inside an embedded frame
 *     does: any code path that does not handle that rejection shows up as a failure instead of as a crash in
 *     someone's browser overlay. `copyText()` in `@dizi/ui` is built for exactly this and is expected to report
 *     failure rather than throw.
 *
 * Needs a server on `DIZI_BASE` (the dev server on :3000 by default) and one dev-only package:
 *
 *     npm i --no-save jsdom && npm run test:runtime
 *
 * Each route is waited on until the shell reports itself hydrated (`data-nav` on <html>, written by an effect and
 * absent from the server's HTML), with `DIZI_READY_MS` as the ceiling — twenty seconds, because a cold `next dev`
 * compiles a route on its first request and four at once can be slow. A route that reaches the ceiling is reported
 * as a problem instead of as a dead button.
 *
 * Routes are checked a few at a time (`DIZI_CONCURRENCY`, four by default): each one is an independent page load
 * in its own jsdom, and thirty of them one after another is fifteen minutes — fine on a workstation, too long for
 * CI, where a job that overruns is killed mid-run and reported as a cancellation rather than as a failure. The
 * output is still printed in route order, so a diff of two runs reads the same as before.
 *
 * jsdom has no layout or CSS engine, so nothing here is a visual check; that is `npm run test:shell` and, later,
 * the P0 browser checks.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let jsdom;
try {
  jsdom = await import('jsdom');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save jsdom\n\nthen run `npm run test:runtime` again.\n');
  process.exit(2);
}

const BASE = process.env.DIZI_BASE ?? 'http://127.0.0.1:3000';
const ROUTES = [
  '/',
  '/patients',
  '/patients/SH-102311',
  '/patients/new',
  '/patients/import',
  '/patients/discharged',
  '/appointments',
  '/appointments/queue',
  '/clinical',
  '/ward',
  '/round',
  '/duty',
  '/ot',
  '/bloodbank',
  '/ambulance',
  '/diagnostics',
  '/diagnostics/search',
  '/pharmacy',
  '/pharmacy/search',
  '/pharmacy/returns',
  '/billing',
  '/billing/opd',
  '/billing/opd-patient',
  '/billing/appointments',
  '/billing/modules',
  '/inventory',
  '/setup',
  '/reports',
  '/sync',
  '/help',
];

const HYDRATION = /hydrat|did not match|server rendered|server-rendered/i;
/** Noise that comes from jsdom itself, not from the app. */
const IGNORE = [/Could not parse CSS stylesheet/i, /Error: Not implemented: (window\.print|document\.execCommand)/i];

const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(String(reason).slice(0, 300)));

async function check(route) {
  const { JSDOM, VirtualConsole } = jsdom;
  const errors = [];
  const routeProblems = [];
  const vc = new VirtualConsole();
  const record = (line) => {
    const text = String(line).replace(/\s+/g, ' ').slice(0, 300);
    if (!text || IGNORE.some((re) => re.test(text))) return;
    if (!errors.includes(text)) errors.push(text);
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
      // A frame without clipboard permission: `writeText` rejects, exactly as in the preview.
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new window.DOMException('The request is not allowed', 'NotAllowedError')),
          readText: () => Promise.reject(new window.DOMException('The request is not allowed', 'NotAllowedError')),
        },
      });
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
      window.requestIdleRequest = undefined;
      window.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);
      window.cancelIdleCallback = (id) => clearTimeout(id);
    },
  });

  const doc = dom.window.document;
  const press = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  /* Wait for hydration, not for a stopwatch.
   *
   * The shell sets `data-nav` on <html> from an effect, and the server's HTML never carries it — so the attribute
   * appearing is the app's own signal that the tree is hydrated and the handlers are attached, rather than a guess
   * about how long that takes. A fixed sleep is what made this harness flaky against `next dev`, which compiles a
   * route on its first request: four routes at once, and the check was pressing a button whose handler had not
   * been attached yet. Against a prebuilt server it returns in well under a second. */
  const readyMs = Number(process.env.DIZI_READY_MS ?? 20_000);
  const readyStarted = Date.now();
  while (!doc.documentElement.dataset.nav && Date.now() - readyStarted < readyMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const readyWait = Date.now() - readyStarted;
  if (!doc.documentElement.dataset.nav) {
    routeProblems.push(`the shell never hydrated: data-nav did not appear within ${Math.round(readyMs / 1000)}s`);
  }

  // A tree that hydrated has live handlers: press the one control every screen shares.
  const trigger = doc.getElementById('mobile-nav-trigger');
  let handlers = 'no shared control';
  if (trigger) {
    press(trigger);
    await new Promise((r) => setTimeout(r, 200));
    handlers = doc.getElementById('mobile-nav-panel') ? 'live' : 'DEAD';
  }

  // Exercise a copy action if this screen exposes one: the clipboard rejects here, so this is the path that
  // produced an error overlay in the preview when the promise was not handled.
  let copy = 'n/a';
  const menuTriggers = [...doc.querySelectorAll('button')].filter((b) => /row actions|actions for|open menu/i.test(b.getAttribute('aria-label') ?? ''));
  if (menuTriggers.length) {
    press(menuTriggers[0]);
    await new Promise((r) => setTimeout(r, 150));
    const item = [...doc.querySelectorAll('button, [role="menuitem"]')].find((b) => /copy (mrn|visit id|phone)/i.test(b.textContent ?? ''));
    if (item) {
      press(item);
      await new Promise((r) => setTimeout(r, 300));
      copy = 'pressed';
    } else {
      copy = 'no copy action in menu';
    }
  }

  // The sync console runs the outage drill from this harness. The verdict it prints is the plan's exit criterion,
  // so it is asserted rather than eyeballed — and the click goes through the real engine, not a stub.
  let drill = 'n/a';
  if (route === '/sync') {
    const run = [...doc.querySelectorAll('button')].find((b) => /run the drill/i.test(b.textContent ?? ''));
    if (!run) {
      drill = 'NO BUTTON';
      routeProblems.push('the outage drill button is not on the sync console');
    } else {
      press(run);
      await new Promise((r) => setTimeout(r, 400));
      drill = /No writes lost across the outage/.test(doc.body.textContent ?? '') ? 'passed' : 'FAILED';
      if (drill === 'FAILED') routeProblems.push('the outage drill did not report zero lost writes');
    }
  }

  await new Promise((r) => setTimeout(r, 300));
  dom.window.close();
  return { errors: [...errors, ...routeProblems], handlers, copy, drill, readyWait };
}

const CONCURRENCY = Math.max(1, Number(process.env.DIZI_CONCURRENCY ?? 4));
const startedAt = Date.now();

let problems = 0;
console.log(`\nruntime — ${ROUTES.length} routes against ${BASE} (${CONCURRENCY} at a time)\n`);

/** Run `worker` over `items`, at most `CONCURRENCY` at a time, preserving the order of the results. */
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i]) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/* Warm the routes before checking them.
 *
 * `next dev` compiles a route the first time it is asked for, and that compile is by far the slowest part of a
 * cold run — `/help` alone took over two minutes under four concurrent page loads, all of it compilation. Warming
 * with plain fetches moves that cost out of the hydrated pass, so what follows measures hydration and errors
 * rather than the compiler, and a first run after a restart is not twenty minutes long. Against a prebuilt server
 * this costs a few hundred milliseconds and stays silent. */
const warmStarted = Date.now();
await pool(ROUTES, async (route) => {
  try {
    await fetch(`${BASE}${route}`, { redirect: 'follow' });
  } catch {
    // A route that will not load at all is reported by the check itself, with the error the page load produced.
  }
});
const warmMs = Date.now() - warmStarted;
if (warmMs > 2000) console.log(`  warmed ${ROUTES.length} routes in ${(warmMs / 1000).toFixed(1)}s (the server compiles on first request)\n`);

const outcomes = await pool(ROUTES, check);
outcomes.forEach((outcome, i) => {
  const route = ROUTES[i];
  if (!outcome.ok) {
    console.log(`  ✗ ${route.padEnd(22)} could not load: ${outcome.error.message}`);
    problems += 1;
    return;
  }
  const { errors, handlers, copy, drill, readyWait } = outcome.value;
  const bad = errors.length > 0 || handlers === 'DEAD';
  const slow = readyWait !== undefined && readyWait > 2000 ? `  ready=${(readyWait / 1000).toFixed(1)}s` : '';
  console.log(`  ${bad ? '✗' : '✓'} ${route.padEnd(22)} handlers=${handlers}  copy=${copy}${drill === 'n/a' ? '' : `  drill=${drill}`}${slow}`);
  if (handlers === 'DEAD') {
    console.log('      the shared control did not respond after hydration');
    problems += 1;
  }
  for (const e of errors.slice(0, 6)) {
    console.log(`      ${e}`);
    problems += 1;
  }
  if (errors.length > 6) {
    console.log(`      … ${errors.length - 6} more`);
    problems += 1;
  }
});

for (const u of unhandled) {
  console.log(`  ✗ unhandled rejection: ${u}`);
  problems += 1;
}

if (problems) {
  console.log(`\n${problems} problem(s) — ${ROUTES.length} routes in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.exit(1);
}
console.log(`\nno console errors, no uncaught exceptions, no unhandled rejections — ${ROUTES.length} routes in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
// Exit explicitly: jsdom keeps windows and timers alive after a check finishes, so the process would otherwise
// print its verdict and then sit there until something outside killed it — which is what turned a fifty-second
// run into a fifteen-minute timeout, and, in CI, into a cancelled job rather than a pass or a failure.
process.exit(0);
