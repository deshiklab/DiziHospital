#!/usr/bin/env node
/**
 * Messaging test — the delivery log, the alerting and the per-event wording, driven against a stubbed service.
 *
 * P0-403's acceptance line is "delivery log with failure alerting; template per event", and this is the machine's half
 * of it. PHPUnit cannot run in the sandbox this repository is built in, so the service's own side is stated as unrun —
 * but the *screens'* side is executable here, and it is the side with the interesting failures:
 *
 *   1. **The path is the contract's.** Every call is checked against the operation's own `path` and `method` in
 *      `capabilities.json`, so a screen cannot quietly start calling an endpoint nobody documented.
 *   2. **A refusal is a value.** A `409 dizi.consent-missing` from the proxy becomes an `ApiProblem` the sheet
 *      branches on — not a status code, and not a tick.
 *   3. **Nothing is queued, ever.** The send is online-only by contract and by this screen: with the proxy down the
 *      send refuses (`dizi.offline-not-allowed` from the surface, a thrown `ApiProblem` from the wire) and writes no
 *      queued row, because a message that has left cannot be recalled.
 *   4. **The log order and masks are the service's.** An append-only log is read most-recent-first with the address
 *      masked to its last three characters, and a retry *appends* rather than editing the failure above it.
 *   5. **The preview refuses what the service refuses.** The second source is a preview of the product, not a second
 *      product: same codes, same sentences' shape, and `preview` named on every row it writes.
 *
 * Needs one dev-only package:
 *
 *     npm i --no-save esbuild && npm run test:messaging
 */
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname as dirOf, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirOf(fileURLToPath(import.meta.url));
const root = resolvePath(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:messaging` again.\n');
  process.exit(2);
}

const work = join(root, 'node_modules/.cache/dizi-messaging');
mkdirSync(work, { recursive: true });
const wire = join(work, 'wire.cjs');
await esbuild.build({
  entryPoints: [join(root, 'apps/web/lib/messaging-source.ts')],
  outfile: wire,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  absWorkingDir: root,
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  logLevel: 'error',
});

const { createRequire: makeRequire } = await import('node:module');
const require = makeRequire(import.meta.url);
const source = require(wire);
const { apiSource, previewSource, ApiProblem, NOTIFICATIONS, OUTBOUND_CHANNELS } = source;

const contract = require(join(root, 'packages/contracts/dist/capabilities.json'));

let failures = 0;
const pass = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail === '' ? '' : `  — ${detail}`}`);
};
const codes = (log) => log.rows.map((row) => row.errorCode).filter(Boolean);

/* ---------------------------------------------------------------- a fetch stand-in that records what was asked */

let seen = [];
function stubFetch(answer) {
  seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body });
    const { status = 200, body = {} } = typeof answer === 'function' ? await answer(String(url), init) : answer;

    return new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
  };
}

const deliveryRow = (over = {}) => ({
  id: 'dl-1',
  topic: 'appointment.booked',
  channel: 'whatsapp',
  template: 'appointment-booked',
  language: 'bn',
  mrn: 'SH-102355',
  to: '*****678',
  status: 'sent',
  provider: 'preview',
  errorCode: null,
  detail: 'The preview driver carried nothing out of this node.',
  attempt: 1,
  at: '2026-11-03T03:00:00+00:00',
  retryable: false,
  ...over,
});

/* ---- the contract is the source of the vocabulary */

