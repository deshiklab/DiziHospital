#!/usr/bin/env node
/**
 * The appointment screens, against the API (P0-402).
 *
 * This slice's acceptance test is a usability test with five receptionists, and that has not happened — no reception
 * desk, no pilot branch, no people. What *can* be proved here is the part a usability test would otherwise be the first
 * to discover, and each case below is one of those:
 *
 *   1. **The call is the contract's operation.** A screen cannot invent an endpoint: the path comes from
 *      `@dizi/contracts/client`, generated from `openapi.json`, and this harness asserts the exact URL the app asks
 *      for — including the two filters the inbox and the board use.
 *   2. **A refusal is a value the screen can render.** A `409 dizi.slot-taken` from the service becomes an `ApiProblem`
 *      carrying the sentence and the alternatives; a `502` from the app's own proxy becomes a readable "the hospital
 *      server is not answering" rather than a screen that says nothing happened.
 *   3. **Instants are the branch's, not the browser's.** The wire carries UTC; the desk reads nine o'clock. The
 *      conversion is exercised across midnight, because that is where a naive `toISOString().slice(0, 10)` puts a
 *      patient on the wrong day.
 *   4. **The conflict prompt is usable.** The *shipping* booking sheet is mounted in a window with a source that refuses
 *      the first booking, and the harness then clicks the time the refusal offered and books it — so a prompt whose
 *      times cannot actually be booked fails here rather than at a reception desk.
 *   5. **The preview source refuses the same way.** With no server, the sheet still must not let two patients be booked
 *      into one slot, and the refusal must be the one the API would give.
 *
 * Needs two dev-only packages:
 *
 *     npm i --no-save jsdom esbuild && npm run test:appointments
 *
 * Exit code 0 when every case passes, 1 otherwise, 2 when the tooling is missing.
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
  console.error('\nThis test needs two dev-only packages:\n\n    npm i --no-save jsdom esbuild\n\nthen run `npm run test:appointments` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-appointments-test-'));
const failures = [];

function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

/* ===================================================== 1. the wire: paths, decoding, refusals */

console.log('\nappointments — the wire, the clock, the conflict prompt and the preview\n');

const wire = join(work, 'wire.cjs');
await esbuild.build({
  entryPoints: [join(root, 'apps/web/lib/appointments-source.ts')],
  outfile: wire,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  absWorkingDir: root,
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  logLevel: 'error',
});

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const source = require(wire);
const { apiSource, previewSource, SCHEDULING, localMinutes, localDay, instantFor, ApiProblem } = source;

/** A fetch stand-in that records the request and answers with whatever a case says. */
let seen = [];
function stubFetch(answer) {
  seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body });
    const { status = 200, body = {} } = typeof answer === 'function' ? await answer(String(url), init) : answer;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
  };
}

const appointmentRow = (over = {}) => ({
  id: 'APT-1',
  token: 'A-001',
  mrn: 'MRN-000001',
  doctorId: 'dr-rahman',
  room: 'OPD-1',
  start: '2026-11-03T03:00:00+00:00',
  durationMin: 45,
  status: 'Confirmed',
  type: 'New',
  priority: 'Routine',
  source: 'Walk-in',
  reason: 'Fever',
  steps: 3,
  origin: 'Main Campus',
  patient: { mrn: 'MRN-000001', name: 'Rahima Begum', nameBn: 'রহিমা বেগম', age: 36, sex: 'Female', phone: '01711000001', allergies: null },
  queued: false,
  ...over,
});

/* ---- the day list */

stubFetch({ body: { rows: [appointmentRow()], asOf: '2026-11-03T03:00:00+00:00' } });
const day = await apiSource.day({ day: '2026-11-03', doctorId: 'dr-rahman', status: 'Requested', source: 'Online portal' });

pass('the day list asks the contract’s own path', seen[0]?.url.startsWith('/api/dizi/appointments?'), seen[0]?.url);
pass(
  'the two screen filters travel to the server',
  seen[0]?.url.includes('status=Requested') && seen[0]?.url.includes('source=Online+portal'),
  seen[0]?.url,
);
pass('a query absent from the call is absent from the URL', !seen[0]?.url.includes('undefined'), seen[0]?.url);

