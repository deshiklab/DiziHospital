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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    entryPoints: [
      join(root, 'apps/web/lib/report-suite.ts'),
      join(root, 'apps/web/lib/birthdeath.ts'),
      join(root, 'apps/web/lib/report-schedules.ts'),
    ],
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
  const V = await import(pathToFileURL(join(work, 'birthdeath.js')).href);
  const SCH = await import(pathToFileURL(join(work, 'report-schedules.js')).href);
  const contract = JSON.parse(readFileSync(join(root, 'packages/contracts/openapi.json'), 'utf8'));
  const { buildReport, reportByTopic, REPORTS, PLANNED_REPORTS, REPORT_SUITE_TOTAL, REPORT_GROUPS, branches, CONSOLIDATED, SCOPES } = R;
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
  pass('the seventeen screens the legacy product had are all built, and nothing is left on the planned list',
    REPORTS.length === REPORT_SUITE_TOTAL && PLANNED_REPORTS.length === 0,
    `${REPORTS.length} built of ${REPORT_SUITE_TOTAL}, ${PLANNED_REPORTS.length} still planned`);
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

  /* ---------------------------------------------------------------- the saved views */
  console.log('\n  the views a reader opens the report for');
  const withViews = REPORTS.filter((d) => (d.views?.length ?? 0) > 0);
  pass('every report has at least one saved view',
    withViews.length === REPORTS.length,
    REPORTS.map((d) => `${d.topic}:${d.views?.length ?? 0}`).join(' '));

  let emptyViews = [];
  let drops = 0;
  for (const def of withViews) {
    const table = build(def.topic, CONSOLIDATED);
    const labels = def.views.map((v) => v.label);
    if (new Set(labels).size !== labels.length) emptyViews.push(`${def.topic}: duplicate label`);
    if (labels.some((l) => l.trim().length === 0)) emptyViews.push(`${def.topic}: empty label`);
    for (const view of def.views) {
      const kept = table.rows.filter(view.keep).length;
      /* A chip that leads to an empty table reads as a broken report, so every view keeps something on the day the
         preview shows — and at least one of them has to actually drop a row, or the filters are not wired at all. */
      if (kept === 0) emptyViews.push(`${def.topic} / ${view.label}`);
      if (kept < table.rows.length) drops += 1;
    }
  }
  pass('every saved view keeps at least one row, and the views really do filter',
    emptyViews.length === 0 && drops > 0,
    emptyViews.length ? `empty: ${emptyViews.join(', ')}` : `${withViews.length} reports, ${withViews.reduce((n, d) => n + d.views.length, 0)} views, ${drops} of them dropping rows`);

  /* ---------------------------------------------------------------- the register the last report reads */
  console.log('\n  the vital-events register');
  const register = V.birthDeathDay(DAY);
  pass('the register reads the day’s own records rather than inventing people',
    register.births.every((b) => b.mother.mrn !== '—')
      && register.deaths.some((d) => d.kind === 'Brought in dead' && /ambulance|AMB-/i.test(d.note ?? '')),
    `${register.births.length} births, ${register.deaths.length} deaths — the obstetric one carrying the fleet’s own call`);

  const stillbirth = register.births.find((b) => b.outcome === 'Stillbirth');
  pass('a stillbirth is recorded as a birth with its outcome and never as a live-birth registration',
    stillbirth !== undefined
      && stillbirth.civil.number === null
      && stillbirth.civil.state === 'Not applicable'
      && stillbirth.vitaminKGiven === false
      && stillbirth.bcgGiven === false,
    `${stillbirth?.registerNo}: outcome ${stillbirth?.outcome}, registration ${stillbirth?.civil.state}`);

  const medicoLegal = register.deaths.find((d) => d.police !== null);
  pass('an unnatural death goes to the police before the body moves, and the certificate waits for the post-mortem',
    medicoLegal !== undefined
      && medicoLegal.certificateNo === null
      && medicoLegal.postMortemReferred === true
      && medicoLegal.releasedAt === null
      && V.certificateState(medicoLegal).startsWith('Post-mortem'),
    `${medicoLegal?.registerNo}: ${V.certificateState(medicoLegal)} · referred ${medicoLegal?.police?.referredAt}`);

  const released = register.deaths.filter((d) => d.releasedAt !== null);
  pass('every body that left the mortuary has either a certificate or a police referral behind it, and a name',
    released.length > 0
      && released.every((d) => (d.certificateNo !== null || d.police !== null) && (d.releasedTo ?? '').length > 0)
      && register.deaths.filter((d) => d.releasedAt === null).every((d) => V.canReleaseBody(d).ok || V.canReleaseBody(d).because.length > 20),
    `${released.length} released (${released.map((d) => d.releasedTo).join(', ')}), ${register.stats.bodiesHeld} still held`);

  pass('every record in the register passes the register’s own rules',
    register.births.every((b) => V.checkBirth(b).ok) && register.deaths.every((d) => V.checkDeath(d).ok) && register.findings.length === 0,
    `${register.births.length + register.deaths.length} records checked, ${register.findings.length} finding(s)`);

  /* The rules are only worth having if they fire. Each of these is a record the register must refuse, built from a
     real one so the negative case is the same shape as the positive. */
  const noPaper = { ...register.deaths[0], certificateNo: null, releasedAt: `${DAY} 16:00`, releasedTo: null, police: null };
  pass('a body released with neither a certificate nor a referral is refused, and a release with no name at all on it',
    V.checkDeath(noPaper).reasons.some((r) => r.code === 'released-without-paper')
      && V.checkDeath(noPaper).reasons.some((r) => r.code === 'released-to-nobody')
      /* Naming the person clears the second refusal and not the first: the paper is what the body needs, and the
         name is what the register needs. */
      && !V.checkDeath({ ...noPaper, releasedTo: 'Somebody' }).reasons.some((r) => r.code === 'released-to-nobody')
      && V.checkDeath({ ...noPaper, releasedTo: 'Somebody' }).reasons.some((r) => r.code === 'released-without-paper'),
    V.checkDeath(noPaper).reasons.map((r) => r.code).join(', '));

  const unnaturalNoReferral = { ...register.deaths[0], manner: 'Unknown — referred to police', police: null };
  pass('an unnatural manner with no police referral is refused, because the body is then held on the hospital’s authority',
    V.checkDeath(unnaturalNoReferral).reasons.some((r) => r.code === 'unnatural-without-referral'),
    V.checkDeath(unnaturalNoReferral).reasons.map((r) => r.code).join(', '));

  const uncaused = { ...register.deaths[1], cause: { immediate: '', antecedent: '', underlying: '', icd: '' }, certificateNo: 'DC-X' };
  pass('a certificate number with no cause written is refused, and a blank cause is refused on its own',
    V.checkDeath(uncaused).reasons.some((r) => r.code === 'certificate-without-cause')
      && V.checkDeath({ ...uncaused, certificateNo: null }).reasons.some((r) => r.code === 'no-cause'),
    V.checkDeath(uncaused).reasons.map((r) => r.code).join(', '));

  const liveBirthAsStillbirth = { ...stillbirth, civil: { state: 'Number issued', number: 'BRIS-2026-9999' }, apgar: { oneMin: 4, fiveMin: 7 } };
  pass('a stillbirth carrying a live-birth number, or an Apgar score, is refused',
    V.checkBirth(liveBirthAsStillbirth).reasons.some((r) => r.code === 'stillbirth-as-live-birth')
      && V.checkBirth(liveBirthAsStillbirth).reasons.some((r) => r.code === 'stillbirth-with-apgar'),
    V.checkBirth(liveBirthAsStillbirth).reasons.map((r) => r.code).join(', '));

  const sectionNoReason = { ...register.births.find((b) => b.type === 'Caesarean'), complications: [] };
  pass('a caesarean without an indication is refused',
    V.checkBirth(sectionNoReason).reasons.some((r) => r.code === 'caesarean-without-indication'),
    V.checkBirth(sectionNoReason).reasons.map((r) => r.code).join(', '));

  pass('the register opens the reviews a mortality meeting reads',
    register.reviews.length >= 3
      && register.reviews.some((r) => r.kind === 'Mortality')
      && register.reviews.some((r) => r.kind === 'Maternal')
      && register.reviews.some((r) => r.kind === 'Medico-legal'),
    register.reviews.map((r) => r.kind).join(', '));

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

  /* ===================================================== the scheduled exports
   *
   * The schedules are the register's own sentences made operable, so what is checked here is agreement: the hour in
   * the schedule is the hour in the report's sentence, the file it would send is built from the report's own
   * generator with the figures as numbers, the working day comes from the branch's calendar, and the places where the
   * register contradicts itself are stated rather than smoothed over.
   */
  console.log('\n  the scheduled exports');
  const SD = '2026-10-16';
  const tableFor = (sc, day = SD) => buildReport(sc.topic, { day, range: sc.range, scope: sc.scope });
  const sendable = REPORTS.filter((r) => !(r.topic in SCH.NOT_SENDABLE));
  pass(
    'one schedule for every report the register says is sent, and the live board left out with the register\u2019s own reason',
    SCH.SCHEDULES.length === sendable.length &&
      SCH.SCHEDULES.every((sc) => REPORTS.some((r) => r.topic === sc.topic)) &&
      new Set(SCH.SCHEDULES.map((sc) => sc.topic)).size === SCH.SCHEDULES.length &&
      Object.keys(SCH.NOT_SENDABLE).length === REPORTS.length - sendable.length,
    `${SCH.SCHEDULES.length} schedules over ${REPORTS.length} reports \u00b7 ${Object.keys(SCH.NOT_SENDABLE).join(', ')} is read live and never sent`,
  );

  /* The register's sentence is the specification: every time it names has to be a time the schedule runs. */
  const timesFromProse = (text) => [...text.matchAll(/\b([01]\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0]);
  const timingDisagreements = SCH.SCHEDULES.flatMap((sc) => {
    const def = reportByTopic(sc.topic);
    return timesFromProse(def.schedule)
      .filter((t) => !sc.cadence.times.includes(t))
      .map((t) => `${sc.topic}: ${t}`);
  });
  const weeklyNamedMonday = SCH.SCHEDULES.filter((sc) => /Monday/.test(reportByTopic(sc.topic).schedule) && sc.cadence.id === 'weekly');
  pass(
    'every hour the register names is an hour the schedule runs, and a weekly sentence names its weekday',
    timingDisagreements.length === 0 && weeklyNamedMonday.every((sc) => (sc.cadence.weekdays ?? []).includes(1)),
    timingDisagreements.length === 0 ? `${SCH.SCHEDULES.length} sentences read, no hour invented` : timingDisagreements.join(' \u00b7 '),
  );

  const finance = SCH.SCHEDULES.find((sc) => sc.topic === 'finance');
  const financeRuns = SCH.nextRuns(finance.cadence, SD, 4);
  const financeCheck = SCH.checkSchedule(finance, SD);
  pass(
    'the next runs are real days with their weekdays printed, in order, and today\u2019s run included',
    financeRuns.length === 4 &&
      financeRuns.every((r, i) => i === 0 || r > financeRuns[i - 1]) &&
      financeRuns[0].startsWith(SD) &&
      SCH.describeRun(financeRuns[0]) === 'Friday 16 October 2026 at 21:00',
    financeRuns.map((r) => SCH.describeRun(r)).join(' \u00b7 '),
  );
  pass(
    'the day-book sheet is flagged against the counters\u2019 own closing time, and the branch is left to settle it',
    financeCheck.ok &&
      financeCheck.warnings.some((w) => /before the counters close/.test(w.title) && w.message.includes('21:00') && w.message.includes(SCH.COUNTERS_CLOSE)),
    financeCheck.warnings.find((w) => /counters close/.test(w.title))?.message.slice(0, 90) ?? 'no warning',
  );

  /* The first working day: New Year's Day 2027 is a Friday, so the monthly reading moves to the Sunday after it. */
  const log = SCH.SCHEDULES.find((sc) => sc.topic === 'log');
  const logRuns = SCH.nextRuns(log.cadence, SD, 4);
  const january = logRuns.find((r) => r.startsWith('2027-01'));
  const logCheck = SCH.checkSchedule(log, SD);
  pass(
    'a monthly run that names the first working day skips the weekend, and says when the calendar stops',
    logRuns[0].startsWith('2026-11-01') &&
      logRuns[1].startsWith('2026-12-01') &&
      january?.startsWith('2027-01-03') &&
      !SCH.isWorkingDay('2027-01-01') &&
      !SCH.isWorkingDay('2027-01-02') &&
      SCH.isWorkingDay('2027-01-03') &&
      logCheck.warnings.some((w) => /calendar stops before this run/.test(w.title) && w.message.includes(SCH.CALENDAR_YEARS[0])),
    `${logRuns.map((r) => r.slice(0, 10)).join(' \u00b7 ')} \u00b7 2027-01-01 is a Friday, so the reading moves to the Sunday`,
  );

  /* The register's own contradictions, and the ones a branch creates. */
  const clone = (patch) => ({ ...SCH.SCHEDULES[3], ...patch });
  const live = SCH.checkSchedule(clone({ topic: 'live_consultation' }), SD);
  const whatsapp = SCH.checkSchedule(clone({ recipients: [{ name: 'OPD manager', role: 'OPD manager', channel: 'whatsapp', address: '+8801700000000' }] }), SD);
  const nobody = SCH.checkSchedule(clone({ recipients: [] }), SD);
  const thirtyFirst = SCH.checkSchedule(clone({ cadence: { ...SCH.SCHEDULES[2].cadence, day: 31 } }), SD);
  const tooWide = SCH.checkSchedule(clone({ topic: 'log', range: 'month' }), SD);
  pass(
    'a live board, a WhatsApp recipient, an empty recipient list, a thirty-first and a period wider than the data are each refused with the reason',
    !live.ok &&
      !whatsapp.ok &&
      !nobody.ok &&
      !thirtyFirst.ok &&
      !tooWide.ok &&
      whatsapp.reasons[0].code === 'dizi.channel-cannot-carry-a-file' &&
      live.reasons.some((r) => /read live/.test(r.title)) &&
      tooWide.reasons.some((r) => /wider than the data/.test(r.title)),
    [live.reasons[0].title, whatsapp.reasons[0].title, nobody.reasons[0].title, thirtyFirst.reasons[0].title, tooWide.reasons[0].title].join(' \u00b7 '),
  );
  pass(
    'the audit committee\u2019s monthly extract cannot be built from a one-day trail, and the schedule says so rather than sending a thirty-day heading over it',
    !logCheck.ok && logCheck.reasons.some((r) => r.field === 'range' && r.message.includes('1 day')),
    logCheck.reasons[0]?.message.slice(0, 120) ?? 'no refusal',
  );

  /* What would actually go out today, and the rule that stops a quiet day being sent as an empty sheet. */
  const appointment = SCH.SCHEDULES.find((sc) => sc.topic === 'appointment');
  const appointmentTable = tableFor(appointment);
  const rowSkipped = SCH.wouldSend(appointment, { ...appointmentTable, rows: [] });
  const rowSent = SCH.wouldSend(appointment, appointmentTable);
  pass(
    'a schedule that only sends with something to report is skipped on an empty day, and says why rather than going quiet',
    rowSkipped.send === false && /skipped/.test(rowSkipped.because) && rowSent.send === true && SCH.wouldSend({ ...appointment, enabled: false }, appointmentTable).send === false,
    rowSkipped.because.slice(0, 100),
  );

  const exported = SCH.exportReport(finance, SD);
  const lines = exported.text.split('\n');
  const bodyStart = lines.findIndex((l) => l.startsWith('Dimension,'));
  const body = lines.slice(bodyStart + 1);
  const totalLine = body[body.length - 1];
  const financeTable = tableFor(finance);
  pass(
    'the file is built from the report\u2019s own generator, named for the branch and the day, and counted in bytes',
    bodyStart > 0 &&
      exported.rows === financeTable.rows.length &&
      exported.name === 'income-and-expense-by-head-all-branches-2026-10-16.csv' &&
      exported.bytes === new TextEncoder().encode(exported.text).length,
    `${exported.name} \u00b7 ${exported.rows} rows \u00b7 ${exported.bytes} bytes`,
  );
  pass(
    'the figures are numbers a spreadsheet can add up, with the unit in the heading rather than in the cell',
    lines.some((l) => l.includes('(BDT)')) && !body.some((l) => l.includes('\u09f3')) && /^Total,.*-?\d/.test(totalLine),
    totalLine.slice(0, 90),
  );
  pass(
    'the total row is the table\u2019s own totals, and a consolidated file carries each branch\u2019s own column',
    totalLine.split(',').map(Number).includes(Math.round(financeTable.totals.amount)) && lines[bodyStart].includes('Main Campus') && body.some((l) => /,-?\d+(,|$)/.test(l)),
    `total line: ${totalLine.slice(0, 70)}`,
  );
  pass(
    'the file says where it came from: the period actually read, the control total it answers to, and that the records are synthetic',
    exported.text.includes('Control total,') && exported.text.includes('preview build') && exported.text.includes('Period,') && exported.text.includes('Source,') && exported.text.includes('Built,'),
    exported.preamble[3]?.slice(0, 80) ?? '',
  );

  /* The screen and the contract: the register is editable, the save queues, and the run is the server's. */
  const schedulePage = ['(staff)', '(portal)', '(site)', ''].map((g) => join(root, 'apps/web/app', g, '/reports/schedules/page.tsx')).find((f) => existsSync(f));
  const ops = Object.fromEntries(Object.entries(contract.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => [op.operationId, { path, method, op }])));
  pass(
    'the schedules have a screen, the register reads cached at the node, and the save queues with an idempotency key',
    Boolean(schedulePage) &&
      ops.listReportSchedules?.op['x-dizi'].offline === 'cache' &&
      ops.saveReportSchedule?.op['x-dizi'].offline === 'queue' &&
      ops.saveReportSchedule?.op['x-dizi'].idempotency === 'required' &&
      ops.saveReportSchedule?.op['x-dizi'].entity === 'report.schedule',
    `${ops.listReportSchedules?.method.toUpperCase()} ${ops.listReportSchedules?.path} \u00b7 ${ops.saveReportSchedule?.method.toUpperCase()} ${ops.saveReportSchedule?.path}`,
  );
  pass(
    'a run is online-only and says why, the two entities carry the policies the client implements, and each refusal has a problem type',
    ops.runReportSchedule?.op['x-dizi'].offline === 'online-only' &&
      (ops.runReportSchedule?.op['x-dizi'].notes ?? '').length > 120 &&
      contract['x-dizi-entities']['report.schedule'].policy === 'field-level' &&
      contract['x-dizi-entities']['report.run'].policy === 'append-only' &&
      Boolean(contract['x-dizi-problem-types']['dizi.schedule-refused']) &&
      Boolean(contract['x-dizi-problem-types']['dizi.channel-cannot-carry-a-file']),
    `${ops.runReportSchedule?.method.toUpperCase()} ${ops.runReportSchedule?.path} \u2014 ${ops.runReportSchedule?.op['x-dizi'].authority}`,
  );

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
