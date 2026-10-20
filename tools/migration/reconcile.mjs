#!/usr/bin/env node
/**
 * Compare the nightly, normalized control snapshots from the legacy and new systems.
 *
 * The source adapters are intentionally outside this command: O1 data access and the entity mappings determine how
 * each system can safely produce a snapshot. This program only compares those snapshots; it never connects to either
 * system, writes records, or attempts to repair a difference.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT_VERSION = 1;
const DEFAULT_MAX_SKEW_MINUTES = 30;
const EXIT = Object.freeze({ CLEAN: 0, INPUT_ERROR: 1, DRIFT: 2, ALERT_NOT_DELIVERED: 3 });
const CATEGORIES = new Set(['clinical', 'financial', 'inventory', 'master', 'other']);
const ENTITY_NAME = /^[a-z][a-z0-9_.-]*$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const INTEGER = /^-?(?:0|[1-9]\d*)$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`);
  return value;
}

function instant(value, path) {
  if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${path} must be an ISO-8601 timestamp with a timezone`);
  }
  return value;
}

function safeCount(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a non-negative safe integer`);
  return value;
}

function canonicalDecimal(value, path) {
  if (typeof value !== 'string' || !DECIMAL.test(value) || value === '-0') {
    throw new Error(`${path} must be an exact decimal string (no exponent or leading zeroes)`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const zero = /^0+$/.test(whole) && trimmedFraction === '';
  return `${negative && !zero ? '-' : ''}${whole}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}

function validateTotal(total, path) {
  if (!object(total)) throw new Error(`${path} must be an object`);
  if (total.kind === 'money') {
    if (typeof total.currency !== 'string' || !/^[A-Z]{3}$/.test(total.currency)) {
      throw new Error(`${path}.currency must be a three-letter uppercase currency code`);
    }
    if (typeof total.minorUnits !== 'string' || !INTEGER.test(total.minorUnits) || total.minorUnits === '-0') {
      throw new Error(`${path}.minorUnits must be an exact integer string`);
    }
    return { kind: 'money', currency: total.currency, minorUnits: total.minorUnits };
  }
  if (total.kind === 'quantity') {
    requiredString(total.unit, `${path}.unit`);
    return { kind: 'quantity', unit: total.unit, value: canonicalDecimal(total.value, `${path}.value`) };
  }
  throw new Error(`${path}.kind must be "money" or "quantity"`);
}

function validatePlan(input) {
  if (!object(input)) throw new Error('control plan root must be an object');
  if (input.schemaVersion !== FORMAT_VERSION) throw new Error(`control plan schemaVersion must be ${FORMAT_VERSION}`);
  const planId = requiredString(input.planId, 'control plan.planId');
  if (!object(input.entities) || Object.keys(input.entities).length === 0) {
    throw new Error('control plan.entities must declare at least one entity');
  }
  const entities = Object.create(null);
  for (const [name, raw] of Object.entries(input.entities)) {
    if (!ENTITY_NAME.test(name)) throw new Error(`control plan has an invalid entity name: ${name}`);
    if (!object(raw) || !CATEGORIES.has(raw.category)) throw new Error(`control plan.entities.${name}.category is invalid`);
    if (!object(raw.totals)) throw new Error(`control plan.entities.${name}.totals must be an object`);
    const totals = Object.create(null);
    for (const [measure, definition] of Object.entries(raw.totals)) {
      if (measure.trim() === '' || !object(definition)) throw new Error(`control plan.entities.${name}.totals has an invalid measure`);
      if (definition.kind === 'money') {
        if (typeof definition.currency !== 'string' || !/^[A-Z]{3}$/.test(definition.currency)) {
          throw new Error(`control plan.entities.${name}.totals.${measure}.currency is invalid`);
        }
        totals[measure] = { kind: 'money', currency: definition.currency };
      } else if (definition.kind === 'quantity') {
        totals[measure] = { kind: 'quantity', unit: requiredString(definition.unit, `control plan.entities.${name}.totals.${measure}.unit`) };
      } else {
        throw new Error(`control plan.entities.${name}.totals.${measure}.kind must be "money" or "quantity"`);
      }
    }
    entities[name] = { category: raw.category, totals };
  }
  return { planId, entities };
}

function validateSnapshot(input, expectedSource, label) {
  if (!object(input)) throw new Error(`${label} snapshot root must be an object`);
  if (input.schemaVersion !== FORMAT_VERSION) throw new Error(`${label}.schemaVersion must be ${FORMAT_VERSION}`);
  if (input.source !== expectedSource) throw new Error(`${label}.source must be "${expectedSource}"`);

  const planId = requiredString(input.planId, `${label}.planId`);
  const snapshotId = requiredString(input.snapshotId, `${label}.snapshotId`);
  const capturedAt = instant(input.capturedAt, `${label}.capturedAt`);
  if (!object(input.scope)) throw new Error(`${label}.scope must be an object`);
  const branch = requiredString(input.scope.branch, `${label}.scope.branch`);
  if (!object(input.scope.period)) throw new Error(`${label}.scope.period must be an object`);
  const from = instant(input.scope.period.from, `${label}.scope.period.from`);
  const to = instant(input.scope.period.to, `${label}.scope.period.to`);
  if (Date.parse(from) >= Date.parse(to)) throw new Error(`${label}.scope.period.from must be earlier than to`);
  if (!Array.isArray(input.scope.entities) || input.scope.entities.length === 0) {
    throw new Error(`${label}.scope.entities must name at least one expected entity`);
  }
  const entitiesInScope = input.scope.entities.map((name, index) => {
    requiredString(name, `${label}.scope.entities[${index}]`);
    if (!ENTITY_NAME.test(name)) throw new Error(`${label}.scope.entities[${index}] has an invalid entity name`);
    return name;
  });
  if (new Set(entitiesInScope).size !== entitiesInScope.length) throw new Error(`${label}.scope.entities must not contain duplicates`);

  if (!object(input.entities)) throw new Error(`${label}.entities must be an object`);
  const entities = Object.create(null);
  for (const [name, raw] of Object.entries(input.entities)) {
    if (!ENTITY_NAME.test(name)) throw new Error(`${label}.entities has an invalid entity name`);
    if (!object(raw)) throw new Error(`${label}.entities.${name} must be an object`);
    if (!CATEGORIES.has(raw.category)) throw new Error(`${label}.entities.${name}.category is invalid`);
    const count = safeCount(raw.count, `${label}.entities.${name}.count`);
    if (!object(raw.byStatus)) throw new Error(`${label}.entities.${name}.byStatus must be an object`);
    const byStatus = Object.create(null);
    let statusTotal = 0n;
    for (const [status, value] of Object.entries(raw.byStatus)) {
      if (status.trim() === '') throw new Error(`${label}.entities.${name}.byStatus contains an empty status`);
      byStatus[status] = safeCount(value, `${label}.entities.${name}.byStatus.${status}`);
      statusTotal += BigInt(value);
    }
    if (!object(raw.totals)) throw new Error(`${label}.entities.${name}.totals must be an object (use {} when there are no totals)`);
    const totals = Object.create(null);
    for (const [measure, total] of Object.entries(raw.totals)) {
      if (measure.trim() === '') throw new Error(`${label}.entities.${name}.totals contains an empty measure`);
      totals[measure] = validateTotal(total, `${label}.entities.${name}.totals.${measure}`);
    }
    entities[name] = { category: raw.category, count, byStatus, totals, statusTotal: statusTotal.toString() };
  }

  return {
    source: expectedSource,
    planId,
    snapshotId,
    capturedAt,
    scope: { branch, period: { from, to }, entities: entitiesInScope },
    entities,
  };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameScope(left, right) {
  return left.branch === right.branch
    && Date.parse(left.period.from) === Date.parse(right.period.from)
    && Date.parse(left.period.to) === Date.parse(right.period.to)
    && stable([...left.entities].sort()) === stable([...right.entities].sort());
}

function issue(code, fields = {}) {
  return { code, priority: 'review', ...fields };
}

function p1Issue(code, fields = {}) {
  return { code, priority: 'P1', ...fields };
}

function metricView(entity) {
  if (!entity) return null;
  const { statusTotal, ...view } = entity;
  return view;
}

function totalMatchesPlan(actual, expected) {
  if (!actual || actual.kind !== expected.kind) return false;
  if (actual.kind === 'money') return actual.currency === expected.currency;
  return actual.unit === expected.unit;
}

function compareSnapshots(legacy, newer, { runId, maxSkewMinutes, plan }) {
  const issues = [];
  const planEntityNames = Object.keys(plan.entities).sort();
  const planEntitySet = new Set(planEntityNames);
  const snapshotPlanIdsMatch = legacy.planId === plan.planId && newer.planId === plan.planId;
  for (const snapshot of [legacy, newer]) {
    if (snapshot.planId !== plan.planId) {
      issues.push(issue('control_plan_mismatch', {
        source: snapshot.source,
        expectedPlanId: plan.planId,
        actualPlanId: snapshot.planId,
      }));
    }
    const declared = [...snapshot.scope.entities].sort();
    const missing = planEntityNames.filter((name) => !declared.includes(name));
    const unexpected = declared.filter((name) => !planEntitySet.has(name));
    if (missing.length || unexpected.length) {
      issues.push(issue('plan_scope_mismatch', { source: snapshot.source, missingEntities: missing, unexpectedEntities: unexpected }));
    }
    const declaredSet = new Set(snapshot.scope.entities);
    for (const name of Object.keys(snapshot.entities)) {
      if (!declaredSet.has(name)) issues.push(issue('unexpected_entity', { source: snapshot.source, entity: name }));
      if (!planEntitySet.has(name)) issues.push(issue('unplanned_entity', { source: snapshot.source, entity: name }));
      const entity = snapshot.entities[name];
      if (BigInt(entity.statusTotal) !== BigInt(entity.count)) {
        issues.push(issue('internal_status_count_mismatch', {
          source: snapshot.source,
          entity: name,
          rowCount: entity.count,
          statusTotal: entity.statusTotal,
        }));
      }
    }
    for (const name of snapshot.scope.entities) {
      if (!snapshot.entities[name]) issues.push(issue('entity_snapshot_missing', { source: snapshot.source, entity: name }));
    }
    for (const name of planEntityNames) {
      const actual = snapshot.entities[name];
      const expected = plan.entities[name];
      if (!actual) {
        if (!declaredSet.has(name)) issues.push(issue('entity_snapshot_missing', { source: snapshot.source, entity: name }));
        continue;
      }
      if (actual.category !== expected.category) {
        const priority = actual.category === 'financial' || expected.category === 'financial' ? p1Issue : issue;
        issues.push(priority('entity_category_mismatch', {
          source: snapshot.source,
          entity: name,
          expected: expected.category,
          actual: actual.category,
        }));
      }
      const financial = expected.category === 'financial' || actual.category === 'financial';
      for (const [measure, definition] of Object.entries(expected.totals)) {
        const total = actual.totals[measure];
        if (!total) {
          issues.push((financial || definition.kind === 'money' ? p1Issue : issue)('planned_total_missing', {
            source: snapshot.source,
            entity: name,
            measure,
          }));
        } else if (!totalMatchesPlan(total, definition)) {
          issues.push((financial || definition.kind === 'money' || total.kind === 'money' ? p1Issue : issue)('planned_total_definition_mismatch', {
            source: snapshot.source,
            entity: name,
            measure,
            expected: definition,
            actual: total.kind === 'money'
              ? { kind: total.kind, currency: total.currency }
              : { kind: total.kind, unit: total.unit },
          }));
        }
      }
      for (const [measure, total] of Object.entries(actual.totals)) {
        if (!Object.hasOwn(expected.totals, measure)) {
          issues.push((financial || total.kind === 'money' ? p1Issue : issue)('unplanned_total', {
            source: snapshot.source,
            entity: name,
            measure,
          }));
        }
      }
    }
  }

  const scopeMatches = sameScope(legacy.scope, newer.scope);
  if (!scopeMatches) {
    const differing = [];
    if (legacy.scope.branch !== newer.scope.branch) differing.push('branch');
    if (Date.parse(legacy.scope.period.from) !== Date.parse(newer.scope.period.from)) differing.push('period.from');
    if (Date.parse(legacy.scope.period.to) !== Date.parse(newer.scope.period.to)) differing.push('period.to');
    if (stable([...legacy.scope.entities].sort()) !== stable([...newer.scope.entities].sort())) differing.push('entities');
    issues.push(issue('scope_mismatch', { fields: differing }));
  }

  const captureSkewMs = Math.abs(Date.parse(legacy.capturedAt) - Date.parse(newer.capturedAt));
  const maxSkewMs = maxSkewMinutes * 60_000;
  const capturesAligned = captureSkewMs <= maxSkewMs;
  if (!capturesAligned) {
    issues.push(issue('capture_skew', {
      observedMinutes: Math.round((captureSkewMs / 60_000) * 100) / 100,
      maximumMinutes: maxSkewMinutes,
    }));
  }

  const planScopeMatches = [legacy, newer].every((snapshot) =>
    stable([...snapshot.scope.entities].sort()) === stable(planEntityNames));
  const canCompare = scopeMatches && capturesAligned && planScopeMatches && snapshotPlanIdsMatch;
  const comparisons = Object.create(null);
  if (canCompare) {
    for (const name of planEntityNames) {
      const oldEntity = legacy.entities[name];
      const newEntity = newer.entities[name];
      if (!oldEntity || !newEntity) continue;

      const planEntity = plan.entities[name];
      const record = { category: planEntity.category, legacy: metricView(oldEntity), new: metricView(newEntity), issueCount: 0 };
      comparisons[name] = record;
      const financial = planEntity.category === 'financial'
        || oldEntity.category === 'financial'
        || newEntity.category === 'financial';
      const addMetricIssue = (code, details, money = false) => {
        issues.push((financial || money ? p1Issue : issue)(code, { entity: name, ...details }));
        record.issueCount++;
      };

      if (oldEntity.count !== newEntity.count) {
        addMetricIssue('row_count_mismatch', { legacy: oldEntity.count, new: newEntity.count });
      }
      const statuses = [...new Set([...Object.keys(oldEntity.byStatus), ...Object.keys(newEntity.byStatus)])].sort();
      for (const status of statuses) {
        const oldCount = oldEntity.byStatus[status] ?? 0;
        const newCount = newEntity.byStatus[status] ?? 0;
        if (oldCount !== newCount) addMetricIssue('status_count_mismatch', { status, legacy: oldCount, new: newCount });
      }
      for (const [measure, definition] of Object.entries(planEntity.totals)) {
        const oldTotal = oldEntity.totals[measure];
        const newTotal = newEntity.totals[measure];
        if (!oldTotal || !newTotal || !totalMatchesPlan(oldTotal, definition) || !totalMatchesPlan(newTotal, definition)) continue;
        const oldValue = oldTotal.kind === 'money' ? BigInt(oldTotal.minorUnits) : canonicalDecimal(oldTotal.value, `${name}.${measure}.legacy.value`);
        const newValue = newTotal.kind === 'money' ? BigInt(newTotal.minorUnits) : canonicalDecimal(newTotal.value, `${name}.${measure}.new.value`);
        if (oldValue !== newValue) addMetricIssue('total_mismatch', { measure, legacy: oldTotal, new: newTotal }, definition.kind === 'money');
      }
    }
  }

  for (const [name, comparison] of Object.entries(comparisons)) {
    comparison.issueCount = issues.filter((entry) => entry.entity === name).length;
  }
  const moneyIssueCount = issues.filter((entry) => entry.priority === 'P1').length;
  const entityNames = [...new Set(issues.map((entry) => entry.entity).filter(Boolean))].sort();
  const scope = scopeMatches ? legacy.scope : { legacy: legacy.scope, new: newer.scope };
  const skippedReason = !scopeMatches ? 'scope_mismatch'
    : (!capturesAligned ? 'capture_skew'
      : (!planScopeMatches ? 'plan_scope_mismatch' : (!snapshotPlanIdsMatch ? 'control_plan_mismatch' : null)));
  return {
    schemaVersion: FORMAT_VERSION,
    planId: plan.planId,
    runId,
    generatedAt: new Date().toISOString(),
    status: issues.length === 0 ? 'clean' : 'drift',
    scope,
    sources: {
      legacy: { planId: legacy.planId, snapshotId: legacy.snapshotId, capturedAt: legacy.capturedAt },
      new: { planId: newer.planId, snapshotId: newer.snapshotId, capturedAt: newer.capturedAt },
    },
    captureSkewMs,
    comparison: {
      performed: canCompare,
      skippedReason,
      entities: comparisons,
    },
    summary: {
      entitiesExpected: planEntityNames.length,
      entitiesCompared: Object.keys(comparisons).length,
      issueCount: issues.length,
      p1IssueCount: moneyIssueCount,
      affectedEntities: entityNames,
      alertPriority: moneyIssueCount > 0 ? 'P1' : (issues.length > 0 ? 'REVIEW' : null),
    },
    issues,
    alert: { delivery: issues.length === 0 ? 'not-needed' : 'pending' },
  };
}

function parseArgs(argv) {
  const options = { maxSkewMinutes: DEFAULT_MAX_SKEW_MINUTES };
  const valueOptions = new Set(['--plan', '--legacy', '--new', '--report', '--run-id', '--max-skew-minutes']);
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!valueOptions.has(flag)) throw new Error(`unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`${flag} may be supplied only once`);
    seen.add(flag);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--max-skew-minutes') {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) throw new Error('--max-skew-minutes must be between 0 and 1440');
      options.maxSkewMinutes = minutes;
    } else {
      const key = ({ '--plan': 'planPath', '--legacy': 'legacyPath', '--new': 'newPath', '--report': 'reportPath', '--run-id': 'runId' })[flag];
      if (options[key] !== undefined) throw new Error(`${flag} may be supplied only once`);
      options[key] = value;
    }
  }
  if (!options.planPath || !options.legacyPath || !options.newPath) throw new Error('--plan, --legacy and --new are required');
  const inputPaths = [options.planPath, options.legacyPath, options.newPath].map((path) => resolve(path));
  if (new Set(inputPaths).size !== inputPaths.length) throw new Error('--plan, --legacy and --new must be different files');
  if (options.reportPath && inputPaths.includes(resolve(options.reportPath))) {
    throw new Error('--report must not overwrite the control plan or either input snapshot');
  }
  options.runId ??= `recon-${randomUUID()}`;
  return options;
}

async function loadPlan(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error('cannot read the control plan file');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('the control plan is not valid JSON');
  }
  return validatePlan(parsed);
}

async function loadSnapshot(file, source) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`cannot read the ${source} snapshot file`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`the ${source} snapshot is not valid JSON`);
  }
  return validateSnapshot(parsed, source, source);
}

function alertPayload(report) {
  const scope = report.scope?.legacy ?? report.scope;
  return {
    event: 'dizihospital.reconciliation.drift',
    runId: report.runId,
    planId: report.planId,
    priority: report.summary.alertPriority,
    branch: scope?.branch ?? null,
    period: scope?.period ?? null,
    affectedEntities: report.summary.affectedEntities,
    issueCodes: [...new Set(report.issues.map((entry) => entry.code))].sort(),
    issueCount: report.summary.issueCount,
    p1IssueCount: report.summary.p1IssueCount,
    emittedAt: new Date().toISOString(),
  };
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

async function deliverAlert(payload) {
  const target = process.env.DIZI_RECONCILIATION_ALERT_URL;
  if (!target) return { delivery: 'missing' };
  let url;
  try {
    url = new URL(target);
  } catch {
    return { delivery: 'failed', reason: 'configured alert URL is invalid' };
  }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) || url.username || url.password) {
    return { delivery: 'failed', reason: 'alert URL must use HTTPS (HTTP is allowed only for loopback tests)' };
  }
  const headers = { 'content-type': 'application/json', 'x-dizi-event': payload.event };
  const token = process.env.DIZI_RECONCILIATION_ALERT_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { delivery: 'failed', reason: `alert endpoint returned HTTP ${response.status}` };
    return { delivery: 'sent' };
  } catch (error) {
    return { delivery: 'failed', reason: error?.name === 'TimeoutError' ? 'alert endpoint timed out' : 'alert endpoint could not be reached' };
  }
}

async function writeOutput(report, reportPath) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (!reportPath) {
    process.stdout.write(serialized);
    return;
  }
  const target = resolve(reportPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized, { mode: 0o600 });
  await chmod(target, 0o600);
  process.stderr.write(`Reconciliation report written to ${target}\n`);
}

function usage() {
  return [
    'Usage: node tools/migration/reconcile.mjs --plan <controls.json> --legacy <snapshot.json> --new <snapshot.json> [options]',
    '',
    'Options:',
    '  --plan <path>                 Require the shared, versioned entity/metric control plan',
    '  --report <path>               Write the protected JSON report to this path (default: stdout)',
    '  --run-id <id>                 Set a stable reconciliation run id (otherwise generated)',
    `  --max-skew-minutes <n>        Maximum capture-time difference (default: ${DEFAULT_MAX_SKEW_MINUTES})`,
    '  --help                        Show this help',
    '',
    'Drift posts to DIZI_RECONCILIATION_ALERT_URL. See tools/migration/README.md for the snapshot format.',
  ].join('\n');
}

export { compareSnapshots, validatePlan, validateSnapshot };

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return EXIT.CLEAN;
    }
    const [plan, legacy, newer] = await Promise.all([
      loadPlan(options.planPath),
      loadSnapshot(options.legacyPath, 'legacy'),
      loadSnapshot(options.newPath, 'new'),
    ]);
    const report = compareSnapshots(legacy, newer, { ...options, plan });
    let exitCode = report.status === 'clean' ? EXIT.CLEAN : EXIT.DRIFT;
    if (report.status === 'drift') {
      const result = await deliverAlert(alertPayload(report));
      report.alert = result;
      if (result.delivery !== 'sent') {
        exitCode = EXIT.ALERT_NOT_DELIVERED;
        process.stderr.write(`DRIFT ALERT NOT DELIVERED: ${result.reason ?? 'DIZI_RECONCILIATION_ALERT_URL is not configured'}\n`);
      } else {
        process.stderr.write(`DRIFT ALERT delivered: ${report.summary.alertPriority}, ${report.summary.issueCount} issue(s)\n`);
      }
    }
    await writeOutput(report, options.reportPath);
    return exitCode;
  } catch (error) {
    process.stderr.write(`Reconciliation error: ${error.message}\n\n${usage()}\n`);
    return EXIT.INPUT_ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