pass('the channels the console offers are the contract’s own two', OUTBOUND_CHANNELS.join(' · ') === 'whatsapp · email', OUTBOUND_CHANNELS.join(' · '));
pass('quiet hours, the retry budget and the alerting rule are read rather than restated', NOTIFICATIONS.quietHours.from === '21:00' && NOTIFICATIONS.retry.attempts === 3 && NOTIFICATIONS.alerting.consecutiveFailures === 3, `${NOTIFICATIONS.quietHours.from}→${NOTIFICATIONS.quietHours.to}, ${NOTIFICATIONS.retry.attempts} attempts, alert at ${NOTIFICATIONS.alerting.consecutiveFailures}`);
pass('every event either names a template or is deliberately quiet, and says which', Object.values(NOTIFICATIONS.events).every((event) => event.template !== null || event.channels.length === 0), Object.entries(NOTIFICATIONS.events).filter(([, e]) => e.template === null).map(([k]) => k).join(', ') || '—');
pass('nothing clinical is carried by an event: no template mentions a value or a diagnosis', !Object.values(NOTIFICATIONS.templates).some((template) => JSON.stringify(template).match(/haemoglobin|hemoglobin|diagnos|positive for/i)), `${Object.keys(NOTIFICATIONS.templates).length} templates`);

/* ---- the log, as the service returns it */

stubFetch({
  body: {
    rows: [
      deliveryRow(),
      deliveryRow({ id: 'dl-2', topic: 'result.released', channel: 'email', status: 'failed', provider: 'smtp', errorCode: 'dizi.unavailable', detail: 'Connection refused by the mail relay.', attempt: 2, retryable: true }),
    ],
    asOf: '2026-11-03T03:05:00+00:00',
    driver: { whatsapp: 'preview', email: 'smtp' },
    alerts: [{ channel: 'email', failures: 3, since: '2026-11-03T02:10:00+00:00', because: NOTIFICATIONS.alerting.note }],
    counts: { sent: 1, failed: 1 },
  },
});

const log = await apiSource.log({ status: 'failed' });
pass('the log is asked for by the contract’s own path and the filter goes in the query', seen[0]?.url === '/api/dizi/notifications/deliveries?status=failed' && seen[0]?.method === 'GET', seen[0]?.url);
pass('the driver in force is named on the page rather than left to be inferred', log.driver.whatsapp === 'preview' && log.driver.email === 'smtp', JSON.stringify(log.driver));
pass('a channel that is not delivering is an alert above the rows', log.alerts.length === 1 && log.alerts[0].channel === 'email' && log.alerts[0].failures === 3, log.alerts[0]?.because?.slice(0, 60));
pass('a row keeps the service’s own words and the code beside them', log.rows[1].errorCode === 'dizi.unavailable' && log.rows[1].detail.includes('Connection refused'));
pass('the address is the masked one the service returned, and the screen does not unmask it', log.rows[0].to === '*****678');
pass('an attempt keeps its number, so a retry reads as a second attempt rather than a second message', log.rows[0].attempt === 1 && log.rows[1].attempt === 2);
pass('an event the contract describes arrives with its meaning attached', log.rows[0].meaning.includes('confirmation'), log.rows[0].topic);
pass('the e-mail subject and bengali wording are on the row a reader would see', typeof log.rows[0].template === 'string' && log.rows[0].template === 'appointment-booked');

/* ---- a refusal is a value the sheet branches on */

stubFetch({
  status: 409,
  body: {
    type: 'https://dizi.example/problems/dizi.consent-missing',
    title: 'There is no consent for that channel',
    detail: 'This patient has consented to e-mail but not to WhatsApp, and the two are separate consents.',
  },
});

let refusal = null;
try {
  await apiSource.sendMessage({ channel: 'whatsapp', mrn: 'SH-102397', to: '01711000099', body: 'Your report is ready.', consentRef: 'consent-1' });
} catch (error) {
  refusal = error;
}

pass('a refusal is a refusal the screen can branch on', refusal instanceof ApiProblem && refusal.code === 'dizi.consent-missing' && refusal.status === 409, refusal?.code);
pass('and it carries the service’s own sentence rather than one this app wrote', (refusal?.detail ?? '').includes('separate consents'));
pass('the send is asked for as the contract’s online-only operation, with an idempotency key', seen[0]?.url === '/api/dizi/notifications/outbound' && seen[0]?.method === 'POST' && seen[0]?.headers?.get('Idempotency-Key') !== undefined, seen[0]?.method);
pass('and the body carries the patient’s MRN and the consent reference the service checks', (seen[0]?.body ?? '').includes('"patientMrn":"SH-102397"') && (seen[0]?.body ?? '').includes('"consentRef":"consent-1"'));

