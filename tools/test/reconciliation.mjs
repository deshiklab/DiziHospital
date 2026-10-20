#!/usr/bin/env node
/**
 * P0-406: the nightly comparator is clean on equal synthetic snapshots and delivers an alert for injected drift.
 * The local HTTP receiver is a test double; no live system or alert service is contacted.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = resolve(ROOT, 'tools/migration/reconcile.mjs');
const PLAN_FIXTURE = resolve(ROOT, 'tools/migration/fixtures/controls.synthetic.json');
const LEGACY_FIXTURE = resolve(ROOT, 'tools/migration/fixtures/legacy.synthetic.json');
const NEW_FIXTURE = resolve(ROOT, 'tools/migration/fixtures/new.synthetic.json');
let passed = 0;
let failed = 0;

function check(description, condition) {
  try {
    if (typeof condition === 'function') assert.equal(condition(), true);
    else assert.equal(condition, true);
    passed++;
    console.log(`  ✓ ${description}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${description}: ${error.message}`);
  }
}

function execute(args, env = {}) {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return `http://127.0.0.1:${server.address().port}/alerts`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

const work = await mkdtemp(resolve(tmpdir(), 'dizi-reconciliation-'));
let receiver;
try {
  const cleanReport = resolve(work, 'clean.json');
  const clean = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', LEGACY_FIXTURE,
    '--new', NEW_FIXTURE,
    '--report', cleanReport,
    '--run-id', 'synthetic-clean-run',
  ], { DIZI_RECONCILIATION_ALERT_URL: undefined, DIZI_RECONCILIATION_ALERT_TOKEN: undefined });
  const cleanJson = JSON.parse(await readFile(cleanReport, 'utf8'));
  const cleanReportMode = (await stat(cleanReport)).mode & 0o777;
  check('equal snapshots compare all declared entities without drift', clean.code === 0 && cleanJson.status === 'clean' && cleanJson.summary.entitiesCompared === 4);
  check('exact quantity decimals normalize without introducing false drift', cleanJson.comparison.entities.inventory.legacy.totals.onHand.value === '42.5' && cleanJson.comparison.entities.inventory.new.totals.onHand.value === '42.5');
  check('clean runs do not send alerts and protect the report file', cleanJson.alert.delivery === 'not-needed' && cleanReportMode === 0o600);

  const legacyWithoutPlannedTotal = JSON.parse(await readFile(LEGACY_FIXTURE, 'utf8'));
  const newWithoutPlannedTotal = JSON.parse(await readFile(NEW_FIXTURE, 'utf8'));
  delete legacyWithoutPlannedTotal.entities.invoices.totals.gross;
  delete newWithoutPlannedTotal.entities.invoices.totals.gross;
  const legacyWithoutPlannedTotalPath = resolve(work, 'legacy-missing-control.json');
  const newWithoutPlannedTotalPath = resolve(work, 'new-missing-control.json');
  await writeFile(legacyWithoutPlannedTotalPath, `${JSON.stringify(legacyWithoutPlannedTotal, null, 2)}\n`);
  await writeFile(newWithoutPlannedTotalPath, `${JSON.stringify(newWithoutPlannedTotal, null, 2)}\n`);
  const missingControl = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', legacyWithoutPlannedTotalPath,
    '--new', newWithoutPlannedTotalPath,
    '--run-id', 'synthetic-missing-control-run',
  ], { DIZI_RECONCILIATION_ALERT_URL: undefined, DIZI_RECONCILIATION_ALERT_TOKEN: undefined });
  const missingControlJson = JSON.parse(missingControl.stdout);
  check('a planned monetary control missing from both sources cannot produce a false clean result', missingControl.code === 3 && missingControlJson.status === 'drift' && missingControlJson.issues.filter((entry) => entry.code === 'planned_total_missing').length === 2 && missingControlJson.comparison.entities.invoices.issueCount === 2 && missingControlJson.summary.alertPriority === 'P1');

  const alteredNew = JSON.parse(await readFile(NEW_FIXTURE, 'utf8'));
  alteredNew.entities.invoices.totals.gross.minorUnits = '125001';
  alteredNew.entities.patients.count = 3;
  alteredNew.entities.patients.byStatus.active = 3;
  const alteredNewPath = resolve(work, 'new-with-injected-drift.json');
  await writeFile(alteredNewPath, `${JSON.stringify(alteredNew, null, 2)}\n`);

  const received = [];
  receiver = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({
        method: request.method,
        contentType: request.headers['content-type'],
        eventHeader: request.headers['x-dizi-event'],
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.writeHead(204).end();
    });
  });
  const alertUrl = await listen(receiver);
  const driftReport = resolve(work, 'drift.json');
  const drift = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', LEGACY_FIXTURE,
    '--new', alteredNewPath,
    '--report', driftReport,
    '--run-id', 'synthetic-injected-run',
  ], {
    DIZI_RECONCILIATION_ALERT_URL: alertUrl,
    DIZI_RECONCILIATION_ALERT_TOKEN: 'test-only-token',
  });
  const driftJson = JSON.parse(await readFile(driftReport, 'utf8'));
  const posted = received[0];
  check('an injected row-count and money mismatch produce a drift report and non-zero status', drift.code === 2 && driftJson.status === 'drift' && driftJson.summary.issueCount >= 2);
  check('financial drift is identified as P1 in the local reconciliation result', driftJson.summary.alertPriority === 'P1' && driftJson.issues.some((entry) => entry.code === 'total_mismatch' && entry.priority === 'P1'));
  check('the drift alert is POSTed with the configured bearer token', received.length === 1 && posted.method === 'POST' && posted.authorization === 'Bearer test-only-token');
  check('the webhook gets plan and issue metadata but no monetary values', posted.eventHeader === 'dizihospital.reconciliation.drift' && posted.body.event === 'dizihospital.reconciliation.drift' && posted.body.planId === 'synthetic-p0-406-v1' && posted.body.priority === 'P1' && !JSON.stringify(posted.body).includes('125001'));
  check('the report records successful alert delivery', driftJson.alert.delivery === 'sent');
  await close(receiver);
  receiver = null;

  const noReceiver = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', LEGACY_FIXTURE,
    '--new', alteredNewPath,
    '--run-id', 'synthetic-no-receiver-run',
  ], { DIZI_RECONCILIATION_ALERT_URL: undefined, DIZI_RECONCILIATION_ALERT_TOKEN: undefined });
  const noReceiverJson = JSON.parse(noReceiver.stdout);
  check('drift without an alert receiver cannot exit cleanly', noReceiver.code === 3 && noReceiverJson.alert.delivery === 'missing' && /DRIFT ALERT NOT DELIVERED/.test(noReceiver.stderr));

  const badScope = JSON.parse(await readFile(NEW_FIXTURE, 'utf8'));
  badScope.scope.branch = 'synthetic-branch-b';
  const badScopePath = resolve(work, 'new-wrong-branch.json');
  await writeFile(badScopePath, `${JSON.stringify(badScope, null, 2)}\n`);
  const badScopeResult = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', LEGACY_FIXTURE,
    '--new', badScopePath,
    '--run-id', 'synthetic-scope-mismatch-run',
  ], { DIZI_RECONCILIATION_ALERT_URL: undefined, DIZI_RECONCILIATION_ALERT_TOKEN: undefined });
  const badScopeJson = JSON.parse(badScopeResult.stdout);
  check('different branch scopes are alerted as incomparable rather than reported clean', badScopeResult.code === 3 && !badScopeJson.comparison.performed && badScopeJson.issues.some((entry) => entry.code === 'scope_mismatch'));

  const staleCapture = JSON.parse(await readFile(NEW_FIXTURE, 'utf8'));
  staleCapture.capturedAt = '2026-10-20T03:00:00.000Z';
  const stalePath = resolve(work, 'new-stale-capture.json');
  await writeFile(stalePath, `${JSON.stringify(staleCapture, null, 2)}\n`);
  const staleResult = await execute([
    '--plan', PLAN_FIXTURE,
    '--legacy', LEGACY_FIXTURE,
    '--new', stalePath,
    '--run-id', 'synthetic-stale-capture-run',
  ], { DIZI_RECONCILIATION_ALERT_URL: undefined, DIZI_RECONCILIATION_ALERT_TOKEN: undefined });
  const staleJson = JSON.parse(staleResult.stdout);
  check('capture skew over 30 minutes suppresses parity and fails closed', staleResult.code === 3 && !staleJson.comparison.performed && staleJson.issues.some((entry) => entry.code === 'capture_skew'));

  const invalid = await execute(['--plan', PLAN_FIXTURE, '--legacy', LEGACY_FIXTURE, '--new', LEGACY_FIXTURE]);
  check('the CLI refuses to compare a legacy snapshot to itself', invalid.code === 1 && /different files/.test(invalid.stderr));
} catch (error) {
  failed++;
  console.error(`  ✗ reconciliation test harness: ${error.message}`);
} finally {
  if (receiver) await close(receiver);
  await rm(work, { recursive: true, force: true });
}

console.log(`\nreconciliation — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