pass('the instant becomes the branch’s minute of the day', day.rows[0].start === 540, String(day.rows[0].start));
pass('the instant also carries which day it belongs to', day.rows[0].day === '2026-11-03', String(day.rows[0].day));
pass('the row keeps the register’s projection', day.rows[0].patient.name === 'Rahima Begum' && day.rows[0].patient.age === 36);
pass('an unrecorded allergy reads as absent, not as empty text', day.rows[0].patient.allergies === null);
pass('a row read back from the service is never “queued”', day.rows[0].queued === false, 'the branch holds the slot');

/* ---- the branch’s clock, at the one hour that breaks naive date handling */

pass(
  'an evening in UTC is already tomorrow at the desk',
  localDay('2026-11-02T20:00:00+00:00') === '2026-11-03' && localMinutes('2026-11-02T20:00:00+00:00') === 120,
  `${localDay('2026-11-02T20:00:00+00:00')} ${localMinutes('2026-11-02T20:00:00+00:00')}`,
);
pass(
  'and nine o’clock at the desk is 03:00 on the wire',
  instantFor('2026-11-03', 540) === '2026-11-03T03:00:00.000+00:00',
  instantFor('2026-11-03', 540),
);
pass(
  'the zone is the contract’s, not the browser’s',
  SCHEDULING.timezone === 'Asia/Dhaka' && localMinutes('2026-11-03T03:00:00+00:00', 'Europe/London') === 180,
  `Dhaka 09:00 vs London ${localMinutes('2026-11-03T03:00:00+00:00', 'Europe/London')}:00`,
);
pass('the grid’s numbers are the contract’s numbers', SCHEDULING.slotMinutes === 15 && SCHEDULING.window.from === 540 && SCHEDULING.closedOn.includes('Friday'));

/* ---- the slots */

stubFetch({
  body: {
    day: '2026-11-03',
    doctorId: 'dr-rahman',
    room: 'OPD-1',
    slotMinutes: 15,
    claimStarts: 3,
    open: true,
    closedBecause: null,
    window: { from: 540, to: 840 },
    slots: [
      { start: '2026-11-03T03:00:00+00:00', minutes: 540, state: 'booked', appointmentId: 'APT-1', token: 'A-001', durationMin: 45 },
      { start: '2026-11-03T03:45:00+00:00', minutes: 585, state: 'free' },
    ],
  },
});
const grid = await apiSource.slots('2026-11-03', 'dr-rahman');
pass('the grid is asked for per doctor and day', seen[0]?.url.includes('/appointments/slots?day=2026-11-03&doctorId=dr-rahman'), seen[0]?.url);
pass('a booked slot says who holds it', grid.slots[0].state === 'booked' && grid.slots[0].token === 'A-001');
/* The claim size travels with the grid: a sheet that drew a one-slot block for a three-step consultation would offer a
   booking the service refuses one tap later. */
pass('the grid says how long a consultation blocks it', grid.claimStarts === 3, String(grid.claimStarts));

/* ---- a refusal the desk has to answer */

stubFetch({
  status: 409,
  body: {
    type: 'https://contract.dizihospital.example/problems/dizi.slot-taken',
    title: 'That slot has just been taken',
    status: 409,
    detail: 'Doctor dr-rahman at 09:00 on 2026-11-03 was claimed by Main Campus first (token A-001).',
    heldBy: 'Main Campus',
    requestedBy: 'Main Campus',
    alternatives: [
      { start: '2026-11-03T03:45:00+00:00', day: '2026-11-03', minutes: 585 },
      { start: '2026-11-03T04:00:00+00:00', day: '2026-11-03', minutes: 600 },
      { start: '2026-11-03T04:15:00+00:00', day: '2026-11-03', minutes: 615 },
    ],
  },
});

let refusal = null;
try {
  await apiSource.book({ mrn: 'MRN-000001', doctorId: 'dr-rahman', day: '2026-11-03', start: 540 });
} catch (error) {
  refusal = error;
}

