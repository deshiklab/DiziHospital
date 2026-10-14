#!/usr/bin/env node
/**
 * The report suite's rules, exercised (P6).
 *
 * Seventeen Reports › … screens share one framework (`apps/web/lib/report-suite.ts`), so what has to be tested is
 * the framework plus each report's own promise. The three claims a management report has to keep, and what this
 * harness does with them:
 *
 *   1. **Per branch and consolidated are the same query added up.** For every report, every row of the consolidated
 *      table is checked against the sum of the same row in each branch's table — and a branch-scope table is
 *      checked to be that branch's own rows rather than a share of the whole.
 *   2. **Figures that do not add up are not added.** A maximum, a ratio and an average are recomputed from the
 *      figures that made them (the oldest overdue claim, occupancy, the pooled response time), which is how a
 *      report ends up claiming a 339-day-old claim that is two claims of 170.
 *   3. **A branch that cannot answer says so.** A satellite with no in-patient beds, and a branch with no register
 *      of its own, get a reason rather than a row of zeros — and the reason names what is missing.
 *
 * It also keeps the phase's own count honest: the built reports plus the planned ones must be the seventeen screens
 * the legacy product had, so the phase cannot be declared finished with screens missing.
 *
 * Needs one dev-only package:
 *
 *     npm i --no-save esbuild && npm run test:reports
 *
 * Exit code 0 when every case passes, 1 otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:reports` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-reports-test-'));
const failures = [];
const DAY = '2026-10-14';

function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

const num = (v) => (typeof v === 'number' ? v : 0);

try {
  await esbuild.build({
    entryPoints: [join(root, 'apps/web/lib/report-suite.ts')],
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  const R = await import(pathToFileURL(join(work, 'report-suite.js')).href);
  const { buildReport, REPORTS, PLANNED_REPORTS, REPORT_SUITE_TOTAL, REPORT_GROUPS, branches, CONSOLIDATED, SCOPES } = R;
  const build = (topic, scope, range = 'week') => buildReport(topic, { day: DAY, range, scope });

  /**
   * The rules a figure adds up by — written out again here rather than imported, because a mirror that shares the
   * framework's code proves only that the framework agrees with itself. A ratio is recomputed from its own two
   * figures, an average is pooled over its own total and count, a maximum stays a maximum, and everything else adds.
   */
  const aggregate = (column, rows) => {
    if (column.percentOf) {
      const part = rows.reduce((n, r) => n + num(r.cells[column.percentOf.part]), 0);
      const whole = rows.reduce((n, r) => n + num(r.cells[column.percentOf.whole]), 0);
      return Math.round((part / Math.max(1, whole)) * 100);
    }
    if (column.avgOf) {
      const total = rows.reduce((n, r) => n + num(r.cells[column.avgOf.total]), 0);
      const count = rows.reduce((n, r) => n + num(r.cells[column.avgOf.count]), 0);
      const factor = 10 ** (column.avgOf.round ?? 0);
      return count === 0 ? 0 : Math.round((total / count) * factor) / factor;
    }
    if ((column.aggregate ?? 'sum') === 'max') return rows.reduce((n, r) => Math.max(n, num(r.cells[column.key])), 0);
    return rows.reduce((n, r) => n + num(r.cells[column.key]), 0);
  };

  console.log('\nreports — the suite, the framework and the seventeen\n');

  /* ---------------------------------------------------------------- the phase's own count */
  console.log('  the suite');
  pass('the built reports plus the planned ones are the seventeen screens the legacy product had',
    REPORTS.length + PLANNED_REPORTS.length === REPORT_SUITE_TOTAL,
    `${REPORTS.length} built + ${PLANNED_REPORTS.length} planned = ${REPORTS.length + PLANNED_REPORTS.length} of ${REPORT_SUITE_TOTAL}`);
  pass('every report is in a group the hub renders, and no topic or legacy screen is claimed twice',
    REPORTS.every((d) => REPORT_GROUPS.includes(d.group))
      && new Set(REPORTS.map((d) => d.topic)).size === REPORTS.length
      && new Set(REPORTS.map((d) => d.legacy)).size === REPORTS.length
      && new Set(PLANNED_REPORTS.map((p) => p.legacy)).size === PLANNED_REPORTS.length,
    REPORTS.map((d) => d.topic).join(', '));
  pass('every report says what it answers, who owns it, when it goes out, and what it reads',
    REPORTS.every((d) => d.question.length > 40 && d.owner.length > 3 && d.schedule.length > 10 && d.filters.length >= 5 && d.columns.length >= 2 && d.maxDays >= 1),
    REPORTS.map((d) => `${d.topic}:${d.filters.length}f/${d.columns.length}c`).join(' '));
  pass('the scope switch offers every branch and the consolidated view',
    SCOPES[0] === CONSOLIDATED && SCOPES.length === branches.length + 1,
    SCOPES.join(' · '));

  /* ---------------------------------------------------------------- additivity, report by report */
  console.log('\n  per branch and consolidated');
  for (const def of REPORTS) {
    /* A contract-wide report is deliberately not the branches added up — see its own case below — so the additivity
       rule does not apply to it. */
    if (def.sameEverywhere) {
      const table = build(def.topic, CONSOLIDATED);
      pass(`${def.topic}: a report of the product’s own rules is not offered as a branch sum`,
        table.rows.length > 0 && !table.columns.some((c) => c.key.startsWith('branch:')),
        `${table.rows.length} rows, checked in its own case below`);
      continue;
    }

    const all = build(def.topic, CONSOLIDATED);
    const perBranch = branches.map((b) => ({ b, t: build(def.topic, b) }));

    let cellProblems = 0;
    for (const row of all.rows) {
      for (const column of def.columns) {
        if (column.kind === 'text') continue;
        const expected = aggregate(column, perBranch.map(({ t }) => ({ cells: t.rows.find((r) => r.id === row.id)?.cells ?? {} })));
        if (Number(row.cells[column.key]) !== expected) cellProblems += 1;
      }
    }

    const totalProblems = def.columns.filter((c) => c.kind !== 'text').filter((c) => aggregate(c, all.rows) !== all.totals[c.key]).length;
    const branchProblems = perBranch.filter(({ t }) => def.columns.filter((c) => c.kind !== 'text').some((c) => aggregate(c, t.rows) !== t.totals[c.key])).length;

    pass(`${def.topic}: the consolidated table is the branches added up, and the totals are the rows`,
      all.rows.length > 0 && cellProblems === 0 && totalProblems === 0 && branchProblems === 0,
      `${all.rows.length} rows · ${perBranch.map(({ b, t }) => `${b.split(' ')[0]} ${t.rows.length}`).join(' ')} · ${cellProblems} cell / ${totalProblems} total / ${branchProblems} branch problem(s)`);
  }

  /* ---------------------------------------------------------------- figures that do not add up */
  console.log('\n  the figures that must not be added');
  const tpaAll = build('tpa', CONSOLIDATED);
  const tpaColumn = tpaAll.def.columns.find((c) => c.key === 'oldest');
  const oldestSum = branches.reduce((n, b) => n + Number(build('tpa', b).totals.oldest ?? 0), 0);
  pass('the oldest overdue claim is a maximum, not a sum of ages',
    tpaColumn?.aggregate === 'max' && tpaAll.totals.oldest <= oldestSum
      && tpaAll.totals.oldest === Math.max(...branches.map((b) => Number(build('tpa', b).totals.oldest ?? 0))),
    `consolidated ${tpaAll.totals.oldest} days · the branches' oldest are ${branches.map((b) => build('tpa', b).totals.oldest).join(', ')} · summing them would say ${oldestSum}`);

  const ipdAll = build('ipd', CONSOLIDATED);
  const ipdColumn = ipdAll.def.columns.find((c) => c.key === 'occupancyPct');
  pass('occupancy is recomputed from occupied beds over beds in service, never averaged or summed',
    ipdColumn?.percentOf?.part === 'occupied' && ipdColumn?.percentOf?.whole === 'beds'
      && ipdAll.totals.occupancyPct === Math.round((ipdAll.totals.occupied / Math.max(1, ipdAll.totals.beds)) * 100)
      && ipdAll.totals.occupancyPct <= 100,
    `${ipdAll.totals.occupied} occupied of ${ipdAll.totals.beds} in service = ${ipdAll.totals.occupancyPct} %`);

  /* The pooled average is the one a reader is most likely to catch: two vehicles with a 12- and a 35-minute
     response average 23.5 minutes, and the mean of two means that each covered one run is the same only by
     coincidence. The check is that the total is the pooled figure and not the mean of the rows' own averages. */
  const ambAll = build('ambulance', CONSOLIDATED);
  const ambColumn = ambAll.def.columns.find((c) => c.key === 'avgResponse');
  const visited = ambAll.rows.map((r) => ({ total: num(r.cells.minutes), count: num(r.cells.responded) }));
  const pooled = Math.round((visited.reduce((n, x) => n + x.total, 0) / Math.max(1, visited.reduce((n, x) => n + x.count, 0))) * 10) / 10;
  const meanOfMeans = ambAll.rows.length === 0 ? 0 : Math.round((ambAll.rows.reduce((n, r) => n + num(r.cells.avgResponse), 0) / ambAll.rows.length) * 10) / 10;
  pass('the response time is pooled over its own minutes and calls, not the mean of the rows’ means',
    ambColumn?.avgOf?.total === 'minutes' && ambAll.totals.avgResponse === pooled,
    `pooled ${ambAll.totals.avgResponse} min over ${visited.reduce((n, x) => n + x.count, 0)} run(s) · averaging the rows would say ${meanOfMeans}`);

  const opdAvg = build('opd', CONSOLIDATED);
  pass('a figure carried by two unprinted columns is still carried into the consolidated row',
    opdAvg.def.columns.every((c) => !c.avgOf || (c.avgOf.count in (opdAvg.rows[0]?.cells ?? {})) || opdAvg.rows.length === 0),
    'the ratio and average columns can be recomputed from the row itself');

  /* ---------------------------------------------------------------- where a branch cannot answer */
  console.log('\n  where a branch cannot answer');
  const ipdMirpur = build('ipd', 'Mirpur Branch');
  pass('a branch with no in-patient service gets a reason, not a row of zeros',
    ipdMirpur.rows.length === 0 && ipdMirpur.unavailable.some((u) => u.branch === 'Mirpur Branch' && /no in-patient service/.test(u.because)),
    ipdMirpur.unavailable.map((u) => u.branch).join(', '));

  const financeUttara = build('finance', 'Uttara Branch');
  pass('a branch with no ledger of its own is told so rather than handed a share of another branch’s book',
    financeUttara.rows.length === 0 && financeUttara.unavailable.some((u) => u.branch === 'Uttara Branch' && /not a share of another branch’s till/.test(u.because)),
    financeUttara.unavailable[0]?.because.slice(0, 70) ?? 'no reason given');

  const storeMirpur = build('inventory', 'Mirpur Branch');
  pass('a register that belongs to one site is named as such rather than divided three ways',
    storeMirpur.rows.length === 0 && /store ledger is Main Campus’s/.test(storeMirpur.unavailable.find((u) => u.branch === 'Mirpur Branch')?.because ?? ''),
    storeMirpur.unavailable.length ? `${storeMirpur.unavailable.length} branch(es) refused with a reason` : 'no refusal');

  const opdAll = build('opd', CONSOLIDATED);
  pass('every branch runs out-patients, so the opd report refuses nobody',
    opdAll.rows.length > 0 && opdAll.unavailable.length === 0,
    `${opdAll.rows.length} departments across ${branches.length} branches`);

  /* ---------------------------------------------------------------- a report that is the same everywhere */
  const logAll = build('log', CONSOLIDATED);
  const logSum = branches.reduce((n, b) => n + Number(build('log', b).totals.operations ?? 0), 0);
  pass('a report about the product itself is read once instead of being counted three times',
    logAll.def.sameEverywhere !== undefined
      && logAll.totals.operations === Number(build('log', 'Mirpur Branch').totals.operations)
      && /not three branches added up/.test(logAll.reconciliation)
      && !logAll.columns.some((c) => c.key.startsWith('branch:')),
    `${logAll.totals.operations} operations, the same figure in every branch scope — adding the three branches up would have said ${logSum * branches.length}`);

  /* ---------------------------------------------------------------- what every report owes a reader */
  console.log('\n  what a report owes the person reading it');
  for (const def of REPORTS) {
    const table = build(def.topic, CONSOLIDATED);
    const named = table.daysRead.length > 0 && new RegExp(`${table.daysRead[0]} to ${table.daysRead[table.daysRead.length - 1]}`).test(table.rangeNote);
    const reconciles = /added up by this report|records the branch itself wrote|not three branches added up/.test(table.reconciliation);
    const controls = table.closing.length > 60;
    pass(`${def.topic}: names the days it read, how it adds up, and the control total it answers to`,
      named && reconciles && controls,
      `${table.daysRead.length} day(s) · ${table.closing.length} chars of control`);
  }

  const monthPath = build('pathology', CONSOLIDATED, 'month');
  pass('a range wider than the data says which days it read instead of implying the whole month',
    monthPath.daysRead.length === monthPath.def.maxDays && /asked for 30/.test(monthPath.rangeNote),
    monthPath.rangeNote.slice(0, 90));

  const todayPatient = build('patient', CONSOLIDATED, 'today');
  pass('a range narrower than the data narrows the report with it',
    todayPatient.daysRead.length === 1 && /1 day/.test(todayPatient.rangeNote),
    todayPatient.rangeNote.slice(0, 76));

  const consolidated = build('appointment', CONSOLIDATED);
  pass('the consolidated table carries each branch beside the row, so the sum is visible and not just claimed',
    branches.every((b) => consolidated.columns.some((c) => c.key === `branch:${b}`))
      && consolidated.rows.every((r) => branches.every((b) => num(r.from?.[b]) === num(build('appointment', b).rows.find((x) => x.id === r.id)?.cells.booked))),
    consolidated.columns.filter((c) => c.key.startsWith('branch:')).map((c) => c.header).join(' · '));

  /* The two reports whose figures are also printed on an operational screen have to agree with it: a report that
     differs from the board the staff read is worse than no report, because one of the two is wrong and neither
     says which. */
  const ambClosed = build('ambulance', CONSOLIDATED);
  const ambQuoted = ambClosed.closing.match(/average response was ([0-9.]+) minutes/);
  pass('the ambulance report’s average response is the fleet screen’s own figure, not a second opinion',
    ambQuoted !== null && Number(ambQuoted[1]) === ambClosed.totals.avgResponse,
    `the closing quotes ${ambQuoted?.[1] ?? 'nothing measurable'} and the table totals ${ambClosed.totals.avgResponse} min`);

  const otClosed = build('ot', CONSOLIDATED);
  const otQuoted = otClosed.closing.match(/lists plan ([0-9]+) % of the four theatres/);
  pass('the theatre report’s utilisation is the theatre screen’s own figure, not a second opinion',
    otQuoted !== null && Number(otQuoted[1]) === otClosed.totals.utilisation,
    `the closing quotes ${otQuoted?.[1] ?? 'nothing'} % and the table totals ${otClosed.totals.utilisation} %`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\nFAILED — ${failures.length} case${failures.length === 1 ? '' : 's'}\n`);
  process.exit(1);
}
console.log('\nOK — every report adds up per branch, never sums a maximum, a ratio or an average, and says where it cannot answer.\n');
process.exit(0);
