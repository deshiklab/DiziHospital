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
import { readFileSync as readJson } from 'node:fs';
import { dirname as dirOf, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/* The generated contract projection, so the queue can be checked against the API rather than against a list kept
 * in this file: every queued write has to name an operation the contract actually declares. */
const REPO = resolvePath(dirOf(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = JSON.parse(readJson(resolvePath(REPO, 'packages/contracts/dist/capabilities.json'), 'utf8'));

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
  '/finance',
  '/finance/income',
  '/finance/expenses',
  '/finance/tpa',
  '/finance/referral',
  '/setup',
  '/setup/finance',
  '/setup/referral-commission',
  '/reports',
  '/reports/schedules',
  '/reports/finance',
  '/reports/tpa',
  '/reports/patient',
  '/reports/appointment',
  '/reports/opd',
  '/reports/ipd',
  '/reports/pathology',
  '/reports/birth_death',
  '/sync',
  '/admin',
  '/admin/staff',
  '/admin/staff/attendance',
  '/admin/payroll',
  '/admin/attendance',
  '/admin/attendance/settings',
  '/admin/visitors',
  '/admin/holiday',
  '/admin/printing',
  '/admin/printing/designer',
  '/admin/birthordeath',
  '/admin/birthordeath/death',
  '/admin/multibranch',
  '/admin/multibranch/branches',
  '/admin/multibranch/report',
  '/admin/setup/visitors',
  '/admin/setup/appointment',
  '/admin/setup/zoom',
  '/admin/setup/human-resource',
  '/admin/setup/custom-fields',
  // P8 — communication, content, records, the portal and the public site.
  '/admin/comms',
  '/admin/live/consultation',
  '/admin/live/meeting',
  '/admin/content/upload',
  '/admin/content/types',
  '/admin/content/shared',
  '/admin/certificates',
  '/admin/id-cards/staff',
  '/admin/id-cards/patient',
  '/admin/surveys',
  '/admin/surveys/mine',
  '/admin/website',
  '/admin/messaging',
  '/portal',
  '/portal/visits',
  '/portal/visits/ap-3',
  '/portal/visits/ap-6',
  '/portal/visits/not-a-visit',
  '/portal/reports',
  '/portal/reports/rs-2',
  '/portal/reports/rs-5',
  '/portal/reports/not-a-report',
  '/portal/prescriptions',
  '/portal/bills',
  '/portal/payments',
  '/portal/feedback',
  '/site',
  '/site/about',
  '/site/news/blood-donation-camp',
  '/print',
  '/print/receipt',
  '/print/birth-record',
  '/print/death-record',
  '/print/payslip',
  '/print/attendance-sheet',
  '/print/visitor-badge',
  '/print/imaging-report',
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

  /* P0-306: the queue survives a reload.
   *
   * The strongest way to check that a saved queue is read back is to plant one *before* the page's scripts run and
   * then look for it on screen. A stub that asserted "localStorage was read" would pass while the console rendered
   * an empty queue, and an empty queue after a reload is exactly the failure the ticket is about. */
  const seeded = route === '/sync';
  /* A branch that has published a receipt layout: planted before the print page's scripts run, so what is checked is
   * that the printed document really is the published layout rather than that a function was called. */
  const seededLayout = route === '/print/receipt';
  const SEEDED_LAYOUT = {
    id: 'receipt',
    name: 'Money receipt',
    paper: 'thermal-80',
    version: 3,
    publishedAt: '2026-09-14',
    publishedBy: 'S. Nahar, system administrator',
    updatedAt: '2026-09-14',
    updatedBy: 'S. Nahar, system administrator',
    blocks: [
      { id: 'b-hospital', kind: 'hospital', x: 3, y: 3, w: 74, h: 16, bold: true },
      { id: 'b-1', kind: 'patient', x: 3, y: 24, w: 74, h: 14, field: 'patient.identity', size: 'sm' },
      { id: 'b-2', kind: 'table', x: 3, y: 42, w: 74, h: 40, field: 'invoice.lines', rows: 5, size: 'sm' },
      { id: 'b-footer', kind: 'footer', x: 3, y: 288, w: 74, h: 6, size: 'sm' },
    ],
  };
  const SEEDED_OPERATION = {
    id: 'edge-a:7',
    nodeId: 'edge-a',
    seq: 7,
    at: '2026-10-14 10:05',
    entity: 'patient.demographic',
    recordId: 'SH-200311',
    label: 'Register Halima Begum at the desk',
    operationId: 'createPatient',
    op: 'append',
    fields: { name: 'Halima Begum', phone: '01711223344' },
    queuedAt: '2026-10-14 10:05',
    actor: 'Reception',
    node: 'OPD desk',
  };

  const dom = await JSDOM.fromURL(`${BASE}${route}`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (seededLayout) {
        try {
          window.localStorage.setItem('dizi.print.layouts', JSON.stringify({ receipt: SEEDED_LAYOUT }));
        } catch {
          // jsdom without storage: the check below reports it rather than passing quietly.
        }
      }
      if (seeded) {
        try {
          window.localStorage.setItem(
            'dizi.outbox.v1',
            JSON.stringify({
              version: 1,
              nodeId: 'edge-a',
              seq: 7,
              pending: [SEEDED_OPERATION],
              conflicts: [],
              blocks: [],
              local: {},
              confirmed: {},
              results: [],
            }),
          );
        } catch {
          // jsdom without storage: the check below reports it rather than passing quietly.
        }
      }
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
   * Each shell sets `data-shell` on <html> from an effect, and the server's HTML never carries it — so the
   * attribute appearing is the app's own signal that the tree is hydrated and the handlers are attached, rather
   * than a guess about how long that takes. It used to be the staff shell's `data-nav`, which meant every portal
   * and public-site route was reported as a page that never hydrated: those shells have no navigation rail, and a
   * check that waits on one shell's marker reads the other two as failures. A fixed sleep is what made this harness flaky against `next dev`, which compiles a
   * route on its first request: four routes at once, and the check was pressing a button whose handler had not
   * been attached yet. Against a prebuilt server it returns in well under a second. */
  const readyMs = Number(process.env.DIZI_READY_MS ?? 20_000);
  const readyStarted = Date.now();
  while (!doc.documentElement.dataset.shell && Date.now() - readyStarted < readyMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const readyWait = Date.now() - readyStarted;
  const shell = doc.documentElement.dataset.shell;
  if (!shell) {
    routeProblems.push(`the shell never hydrated: data-shell did not appear within ${Math.round(readyMs / 1000)}s`);
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

  /* The cash book's headline claim, driven rather than asserted by hand: a receipt taken on this device is in a
   * drawer and not yet in the ledger, so the day's verdict has to move from "agrees" to "explained" — and name
   * the voucher that moved it. This goes through the page and the contract, not through a helper called here. */
  let ledger = 'n/a';
  if (route === '/finance') {
    const open = [...doc.querySelectorAll('button')].find((b) => /record a counter receipt/i.test(b.textContent ?? ''));
    if (!open) {
      ledger = 'NO BUTTON';
      routeProblems.push('the counter-receipt button is missing from the finance overview');
    } else {
      press(open);
      await new Promise((r) => setTimeout(r, 250));
      const post = [...doc.querySelectorAll('button')].find((b) => /^post the voucher$/i.test((b.textContent ?? '').trim()));
      if (!post) {
        ledger = 'NO SHEET';
        routeProblems.push('the receipt sheet did not open with a post button');
      } else {
        press(post);
        await new Promise((r) => setTimeout(r, 400));
        const text = doc.body.textContent ?? '';
        const verdict = /Explained by the queue/i.test(text) ? 'explained' : /Investigate — the queue/i.test(text) ? 'investigate' : /Every counter agrees/i.test(text) ? 'still agrees' : 'no verdict';
        const named = /queued on this device/i.test(text);
        ledger = `${verdict}${named ? ' named' : ' unnamed'}`;
        if (verdict !== 'explained') routeProblems.push(`posting a receipt left the reconciliation saying “${verdict}”`);
        if (!named) routeProblems.push('the queued receipt is not reported on the screen it was taken on');
      }
    }
  }

  /* Setup › Finance's headline job, driven: a billing category no income head collects is revenue that lands in
   * “other operating income” and reads as missing documents at day end. The screen has to show the gap, and closing
   * it has to be a thing a person can do here — a category given a head stops being a gap on the same screen. */
  let heads = 'n/a';
  if (route === '/setup/finance') {
    const buttonBy = (re) => [...doc.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()));
    const textOf = () => doc.body.textContent ?? '';

    const gapFirst = /has no income head/.test(textOf());
    const decide = buttonBy(/^Decide where it lands?$/);
    if (!decide) {
      heads = 'NO GAP';
      routeProblems.push('the category-coverage gap is not reported on Setup › Finance');
    } else {
      press(decide);
      await new Promise((r) => setTimeout(r, 300));
      const unmapped = /No head collects it/.test(textOf());
      const trigger = [...doc.querySelectorAll('button')].find((b) => /^Actions for record Radiology$/.test(b.getAttribute('aria-label') ?? ''));
      if (!unmapped) {
        heads = 'NO GAP ROW';
        routeProblems.push('the coverage list does not say which category has no head');
      } else if (!trigger) {
        heads = 'NO ROW ACTION';
        routeProblems.push('an unmapped category offers no way to give it a head');
      } else {
        press(trigger);
        await new Promise((r) => setTimeout(r, 200));
        const give = [...doc.querySelectorAll('button, [role="menuitem"]')].find((b) => /^Give it its own head$/.test((b.textContent ?? '').trim()));
        if (!give) {
          heads = 'NO MENU ITEM';
          routeProblems.push('the unmapped row does not offer its own head');
        } else {
          press(give);
          await new Promise((r) => setTimeout(r, 300));
          // The form opens with the head that would collect it, its category already chosen.
          const prefilled = /INC-IMAG/.test(textOf());
          const chipOn = [...doc.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent ?? '').trim() === 'Radiology');
          const create = buttonBy(/^Create the head$/);
          if (!create || !prefilled || !chipOn) {
            heads = `NO FORM (${prefilled ? 'prefilled' : 'EMPTY'}${chipOn ? ' · chip on' : ' · chip off'})`;
            routeProblems.push('“Give it its own head” did not open a form for a head that collects the category');
          } else {
            press(create);
            await new Promise((r) => setTimeout(r, 400));
            const saved = /INC-IMAG saved/.test(textOf());
            // The gap closes on the screen that reported it, because coverage is read from the drafts here.
            const closed = !/has no income head/.test(textOf()) && /One head collects it/.test(textOf());
            heads = `${gapFirst ? 'gap shown' : 'NO BANNER'} · ${saved ? 'INC-IMAG saved' : 'NOT SAVED'} · ${closed ? 'gap closed' : 'STILL OPEN'}`;
            if (!saved) routeProblems.push('creating the head did not save it (the toast never said so)');
            if (!closed) routeProblems.push('the coverage gap did not close on the screen that reported it');
          }
        }
      }
    }
  }

  /* A saved view is the point of a report screen, so it is pressed: the laboratory's “Awaiting a result” view has
   * to keep fewer rows than the whole table and keep the ones it claims to. A chip that does nothing is a chip
   * nobody presses twice. */
  let viewPress = 'n/a';
  if (route === '/reports/pathology') {
    const textOf = () => doc.body.textContent ?? '';
    const chip = [...doc.querySelectorAll('button[aria-pressed]')].find((b) => (b.textContent ?? '').trim() === 'Awaiting a result');
    const rowsBefore = doc.querySelectorAll('tbody tr').length;
    if (!chip) {
      viewPress = 'NO CHIP';
      routeProblems.push('the pathology report has no “Awaiting a result” saved view');
    } else {
      chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const rowsAfter = doc.querySelectorAll('tbody tr').length;
      const on = [...doc.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent ?? '').trim() === 'Awaiting a result');
      const explained = /Awaiting a result —/.test(textOf());
      const back = [...doc.querySelectorAll('button[aria-pressed]')].find((b) => (b.textContent ?? '').trim() === 'Everything');
      if (back) back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const restored = doc.querySelectorAll('tbody tr').length === rowsBefore;
      viewPress = `${rowsBefore}→${rowsAfter} rows · ${on ? 'pressed' : 'NOT PRESSED'} · ${explained ? 'explained' : 'NO HINT'} · ${restored ? 'back to everything' : 'STUCK'}`;
      if (!on || !explained) routeProblems.push('the saved view did not take effect');
      if (!restored) routeProblems.push('the report did not come back to the full table');
    }
  }

  /* The report suite's headline claim, driven on a report screen: switching the scope from every branch to one
   * branch has to do what the framework says it does — read that branch's own records, and where a branch cannot
   * answer at all, say so rather than print a row of zeros. A promise that only lives in a comment is a promise
   * nobody has read. */
  let suite = 'n/a';
  if (route === '/reports/finance') {
    const buttonBy = (re) => [...doc.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()));
    const textOf = () => doc.body.textContent ?? '';
    /* The scope switch is a real radio group — arrow keys and a screen reader both work on it — so it is driven the
       way a keyboard user drives it, by its own input rather than by a styled label that only looks pressable. */
    const chooseScope = (label) => {
      const input = [...doc.querySelectorAll('input[type="radio"][name="report-scope"]')].find(
        (i) => (i.closest('label')?.textContent ?? '').trim() === label,
      );
      if (!input) return false;
      input.click();
      return true;
    };

    const consolidated = /Consolidated — /.test(textOf());
    const uttara = chooseScope('Uttara');
    if (!consolidated) {
      suite = 'NO RECONCILIATION';
      routeProblems.push('the report does not say how its consolidated column was arrived at');
    } else if (!uttara) {
      suite = 'NO SCOPE SWITCH';
      routeProblems.push('the report has no per-branch scope switch');
    } else {
      await new Promise((r) => setTimeout(r, 350));
      const refused = /Uttara Branch cannot answer this report/i.test(textOf()) && /not a share of another branch’s till/i.test(textOf());
      const scoped = /Uttara Branch alone, read from its own records/.test(textOf());
      chooseScope('All');
      await new Promise((r) => setTimeout(r, 350));
      const restored = /Consolidated — /.test(textOf());
      const back = buttonBy(/^All$/);
      suite = `${refused ? 'refused with a reason' : 'NO REASON'} · ${scoped ? 'branch scope' : 'NO BRANCH SCOPE'} · ${restored ? 'consolidated again' : 'STUCK'}`;
      if (!refused) routeProblems.push('a branch with no ledger of its own was shown a figure anyway');
      if (!scoped) routeProblems.push('a branch scope did not read that branch’s own records');
      if (!restored) routeProblems.push('the report did not come back to the consolidated view');
      if (back) back.blur();
    }
  }

  /* The claim pipeline's headline claim, driven the same way: a refusal is refused *with the payer's own rule*,
   * and an accepted claim moves out of Draft and into the device's own queue. A preview that only renders a status
   * column can demonstrate neither. */
  let claims = 'n/a';
  if (route === '/finance/tpa') {
    const chip = (re) => [...doc.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
    const toastText = () => [...doc.querySelectorAll('[role="status"], [role="alert"], li')].map((n) => n.textContent ?? '').join(' ');
    const pressChip = (re) => {
      const button = chip(re);
      if (button) press(button);
      return Boolean(button);
    };

    // 1. An interim estimate is refused, and the refusal quotes the payer's rule rather than an error code.
    if (!pressChip(/^Awaiting pre-authorisation$/)) {
      claims = 'NO VIEW';
      routeProblems.push('the “Awaiting pre-authorisation” saved view is missing from the claim register');
    } else {
      await new Promise((r) => setTimeout(r, 300));
      // The sheet offers submission for the states it is allowed in, so the row is chosen by state rather than by
      // position: only an approved pre-authorisation is a claim the desk may try to send.
      const rows = [...doc.querySelectorAll('tbody tr')];
      const firstRow = rows.find((r) => /Pre-auth approved/.test(r.textContent ?? '')) ?? rows[0];
      if (!firstRow) {
        claims = 'NO ROWS';
        routeProblems.push('the pre-authorisation view rendered no rows');
      } else {
        press(firstRow);
        await new Promise((r) => setTimeout(r, 250));
        const submit = [...doc.querySelectorAll('button')].find((b) => /^submit the claim$/i.test((b.textContent ?? '').trim()));
        if (!submit) {
          claims = 'NO SUBMIT';
          routeProblems.push('an interim claim cannot be submitted from its sheet — the refusal is the screen');
        } else {
          press(submit);
          await new Promise((r) => setTimeout(r, 350));
          const refused = /Refused — This is an interim estimate/i.test(toastText());
          // 2. A draft claim is submitted: it stays in the register — an answer from the payer closes it — but it is
          //    no longer a draft, and the write is in the queue under the contract's operation name.
          const close = [...doc.querySelectorAll('button')].find((b) => /^close$/i.test((b.textContent ?? '').trim()));
          if (close) press(close);
          pressChip(/^Open register$/);
          await new Promise((r) => setTimeout(r, 300));
          const openRows = [...doc.querySelectorAll('tbody tr')];
          const draftRow = openRows.find((r) => /Draft/.test(r.textContent ?? '')) ?? openRows[0];
          const claimNo = (draftRow?.textContent ?? '').match(/CL-\d+-\d+/)?.[0] ?? '';
          if (!draftRow) {
            claims = refused ? 'refused · NO DRAFT ROW' : 'NO DRAFT ROW';
            routeProblems.push('the open register rendered no rows');
          } else {
            press(draftRow);
            await new Promise((r) => setTimeout(r, 250));
            const send = [...doc.querySelectorAll('button')].find((b) => /^submit the claim$/i.test((b.textContent ?? '').trim()));
            if (!send) {
              claims = refused ? 'refused · NO SUBMIT' : 'NO SUBMIT';
              routeProblems.push('a draft claim cannot be submitted from the register');
            } else {
              press(send);
              await new Promise((r) => setTimeout(r, 400));
              // The write has to reach the saved queue under the operation the contract declares: a status that
              // only changes on screen is a status a reload loses.
              let queued = 0;
              try {
                const saved = JSON.parse(dom.window.localStorage.getItem('dizi.outbox.v1') ?? 'null');
                queued = (Array.isArray(saved?.pending) ? saved.pending : []).filter((op) => op.operationId === 'submitClaim' && op.recordId === claimNo).length;
              } catch {
                queued = -1;
              }
              const close = [...doc.querySelectorAll('button')].find((b) => /^close$/i.test((b.textContent ?? '').trim()));
              if (close) press(close);
              await new Promise((r) => setTimeout(r, 300));
              const named = /submitted — ৳/.test(toastText());
              // And it is a claim, not a draft: it stays in the register, because an answer from the payer is what
              // closes it — but its state has moved on, which is what the desk reads.
              const row = [...doc.querySelectorAll('tbody tr')].find((r) => (r.textContent ?? '').includes(claimNo));
              const moved = /Submitted/.test(row?.textContent ?? '');
              claims = `${refused ? 'refused' : 'NO REFUSAL'} · ${claimNo} ${moved ? 'submitted' : 'STILL Draft'}${queued === 1 ? ' · queued as submitClaim' : ` · queued=${queued}`}${named ? ' · named' : ''}`;
              if (!refused) routeProblems.push('submitting an interim estimate was allowed — a claim is filed against a bill, not an estimate');
              if (!moved) routeProblems.push(`submitting ${claimNo} left it reading “Draft” in the register`);
              if (queued !== 1) routeProblems.push(`the submitted claim did not reach the saved queue as \`submitClaim\` (${queued} matching operations) — P0-306 keeps the queue on the device`);
            }
          }
        }
      }
    }
  }

  // Did the saved queue come back, and is the contract the thing refusing what cannot be queued?
  let queue = 'n/a';
  if (seeded) {
    const text = doc.body.textContent ?? '';
    const found = text.includes('edge-a:7') && text.includes('createPatient') && text.includes('Halima Begum');
    queue = found ? 'rehydrated' : 'LOST';
    if (!found) {
      routeProblems.push('a queue saved on the device was not read back — P0-306 says it survives a reload');
    }
  }

  /* The other half of the round trip: a write made in the page has to *reach* storage, or the check above would
   * pass on a saved queue that this build can read but never writes. */
  let persist = 'n/a';
  if (seeded) {
    const register = [...doc.querySelectorAll('button')].find((b) => /the contract names the operation/i.test(b.textContent ?? ''));
    if (!register) {
      persist = 'NO BUTTON';
      routeProblems.push('the contract-driven registration button is not on the sync console');
    } else {
      press(register);
      await new Promise((r) => setTimeout(r, 300));
      try {
        const saved = JSON.parse(dom.window.localStorage.getItem('dizi.outbox.v1') ?? 'null');
        const queued = Array.isArray(saved?.pending) ? saved.pending : [];
        const named = queued.filter((op) => op.operationId === 'createPatient');
        persist = named.length === 2 ? 'saved (2 named writes)' : `saved=${queued.length} named=${named.length}`;
        if (named.length !== 2) {
          routeProblems.push(`a write made in the page did not reach the saved queue (${persist}) — P0-306 keeps the queue on the device`);
        }
      } catch (error) {
        persist = 'UNREADABLE';
        routeProblems.push(`the saved queue could not be read after a write: ${error.message}`);
      }
    }
  }

  /* Every queued write has to name an operation the contract declares. This is the difference between a queue a
   * drain can send and a queue of prose: an unnamed write has nothing to replay as, and the last unnamed writes in
   * the product were the ones this ticket is about. */
  let named = 'n/a';
  if (seeded) {
    const press_ = (re) => {
      const button = [...doc.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
      if (button) press(button);
      return Boolean(button);
    };
    press_(/take a cash payment/i);
    press_(/add a nursing note/i);
    await new Promise((r) => setTimeout(r, 300));
    try {
      const queued = JSON.parse(dom.window.localStorage.getItem('dizi.outbox.v1') ?? 'null')?.pending ?? [];
      const unnamed = queued.filter((op) => !op.operationId || !CONTRACT.operations[op.operationId]);
      named = `${queued.length - unnamed.length}/${queued.length}`;
      if (queued.length < 3 || unnamed.length > 0) {
        routeProblems.push(
          `${unnamed.length} of ${queued.length} queued write(s) do not name an operation the contract declares` +
            (unnamed.length ? ` (${unnamed.map((op) => op.operationId ?? '(none)').join(', ')})` : ''),
        );
      }
    } catch (error) {
      named = 'UNREADABLE';
      routeProblems.push(`the saved queue could not be read for the naming check: ${error.message}`);
    }
  }

  /* A refusal, and the desk sending it again. The other branch takes bed A-19 first, so the claim on it is refused
   * for a reason a person can act on — and retrying is a button, not a loop. The retry has to arrive as a new
   * operation: the old id was spent on the refusal. */
  let retry = 'n/a';
  if (seeded) {
    const pressText = (re) => {
      const button = [...doc.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
      if (button) press(button);
      return Boolean(button);
    };
    pressText(/take the same bed/i);
    await new Promise((r) => setTimeout(r, 150));
    pressText(/admit into bed A-19/i);
    await new Promise((r) => setTimeout(r, 150));
    const before = JSON.parse(dom.window.localStorage.getItem('dizi.outbox.v1') ?? 'null')?.pending ?? [];
    const claim = before.find((op) => op.operationId === 'claimBed');
    if (!claim) {
      retry = 'NO CLAIM';
      routeProblems.push('the bed claim was not queued, so the refusal could not be exercised');
    } else {
      pressText(/^\s*drain the queue/i);
      await new Promise((r) => setTimeout(r, 300));
      const refused = /Already held by/i.test(doc.body.textContent ?? '');
      const again = [...doc.querySelectorAll('button')].find((b) => /queue it again/i.test(b.textContent ?? ''));
      if (!refused || !again) {
        retry = refused ? 'NO RETRY BUTTON' : 'NOT REFUSED';
        routeProblems.push(refused ? 'a refused write has no way to be sent again' : 'the exclusive claim was not refused with the holder named');
      } else {
        press(again);
        await new Promise((r) => setTimeout(r, 300));
        const after = JSON.parse(dom.window.localStorage.getItem('dizi.outbox.v1') ?? 'null')?.pending ?? [];
        const resent = after.filter((op) => op.operationId === 'claimBed');
        const fresh = resent.some((op) => op.id !== claim.id);
        retry = fresh ? 'requeued as a new operation' : resent.length ? 'SAME ID' : 'NOT REQUEUED';
        if (!fresh) {
          routeProblems.push(
            resent.length
              ? 'the retried write kept the id that was already refused, so the drain would drop it as a duplicate'
              : 'a refused write was not put back in the queue when the desk asked for it again',
          );
        }
      }
    }
  }

  let refusal = 'n/a';
  if (seeded) {
    const attempt = [...doc.querySelectorAll('button')].find((b) => /needs the network/i.test(b.textContent ?? ''));
    if (!attempt) {
      refusal = 'NO BUTTON';
      routeProblems.push('the online-only attempt button is not on the sync console');
    } else {
      press(attempt);
      await new Promise((r) => setTimeout(r, 250));
      refusal = /cannot start a day offline/i.test(doc.body.textContent ?? '') ? 'sentence shown' : 'NOT SHOWN';
      if (refusal === 'NOT SHOWN') {
        routeProblems.push('an action the contract marks online-only was not refused with the contract’s own sentence');
      }
    }
  }

  /* The one claim a report detail screen has to keep: the patient gets the numbers, with their ranges, and a
   * withheld report shows nothing but the reason. The portal is Bangla by default, so the claim is read in Bangla
   * first and then again after pressing the English switch — the screen has to say the same thing in both, and a
   * value that only survives in one of them is a value half the patients cannot read.
   */
  let report = 'n/a';
  const textNow = () => doc.body.textContent ?? '';
  const toEnglish = () => {
    const english = [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'English');
    if (english) press(english);
  };
  if (route === '/portal/reports/rs-2' || route === '/portal/reports/rs-5') {
    /* The flag is a word in its own element, so the element is what is checked — the spans sit next to each other
     * with no whitespace between them, which is exactly why a text search for “Low” alone would be a guess. */
    const banglaFlag = />কম</.test(doc.body.innerHTML);
    toEnglish();
    await new Promise((r) => setTimeout(r, 250));
    const text = textNow();
    const hasRange = /Usual range 11–14 g\/dL/.test(text);
    const hasValue = /10\.4/.test(text);
    const flagged = banglaFlag && />Low</.test(doc.body.innerHTML);
    const explained = /why the iron tablet was started/.test(text);
    if (route === '/portal/reports/rs-5') {
      report = `${hasValue || hasRange ? 'LEAKED THE NUMBER' : 'withheld'} · ${/not shown on a phone/.test(text) ? 'reason given' : 'NO REASON'}`;
      if (hasValue || hasRange) routeProblems.push('a withheld report showed its own values on the portal');
    } else {
      report = `${hasValue ? 'value' : 'NO VALUE'} · ${hasRange ? 'range' : 'NO RANGE'} · ${flagged ? 'flagged' : 'NOT FLAGGED'} · ${explained ? 'explained' : 'NOT EXPLAINED'}`;
      if (!hasValue || !hasRange) routeProblems.push('a released report did not show its values with their ranges');
      if (!flagged) routeProblems.push('a value outside its range was not shown as outside it');
      if (!explained) routeProblems.push('a value outside its range carried no sentence saying what it meant');
    }
  }
  if (route === '/portal/visits/ap-3') {
    const bangla = /আয়রনের ট্যাবলেট খাবেন/.test(textNow()) && /ভিজিট নেওয়ার সময়ের অগ্রিম/.test(textNow());
    if (!bangla) routeProblems.push('the visit detail did not show the advice, or the booking fee, in Bangla');
    toEnglish();
    await new Promise((r) => setTimeout(r, 250));
    const text = textNow();
    const advice = /Take one iron tablet every morning/.test(text);
    const next = /The 22-week ultrasound, on 14 October/.test(text);
    const money = /Booking fee/.test(text) && /Adjusted against your bill/.test(text);
    report = `${advice ? 'advice' : 'NO ADVICE'} · ${next ? 'next step' : 'NO NEXT STEP'} · ${money ? 'fee explained' : 'NO FEE LINE'}`;
    if (!advice || !next || !money) routeProblems.push('the visit detail did not show what the doctor released, or what the money did');
  }
  if (route === '/portal/visits/ap-6') {
    const text = textNow();
    report = /আসা না হলে ভিজিটের কিছু লেখা হয় না/.test(text) ? 'not attended, said so' : 'NOT SAID';
    if (report === 'NOT SAID') routeProblems.push('a visit that did not happen did not say why there is nothing behind it');
  }
  if (route.endsWith('not-a-visit') || route.endsWith('not-a-report')) {
    const text = textNow();
    const kind = route.includes('visits') ? 'visit' : 'report';
    const said = /খুঁজে পাওয়া যায়নি/.test(text);
    report = said ? `${kind} not found, said so` : 'NOT SAID';
    if (!said) routeProblems.push('an address that is not on the register did not say so on the portal');
  }

  /* The scheduled exports, driven: a schedule is edited, saved through the contract's own operation, and today's
   * sheet is built and taken. A screen that only reproduces the register's own sentences is a table; this is the
   * round trip — the hour changed here, the file built here, both recorded where the branch can read them.
   *
   * The text field is driven the way a browser drives it: React keeps its own value tracker on the element, so the
   * value is set through the native setter and an `input` event is dispatched, which is what a keystroke ends in. */
  let schedules = 'n/a';
  if (route === '/reports/schedules') {
    const textOf = () => doc.body.textContent ?? '';
    const buttonBy = (re) => [...doc.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()));
    const type = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    const read = (key) => {
      try {
        return JSON.parse(doc.defaultView?.localStorage.getItem(key) ?? 'null');
      } catch {
        return null;
      }
    };

    const rows = doc.querySelectorAll('[aria-label*=", next "]').length;
    const hour = doc.querySelector('input[name="schedule-times"]');
    const save = buttonBy(/^save this schedule$/i);
    const take = buttonBy(/^download today’s sheet$/i);
    if (!hour || !save || !take) {
      schedules = `${rows} schedules · ${!hour ? 'NO HOUR FIELD' : ''}${!save ? ' NO SAVE' : ''}${!take ? ' NO DOWNLOAD' : ''}`;
      routeProblems.push('the schedule screen is missing the hour field, the save or the download');
    } else {
      type(hour, '06:15, 18:45');
      await new Promise((r) => setTimeout(r, 80));
      press(save);
      await new Promise((r) => setTimeout(r, 300));

      const stored = read('dizi.report.schedules') ?? [];
      const kept = stored.find((sc) => sc.id === 'sch-finance');
      const queued = (read('dizi.outbox.v1')?.pending ?? []).filter((op) => op.operationId === 'saveReportSchedule');
      const named = /saveReportSchedule/.test(textOf());

      press(take);
      await new Promise((r) => setTimeout(r, 300));
      const taken = (read('dizi.report.downloads') ?? []).find((r) => r.scheduleId === 'sch-finance');

      /* The register's own contradiction is on another schedule, so it is read the way a person reads it: by
         opening the audit committee's monthly extract and finding the refusal, not by hoping it is on screen. */
      const audit = [...doc.querySelectorAll('[aria-label^="Audit log,"]')][0];
      let refused = false;
      if (audit) {
        press(audit);
        await new Promise((r) => setTimeout(r, 300));
        refused = /The period is wider than the data/.test(textOf()) && /reads \d+ day\(s\) of data/.test(textOf());
      }
      const runs = /Friday 16 October 2026 at/.test(textOf()) || /at \d\d:\d\d/.test(textOf());
      schedules = `${rows} schedules · ${(kept?.cadence?.times ?? []).join('/') || 'NOT SAVED'} · ${queued.length === 1 ? 'queued as saveReportSchedule' : `queued=${queued.length}`} · ${taken ? `took ${taken.name}` : 'NOT TAKEN'} · ${refused ? 'refusal stated' : audit ? 'NO REFUSAL' : 'NO AUDIT ROW'}`;
      if (rows !== 16) routeProblems.push(`the schedule register drew ${rows} schedules, not one per report the register says is sent`);
      if ((kept?.cadence?.times ?? []).join('/') !== '06:15/18:45') routeProblems.push('saving a schedule did not keep the hour on this node');
      if (queued.length !== 1) routeProblems.push(`saving a schedule did not reach the saved queue as \`saveReportSchedule\` (${queued.length} matching operations)`);
      if (!named) routeProblems.push('the save did not name the contract operation it went through');
      if (!taken) routeProblems.push('downloading today’s sheet recorded nothing on the node');
      if (!refused) routeProblems.push('the register’s own contradiction — a monthly extract of a one-day trail — was not stated on the screen');
      if (!runs) routeProblems.push('the schedule screen did not print the next runs as days');
    }
  }

  /* The designer, driven: a block is dragged with the pointer, the position is read back off the sheet, and the
   * version is published through the contract's own operation. A designer whose blocks only move in a screenshot is
   * a canvas, not a designer. */
  let design = 'n/a';
  if (route === '/admin/printing/designer') {
    const labelOf = (id) => doc.querySelector(`[data-block="${id}"]`)?.parentElement?.querySelector(`[aria-label^="Patient block"], [aria-label^="Document title"], [aria-label^="Footer"]`)?.getAttribute('aria-label') ?? '';
    const surface = [...doc.querySelectorAll('[role="button"][aria-label*=" at "]')].find((el) => /Patient block at/.test(el.getAttribute('aria-label') ?? ''));
    if (!surface) {
      design = 'NO DRAG SURFACE';
      routeProblems.push('the designer drew no draggable block for the specimen patient block');
    } else {
      const before = surface.getAttribute('aria-label');
      const box = { x: 0, y: 0 };
      /* jsdom has no PointerEvent in every version, and React only needs the event's own type: a MouseEvent named
       * `pointerdown` reaches the same handler the tablet does. */
      const pointer = (type, x, y) => surface.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      pointer('pointerdown', box.x + 10, box.y + 10);
      await new Promise((r) => setTimeout(r, 30));
      pointer('pointermove', box.x + 10 + 60, box.y + 10 + 20);
      await new Promise((r) => setTimeout(r, 30));
      pointer('pointerup', box.x + 10 + 60, box.y + 10 + 20);
      await new Promise((r) => setTimeout(r, 120));
      const after = doc.querySelector('[role="button"][aria-label*=" at "]')?.getAttribute('aria-label') ?? '';
      const nums = [...(after.match(/-?\d+(\.\d+)?/g) ?? [])].map(Number);
      const [x, y, w, h] = nums;
      const onGrid = [x, y, w, h].every((n) => n !== undefined && Math.abs(n - Math.round(n / 2) * 2) < 0.001);
      const moved = after !== before;
      const publish = [...doc.querySelectorAll('button')].find((b) => /^Publish version/.test((b.textContent ?? '').trim()));
      if (!publish) {
        routeProblems.push('the designer offers no way to publish a version');
      } else {
        publish.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 250));
        const text = doc.body.textContent ?? '';
        const versioned = /version 1 published/.test(text) || /Version 1/.test(text);
        const queued = /publishPrintTemplate/.test(text) || /queued/i.test(text);
        const stored = (() => {
          try {
            return Boolean(doc.defaultView?.localStorage.getItem('dizi.print.layouts'));
          } catch {
            return false;
          }
        })();
        design = `${moved ? 'dragged' : 'NOT DRAGGED'} · ${onGrid ? 'on the grid' : 'OFF THE GRID'} · ${versioned ? 'version published' : 'NOT PUBLISHED'} · ${stored ? 'kept on the node' : 'NOT STORED'}`;
        if (!moved) routeProblems.push('dragging a block did not move it');
        if (!onGrid) routeProblems.push('a dragged block left the grid');
        if (!versioned) routeProblems.push('publishing did not record a version');
        if (!stored) routeProblems.push('a published version was not kept where the printer reads it');
      }
    }
  }

  /* And the printed page really is the published layout: the banner names the version, and the sheet carries the
   * blocks the designer draws rather than the code template's own markup. */
  if (route === '/print/receipt') {
    const text = doc.body.textContent ?? '';
    const banner = /Printing Money receipt version 3 from the designer/.test(text);
    const blocks = doc.querySelectorAll('[data-block]').length;
    const specimen = /Fatema Begum/.test(text);
    design = `${banner ? 'the designer’s version' : 'THE CODE TEMPLATE'} · ${blocks} blocks · ${specimen ? 'a real record' : 'NO RECORD'}`;
    if (!banner) routeProblems.push('the printed page ignored the published layout');
    if (blocks < 3) routeProblems.push('the printed page did not render the published blocks');
    if (!specimen) routeProblems.push('the printed layout showed no specimen record');
  }

  await new Promise((r) => setTimeout(r, 300));
  dom.window.close();
  return { errors: [...errors, ...routeProblems], shell, handlers, copy, ledger, claims, heads, suite, viewPress, drill, queue, persist, named, retry, refusal, report, design, schedules, readyWait };
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
  const { errors, shell, handlers, copy, ledger, claims, heads, suite, viewPress, drill, queue, persist, named, retry, refusal, report, design, schedules, readyWait } = outcome.value;
  const bad = errors.length > 0 || handlers === 'DEAD';
  const slow = readyWait !== undefined && readyWait > 2000 ? `  ready=${(readyWait / 1000).toFixed(1)}s` : '';
  console.log(`  ${bad ? '✗' : '✓'} ${route.padEnd(22)} shell=${shell ?? 'none'}  handlers=${handlers}  copy=${copy}${ledger === 'n/a' ? '' : `  ledger=${ledger}`}${claims === 'n/a' ? '' : `  claims=${claims}`}${heads === 'n/a' ? '' : `  heads=${heads}`}${suite === 'n/a' ? '' : `  suite=${suite}`}${viewPress === 'n/a' ? '' : `  view=${viewPress}`}${drill === 'n/a' ? '' : `  drill=${drill}`}${queue === 'n/a' ? '' : `  queue=${queue}`}${persist === 'n/a' ? '' : `  persist=${persist}`}${named === 'n/a' ? '' : `  named=${named}`}${retry === 'n/a' ? '' : `  retry=${retry}`}${refusal === 'n/a' ? '' : `  refusal=${refusal}`}${report === 'n/a' ? '' : `  report=${report}`}${design === 'n/a' ? '' : `  design=${design}`}${schedules === 'n/a' ? '' : `  schedules=${schedules}`}${slow}`);
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