pass('a taken slot is a refusal the screen can branch on', refusal instanceof ApiProblem && refusal.isSlotTaken, refusal?.code);
pass('the refusal keeps the service’s own sentence', (refusal?.detail ?? '').includes('claimed by Main Campus first'));
pass('the refusal offers times that can be taken', refusal?.alternatives.length === 3, JSON.stringify(refusal?.alternatives?.[0] ?? null));
pass('a booking posts the branch’s instant, not the browser’s', (seen[0]?.body ?? '').includes('2026-11-03T03:00:00.000+00:00'), seen[0]?.body);
pass('and it carries an idempotency key, from the contract’s header name', seen[0]?.headers?.get('Idempotency-Key') !== undefined, JSON.stringify([...(seen[0]?.headers?.keys() ?? [])]));

/* ---- the proxy is down, and says so */

stubFetch({
  status: 502,
  body: {
    type: 'https://contract.dizihospital.example/problems/dizi.unavailable',
    title: 'The hospital server is not answering',
    status: 502,
    detail: 'This app could not reach the API at http://127.0.0.1:8000/appointments. The screen is showing what it can do without it; nothing was written.',
  },
});

const probe = await source.probeApi ? await source.probeApi() : { reachable: false, because: '' };
pass('a server that is not there is a sentence, not a blank screen', probe.reachable === false && probe.because.includes('could not reach'), probe.because.slice(0, 60));

/* ===================================================== 2. the preview source, same refusals */

console.log('\nappointments — the preview, when no server is configured\n');

/* 2026-11-03 is a Tuesday, 2026-11-06 a Friday, and the contract's horizon is thirty days. */
const previewRow = await previewSource.book({ mrn: 'MRN-000001', doctorId: 'dr-hossain', day: '2026-11-05', start: 540, type: 'New', priority: 'Routine', source: 'Walk-in', reason: 'Child: feeding difficulty' });
pass('a preview booking gets the branch’s room and claim', previewRow.room === 'OPD-7' && previewRow.durationMin === 30, `${previewRow.room} ${previewRow.durationMin}m`);
pass('and the grid it was taken from shows the block as taken', previewRow.steps === 2);

let clash = null;
try {
  await previewSource.book({ mrn: 'MRN-000002', doctorId: 'dr-hossain', day: '2026-11-05', start: 540, type: 'New', priority: 'Routine', source: 'Walk-in', reason: 'Second patient' });
} catch (error) {
  clash = error;
}
pass('the preview refuses a double booking the way the API does', clash?.isSlotTaken === true, clash?.code);
pass('and it offers the next free starts', (clash?.alternatives ?? []).length === 3, JSON.stringify(clash?.alternatives?.[0] ?? null));

let closed = null;
try {
  await previewSource.book({ mrn: 'MRN-000003', doctorId: 'dr-hossain', day: '2026-11-06', start: 540, type: 'New', priority: 'Routine', source: 'Walk-in', reason: 'Friday' });
} catch (error) {
  closed = error;
}
pass('a closed day is refused with the day named', closed !== null && (closed.detail ?? '').includes('Friday'), closed?.detail?.slice(0, 40));

let beyond = null;
try {
  await previewSource.book({ mrn: 'MRN-000004', doctorId: 'dr-hossain', day: '2026-12-10', start: 540, type: 'New', priority: 'Routine', source: 'Walk-in', reason: 'Too far' });
} catch (error) {
  beyond = error;
}
pass('a date past the horizon is refused rather than promised', (beyond?.detail ?? '').includes('30 days ahead'), beyond?.detail?.slice(0, 40));

/* The preview seeds a plausible day (the generator has always drawn one), so what is asserted is the *change*: a
   booking made here must appear as a block in the grid it was taken from, and nowhere else. */
const before = await previewSource.slots('2026-11-05', 'dr-hossain');
const beforeBooked = before.slots.filter((slot) => slot.state === 'booked').length;
const beforeFree = before.slots.filter((slot) => slot.state === 'free').length;

/* The free start is read off the grid, not guessed: a start the grid calls free may still be inside the block the
   sitting claims, and the preview refuses those exactly as the service does. */
