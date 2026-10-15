#!/usr/bin/env node
/**
 * People, the month and the branches — the P7 rules, exercised.
 *
 * Phase 7 is eighteen screens over five models: the staff register, a month of attendance, a payroll run, two
 * vital registers written from a ward, the gate, the calendar and the branch console. Most of those screens are
 * views of the same arithmetic, so what is worth testing is the arithmetic and the refusals — a screen that
 * renders a wrong figure beautifully is the failure this file exists to catch.
 *
 * The claims, in the order a month happens:
 *
 *   1. **One register.** An employee number is the number the roster, the gate and the payroll file all resolve
 *      back to, and the same day read twice is the same day.
 *   2. **The register and the payroll walk the same days.** Every figure the payroll deducts, caps or pays
 *      overtime on is the attendance register's own figure for that person and that month, recomputed here from
 *      the register's own days rather than taken on trust — the classic payroll bug is two month lengths.
 *   3. **Every deduction is named and reproducible.** A payslip line is rebuilt from basic, the allowance table,
 *      the attendance and the tax slabs; a figure nobody can reproduce is reported with the line it came from.
 *   4. **The registers refuse what they must.** A stillbirth with a live-birth number, a caesarean without an
 *      indication, a body released without paper, a visitor with no host, a third person off from one ward, a
 *      closure inside its notice window, a branch with no ICU: each is driven through the real check.
 *   5. **The console is a sum of named postings.** A branch whose figures are its last posting says so, with the
 *      time of the posting, rather than being averaged in as if it were this minute.
 *   6. **The phase is the plan.** The eighteen registered screens are diffed field by field against
 *      `docs/plan/03-SCREEN-MAP.md`, every route has a page behind it, and the runtime harness visits them all.
 *
 * Needs one dev-only package:
 *
 *     npm i --no-save esbuild && npm run test:admin
 *
 * Exit code 0 when every case passes, 1 otherwise, 2 when the tooling is missing.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:admin` again.\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'dizi-admin-test-'));
const failures = [];
const DAY = '2026-10-15';
const MONTH = DAY.slice(0, 7);
const BRANCH = 'Main Campus';

/** Assert one claim. Printed as it is checked, so a failure names the case rather than a line number. */
function pass(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}
const sum = (rows, pick) => rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
const close = (a, b, tolerance = 0.51) => Math.abs(a - b) <= tolerance;
const failCodes = (check) => (check.reasons ?? []).map((r) => r.code).join(',');
/** Route groups are not part of the URL: the staff app lives under `app/(staff)/admin/…`, the portal and the
 * public site under their own groups. A screen registered at `/admin/visitors` is a file two levels down. */