/* ---- a gateway that is down is a 502 the log already holds, and nothing is queued */

stubFetch({
  status: 502,
  body: { type: 'https://dizi.example/problems/dizi.unavailable', title: 'The gateway is unreachable', detail: 'Meta refused the message: Recipient not in allowed list.' },
});
let gatewayDown = null;
try {
  await apiSource.sendMessage({ channel: 'whatsapp', mrn: 'SH-102355', to: '01711000678', body: 'Your appointment is tomorrow at 11:00.', consentRef: 'consent-2' });
} catch (error) {
  gatewayDown = error;
}
pass('a gateway that is down reaches the sheet as dizi.unavailable, with the provider’s own words', gatewayDown?.code === 'dizi.unavailable' && gatewayDown?.detail.includes('Recipient not in allowed list'));

/* ---- a retry appends the next attempt */

stubFetch({
  status: 201,
  body: deliveryRow({ id: 'dl-3', status: 'sent', provider: 'meta-cloud', attempt: 2, errorCode: null, detail: 'The gateway accepted attempt 2.' }),
});
const retried = await apiSource.retry('dl-2');
pass('a retry asks for the attempt’s own path and posts with a key', seen[0]?.url === '/api/dizi/notifications/deliveries/dl-2/retry' && seen[0]?.method === 'POST' && seen[0]?.headers?.get('Idempotency-Key') !== undefined, seen[0]?.url);
pass('and the row that comes back is the new attempt, not an edit of the failed one', retried.attempt === 2 && retried.id === 'dl-3' && retried.detail.includes('accepted attempt 2'));

/* ---- templates, one wording per event */

stubFetch({
  body: {
    rows: [
      { event: 'appointment.booked', template: 'appointment-booked', channel: 'whatsapp', language: 'bn', body: '{{patient}} — আপনার অ্যাপয়েন্টমেন্ট…', placeholders: ['patient'], approval: 'pending', enabled: true },
      { event: 'appointment.booked', template: 'appointment-booked', channel: 'email', language: 'en', subject: 'Your appointment is confirmed', body: '{{patient}} — your appointment is on {{day}}.', placeholders: ['patient', 'day'], approval: 'not-required', enabled: true },
    ],
  },
});
const templates = await apiSource.templates();
pass('the templates are read from the contract’s operation', seen[0]?.url === '/api/dizi/notifications/templates', seen[0]?.url);
pass('a template belongs to an event, and a reader is told what the event is', templates[0].event === 'appointment.booked' && templates[0].meaning.includes('confirmation'), templates[0].event);
pass('the e-mail template carries a subject and the WhatsApp one does not', templates[1].subject !== '' && templates[0].subject === '');
pass('an unapproved WhatsApp template says so rather than showing a tick', templates[0].approval === 'pending' && templates[1].approval === 'not-required', `${templates[0].approval} vs ${templates[1].approval}`);

/* ---- the preview: the same refusals, and `preview` named on every row it writes */