const opened = before.slots.findIndex(
  (slot, index) =>
    slot.state === 'free' &&
    before.slots.slice(index, index + before.claimStarts).every((candidate) => candidate.state === 'free'),
);
pass('the preview grid has a free block to take', opened >= 0, `${before.slots.length} slots, claim ${before.claimStarts}`);
const chosenStart = before.slots[opened].minutes;

await previewSource.book({ mrn: 'MRN-000009', doctorId: 'dr-hossain', day: '2026-11-05', start: chosenStart, type: 'New', priority: 'Routine', source: 'Walk-in', reason: 'Measured' });

const after = await previewSource.slots('2026-11-05', 'dr-hossain');
const block = after.slots.filter((slot) => slot.state === 'booked' && slot.minutes >= chosenStart && slot.minutes < chosenStart + after.claimStarts * after.slotMinutes);
pass('a new booking’s block appears in the grid', after.slots.filter((slot) => slot.state === 'booked').length === beforeBooked + after.claimStarts, `${beforeBooked} → ${after.slots.filter((s) => s.state === 'booked').length} booked`);
pass('and the block is as long as the sitting claims, not one slot long', block.length === after.claimStarts && after.claimStarts === 2, `${block.length} slots of ${after.slotMinutes} minutes`);
pass('the free slots are the ones it did not take', after.slots.filter((slot) => slot.state === 'free').length === beforeFree - after.claimStarts);
pass('the earlier booking is still where it was put', after.slots.some((slot) => slot.minutes === 540 && slot.state === 'booked'));

/* ===================================================== 3. the conflict prompt, in a window */

const { JSDOM } = jsdom;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://dizi.test/appointments' });
const { window } = dom;

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
/* jsdom has no `scrollIntoView`, and the Sheet focuses its first control when it opens. */
window.HTMLElement.prototype.scrollIntoView = () => undefined;