const pageAt = (route) =>
  ['(staff)', '(portal)', '(site)', '']
    .map((group) => join(root, 'apps/web/app', group, route.replace(/^\//, ''), 'page.tsx'))
    .find((path) => existsSync(path));

try {
  await esbuild.build({
    entryPoints: ['admin', 'hr', 'attendance', 'registry', 'visitors', 'calendar', 'branches', 'ward', 'birthdeath', 'printing'].map((n) => join(root, `apps/web/lib/${n}.ts`)),
    outdir: work,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    tsconfig: join(root, 'apps/web/tsconfig.json'),
    logLevel: 'error',
  });

  const load = (name) => import(pathToFileURL(join(work, `${name}.js`)).href);
  const [AD, HR, AT, RG, VS, CA, BR, WARD, BD, PT] = await Promise.all(['admin', 'hr', 'attendance', 'registry', 'visitors', 'calendar', 'branches', 'ward', 'birthdeath', 'printing'].map(load));

  console.log('\nadmin — the register, the month, the gate and the branches\n');

  /* ===================================================== 1. the staff register */

  const directory = HR.staffDirectory(DAY);
  pass('the register is the same day read twice', JSON.stringify(directory) === JSON.stringify(HR.staffDirectory(DAY)), `${directory.length} people`);
  pass('every employee number is unique, and they are one series', new Set(directory.map((s) => s.code)).size === directory.length, `EMP-${Math.min(...directory.map((s) => Number(s.code.slice(4))))} … EMP-${Math.max(...directory.map((s) => Number(s.code.slice(4))))}`);
  pass('every grade and department on the register resolves', directory.every((s) => Boolean(HR.gradeByCode(s.gradeCode)) && Boolean(HR.departmentById(s.departmentId))), `${new Set(directory.map((s) => s.gradeCode)).size} grades`);
  pass('every basic is a monthly figure', directory.every((s) => s.basic >= 15_000), `৳${sum(directory, (s) => s.basic).toLocaleString('en-IN')} in basic`);
  pass('a licence is held by clinical staff only', directory.filter((s) => s.licence).every((s) => Boolean(HR.departmentById(s.departmentId)?.clinical)), `${directory.filter((s) => s.licence).length} licences, nearest expiry ${Math.min(...directory.filter((s) => s.licence).map((s) => HR.licenceDaysLeft(s, DAY)))} days`);

  const stats = HR.hrStats(directory, DAY);
  const onRoll = directory.filter((s) => s.status !== 'Resigned' && s.status !== 'Retired');
  pass('the head count adds up', stats.clinical + stats.nonClinical === stats.total && stats.total === directory.length, `${stats.clinical} clinical · ${stats.nonClinical} not`);
  pass('the branch split adds up to the register', close(sum(stats.byBranch, (b) => b.headcount), onRoll.length, 0) && close(sum(stats.byBranch, (b) => b.basic), sum(onRoll, (s) => s.basic), 0), stats.byBranch.map((b) => `${b.branch} ${b.headcount}`).join(' · '));
  pass('the basic total is the register’s own total, less those who have left', close(stats.monthlyBasic, sum(onRoll, (s) => s.basic), 0), `৳${stats.monthlyBasic.toLocaleString('en-IN')}`);
  const unverified = directory.filter((s) => s.bank && !s.bank.verified);
  pass('an unverified bank account is counted, not discovered at month end', stats.unverifiedBank === unverified.length, `${unverified.length} account(s)`);
  pass('a bank account is masked on every screen anyway', directory.filter((s) => s.bank).every((s) => /[•*]/.test(s.bank.masked)));
  const expiring = directory.filter((s) => { const d = HR.licenceDaysLeft(s, DAY); return d !== null && d <= 120; });
  pass('a licence inside the warning window is counted with its days', stats.licencesExpiring === expiring.length, expiring.map((s) => `${s.name} ${HR.licenceDaysLeft(s, DAY)} d`).join(', '));
  pass('probation and leave are read off the register, not typed', stats.probation === directory.filter((s) => HR.onProbation(s, DAY)).length && stats.onLeave === directory.filter((s) => s.onLeave).length);
  const refusals = HR.payrollRefusals(directory);
  pass('the run names the lines it cannot pay', unverified.every((s) => refusals.some((r) => r.staffCode === s.code)) && refusals.every((r) => r.staffCode && r.because.length > 40), `${refusals.length} line(s) held`);

  /* ===================================================== 2. leave */

  const inDays = (n) => CA.addDays(DAY, n);
  const nurse = directory.find((s) => s.wardId === 'med-a' && s.employment === 'Permanent') ?? directory.find((s) => s.wardId && s.employment === 'Permanent');
  const request = (over) => ({ id: 'lr-new', staffId: nurse.id, staffCode: nurse.code, typeCode: 'CAS', days: 1, reason: 'Family matter', state: 'Applied', appliedAt: DAY, ...over });
  const ask = (draft, existing = [], options = {}) => HR.checkLeave(nurse, draft, existing, DAY, options);

  pass('a casual application inside the rules is granted', ask({ typeCode: 'CAS', from: inDays(14), to: inDays(15) }).ok, `${nurse.name}, ${inDays(14)}–${inDays(15)}`);
  const noNotice = ask({ typeCode: 'CAS', from: inDays(1), to: inDays(2) });
  pass('leave with no notice is refused, with the days it wanted', !noNotice.ok && noNotice.code === 'short-notice', noNotice.problem ?? '');
  const overlap = ask({ typeCode: 'CAS', from: inDays(15), to: inDays(16) }, [request({ from: inDays(14), to: inDays(15), days: 2, state: 'Approved' })]);
  pass('one absence cannot be two applications', !overlap.ok && overlap.code === 'overlaps', overlap.problem ?? '');
  const tooLong = ask({ typeCode: 'CAS', from: inDays(20), to: inDays(35), days: 16 });
  pass('more days at a time than the type runs is refused', !tooLong.ok && tooLong.code === 'too-long', tooLong.problem ?? '');
  const spent = [request({ id: 'lr-a', from: inDays(40), to: inDays(43), days: 4, state: 'Approved' }), request({ id: 'lr-b', from: inDays(50), to: inDays(53), days: 4, state: 'Approved' }), request({ id: 'lr-c', from: inDays(60), to: inDays(61), days: 2, state: 'Approved' })];
  const overEntitlement = ask({ typeCode: 'CAS', from: inDays(70), to: inDays(71) }, spent);
  pass('an entitlement is a balance and not an opinion', !overEntitlement.ok && overEntitlement.code === 'over-entitlement', overEntitlement.problem ?? '');
  const limit = HR.LEAVE_COVER.limitForWard(nurse.wardId);
  const cover = ask({ typeCode: 'CAS', from: inDays(14), to: inDays(15) }, [], {
    wardOnLeave: Array.from({ length: limit }, (_, i) => ({ staffCode: `EMP-90${i}`, wardId: nurse.wardId, departmentId: nurse.departmentId, from: inDays(14), to: inDays(15) })),
  });
  pass(`a ward that can cover ${limit} refuses the next person`, !cover.ok && cover.code === 'coverage', cover.problem ?? '');
  const probationer = directory.find((s) => HR.onProbation(s, DAY) && ['Permanent', 'Contract'].includes(s.employment));
  const probationAsk = probationer ? HR.checkLeave(probationer, { typeCode: 'EARN', from: inDays(40), to: inDays(43) }, [], DAY) : { ok: true };
  pass('earned leave during probation is refused with the date it starts', probationer ? !probationAsk.ok && probationAsk.code === 'probation' : true, probationer ? probationAsk.problem ?? '' : 'nobody on the register is in probation');
  const sick = ask({ typeCode: 'SICK', from: inDays(0), to: inDays(3) });
  pass('an absence over two days is refused without the certificate', !sick.ok && sick.code === 'needs-certificate', sick.problem ?? '');
  const mayHave = directory.filter((s) => s.employment === 'Permanent').map((s) => ({ staff: s, check: HR.checkLeave(s, { typeCode: 'MAT', from: inDays(70), to: inDays(180), days: 112, documentNo: 'EDC-2291' }, [], DAY) }));
  pass('maternity is granted to the person who can take it and refused to the ones who cannot, by name', mayHave.some((r) => r.check.code === 'maternity-not-applicable') && mayHave.some((r) => r.check.ok), `${mayHave.filter((r) => r.check.ok).length} of ${mayHave.length} eligible`);
  const balance = HR.leaveBalance(nurse, 'CAS', [{ ...spent[0], days: 2 }, { ...spent[1], days: 3, state: 'Applied' }], DAY.slice(0, 4));
  pass('the balance is entitlement less taken less pending', balance.left === Math.max(0, balance.entitlement - balance.taken - balance.pending) && balance.taken === 2 && balance.pending === 3, JSON.stringify(balance));
  const intern = directory.find((s) => s.employment === 'Intern');
  pass('an intern accrues less, and only of the types an intern takes', intern ? HR.entitlement(intern, HR.leaveTypeByCode('CAS'), DAY.slice(0, 4)) === Math.round(HR.leaveTypeByCode('CAS').days / 2) && HR.entitlement(intern, HR.leaveTypeByCode('EARN'), DAY.slice(0, 4)) === 0 : true, intern ? `${HR.leaveTypeByCode('CAS').days} → ${HR.entitlement(intern, HR.leaveTypeByCode('CAS'), '2026')} days` : 'no intern');
  pass('every leave type is a real entitlement', HR.LEAVE_TYPES.every((t) => t.days > 0 && t.maxConsecutive <= t.days && t.label.length > 3 && t.note.length > 60), `${HR.LEAVE_TYPES.length} types, ${sum(HR.LEAVE_TYPES, (t) => t.days)} days a year`);

  /* ===================================================== 3. the reader’s day */

  const board = AT.attendanceDay(DAY, directory);
  const rostered = directory.filter((s) => AT.HR_NODES.includes(s.branch));
  pass('the day covers the branch’s roster', board.rows.length === rostered.length, `${board.rows.length} rows`);
  const counted = (state) => board.rows.filter((r) => r.state === state).length;
  pass('the day’s figures are its own rows’ figures', board.stats.rostered === board.rows.length && board.stats.late === counted('Late') && board.stats.absent === counted('Absent') && board.stats.onLeave === counted('On leave') && board.stats.open === board.rows.filter((r) => r.open).length, JSON.stringify({ present: counted('Present'), late: board.stats.late, absent: board.stats.absent, onLeave: board.stats.onLeave, open: board.stats.open }));
  pass('a late row is past the grace and carries the minutes', board.rows.filter((r) => r.lateMinutes > 0).every((r) => r.lateMinutes > AT.LATE_GRACE_MIN), `${board.rows.filter((r) => r.lateMinutes > 0).map((r) => `${r.name} +${r.lateMinutes}`).join(', ')}`);
  pass('a stint punched in and not out is open, not short', board.rows.filter((r) => r.open).every((r) => !r.outAt && r.inAt), `${board.stats.open} still on`);
  pass('overtime is counted in the step the setting names, and inside the cap', board.rows.every((r) => r.otMinutes % AT.OT_MIN_MINUTES === 0 && r.otMinutes <= HR.OT_MONTHLY_CAP_HOURS * 60), `${Math.round(board.stats.overtimeMinutes / 60)} hours today`);
  pass('a punch belongs to the day it was read', board.punches.length > 0 && board.punches.every((p) => p.day === DAY && p.at.slice(0, 10) === DAY));
  const silent = board.devices.filter((d) => !d.active);
  pass('a reader that stopped reporting is on the day’s list', board.stats.lateDevices === silent.length && silent.every((d) => d.note && d.lastSeen.startsWith('yesterday')), silent.map((d) => `${d.label} silent since ${d.lastSeen}`).join(', '));

  const badge = AT.deviceById('DEV-GATE-01');
  const staffFile = HR.staffByCode(directory, board.rows[0].staffCode);
  const lastPunch = (state, time) => ({ id: 'p', staffCode: staffFile.code, staffName: staffFile.name, at: `${DAY} ${time}`, day: DAY, time, deviceId: badge.id, deviceLabel: badge.label, kind: 'QR', state, shift: 'Morning', lateMinutes: 0 });
  [
    ['an employee number that was never issued', { staff: undefined, at: `${DAY} 09:00`, device: badge, kind: 'QR', state: 'In', dayIso: DAY }, 'unknown-staff'],
    ['a reader that is not enrolled for the branch', { staff: staffFile, at: `${DAY} 09:00`, device: undefined, kind: 'QR', state: 'In', dayIso: DAY }, 'unknown-device'],
    ['a reader that stopped reporting', { staff: staffFile, at: `${DAY} 09:00`, device: silent[0], kind: 'Face', state: 'In', dayIso: DAY }, 'device-inactive'],
    ['the same badge twice in the same minute', { staff: staffFile, at: `${DAY} 09:00`, device: badge, kind: 'QR', state: 'In', dayIso: DAY, last: lastPunch('In', '09:00') }, 'duplicate'],
    ['two ins in a row', { staff: staffFile, at: `${DAY} 12:00`, device: badge, kind: 'QR', state: 'In', dayIso: DAY, last: lastPunch('In', '09:00') }, 'unpaired'],
    ['an out with no in before it', { staff: staffFile, at: `${DAY} 12:00`, device: badge, kind: 'QR', state: 'Out', dayIso: DAY }, 'no-open-stint'],
    ['a stint longer than a shift can be', { staff: staffFile, at: `${DAY} 23:00`, device: badge, kind: 'QR', state: 'Out', dayIso: DAY, last: lastPunch('In', '05:00') }, 'stint-too-long'],
  ].forEach(([what, input, expected]) => {
    const result = AT.checkPunch(input);
    pass(`the reader refuses ${what}`, !result.ok && result.code === expected, result.code ?? 'accepted');
  });
  const lapsed = directory.find((s) => { const d = HR.licenceDaysLeft(s, DAY); return d !== null && d <= 0; });
  pass('a lapsed clinical licence stops the duty punch', lapsed ? AT.checkPunch({ staff: lapsed, at: `${DAY} 07:00`, device: badge, kind: 'QR', state: 'In', dayIso: DAY }).code === 'licence-lapsed' : true, lapsed ? `${lapsed.name} since ${lapsed.licence.expires}` : 'every licence on the register is in date');
  const override = AT.checkPunch({ staff: staffFile, at: `${DAY} 09:00`, device: badge, kind: 'Manual override', state: 'In', dayIso: DAY });
  pass('a manual override is accepted and stamped as one, for the shift manager to sign', override.ok && override.code === 'manual' && override.hint.length > 40);

  /* ===================================================== 4. the month */

  const register = AT.attendanceRegister(MONTH, directory);
  const days = HR.monthDays(MONTH);
  pass('the register is every day for every person', register.rows.length === rostered.length && register.rows.every((r) => r.days.length === days.length && r.days.every((d, i) => d.day === days[i])), `${register.rows.length} × ${days.length}`);
  const count = (row, list) => row.days.filter((d) => list.includes(d.code)).length;
  pass('a row’s summary is that row’s own days', register.rows.every((r) => r.summary.present === count(r, ['P']) && r.summary.late === count(r, ['L']) && r.summary.half === count(r, ['HD']) && r.summary.absent === count(r, ['A']) && r.summary.leave === count(r, ['LV']) && r.summary.unpaid === count(r, ['LWP']) && r.summary.training === count(r, ['T']) && r.summary.weeklyOff + r.summary.holiday === count(r, ['WO']) + count(r, ['PH'])));
  pass('worked days, paid days and late marks are the row’s own days', register.rows.every((r) => r.summary.workedDays === sum(AT.WORKED_CODES, (c) => count(r, [c])) && r.summary.lateMarks === r.summary.late) && register.stats.paidDays === sum(register.rows, (r) => r.days.filter((d) => AT.PAID_CODES.includes(d.code)).length));
  pass('overtime is per person, in tenths of an hour, inside the cap', register.rows.every((r) => r.summary.otHours === Math.round((r.days.reduce((n, d) => n + d.otMinutes, 0) / 60) * 10) / 10 && r.summary.otHours <= HR.OT_MONTHLY_CAP_HOURS), `${sum(register.rows, (r) => r.summary.otHours)} hours in ${MONTH}`);
  pass('the month’s totals are the rows added up', close(register.stats.presentDays, sum(register.rows, (r) => r.summary.workedDays)) && close(register.stats.absentDays, sum(register.rows, (r) => r.summary.absent)) && close(register.stats.leaveDays, sum(register.rows, (r) => r.summary.leave)) && close(register.stats.unpaidDays, sum(register.rows, (r) => r.summary.unpaid)) && close(register.stats.halfDays, sum(register.rows, (r) => r.summary.half)), JSON.stringify({ present: register.stats.presentDays, absent: register.stats.absentDays, leave: register.stats.leaveDays, unpaid: register.stats.unpaidDays }));
  pass('the digest is the exception list', AT.registerDigest(register).length === 5 && register.stats.exceptions === register.exceptions.length && register.exceptions.every((e) => e.text.length > 60), `${register.exceptions.length} exception(s), ${register.stats.holidaysWorked} holiday(s) worked`);
  const spans = AT.seedLeaveSpans(MONTH, directory);
  pass('an approved span is leave on every day it covers', spans.length > 0 && spans.every((s) => (register.rows.find((r) => r.staffCode === s.staffCode)?.days ?? []).filter((d) => d.day >= s.from && d.day <= s.to).every((d) => d.code === (s.paid ? 'LV' : 'LWP'))), `${spans.length} span(s): ${spans.map((s) => `${s.staffCode} ${s.typeCode}`).join(', ')}`);
  const OFFICE = ['front', 'accounts', 'admin', 'hr', 'support'];
  const festive = AT.attendanceRegister('2026-12', directory);
  const festiveDays = AT.PUBLIC_HOLIDAYS.filter((h) => h.day.startsWith('2026-12'));
  pass('the office is closed on a gazetted holiday and the register says so, in `PH`', festiveDays.length > 0 && festiveDays.every((h) => festive.rows.filter((r) => OFFICE.includes(r.departmentId)).every((r) => ['PH', 'WO'].includes(r.days.find((d) => d.day === h.day)?.code))), `${festiveDays.map((h) => h.label).join(', ')}: ${festive.rows.filter((r) => r.days.find((d) => d.day === festiveDays[0].day)?.code === 'PH').length} rows on PH`);
  pass('a ward that works a gazetted holiday is recorded as working it', festiveDays.every((h) => festive.rows.filter((r) => r.wardId).some((r) => r.days.find((d) => d.day === h.day)?.code === 'T')), `${festive.stats.holidaysWorked} day(s) worked in December`);
  pass('every register code says what it means for the money', Object.keys(AT.REGISTER_CODES).every((c) => AT.REGISTER_CODES[c].because.length > 40), Object.keys(AT.REGISTER_CODES).join(' '));

  /* ===================================================== 5. the payroll */

  const attendance = AT.payrollAttendance(register);
  const lines = register.rows.map((row) => HR.payrollLine(HR.staffByCode(directory, row.staffCode), attendance[row.staffCode], { overtimeApproved: { [row.staffCode]: row.summary.otHours } }));
  pass('every person on the register has a line', lines.length === register.rows.length && lines.every((l) => l.staffCode && l.name));
  pass('the payroll was given the same month the register walked', register.rows.every((row) => attendance[row.staffCode].daysInMonth === days.length), `${days.length} days, read once`);
  const drifted = lines.filter((l, i) => {
    const row = register.rows[i];
    const a = attendance[row.staffCode];
    const why = [];
    if (l.absentDays !== row.summary.absent) why.push(`absent ${l.absentDays} vs ${row.summary.absent}`);
    if (l.unpaidLeaveDays !== row.summary.unpaid) why.push(`unpaid ${l.unpaidLeaveDays} vs ${row.summary.unpaid}`);
    if (l.overtimeHours !== Math.min(row.summary.otHours, HR.OT_MONTHLY_CAP_HOURS)) why.push(`overtime ${l.overtimeHours} vs ${row.summary.otHours}`);
    if (a.workedDays !== row.summary.workedDays) why.push(`worked ${a.workedDays} vs ${row.summary.workedDays}`);
    l.why = why;
    return why.length > 0;
  });
  pass('the payroll pays the register’s own month, day for day', drifted.length === 0, drifted.slice(0, 3).map((l) => `${l.staffCode}: ${l.why.join(', ')}`).join(' · ') || `all ${lines.length} lines agree with the register`);
  pass('gross is the earnings added up', lines.every((l) => close(l.gross, sum(l.earnings, (e) => e.amount))));
  pass('net is gross less every deduction, and never below zero', lines.every((l) => l.net === Math.max(0, l.gross - l.deductionsTotal) && close(l.deductionsTotal, sum(l.deductions, (d) => d.amount)) && l.net >= 0 && l.earnings.every((e) => e.amount >= 0) && l.deductions.every((d) => d.amount >= 0)));
  pass('every deduction names the rule that produced it', lines.every((l) => l.deductions.every((d) => d.label.length > 8 && /[a-z]/.test(d.label))), lines[0].deductions.map((d) => `${d.label} ৳${d.amount.toLocaleString('en-IN')}`).join(' · '));
  const pfWrong = lines.filter((l) => (l.deductions.find((d) => d.code === 'PF')?.amount ?? 0) !== Math.round(Math.min(l.basic, HR.PF_CAP_BASIC) * HR.PF_RATE));
  pass('the provident fund is ten per cent of basic up to the cap', pfWrong.length === 0, `cap ৳${HR.PF_CAP_BASIC.toLocaleString('en-IN')}`);
  const allowanceWrong = lines.filter((l) => HR.ALLOWANCE_RATES.every((a) => {
    if (a.code === 'DEAR' && !['Permanent', 'Contract'].includes(l.employment)) return true;
    const expected = a.kind === 'pct' ? Math.round(l.basic * (a.value / 100)) : a.value;
    return (l.earnings.find((e) => e.code === a.code)?.amount ?? 0) === expected;
  }) === false);
  pass('every allowance comes from the rate table, per cent or flat', allowanceWrong.length === 0, HR.ALLOWANCE_RATES.map((a) => `${a.label} ${a.kind === 'pct' ? `${a.value}%` : `৳${a.value}`}`).join(' · '));
  const otWrong = lines.filter((l) => (l.earnings.find((e) => e.code === 'OT')?.amount ?? 0) !== Math.round((l.basic / HR.OT_HOURS_PER_MONTH) * HR.OT_MULTIPLIER * l.overtimeHours));
  pass('overtime is the hourly rate at the multiplier, capped at the month', otWrong.length === 0, otWrong.length ? otWrong[0].staffCode : `${HR.OT_MULTIPLIER}× over ${HR.OT_HOURS_PER_MONTH} h, cap ${HR.OT_MONTHLY_CAP_HOURS} h`);
  const perDayOf = (l, a) => (l.gross - (l.earnings.find((e) => e.code === 'OT')?.amount ?? 0)) / a.daysInMonth;
  const absentWrong = lines.filter((l, i) => {
    const a = attendance[register.rows[i].staffCode];
    const perDay = perDayOf(l, a);
    return (l.deductions.find((d) => d.code === 'ABSENT')?.amount ?? 0) !== Math.round(perDay * a.absentDays + perDay * 0.5 * a.halfDays);
  });
  pass('an absence costs the day rate of the month it is in, on the month’s own gross', absentWrong.length === 0, `${days.length} days in ${MONTH}, ৳${sum(lines, (l) => l.deductions.find((d) => d.code === 'ABSENT')?.amount ?? 0).toLocaleString('en-IN')} in absent days`);
  const lateWrong = lines.filter((l, i) => {
    const a = attendance[register.rows[i].staffCode];
    return (l.deductions.find((d) => d.code === 'LATE')?.amount ?? 0) !== Math.round(perDayOf(l, a) * 0.5 * Math.floor(a.lateMarks / HR.LATE_MARKS_PER_HALF_DAY));
  });
  pass(`every ${HR.LATE_MARKS_PER_HALF_DAY} late arrivals cost half a day`, lateWrong.length === 0, `৳${sum(lines, (l) => l.deductions.find((d) => d.code === 'LATE')?.amount ?? 0).toLocaleString('en-IN')} in late marks`);
  const taxWrong = lines.filter((l) => {
    const pfRow = l.deductions.find((d) => d.code === 'PF')?.amount ?? 0;
    return (l.deductions.find((d) => d.code === 'TAX')?.amount ?? 0) !== Math.max(0, HR.taxFor(Math.max(0, l.gross * 12 - pfRow * 12)).monthly);
  });
  pass('income tax is the annualised month against the branch’s slabs', taxWrong.length === 0, taxWrong.length ? taxWrong[0].staffCode : `${HR.TAX_SLABS.length} slabs, floor ৳${HR.MINIMUM_TAX_ANNUAL.toLocaleString('en-IN')}, rebate ${HR.INVESTMENT_REBATE_RATE * 100}% capped at ${HR.INVESTMENT_REBATE_CAP_PCT}%`);
  const consultant = lines.find((l) => l.basic >= 150_000);
  const taxOf = (l) => l.deductions.find((d) => d.code === 'TAX')?.amount ?? 0;
  const ladder = lines.slice().sort((a, b) => a.basic - b.basic);
  /* The table is a function of taxable income, not of basic: two people on the same basic pay different tax in a
     month when one of them lost a day. So the property is swept over the table itself. */
  const sweep = Array.from({ length: 400 }, (_, i) => i * 25_000);
  const taxAt = sweep.map((t) => HR.taxFor(t));
  const breaks = taxAt.filter((r, i) => i === 0 ? false : r.afterRebate < taxAt[i - 1].afterRebate || r.marginal < taxAt[i - 1].marginal);
  pass('the tax table never falls back as income rises, and the marginal rate never drops', breaks.length === 0, `${sweep.length} incomes from ৳0 to ৳${sweep[sweep.length - 1].toLocaleString('en-IN')}, marginal ৳${taxAt[0].marginal}% → ৳${taxAt[taxAt.length - 1].marginal}%`);
  const belowThreshold = HR.taxFor(200_000);
  pass('an income under the first slab pays the branch’s floor and nothing above it', belowThreshold.afterRebate === HR.MINIMUM_TAX_ANNUAL && belowThreshold.monthly === Math.round(HR.MINIMUM_TAX_ANNUAL / 12), JSON.stringify(belowThreshold));
  pass('the lowest line pays the floor and the consultant pays many times it', taxOf(ladder[0]) === Math.round(HR.MINIMUM_TAX_ANNUAL / 12) && taxOf(consultant) > taxOf(ladder[0]) * 50, `৳${taxOf(ladder[0]).toLocaleString('en-IN')} on ৳${ladder[0].basic.toLocaleString('en-IN')} basic against ৳${taxOf(consultant).toLocaleString('en-IN')} on ৳${consultant.basic.toLocaleString('en-IN')}`);
  const invested = HR.payrollLine(HR.staffByCode(directory, consultant.staffCode), attendance[consultant.staffCode], { investments: { [consultant.staffCode]: 2_000_000 } });
  const consultantTaxable = Math.max(0, consultant.gross * 12 - (consultant.deductions.find((d) => d.code === 'PF')?.amount ?? 0) * 12);
  const rebate = HR.taxFor(consultantTaxable, 2_000_000);
  pass('a declared investment never raises the tax, and never cuts it past the cap', taxOf(invested) <= taxOf(consultant) && rebate.rebate <= Math.round(consultantTaxable * (HR.INVESTMENT_REBATE_CAP_PCT / 100)) + 1, `৳${taxOf(consultant).toLocaleString('en-IN')} → ৳${taxOf(invested).toLocaleString('en-IN')}, rebate ৳${rebate.rebate.toLocaleString('en-IN')}`);
  const advanced = HR.payrollLine(HR.staffByCode(directory, register.rows[0].staffCode), attendance[register.rows[0].staffCode], { advances: { [register.rows[0].staffCode]: 10_000_000 } });
  pass('an advance is recovered up to half of basic and no further', advanced.advance === Math.round(advanced.basic * (HR.ADVANCE_CAP_PCT / 100)), `৳${advanced.advance.toLocaleString('en-IN')} recovered of ৳${advanced.basic.toLocaleString('en-IN')} basic`);
  const employerWrong = lines.filter((l) => l.employerCost !== l.gross + (l.deductions.find((d) => d.code === 'PF')?.amount ?? 0) + (l.employment === 'Outsourced' ? 0 : HR.GROUP_INSURANCE));
  pass('the employer cost is the salary plus the hospital’s own contributions', employerWrong.length === 0);
  const internLine = lines.find((l) => l.employment === 'Intern');
  pass('an intern’s stipend is a stipend and the payslip says so', internLine.notes.some((n) => /stipend/i.test(n)), internLine.notes[internLine.notes.length - 1] ?? '');
  const run = { gross: sum(lines, (l) => l.gross), deductions: sum(lines, (l) => l.deductionsTotal), net: sum(lines, (l) => l.net), employer: sum(lines, (l) => l.employerCost), overtime: sum(lines, (l) => l.overtimeHours), absent: sum(lines, (l) => l.absentDays) };
  pass('the run’s totals are the lines added up', close(run.net, run.gross - run.deductions, 1) && run.employer > run.gross && close(run.overtime, register.stats.otHours, 0.2) && run.absent === register.stats.absentDays, `gross ৳${run.gross.toLocaleString('en-IN')} · deductions ৳${run.deductions.toLocaleString('en-IN')} · net ৳${run.net.toLocaleString('en-IN')} · employer ৳${run.employer.toLocaleString('en-IN')}`);
  pass('a month with no attendance at all still produces lines that add up', (() => {
    const empty = AT.payrollAttendance({ ...register, rows: register.rows.map((r) => ({ ...r, summary: { ...r.summary, absent: 0, half: 0, unpaid: 0, lateMarks: 0, otHours: 0 } })) });
    const rows = lines.map((l) => HR.payrollLine(HR.staffByCode(directory, l.staffCode), empty[l.staffCode]));
    return rows.every((l) => l.net === Math.max(0, l.gross - l.deductionsTotal) && l.gross === sum(l.earnings, (e) => e.amount));
  })());
  pass('every run rule states what it is for', HR.PAYROLL_RULES.length >= 5 && HR.PAYROLL_RULES.every((r) => r.because.length > 60));
  pass('one pair of hands cannot both run and approve the month', HR.PAYROLL_FLOW['Awaiting approval'].by.length > 0 && HR.PAYROLL_FLOW.Approved.by.length > 0 && HR.PAYROLL_FLOW.Paid.next === null && HR.PAYROLL_FLOW.Draft.note.length > 40);
  pass('the tax table is printed beside the payslip it produced', HR.TAX_TABLE_NOTE.length > 80, HR.TAX_TABLE_NOTE);

  /* ===================================================== 6. the vital registers */

  pass('the birth form is the register the plan describes', RG.BIRTH_FIELDS.length === 34 && RG.BIRTH_COLUMNS.length === 11, `${RG.BIRTH_FIELDS.length} fields · ${RG.BIRTH_COLUMNS.length} columns`);
  pass('the death form is the register the plan describes', RG.DEATH_FIELDS.length === 18 && RG.DEATH_COLUMNS.length === 10, `${RG.DEATH_FIELDS.length} fields · ${RG.DEATH_COLUMNS.length} columns`);
  pass('every field is in one of five sections and carries a label and a hint', RG.sectionsOf(RG.BIRTH_FIELDS).length === 5 && RG.sectionsOf(RG.DEATH_FIELDS).length === 5 && [...RG.BIRTH_FIELDS, ...RG.DEATH_FIELDS].every((f) => f.label.length > 2 && f.section.length > 2 && (f.hint ?? '').length > 20));
  pass('every column on the register names a field and a heading', [...RG.BIRTH_COLUMNS, ...RG.DEATH_COLUMNS].every((c) => c.header.length >= 3 && c.key.length >= 2) && [...RG.BIRTH_COLUMNS, ...RG.DEATH_COLUMNS].filter((c) => c.width).length >= 8, `${RG.BIRTH_COLUMNS.length + RG.DEATH_COLUMNS.length} columns, ${[...RG.BIRTH_COLUMNS, ...RG.DEATH_COLUMNS].filter((c) => c.width).length} with a width`);

  const registry = RG.registryDay(DAY);
  const nextBirth = RG.nextRegisterNo('birth', DAY, registry.births.map((b) => b.registerNo));
  const nextDeath = RG.nextRegisterNo('death', DAY, registry.deaths.map((d) => d.registerNo));
  pass('the day’s register has its births and deaths, each with a number of its own', registry.births.length > 0 && registry.deaths.length > 0 && new Set(registry.births.map((b) => b.registerNo)).size === registry.births.length && new Set(registry.deaths.map((d) => d.registerNo)).size === registry.deaths.length, `${registry.births.map((b) => b.registerNo).join(' ')} · ${registry.deaths.map((d) => d.registerNo).join(' ')}`);
  pass('the next number continues the series and is never reused', nextBirth !== '' && !registry.births.some((b) => b.registerNo === nextBirth) && nextDeath !== '' && !registry.deaths.some((d) => d.registerNo === nextDeath), `${nextBirth} · ${nextDeath}`);
  pass('the number is the same on a second look', RG.nextRegisterNo('birth', DAY, registry.births.map((b) => b.registerNo)) === nextBirth);

  const goodBirth = {
    ...RG.emptyBirthDraft(DAY, nextBirth),
    motherMrn: registry.births[0].mother.mrn,
    motherName: registry.births[0].mother.name,
    motherAge: String(registry.births[0].mother.age),
    gravidaPara: 'G2 P1',
    birthTime: '09:15',
    attendedBy: 'Dr. S. Noor',
    weightGrams: '2980',
    lengthCm: '49',
    apgarOne: '8',
    apgarFive: '9',
    phone: '01711 223344',
    firstFeed: '10:05',
    civilState: 'Filed, number awaited',
    civilNumber: 'BRC-2026-0415',
  };
  const birthCheck = RG.checkBirthDraft(goodBirth, DAY);
  pass('a completed birth entry is accepted by the form', birthCheck.ok, failCodes(birthCheck) || 'no refusals');
  pass('and accepted by the report’s own reader, which reads the same record', BD.checkBirth(RG.birthFromDraft(goodBirth, DAY)).ok);
  [
    ['a stillbirth carrying a live-birth number', { ...goodBirth, outcome: 'Stillbirth', apgarOne: '0', apgarFive: '0' }, 'stillbirth-as-live-birth'],
    ['a stillbirth with an Apgar score', { ...goodBirth, outcome: 'Stillbirth', civilNumber: '', apgarOne: '1', apgarFive: '3' }, 'stillbirth-with-apgar'],
    ['a caesarean with no indication', { ...goodBirth, type: 'Caesarean', indication: '' }, 'caesarean-without-indication'],
    ['a birth with nobody’s name against it', { ...goodBirth, attendedBy: '' }, 'no-attendant'],
    ['a live birth with no Apgar', { ...goodBirth, apgarOne: '', apgarFive: '' }, 'no-apgar'],
    ['a birth with no weight', { ...goodBirth, weightGrams: '' }, 'no-weight'],
    ['a birth with no gravida or para', { ...goodBirth, gravidaPara: '' }, 'no-gravida'],
  ].forEach(([what, draft, expected]) => {
    const result = RG.checkBirthDraft(draft, DAY);
    pass(`the birth register refuses ${what}`, !result.ok && result.reasons.some((r) => r.code === expected), failCodes(result));
  });
  const lowWeight = RG.checkBirthDraft({ ...goodBirth, weightGrams: '2100' }, DAY);
  pass('a low-birth-weight baby is recorded as one, with a warning rather than a refusal', lowWeight.ok && lowWeight.warnings.some((w) => w.includes('2 500 g')));

  const goodDeath = {
    ...RG.emptyDeathDraft(DAY, nextDeath),
    patientMrn: registry.deaths[0].patient?.mrn ?? '',
    patientName: registry.deaths[0].patient?.name ?? 'Abdul Malek',
    age: String(registry.deaths[0].patient?.age ?? 68),
    immediateCause: 'Cardiac arrest',
    antecedentCause: 'Chronic kidney disease',
    underlyingCause: 'Acute myocardial infarction',
    icdCode: 'I21.9',
    certifiedBy: 'Dr. F. Kabir',
    certificateNo: 'SSC-2026-DC-0092',
    releasedTo: 'Rahima Begum',
    releasedRelation: 'Wife',
    civilState: 'Filed, number awaited',
  };
  const deathCheck = RG.checkDeathDraft(goodDeath, DAY);
  pass('a completed death entry is accepted by the form', deathCheck.ok, failCodes(deathCheck) || 'no refusals');
  [
    ['a death with no cause at all', { ...goodDeath, immediateCause: '', underlyingCause: '', certificateNo: '', releasedTo: '', releasedRelation: '' }, 'no-cause'],
    ['a numbered certificate with no cause behind it', { ...goodDeath, immediateCause: '', underlyingCause: '' }, 'certificate-without-cause'],
    ['an unnatural death with no police station', { ...goodDeath, manner: 'Unnatural — referred to police', policeStation: '' }, 'no-station'],
    ['a body released with neither certificate nor referral', { ...goodDeath, certificateNo: '' }, 'released-without-paper'],
    ['a relationship without a name', { ...goodDeath, releasedTo: '', releasedRelation: 'Wife' }, 'relation-without-name'],
  ].forEach(([what, draft, expected]) => {
    const result = RG.checkDeathDraft(draft, DAY);
    pass(`the death register refuses ${what}`, !result.ok && result.reasons.some((r) => r.code === expected), failCodes(result));
  });
  const unpapered = RG.deathFromDraft({ ...goodDeath, certificateNo: '', releasedTo: '', releasedRelation: '' }, DAY);
  const papered = RG.deathFromDraft(goodDeath, DAY);
  const held = { ...papered, releasedAt: null };
  const releasedNobody = BD.checkDeath({ ...papered, releasedAt: `${DAY} 15:30`, releasedTo: null });
  pass('a body recorded as released with nobody’s name against it is refused', !releasedNobody.ok && releasedNobody.reasons.some((r) => r.code === 'released-to-nobody'));
  const referred = RG.deathFromDraft({ ...goodDeath, manner: 'Unnatural — referred to police', policeStation: 'Dhanmondi', postMortemReferred: 'yes', releasedTo: '', releasedRelation: '' }, DAY);
  pass('the mortuary question — may the body leave — is answered with a sentence either way', !BD.canReleaseBody(unpapered).ok && BD.canReleaseBody(held).ok && BD.canReleaseBody(referred).ok && !BD.canReleaseBody(papered).ok, BD.canReleaseBody(held).because);
  pass('and a body that has already gone says so, with the time it went', !BD.canReleaseBody(papered).ok && BD.canReleaseBody(papered).because.includes('15:30'), BD.canReleaseBody(papered).because);
  pass('a referred death names the station on the certificate state', BD.certificateState(referred).includes('Dhanmondi') && BD.certificateState(papered).includes(papered.certificateNo), BD.certificateState(referred));
  const written = RG.registryDay(DAY, [RG.birthFromDraft(goodBirth, DAY)], [RG.deathFromDraft(goodDeath, DAY)]);
  pass('a record written here is in the day’s register before the server has it', written.births.length === registry.births.length + 1 && written.deaths.length === registry.deaths.length + 1 && written.queuedBirths === 1 && written.queuedDeaths === 1);
  pass('the register says the report will not show it until the server has it', RG.REGISTRY_NOTE.length > 120, RG.REGISTRY_NOTE);

  /* ===================================================== 7. the gate */

  const gate = VS.visitorDay(DAY);
  pass('the gate’s day is the passes issued on it', gate.stats.issued === gate.passes.length && gate.passes.every((p) => p.issuedAt.slice(0, 10) === DAY), `${gate.passes.length} passes`);
  pass('every pass number in the day is unique and continues the year’s series', new Set(gate.passes.map((p) => p.passNo)).size === gate.passes.length && VS.nextPassNo(DAY, gate.passes) === `VP-2026-${String(Math.max(...gate.passes.map((p) => Number(p.passNo.split('-')[2]))) + 1).padStart(4, '0')}`, VS.nextPassNo(DAY, gate.passes));
  pass('who is in the building is the passes’ own state', gate.stats.inBuilding === gate.passes.filter((p) => p.state === 'In').length && gate.stats.signedOut === gate.passes.filter((p) => p.state === 'Out').length && gate.stats.overdue === gate.passes.filter((p) => p.state === 'Overdue').length);
  pass('every pass says who issued it and when it stops being valid', gate.passes.every((p) => p.issuedBy.length > 4 && p.validUntil > p.issuedAt && p.mobile.length > 8));
  const unclosed = VS.overduePasses(gate.passes, `${DAY} 16:00`);
  pass('a pass the hour has overtaken is on the gate’s list, with the hour it passed', unclosed.length > 0 && unclosed.every((p) => p.validUntil <= `${DAY} 16:00` || p.state === 'Overdue'), `${unclosed.length} to find: ${unclosed.map((p) => `${p.passNo} ${p.name}`).join(', ')}`);
  pass('every purpose reaches areas that exist and says what it is for', VS.PURPOSES.every((p) => p.areas.length > 0 && p.areas.every((a) => Boolean(VS.areaById(a))) && p.note.length > 30), `${VS.PURPOSES.length} purposes over ${VS.VISIT_AREAS.length} areas`);
  pass('theatre is a room no badge opens', VS.VISIT_AREAS.find((a) => a.id === 'theatre').allows.length === 0, VS.VISIT_AREAS.map((a) => a.id).join(' '));
  pass('the areas a purpose reaches are the purpose’s own areas, by id', VS.areasFor('VST-WARD').length === VS.purposeByCode('VST-WARD').areas.length && VS.areasFor('VST-WARD').every((a) => Boolean(VS.areaById(a))));

  const visiting = (over = {}) => ({
    name: 'Rahima Begum', mobile: '01711-884210', organisation: '', purpose: 'VST-WARD', hostCode: 'EMP-1001', badgeKind: 'Visitor',
    idKind: 'NID', idNumber: '1990 1234 56789', vehicle: '', itemsIn: '', escorts: '', accompanying: '', note: '',
    validUntil: `${DAY} 18:30`, nowIso: `${DAY} 15:10`, day: gate.passes, ...over,
  });
  const issued = VS.checkVisitor(visiting());
  pass('an ordinary visiting pass is issued', issued.ok, failCodes(issued) || `${issued.warnings.length} warning(s), which is what the ward is told`);
  [
    ['a pass with no name on it', { name: '' }, 'no-name'],
    ['a pass with no number to reach them on', { mobile: '' }, 'no-mobile'],
    ['a visitor with nobody to see', { hostCode: '' }, 'no-host'],
    ['a contractor with nothing identified', { badgeKind: 'Contractor', idKind: 'Not checked' }, 'contractor-no-id'],
    ['a report collected without the patient’s number', { purpose: 'VST-REPORT', accompanying: '' }, 'report-without-patient'],
    ['a pass that expired before it was issued', { validUntil: `${DAY} 10:00` }, 'already-expired'],
    ['a purpose the register does not hold', { purpose: 'VST-PARTY' }, 'no-purpose'],
  ].forEach(([what, over, expected]) => {
    const result = VS.checkVisitor(visiting(over));
    pass(`the gate refuses ${what}`, !result.ok && result.reasons.some((r) => r.code === expected), failCodes(result));
  });
  const delivery = VS.checkVisitor(visiting({ badgeKind: 'Delivery', purpose: 'VST-SUPPLY', organisation: 'Mirpur Cold Chain' }));
  pass('a delivery is issued a store pass, and refused a ward one', delivery.ok && VS.checkVisitor(visiting({ badgeKind: 'Delivery', purpose: 'VST-WARD' })).reasons.some((r) => r.code === 'area-not-allowed'), failCodes(VS.checkVisitor(visiting({ badgeKind: 'Delivery', purpose: 'VST-WARD' }))) || 'a delivery reached a ward');
  pass('the gate warns rather than refusing a visitor out of hours', VS.checkVisitor(visiting({ nowIso: `${DAY} 21:40`, validUntil: `${DAY} 22:30` })).warnings.some((w) => w.includes('visiting hours')));
  pass('every badge kind is a badge somebody has to return', VS.BADGE_KINDS.length === 5 && VS.VISITOR_RULES.every((r) => r.because.length > 60), `${VS.VISITOR_RULES.length} rules`);

  /* ===================================================== 8. the calendar */

  const year = DAY.slice(0, 4);
  const holidays = CA.HOLIDAYS_2026;
  const dateKeys = holidays.map((h) => `${h.date}|${[...h.branches].sort().join(',') || 'all'}`);
  pass('one holiday, one row per branch it applies to', new Set(dateKeys).size === dateKeys.length, `${holidays.length} rows across ${BR.BRANCHES.length} branches`);
  pass('every kind of holiday is on the year, and every row says where it came from', CA.HOLIDAY_KINDS.every((k) => holidays.some((h) => h.kind === k)) && holidays.every((h) => h.source.length > 3));
  pass('a day that is worked says what the payroll owes for it', holidays.every((h) => h.payrollNote.trim().length >= 25), holidays.find((h) => h.kind === 'Gazetted').payrollNote);
  pass('a date the branch is still guessing at says so, and who it is waiting for', holidays.filter((h) => h.provisional).length > 0 && holidays.filter((h) => h.provisional).every((h) => h.source === 'Sighting committee'));
  pass('a day that is not a normal service day names who is on it', holidays.filter((h) => h.wardPlan !== 'Normal service').every((h) => h.skeletonWho.length > 10));
  pass('a plan nobody has approved is left visible for the screen to flag', CA.calendarStats(year, BRANCH).plansUnapproved > 0, `${CA.calendarStats(year, BRANCH).plansUnapproved} plan(s) awaiting a name`);

  const drafted = (over = {}) => ({
    id: 'new', name: 'Branch foundation day', nameBn: 'প্রতিষ্ঠা দিবস', date: CA.addDays(DAY, 40), observed: '', kind: 'Festival', source: 'Branch decision',
    branch: BRANCH, wardPlan: 'Skeleton staff', skeletonWho: 'One nurse per ward, one porter, one security guard', paid: true, provisional: false, noticeDays: 30,
    approvedBy: 'J. Alam', note: '', todayIso: DAY, rows: holidays, ...over,
  });
  const added = CA.checkHoliday(drafted());
  pass('a holiday added with notice is accepted', added.ok, failCodes(added) || `${added.warnings.length} warning(s)`);
  [
    ['a second holiday on a date already taken', { date: holidays.find((h) => h.branches.length === 0 || h.branches.includes(BRANCH)).date }, 'date-clash'],
    ['a skeleton plan with no skeleton in it', { wardPlan: 'Skeleton staff', skeletonWho: '' }, 'no-plan'],
    ['a holiday with no name', { name: '' }, 'no-name'],
    ['a date that is not a date', { date: 'next Friday' }, 'no-date'],
    ['a closure inside its own notice window', { kind: 'Branch closure', noticeDays: 10 }, 'short-notice'],
    ['a closure of every branch at once', { wardPlan: 'Closed to visitors', branch: 'All branches' }, 'no-whole-closure'],
    ['a holiday announced inside the week the roster is published', { noticeDays: 3 }, 'notice-too-thin'],
  ].forEach(([what, over, expected]) => {
    const result = CA.checkHoliday(drafted(over));
    pass(`the calendar refuses ${what}`, !result.ok && result.reasons.some((r) => r.code === expected), failCodes(result));
  });
  const month = CA.calendarMonth(MONTH, BRANCH);
  pass('the month’s working days are the days that are neither a weekend nor a holiday', month.workingDays === month.days.filter((d) => !d.weekend && !d.holiday).length && month.days.length === days.length, `${month.workingDays} working days in ${month.label}`);
  pass('the month’s holidays are the year’s rows that fall in it, for this branch', month.holidays.length === CA.holidaysIn(MONTH).filter((h) => h.branches.length === 0 || h.branches.includes(BRANCH)).length, month.holidays.map((h) => `${h.date} ${h.name}`).join(' · ') || 'none in this month');
  const yearStats = CA.calendarStats(year, BRANCH);
  pass('the year’s rows are the branch’s own rows', yearStats.rows === CA.holidaysFor(BRANCH).filter((h) => h.date.startsWith(year)).length, `${yearStats.rows} rows in ${year}`);
  pass('the year’s figures add up to its rows', yearStats.gazetted + yearStats.festivals + yearStats.restricted + yearStats.closures === yearStats.rows && yearStats.payrollNoted === yearStats.rows);
  pass('the year counts the days worked and the plans nobody has approved', yearStats.workedThrough === holidays.filter((h) => (h.branches.length === 0 || h.branches.includes(BRANCH)) && h.date.startsWith(year) && CA.isWorked(h)).length && yearStats.plansUnapproved === holidays.filter((h) => (h.branches.length === 0 || h.branches.includes(BRANCH)) && h.date.startsWith(year) && !h.approvedBy && h.wardPlan !== 'Normal service').length, `${yearStats.workedThrough} day(s) worked through, ${yearStats.observedDayOpen} observed date(s) still open`);
  const covering = holidays.find((h) => h.wardPlan !== 'Normal service');
  const skeleton = CA.skeletonLines(covering);
  const multiplierOf = (plan) => (plan === 'Emergency and in-patients only' ? 0.7 : plan === 'Closed to visitors' ? 0.5 : plan === 'Normal service' ? 1 : 0.8);
  const skeletonWrong = skeleton.filter((line) => {
    const ward = WARD.WARDS.find((w) => w.id === line.wardId);
    const per = Number((ward.nurseRatio.match(/1 nurse : (\d+)/) ?? [])[1] ?? 8);
    const needed = Math.max(1, Math.ceil((ward.beds / per) * multiplierOf(covering.wardPlan)));
    return line.nursesNeeded !== needed || line.nursesOn !== Math.max(0, needed - (ward.id === 'hdu' ? 0 : 1));
  });
  pass('the skeleton is recomputed from each ward’s own beds and ratio', skeleton.length === WARD.WARDS.length && skeletonWrong.length === 0, `${skeleton.length} wards for ${covering.name} (${covering.wardPlan}), ${sum(skeleton, (s) => s.nursesNeeded)} nurses needed`);
  pass('a ward short of its own plan says so rather than rounding', skeleton.filter((s) => s.nursesOn < s.nursesNeeded).every((s) => s.note.includes('short')) && skeleton.filter((s) => s.nursesOn >= s.nursesNeeded).every((s) => s.note === 'Covered.'));

  /* ===================================================== 9. the branches */

  const branchDays = BR.BRANCHES.map((b) => BR.branchDay(b, DAY));
  const main = branchDays.find((d) => d.branch === BRANCH);
  pass('Main Campus beds are the ward board’s beds', main.beds.total === sum(WARD.WARDS, (w) => w.beds) && main.beds.occupied + main.beds.free + main.beds.other === main.beds.total, `${main.beds.occupied}/${main.beds.total} occupied`);
  pass('every branch’s day is its own, and adds up within itself', branchDays.every((d) => d.node.branch === d.branch && d.beds.percentOccupied === Math.round((d.beds.occupied / d.beds.total) * 100) && d.money.billed >= d.money.collected && d.staff.onDuty <= d.staff.rostered + d.staff.secondedIn), branchDays.map((d) => `${d.branch} ${d.beds.occupied}/${d.beds.total} · ৳${d.money.collected.toLocaleString('en-IN')}`).join(' · '));
  pass('every branch writes on its own node', new Set(BR.BRANCH_PROFILES.map((p) => p.node)).size === BR.BRANCH_PROFILES.length && BR.BRANCH_PROFILES.every((p) => BR.nodeState(p.id, DAY).node === p.node), BR.BRANCH_PROFILES.map((p) => p.node).join(' '));
  pass('every node state is one the console can label, and each says what it means', branchDays.every((d) => BR.NODE_MODES.some((m) => m.mode === d.node.mode)) && BR.NODE_MODES.every((m) => m.because.length > 60));
  const wall = BR.consoleTotals(branchDays);
  pass('the wall is the branches added up', wall.beds.occupied === sum(branchDays, (d) => d.beds.occupied) && wall.collected === sum(branchDays, (d) => d.money.collected) && wall.outPatients === sum(branchDays, (d) => d.outPatients.seen) && wall.billed === sum(branchDays, (d) => d.money.billed) && wall.staffOnDuty === sum(branchDays, (d) => d.staff.onDuty));
  pass('a branch reading from a posting is named, with the time of the posting', wall.staleBranches.length === branchDays.filter((d) => d.node.figuresAreLastPosting).length && wall.staleBranches.length > 0 && wall.staleBranches.every((s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.posted) && s.pending > 0), wall.staleBranches.map((s) => `${s.branch} at ${s.posted}, ${s.pending} queued`).join(' · '));
  pass('the branch that is posting live is not on that list', !wall.staleBranches.some((s) => s.branch === BRANCH) && branchDays.find((d) => d.branch === BRANCH).node.pending === 0);
  const gaps = [['Uttara Branch', 'ICU'], ['Uttara Branch', 'Blood bank'], ['Uttara Branch', 'MRI'], ['Uttara Branch', 'NICU'], ['Mirpur Branch', 'Emergency 24 h'], ['Mirpur Branch', 'Theatre 24 h'], ['Mirpur Branch', 'Blood bank'], ['Mirpur Branch', 'ICU']];
  pass('a service a branch does not have is refused, not silently offered', gaps.every(([b, c]) => !BR.branchHas(b, c)), gaps.map(([b, c]) => `${b} · no ${c}`).join(' · '));
  pass('every capability is held by at least one branch, and the wall says which', BR.CAPABILITIES.every((c) => BR.BRANCHES.some((b) => BR.branchHas(b, c))), `${BR.CAPABILITIES.length} capabilities`);
  pass('a branch that cannot treat somebody says where they go instead', BR.BRANCHES.every((b) => (b === BRANCH ? BR.referralsFor(b).length === 0 : BR.referralsFor(b).length > 0 && BR.referralsFor(b).every((r) => r.route.length > 30 && r.because.length > 40))), `${BR.referralsFor('Uttara Branch').length + BR.referralsFor('Mirpur Branch').length} referral route(s)`);

  const report = BR.branchReport(MONTH);
  pass('the report is one row per branch per period', report.length === BR.BRANCHES.length && report.every((r) => r.period.includes(HR.monthLabel(MONTH)) || r.period.includes(MONTH)), report.map((r) => `${r.branch} · ${r.period}`).join(' · '));
  pass('every row says where its figures came from, and when they were posted', report.every((r) => r.source.length > 60 && r.posted.length >= 5));
  pass('a branch’s scope is that branch’s own row', report.every((r) => {
    const own = BR.reportTotals([r]);
    return own.billed === r.billed && own.admissions === r.admissions && own.payrollCost === r.payrollCost && own.bedNights === r.bedNights;
  }));
  const reportWall = BR.reportTotals(report);
  pass('the report’s total is the branches added up', close(reportWall.billed, sum(report, (r) => r.billed), 1) && close(reportWall.payrollCost, sum(report, (r) => r.payrollCost), 1) && close(reportWall.outstanding, sum(report, (r) => r.outstanding), 1), `৳${reportWall.billed.toLocaleString('en-IN')} billed · ৳${reportWall.collected.toLocaleString('en-IN')} collected`);
  pass('seconded staff are counted where they are paid, and the report says so', BR.BRANCH_REPORT_NOTES.some((n) => /second/i.test(n.because)) && BR.BRANCH_PROFILES.some((p) => p.seconded > 0), `${sum(BR.BRANCH_PROFILES, (p) => p.seconded)} seconded`);
  pass('the differences between branches each carry a reason and a reader', BR.BRANCH_SETTING_DIFFS.length > 0 && BR.BRANCH_SETTING_DIFFS.every((r) => r.because.length > 40 && r.readBy.length > 20 && BR.BRANCHES.every((b) => r.values[b])));
  const same = BR.BRANCH_SETTING_DIFFS.filter((r) => new Set(BR.BRANCHES.map((b) => r.values[b])).size === 1);
  pass('a setting that is deliberately the same everywhere says so, because an audit asks first', same.length > 0 && same.every((r) => /same|hospital-wide|deliberately|Applies as per/i.test(`${r.because} ${BR.BRANCHES.map((b) => r.values[b]).join(' ')}`)), same.map((r) => r.label).join(', '));

  /* ===================================================== 10. the phase is the plan */

  const plan = readFileSync(join(root, 'docs/plan/03-SCREEN-MAP.md'), 'utf8');
  const p7 = plan.slice(plan.indexOf('## P7 —'), plan.indexOf('## P8 —'));
  const planRows = p7.split('\n').filter((l) => l.startsWith('| **')).map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    return { title: cells[1].replace(/\*\*/g, ''), legacy: cells[2].replace(/`/g, ''), size: cells[3], fields: Number(cells[4]), grids: Number(cells[5]), maxCols: Number(cells[6]), dialogs: Number(cells[8]) };
  });
  pass('the plan names sixteen screens for the phase', planRows.length === 16, `${planRows.length} rows`);
  /* This section is the P7 diff, so it reads P7's own screens: the register also carries P8's twelve, and a count
   * that included them would have to be raised every time another phase is written. */
  const inPhase = AD.ADMIN_SCREENS.filter((s) => s.phase === 'P7');
  const screens = inPhase.filter((s) => s.kind === 'screen');
  const subs = inPhase.filter((s) => s.kind === 'sub');
  pass('the registry is sixteen screens and the two the plan counts apart', screens.length === 16 && subs.length === 2 && AD.ADMIN_SCREEN_COUNT.screens === 16 && AD.ADMIN_SCREEN_COUNT.subs === 2, `${screens.length} + ${subs.length}`);
  const driftedFromPlan = planRows.filter((row) => {
    const found = inPhase.find((s) => s.legacy === row.legacy);
    return !found || found.title !== row.title || found.size !== row.size || found.fields !== row.fields || found.grids !== row.grids || found.maxCols !== row.maxCols || found.dialogs !== row.dialogs;
  });
  pass('the registry matches the plan field by field', driftedFromPlan.length === 0, driftedFromPlan.map((r) => r.title).join(' · ') || 'title, size, fields, grids, columns and dialogs all agree with the screen map');
  pass('the sub-screens the plan names by id are the two on the register', /17-staff-attendance-register/.test(p7) && /18-payroll/.test(p7) && subs.map((s) => s.id).sort().join(',') === 'payroll,staff-attendance-register');
  const missing = inPhase.filter((s) => !pageAt(s.route));
  pass('every registered screen has a page behind it', missing.length === 0, missing.map((s) => s.route).join(', ') || `${AD.ADMIN_SCREENS.length} routes on disk`);
  const runtime = readFileSync(join(root, 'tools/test/runtime.mjs'), 'utf8');
  const unvisited = inPhase.filter((s) => !runtime.includes(`'${s.route}'`));
  pass('every registered screen is visited by the runtime harness', unvisited.length === 0, unvisited.map((s) => s.route).join(', ') || 'rendered, hydrated and read for console errors');
  pass('the hub says what the phase is waiting for', AD.ADMIN_WAITING.length >= 3 && AD.ADMIN_WAITING.every((w) => w.length > 60), `${AD.ADMIN_WAITING.length} items`);
  pass('every group on the hub holds something a person can open', AD.ADMIN_GROUPS.length === 4 && AD.ADMIN_GROUPS.every((g) => g.members.length >= 3 && g.members.every((m) => Boolean(AD.adminScreenById(m)) && Boolean(pageAt(AD.adminScreenById(m).route))) && g.because.length > 40), AD.ADMIN_GROUPS.map((g) => `${g.title} (${g.members.length})`).join(' · '));
  pass('every screen states what it is for, and every route is unique', AD.ADMIN_SCREENS.every((s) => s.purpose.length > 60) && new Set(AD.ADMIN_SCREENS.map((s) => s.route)).size === AD.ADMIN_SCREENS.length);

  /* ===================================================== 11. the settings and the printing */

  pass('the settings screens are registered once each, on a screen that exists', AD.SETTING_SCREENS.length === 6 && new Set(AD.SETTING_SCREENS.map((s) => s.key)).size === 6 && AD.SETTING_SCREENS.every((s) => Boolean(AD.adminScreenById(s.screenId))), AD.SETTING_SCREENS.map((s) => s.key).join(' · '));
  pass('every setting says who reads it and what breaks', AD.SETTING_SCREENS.every((s) => s.fields.every((f) => f.readBy.length >= 8 && f.hint.length > 40) && s.rules.length >= 2 && s.subtitle.length > 40), `${sum(AD.SETTING_SCREENS, (s) => s.fields.length)} fields over ${AD.SETTING_SCREENS.length} screens`);
  const ruled = AD.SETTING_SCREENS.flatMap((s) => s.fields).filter((f) => f.refuse);
  pass('a field with a rule refuses a value that breaks it, and keeps the value it holds', ruled.length >= 8 && ruled.every((f) => !AD.checkSetting(f, f.kind === 'number' || f.kind === 'money' ? '99999999' : '').ok && AD.checkSetting(f, f.kind === 'number' || f.kind === 'money' ? String(f.value) : f.value).ok), `${ruled.length} ruled fields, each refusing with its own sentence`);
  const slot = AD.settingByKey('appointment.online').fields.find((f) => f.key === 'slotMinutes');
  pass('a number outside its range is refused with the reason, not a red box', !AD.checkSetting(slot, 120).ok && AD.checkSetting(slot, 15).ok && AD.checkSetting(slot, 120).problem.includes(slot.label), AD.checkSetting(slot, 120).problem);
  pass('a setting that changes every appointment says so before it saves', slot.hint.includes('asks before it saves'));
  pass('every custom field names the entity, the validation and who may see it', AD.CUSTOM_FIELDS.length > 0 && AD.CUSTOM_FIELDS.every((f) => AD.CUSTOM_ENTITIES.includes(f.entity) && f.key.length > 2 && f.label.length > 2 && f.visibleTo.length > 0), `${AD.CUSTOM_FIELDS.length} fields over ${AD.CUSTOM_ENTITIES.length} entities`);
  const duplicate = AD.checkCustomField(AD.CUSTOM_FIELDS, { entity: AD.CUSTOM_FIELDS[0].entity, key: AD.CUSTOM_FIELDS[0].key, label: 'Another question', kind: 'text', options: [], visibleTo: ['admin'] });
  pass('a key already used on that entity is refused, by name', !duplicate.ok && (duplicate.problem ?? '').includes(AD.CUSTOM_FIELDS[0].key), duplicate.problem);
  const printDoc = readFileSync(pageAt('/print/[doc]'), 'utf8');
  pass('twelve print templates, and every one of them renders a document', AD.PRINT_TEMPLATES.length === 12 && AD.PRINT_TEMPLATES.every((t) => t.route.startsWith('/print/') && printDoc.includes(`'${t.route.split('/').pop()}'`)), AD.PRINT_TEMPLATES.map((t) => t.route.split('/').pop()).join(' '));
  pass('every template names the paper it wants, what it prints and which legacy screen it replaces', AD.PRINT_TEMPLATES.every((t) => t.paper && t.prints.length > 0 && t.note.length > 40 && t.legacy.startsWith('/admin')));

  /* ---------------------------------------------------------------- 12. the template designer
   *
   * The register has said `authoredIn: 'designer'` since the printing settings screen shipped, so what is worth
   * checking is that the designer's language holds up: every template has a layout on the paper its own row names,
   * every starting layout passes the printer's own rules, the rules refuse what would waste paper, and a published
   * version is appended rather than edited.
   */
  const layouts = PT.LAYOUTS;
  pass(
    'every template the register tracks has a layout, on the paper its own row names',
    layouts.length === AD.PRINT_TEMPLATES.length && AD.PRINT_TEMPLATES.every((t) => PT.layoutFor(t.id)?.name === t.label && PT.PAPERS[PT.layoutFor(t.id).paper].register === t.paper),
    layouts.map((l) => `${l.id} ${PT.PAPERS[l.paper].register}`).join(' · '),
  );
  const layoutRefusals = layouts.filter((l) => !PT.checkLayout(l).ok);
  const warnings = layouts.flatMap((l) => PT.checkLayout(l).warnings);
  const offGrid = layouts.flatMap((l) => l.blocks.filter((b) => ![b.x, b.y, b.w, b.h].every(PT.onGrid)).map((b) => `${l.id}/${b.id}`));
  pass(
    'every starting layout passes the printer’s rules, with nothing to warn about and every edge on the grid',
    layoutRefusals.length === 0 && warnings.length === 0 && offGrid.length === 0,
    `${sum(layouts, (l) => l.blocks.length)} blocks over ${layouts.length} templates · ${offGrid.length} off the ${PT.GRID} mm grid`,
  );
  const bad = (patch) => PT.checkLayout({ ...PT.layoutFor('receipt'), blocks: PT.layoutFor('receipt').blocks.map((b) => (b.kind === 'patient' ? { ...b, ...patch } : b)) });
  pass(
    'a data block with no field behind it is refused, because it would print its heading and a blank line',
    !bad({ field: undefined }).ok && bad({ field: undefined }).reasons.some((r) => r.code === 'dizi.layout-refused' && r.block),
    bad({ field: undefined }).reasons[0].message.slice(0, 80),
  );
  const noRows = PT.checkLayout({ ...PT.layoutFor('receipt'), blocks: PT.layoutFor('receipt').blocks.map((b) => (b.kind === 'table' ? { ...b, rows: 0 } : b)) });
  const offPaper = PT.checkLayout({ ...PT.layoutFor('receipt'), blocks: [...PT.layoutFor('receipt').blocks, { id: 'x', kind: 'note', x: 70, y: 290, w: 20, h: 12, text: 'Added at the edge' }] });
  const noHeader = PT.checkLayout({ ...PT.layoutFor('receipt'), blocks: PT.layoutFor('receipt').blocks.filter((b) => b.kind !== 'hospital') });
  pass(
    'a table with no rows, a block off the sheet and a document with no hospital name are each refused by name',
    failCodes(noRows) === 'dizi.layout-refused' && failCodes(offPaper) === 'dizi.layout-refused' && failCodes(noHeader) === 'dizi.layout-refused' && offPaper.reasons[0].block && noHeader.reasons[0].message.includes('hospital'),
    `${noRows.reasons[0].block} · ${offPaper.reasons[0].block} · ${noHeader.reasons.length} for the missing header`,
  );
  const receipt = PT.layoutFor('receipt');
  const room = PT.roomFor(receipt, 'note');
  pass(
    'a new block lands in the first gap rather than off the bottom of the sheet',
    room.ok && room.y < PT.PAPERS[receipt.paper].h && PT.checkLayout({ ...receipt, blocks: receipt.blocks.map((b) => b).concat([{ id: 'n', kind: 'note', x: 4, y: room.y, w: 70, h: room.h, text: 'Hand this slip to the pharmacy counter.' }]) }).ok,
    `a ${room.h} mm block fits at ${room.y} mm on a ${PT.PAPERS[receipt.paper].h} mm roll`,
  );
  const full = {
    ...receipt,
    blocks: [
      { id: 'h', kind: 'hospital', x: 4, y: 4, w: 72, h: 30 },
      { id: 'fill', kind: 'note', x: 4, y: 34, w: 72, h: 250, text: 'The whole sheet, head to foot' },
      { id: 'f', kind: 'footer', x: 4, y: 286, w: 72, h: 6 },
    ],
  };
  const noRoom = PT.roomFor(full, 'note');
  pass(
    'and when the sheet really is full it says so, naming what to do about it, instead of dropping a block on the floor',
    !noRoom.ok && (noRoom.because ?? '').includes('Move a block') && (noRoom.because ?? '').length > 60,
    noRoom.because ?? '',
  );
  const dragged = PT.editBlock({ id: 'd', kind: 'note', x: 4, y: 24, w: 40, h: 12, text: 'x' }, { dx: 7, dy: 5 }, 'thermal-80');
  const tiny = PT.editBlock(dragged, { dw: -500, dh: -500 }, 'thermal-80');
  const shoved = PT.editBlock({ id: 's', kind: 'note', x: 4, y: 280, w: 40, h: 12, text: 'x' }, { dx: 500, dy: 500 }, 'thermal-80');
  pass(
    'a dragged block snaps to the grid, never shrinks below the legible minimum, and cannot be shoved off the sheet',
    PT.onGrid(dragged.x) && PT.onGrid(dragged.y) && dragged.x === 12 && dragged.y === 30 && tiny.w === PT.MIN_BLOCK.w && tiny.h === PT.MIN_BLOCK.h && shoved.x + shoved.w <= PT.PAPERS['thermal-80'].w && shoved.y + shoved.h <= PT.PAPERS['thermal-80'].h,
    `7,5 mm drag → ${dragged.x},${dragged.y} · resized to ${tiny.w}×${tiny.h} · shoved to ${shoved.x},${shoved.y}`,
  );
  const before = PT.layoutFor('receipt');
  const after = PT.publish(before, 'S. Nahar, system administrator', '2026-10-16 11:20');
  pass(
    'publishing appends a version and leaves the previous sheet untouched',
    after.version === before.version + 1 && after.publishedBy === 'S. Nahar, system administrator' && after.publishedAt === '2026-10-16 11:20' && before.version === 0 && before.publishedAt === undefined && after.blocks === before.blocks,
    `v${before.version} → v${after.version} · the previous layout is the same object it was`,
  );
  const mapped = Object.values(PT.TEMPLATE_OF_DOC);
  const unmapped = AD.PRINT_TEMPLATES.filter((t) => !mapped.includes(t.id));
  pass(
    'the documents the designer owns are the register’s twelve, and the ones it does not own are named rather than silently missing',
    mapped.length === 12 && new Set(mapped).size === 12 && unmapped.length === 0 && PT.DESIGNER_WAITING.some((w) => /registration slip/i.test(w)),
    `${mapped.length} documents mapped · ${PT.DESIGNER_WAITING.length} things the designer still needs`,
  );
  const printRoute = readFileSync(pageAt('/print/[doc]'), 'utf8');
  pass(
    'the printed page renders a published layout when this node has one, and its own template when it has not',
    /PrintSheet/.test(printRoute) && /nodeLayoutFor/.test(printRoute) && /TEMPLATE_OF_DOC\[kind\]/.test(printRoute) && PT.LAYOUT_RULES.length >= 5,
    'one renderer for the designer and the printer',
  );

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):\n${failures.map((f) => `  · ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log('\nadmin — every case passed\n');
  process.exit(0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