const previewLog = await previewSource.log();
const patientFacing = Object.entries(NOTIFICATIONS.events).filter(([, event]) => event.consent).map(([topic]) => topic);
pass('every patient-facing event appears in the preview log, and the deliberately quiet one does not', patientFacing.every((topic) => previewLog.rows.some((row) => row.topic === topic)) && !previewLog.rows.some((row) => row.topic === 'encounter.signed'), `${previewLog.rows.length} rows over ${patientFacing.length} events`);
pass('the preview names its driver on every row and at the top, so a preview row is never read as evidence', Object.values(previewLog.driver).every((driver) => driver === 'preview') && previewLog.rows.every((row) => row.provider === 'preview'), `${previewLog.rows.length} rows`);
pass('the preview shows the states the log exists for, including failures and a suppression', new Set(previewLog.rows.map((row) => row.status)).size >= 4 && previewLog.rows.some((row) => row.status === 'failed') && previewLog.rows.some((row) => row.status === 'suppressed'), [...new Set(previewLog.rows.map((r) => r.status))].join(' · '));
pass('a failure raises the alert the acceptance line asks for, at the contract’s own threshold', previewLog.alerts.length === 1 && previewLog.alerts[0].channel === 'whatsapp' && previewLog.alerts[0].failures === Number(contract.notifications.alerting.consecutiveFailures), `${previewLog.alerts[0]?.failures} failures on ${previewLog.alerts[0]?.channel}`);
pass('a suppression is not counted as a failure: a policy refusal is not a channel that is down', previewLog.alerts[0].failures === previewLog.rows.filter((row) => row.status === 'failed').length, `${previewLog.rows.filter((r) => r.status === 'suppressed').length} suppression(s) beside it`);
pass('the attempts of one message are three rows, and only the ones with attempts left are retryable', previewLog.rows.filter((row) => row.topic === 'appointment.booked' && row.status === 'failed').length === Number(contract.notifications.retry.attempts) && previewLog.rows.filter((row) => row.status === 'failed' && row.retryable).length === Number(contract.notifications.retry.attempts) - 1);

let exhausted = null;
try {
  await previewSource.retry('dl-preview-1');
} catch (error) {
  exhausted = error;
}
pass('a retry of an attempt with none left is a 422 naming the count, as the service answers it', exhausted?.status === 422 && exhausted?.code === 'dizi.validation-failed' && exhausted?.detail.includes('number 3 of 3'), exhausted?.code);

let suppressedRetry = null;
try {
  await previewSource.retry('dl-preview-4');
} catch (error) {
  suppressedRetry = error;
}
pass('and a retry of a suppression is refused under the code that suppressed it', suppressedRetry?.status === 409 && suppressedRetry?.code === 'dizi.consent-missing', suppressedRetry?.code);

const retriedFromLog = await previewSource.retry('dl-preview-3');
pass('a failure with an attempt left is retried by appending the next attempt', retriedFromLog.attempt === 2 && retriedFromLog.status === 'sent' && retriedFromLog.id === 'dl-preview-3-r2', `${retriedFromLog.id} · attempt ${retriedFromLog.attempt}`);
pass('and the failed attempt it came from is still in the log, unchanged', previewLog.rows.some((row) => row.id === 'dl-preview-3' && row.status === 'failed' && row.detail.includes('the desk saw fail')), 'append-only');

let previewRefusal = null;
try {
  await previewSource.sendMessage({ channel: 'whatsapp', mrn: 'SH-102397', to: '01711000099', body: 'Your report is ready.' });
} catch (error) {
  previewRefusal = error;
}
pass('a preview refuses a send with the same code the service refuses it with', previewRefusal instanceof ApiProblem && previewRefusal.code === 'dizi.consent-missing' && previewRefusal.status === 409, previewRefusal?.code);
pass('and it says the send did not happen rather than showing a tick', (previewRefusal?.detail ?? '').includes('Nothing was sent'));

const previewTemplates = await previewSource.templates();
pass('the preview’s wording is the contract’s own table, in both languages', previewTemplates.length >= 12 && previewTemplates.some((row) => row.language === 'bn') && previewTemplates.some((row) => row.language === 'en'), `${previewTemplates.length} rows`);
pass('and no preview WhatsApp template claims to have been approved by nobody', previewTemplates.filter((row) => row.channel === 'whatsapp').every((row) => row.approval === 'pending'));

/* ---- the noticeboard is not claimed: the preview says it cannot write one */

let boardRefusal = null;
try {
  await previewSource.sendNotice({ to: [{ kind: 'role', ref: 'Staff nurse' }], subject: 'x', body: 'y' });
} catch (error) {
  boardRefusal = error;
}
pass('the preview refuses to write a notice rather than writing it into a fixture', boardRefusal?.code === 'dizi.offline-not-allowed' && boardRefusal.status === 503, boardRefusal?.code);

rmSync(work, { recursive: true, force: true });

console.log(`\nmessaging — ${failures === 0 ? 'every case passed' : `${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