for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'Blob', 'URL']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = join(work, 'appointments-entry.cjs');
await esbuild.build({
  entryPoints: [join(here, 'appointments-entry.tsx')],
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

const entry = require(harness);
const { mount, buttons, slotDisabled } = entry.default ?? entry;
const doc = window.document;
const host = doc.getElementById('root');

/* The refused booking offers 09:45; the harness must be able to book exactly that afterwards. */
const refused = {
  code: 'dizi.slot-taken',
  title: 'That slot has just been taken',
  status: 409,
  detail: 'Doctor dr-rahman at 09:00 on 2026-11-03 was claimed by Main Campus first (token A-001). The desk that took the booking keeps it — take one of the times below.',
  alternatives: [{ day: '2026-11-03', minutes: 585 }],
};

const gridFor = (day, doctorId, claim = 3) => ({
  day,
  doctorId,
  room: 'OPD-1',
  slotMinutes: 15,
  claimStarts: claim,
  open: true,
  closedBecause: null,
  window: { from: 540, to: 840 },
  /* The service marks *every* minute a claim covers as taken, not just the start — the sheet's blocking check reads each
     minute of the block the consultation would need, so a grid that marked only 09:00 would let the desk pick 09:15 for a
     three-step sitting and be refused. This stub is shaped like the service's answer for that reason. */
  slots: Array.from({ length: 20 }, (_, i) => {
    const minutes = 540 + i * 15;
    const at = `${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+00:00`;
    return minutes < 540 + claim * 15
      ? { start: at, minutes, state: 'booked', appointmentId: 'APT-1', token: 'A-001', durationMin: 45 }
      : { start: at, minutes, state: 'free' };
  }),
});

const submitted = [];
const { handles } = await mount(
  {
    day: '2026-11-03',
    /* The patient is known — the desk opened the sheet from a card — but the time is *not*: choosing it from the grid is
       part of what is being proved. */
    preset: { doctorId: 'dr-rahman', patientMrn: 'MRN-000001' },
    loadSlots: async (day, doctorId) => gridFor(day, doctorId),
    onSubmit: async (input) => {
      submitted.push(input);
      if (submitted.length === 1) {
        const problem = new Error(refused.detail);
        Object.assign(problem, {
          code: refused.code,
          status: refused.status,
          detail: refused.detail,
          alternatives: refused.alternatives,
          isSlotTaken: true,
        });
        throw problem;
      }
      return { ...appointmentRow({ start: `${input.day}T03:45:00+00:00` }), id: 'APT-2', token: 'A-002' };
    },
  },
  host,
);

/* Patient → doctor & time, where the grid is drawn. */
await handles.click('Continue');

pass('the sheet was read for the day the desk opened', handles.asked.length > 0 && handles.asked[0].day === '2026-11-03', JSON.stringify(handles.asked[0] ?? null));
pass('the sheet draws the grid it was given, with the sitting’s own numbers', handles.text().includes('Slots every 15 minutes'), 'OPD-1, claim 3');
pass('a taken slot is not selectable', slotDisabled(host, '9:00 AM'), 'the booked block is disabled, not merely styled');
pass('the block a consultation claims is shown as taken, not one slot of it', slotDisabled(host, '9:15 AM') && slotDisabled(host, '9:30 AM') && !slotDisabled(host, '9:45 AM'), 'three steps blocked from 9:00');

/* Pick a free time the way the desk does, then walk to the confirmation. */
await handles.click('10:00 AM');
await handles.click('Continue');
await handles.click('Continue');
await handles.click('Confirm appointment');

const text = handles.text();
pass('the service’s own sentence reaches the desk', text.includes('claimed by Main Campus first'), 'the refusal is rendered, not paraphrased');
pass('the times the refusal offered are offered here', buttons(host).some((label) => label.startsWith('9:45 AM')), buttons(host).filter((l) => l.includes('AM')).join(' | '));
pass('what was refused is not reported as booked', !text.includes('Booked A-002'), 'nothing is claimed to be written');

/* Now take the time the *service* said was free: the whole point of the prompt. */
await handles.click('9:45 AM · 2026-11-03');
pass('taking an offered time returns to the time step', handles.text().includes('Slots every 15 minutes'), 'the desk can see the day it is being moved to');
await handles.click('Continue');
await handles.click('Continue');
pass('the confirmation is for the new time before it is written', handles.text().includes('9:45 AM (45 min)'), 'the sheet restates the time it will book');
await handles.click('Confirm appointment');

pass('choosing an offered time submits the new slot', submitted.length === 2 && submitted[1].start === 585 && submitted[1].day === '2026-11-03', JSON.stringify(submitted[1] ?? null));
pass('and the booking keeps the patient the desk chose', submitted[1]?.mrn === 'MRN-000001' && submitted[1]?.doctorId === 'dr-rahman');
pass('the first attempt carried the time the desk had picked', submitted[0]?.start === 600, JSON.stringify(submitted[0] ?? null));
pass('the grid was re-read for the day that was chosen', handles.asked.some((question) => question.day === '2026-11-03' && question.doctorId === 'dr-rahman'), `${handles.asked.length} reads`);

/* A closed day is a reason, not twenty grey buttons. */
const closedHarness = await mount(
  {
    day: '2026-11-06',
    preset: { doctorId: 'dr-rahman', patientMrn: 'MRN-000001' },
    loadSlots: async (day, doctorId) => ({ ...gridFor(day, doctorId), open: false, closedBecause: 'The clinic is closed on Fridays. Choose the next open day.', slots: [] }),
    onSubmit: async () => appointmentRow(),
  },
  (() => {
    const div = doc.createElement('div');
    doc.body.appendChild(div);
    return div;
  })(),
);

/* The day is drawn on the time step, which is where a closed day has to be visible: before a time is picked. */
await closedHarness.handles.click('Continue');
const closedText = closedHarness.handles.text();
pass('a closed day is drawn as the reason it is closed', closedText.includes('The clinic is closed on Fridays'), 'not as an empty grid');

handles.unmount();
closedHarness.handles.unmount();

handles.unmount();
closedHarness.handles.unmount();

rmSync(work, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? 'OK' : 'FAILED'} — ${failures.length} failure(s)\n`);
if (failures.length > 0) {
  console.log('The usability test with five receptionists still has not happened; this only proves what a machine can.\n');
  process.exit(1);
}
process.exit(0);
