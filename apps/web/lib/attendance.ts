/* ----------------------------------------------------------------------------------------------------
 * Attendance (P7) — the reader at the door, the day it produced, and the month the payroll is paid from.
 *
 * The legacy system's attendance was a paper register somebody filled in on Thursday for the whole week,
 * which is why its payroll was always approximately right. This module is built the other way round:
 *
 *  1. **A punch is a fact with a device and a time.** It is accepted from an enrolled reader, it opens or
 *     closes a stint, and it is never edited — a correction is a second record naming the supervisor and the
 *     reason, which is the only kind of correction the person whose pay depends on it can check.
 *  2. **The register is what the punches add up to, and it refuses to guess.** A day with no punch and no leave
 *     is an absence, and the register says so out loud in its exception list rather than quietly paying it.
 *  3. **A QR code is a shared secret on a wall.** It identifies the *shift* a person is on, not the person:
 *     a PIN or a fingerprint confirms who is standing in front of the reader, and the register records which.
 *  4. **The month is the unit the payroll is paid in**, so the register and the payroll walk the same days,
 *     through the same generator. They cannot disagree about what October contained.
 *
 * Preview: punches for today are derived from the shift clock, and the month is generated deterministically per
 * staff member and month, so the same October reads the same for two people looking at it.
 */

import { SHIFT_WINDOW, type Shift } from './duty';
import { branches } from './mock';
import {
  LATE_MARKS_PER_HALF_DAY,
  type HrStaff,
  type PayrollAttendance,
  type StaffBranch,
  isWeekend,
  monthDays,
} from './hr';

/* The registers in this preview are Main Campus's: one gate, one set of readers, one payroll month. A satellite
   runs its own node, and a share of another site's attendance would be a figure nobody could act on. */
export const HR_NODES: StaffBranch[] = ['Main Campus'];

export type PunchKind = 'QR' | 'Biometric' | 'Face' | 'Manual override';
export const PUNCH_KINDS: PunchKind[] = ['QR', 'Biometric', 'Face', 'Manual override'];

export interface Device {
  id: string;
  label: string;
  location: string;
  kind: PunchKind;
  branch: StaffBranch;
  active: boolean;
  lastSeen: string;
  note?: string;
}

/**
 * The readers. One is deliberately faulty: a device that has not reported since yesterday is the reason a nurse
 * appears absent on the register, and the screen's job is to make that visible before the payroll is approved.
 */
export const DEVICES: Device[] = [
  { id: 'DEV-GATE-01', label: 'Main gate reader', location: 'Main gate, staff entrance', kind: 'QR', branch: 'Main Campus', active: true, lastSeen: 'today 06:41' },
  { id: 'DEV-GATE-02', label: 'Gate fingerprint reader', location: 'Main gate, staff entrance', kind: 'Biometric', branch: 'Main Campus', active: true, lastSeen: 'today 06:58', note: 'The fingerprint reader next to the QR reader: the QR identifies the shift, the fingerprint identifies the person.' },
  { id: 'DEV-WARD-01', label: 'Ward corridor reader', location: 'Ward corridor, outside Medicine Ward A', kind: 'QR', branch: 'Main Campus', active: true, lastSeen: 'today 07:02' },
  { id: 'DEV-HDU-01', label: 'Critical care reader', location: 'HDU entrance', kind: 'Face', branch: 'Main Campus', active: false, lastSeen: 'yesterday 21:14', note: 'Not reporting since 21:14 yesterday. Six people are punched in on this device and the register shows them as unpaired until it comes back or somebody corrects the days.' },
  { id: 'DEV-OT-01', label: 'Theatre suite reader', location: 'Theatre suite, scrub corridor', kind: 'Biometric', branch: 'Main Campus', active: true, lastSeen: 'today 08:06' },
  { id: 'DEV-ADMIN-01', label: 'Administration reader', location: 'Administration floor', kind: 'QR', branch: 'Main Campus', active: true, lastSeen: 'today 08:52' },
];

export const deviceById = (id: string): Device | undefined => DEVICES.find((d) => d.id === id);
export const devicesOf = (branch: StaffBranch): Device[] => DEVICES.filter((d) => d.branch === branch);

/** Ten minutes after the shift starts, and the register records the minutes rather than a tick. */
export const LATE_GRACE_MIN = 10;
/** Under four hours is a half day, not a short day: the payroll has to draw the line somewhere, and this is it. */
export const HALF_DAY_HOURS = 4;
/** Overtime is counted in half hours, from the first one, and approved before it is paid. */
export const OT_MIN_MINUTES = 30;
/** Nobody is in this building for sixteen hours. Past that the punch is a reader fault, not a shift. */
export const MAX_STINT_HOURS = 16;
/** Two punches for the same person inside a minute are one punch. */
export const DUPLICATE_WINDOW_SECONDS = 60;

export const DEVICE_RULES: Array<{ title: string; because: string }> = [
  { title: 'A punch is only accepted from an enrolled reader in this branch', because: 'The reader is the evidence. A punch typed into an app from outside the building is a claim, not a record, and the register has to be able to say which one it holds.' },
  { title: 'A QR code identifies the shift, not the person', because: 'The code is printed and stuck on a wall beside the reader, so anybody could photograph it. The PIN or the fingerprint is what confirms who is standing there, and the register records which check was used.' },
  { title: 'A punch is never edited', because: 'The correction names the supervisor, the reason and the time. The person whose pay depends on the day can then ask a question about a name rather than about a number that changed.' },
  { title: 'An unpaired punch is an exception, not an absence', because: 'A reader that dies mid-shift leaves people punched in and no way out. The register names those days and the shift manager corrects them; it never silently writes a half day.' },
  { title: 'A lapsed clinical licence blocks the duty punch', because: 'A nurse whose registration expired yesterday may not be counted as working today, and the roster and attendance have to agree about that order of events.' },
];

export interface Punch {
  id: string;
  staffCode: string;
  staffName: string;
  /** `YYYY-MM-DD HH:MM`, read when the punch happens and never re-read while rendering. */
  at: string;
  day: string;
  time: string;
  deviceId: string;
  deviceLabel: string;
  kind: PunchKind;
  state: 'In' | 'Out';
  shift: Shift;
  /** Minutes past the shift start, when late. Negative is early, which is a person rather than a fault. */
  lateMinutes: number;
  /** Named for a manual override: a punch nobody can be asked about is not evidence. */
  verifiedBy?: string;
  reason?: string;
  /** Shift managers, not readers: kept so the register can count corrections by person. */
  corrected?: boolean;
}

export const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOf = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The shift windows are written as clock times, because that is how they are printed on the roster. */
export const shiftStart = (shift: Shift): number => minutesOf(SHIFT_WINDOW[shift].start);
export const shiftEnd = (shift: Shift): number => minutesOf(SHIFT_WINDOW[shift].end);
export const shiftHours = (shift: Shift): number => SHIFT_WINDOW[shift].hours;

/** Which shift a punch falls in: an hour before a shift starts belongs to that shift, not to nothing. */
export const shiftOf = (time: string): Shift => {
  const minutes = minutesOf(time);
  if (minutes >= shiftStart('Morning') - 120 && minutes < shiftStart('Evening') - 60) return 'Morning';
  if (minutes >= shiftStart('Evening') - 60 && minutes < shiftStart('Night') - 60) return 'Evening';
  return 'Night';
};

/** Late minutes against the shift this punch falls in. Early arrivals return a negative number, on purpose. */
export function lateAgainst(time: string, shift: Shift): number {
  return minutesOf(time) - shiftStart(shift);
}

export interface PunchCheck {
  ok: boolean;
  code?: string;
  problem?: string;
  hint?: string;
}

/**
 * Whether the reader should accept a punch, and what to say if it should not.
 *
 * These are the five things that go wrong at a real reader, and each one has a sentence a security guard can act
 * on at seven in the morning.
 */
export function checkPunch(
  input: { staff: HrStaff | undefined; at: string; device: Device | undefined; kind: PunchKind; state: 'In' | 'Out'; last?: Punch; dayIso: string },
): PunchCheck {
  const { staff, at, device, kind, state, last, dayIso } = input;
  const time = at.slice(11, 16);
  if (!staff) return { ok: false, code: 'unknown-staff', problem: 'That employee number is not in the staff register.', hint: 'The reader reads the number off the badge; a number that is not in the register is a badge that was never issued, and the guard should keep it rather than guess.' };
  if (!device) return { ok: false, code: 'unknown-device', problem: 'That reader is not enrolled for this branch.', hint: 'Readers are enrolled by the IT officer with their location. An unenrolled reader is one whose punches nobody can place in a building.' };
  if (!device.active) return { ok: false, code: 'device-inactive', problem: `${device.label} is not reporting and has been offline since ${device.lastSeen}.`, hint: 'A punch from a reader that is down would be a claim rather than a record. Use the other reader at the same door, or the shift manager corrects the day.' };
  if (staff.status === 'Resigned' || staff.status === 'Retired') return { ok: false, code: 'left-service', problem: `${staff.name} left service, so there is no shift to punch.`, hint: 'If this is a visit rather than work, the visitor register at the gate is the right record.' };
  if (staff.status === 'Suspended') return { ok: false, code: 'suspended', problem: `${staff.name} is suspended pending an inquiry.`, hint: 'A suspended member of staff may not be counted as on duty, whatever the reader says.' };
  if (staff.licence && staff.licence.expires < dayIso && staff.wardId) {
    return {
      ok: false,
      code: 'licence-lapsed',
      problem: `${staff.name}’s ${staff.licence.kind} lapsed on ${staff.licence.expires}, so the reader refuses the duty punch.`,
      hint: 'The roster must not fill a clinical duty with a lapsed registration. HR renews the licence and the punch goes through the same day — the record of the refusal stays either way.',
    };
  }
  if (kind === 'Manual override') {
    return { ok: true, code: 'manual', problem: undefined, hint: 'Recorded as a manual override: it needs the supervisor’s name and a reason, which the screen has already taken.' };
  }
  if (last?.at.slice(0, 10) === at.slice(0, 10)) {
    const gap = Math.abs(minutesOf(time) - minutesOf(last.time));
    if (gap === 0) return { ok: false, code: 'duplicate', problem: `The reader has already seen this punch at ${last.time}.`, hint: 'The same code at the same minute is one punch. A second identical one is a person who tapped twice, and counting it would move a night shift across midnight.' };
    if (last.state === state) return { ok: false, code: 'unpaired', problem: `${staff.name} is already punched ${state === 'In' ? 'in' : 'out'} — the last punch was ${last.time}, and this one pairs nothing.`, hint: `The register holds the ${state === 'In' ? 'in' : 'out'} and reports it as an unpaired punch at the end of the day, rather than guessing at the missing half.` };
    if (state === 'Out' && gap > MAX_STINT_HOURS * 60) {
      return { ok: false, code: 'stint-too-long', problem: `${gap / 60} hours between ${last.time} and ${time} is longer than a shift can be.`, hint: `Nobody is in this building for ${MAX_STINT_HOURS} hours. This is a reader fault or a forgotten punch; the shift manager corrects the day so the payroll sees the real stint.` };
    }
  }
  if (state === 'Out' && !last) {
    return { ok: false, code: 'no-open-stint', problem: `There is no punch in today for ${staff.name}.`, hint: 'An out without an in pays nothing. The shift manager corrects the in, with their name and the reason, and then this punch pairs.' };
  }
  return { ok: true };
}

export interface AttendanceRow {
  staffCode: string;
  name: string;
  designation: string;
  wardId?: string;
  shift: Shift;
  inAt?: string;
  outAt?: string;
  hours: number;
  state: 'Present' | 'Late' | 'Absent' | 'On leave' | 'Half day' | 'Off' | 'On duty outside' | 'Starts later';
  lateMinutes: number;
  otMinutes: number;
  punchKind?: PunchKind;
  corrected?: boolean;
  /** Punched in and not yet out: the stint is still running, so it is present rather than short. */
  open?: boolean;
}

export interface AttendanceDay {
  day: string;
  now: string;
  rows: AttendanceRow[];
  punches: Punch[];
  stats: {
    rostered: number;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    off: number;
    later: number;
    open: number;
    unpaired: number;
    corrected: number;
    lateDevices: number;
    overtimeMinutes: number;
  };
  devices: Device[];
}

/** mulberry32 over a string key: the same day and the same employee always produce the same punch. */
function seededRng(key: string) {
  let seed = 2_166_136_261;
  for (const ch of key) seed = (Math.imul(seed ^ ch.charCodeAt(0), 16_777_619) >>> 0) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function tally(rows: AttendanceRow[]) {
  return {
    rostered: rows.length,
    present: rows.filter((r) => r.state === 'Present' || r.state === 'Late' || r.state === 'Half day' || r.state === 'On duty outside').length,
    late: rows.filter((r) => r.state === 'Late').length,
    absent: rows.filter((r) => r.state === 'Absent').length,
    onLeave: rows.filter((r) => r.state === 'On leave').length,
    off: rows.filter((r) => r.state === 'Off').length,
    later: rows.filter((r) => r.state === 'Starts later').length,
    open: rows.filter((r) => r.open).length,
    overtimeMinutes: rows.reduce((n, r) => n + r.otMinutes, 0),
  };
}

/**
 * The day's attendance: the punches the readers hold and the rows they add up to.
 *
 * The current shift is the evening shift, and the clock is 15:20 — the same clock the ward board reads — so the
 * screen shows a shift that is half over rather than a tidy completed day.
 */
export function attendanceDay(dayIso: string, directory: HrStaff[]): AttendanceDay {
  const now = '15:20';
  const shifts: Shift[] = ['Morning', 'Evening', 'Night'];
  const mine = directory.filter((s) => HR_NODES.includes(s.branch));
  const punches: Punch[] = [];
  const rows: AttendanceRow[] = [];
  let seq = 0;

  for (const staff of mine) {
    const r = seededRng(`${dayIso}:${staff.code}`)();
    /* The shifts are dealt out the way the roster deals them: three groups of the same ward, so the evening that
       is now half over is a third of the floor rather than all of it. Office staff work the morning. */
    const shift: Shift = staff.wardId ? shifts[seq % 3] : 'Morning';
    seq += 1;
    const device = DEVICES.find((d) => d.active && (staff.wardId === 'hdu' ? d.id === 'DEV-GATE-02' : staff.departmentId === 'support' ? d.id === 'DEV-GATE-01' : d.id === 'DEV-WARD-01')) ?? DEVICES[0];

    if (staff.onLeave) {
      rows.push({ staffCode: staff.code, name: staff.name, designation: staff.designation, wardId: staff.wardId, shift, hours: 0, state: 'On leave', lateMinutes: 0, otMinutes: 0 });
      continue;
    }
    if (staff.wardId === undefined && isWeekend(dayIso)) {
      rows.push({ staffCode: staff.code, name: staff.name, designation: staff.designation, shift, hours: 0, state: 'Off', lateMinutes: 0, otMinutes: 0 });
      continue;
    }
    if (r > 0.94) {
      rows.push({ staffCode: staff.code, name: staff.name, designation: staff.designation, wardId: staff.wardId, shift, hours: 0, state: 'Absent', lateMinutes: 0, otMinutes: 0 });
      continue;
    }
    /* The night shift begins at 20:00 and has not started: the register says so rather than calling it absent. */
    if (shift === 'Night') {
      rows.push({ staffCode: staff.code, name: staff.name, designation: staff.designation, wardId: staff.wardId, shift, hours: 0, state: 'Starts later', lateMinutes: 0, otMinutes: 0 });
      continue;
    }

    /* The shift's own clock. One person on the floor is late on purpose, because the register has to show what a
       late mark does to a month: three of them are half a day. */
    const late = staff.name === 'S. Nahar' || r > 0.9;
    /* The receptionist is late on purpose, by a fixed 23 minutes: the day screen has to show a late mark whose
       consequence — three of them are half a day — is the rule the register prints. */
    const inMinutes = shiftStart(shift) + (late ? (staff.name === 'S. Nahar' ? 23 : 5 + Math.floor(r * 24)) : -Math.floor(r * 12));
    const inTime = timeOf(inMinutes);
    const outMinutes = shiftEnd(shift) + (r > 0.7 ? Math.floor(r * 30) : 0);
    const open = shift === 'Evening' && outMinutes > minutesOf(now);
    const worked = open ? minutesOf(now) - inMinutes : outMinutes - inMinutes;
    const delta = inMinutes - shiftStart(shift);
    const lateMinutes = delta > LATE_GRACE_MIN ? delta : 0;
    const kind: PunchKind = device.kind;

    const punch = (state: 'In' | 'Out', time: string): Punch => ({
      id: `${device.id}:${staff.code}:${state}`,
      staffCode: staff.code,
      staffName: staff.name,
      at: `${dayIso} ${time}`,
      day: dayIso,
      time,
      deviceId: device.id,
      deviceLabel: device.label,
      kind,
      state,
      shift,
      lateMinutes: state === 'In' ? lateMinutes : 0,
    });

    punches.push(punch('In', inTime));
    if (!open && worked > 0) punches.push(punch('Out', timeOf(outMinutes)));

    const otMinutes = worked > shiftHours(shift) * 60 + OT_MIN_MINUTES ? Math.floor((worked - shiftHours(shift) * 60) / OT_MIN_MINUTES) * OT_MIN_MINUTES : 0;
    rows.push({
      staffCode: staff.code,
      name: staff.name,
      designation: staff.designation,
      wardId: staff.wardId,
      shift,
      inAt: inTime,
      ...(open ? {} : { outAt: timeOf(outMinutes) }),
      hours: Math.round((worked / 60) * 10) / 10,
      state: lateMinutes > 0 ? 'Late' : !open && worked < HALF_DAY_HOURS * 60 ? 'Half day' : 'Present',
      lateMinutes,
      otMinutes,
      punchKind: kind,
      ...(open ? { open: true } : {}),
    });
  }

  const stats = tally(rows);
  return {
    day: dayIso,
    now,
    rows,
    punches,
    stats: {
      ...stats,
      unpaired: rows.filter((r) => r.open).length,
      corrected: punches.filter((p) => p.kind === 'Manual override').length,
      lateDevices: DEVICES.filter((d) => !d.active).length,
    },
    devices: DEVICES,
  };
}

/* ------------------------------------------------------------------------------------------- the month */

export type RegisterCode = 'P' | 'L' | 'HD' | 'A' | 'LV' | 'LWP' | 'WO' | 'PH' | 'T';

export const REGISTER_CODES: Record<RegisterCode, { label: string; tone: 'success' | 'warning' | 'critical' | 'neutral' | 'info'; because: string }> = {
  P: { label: 'Present', tone: 'success', because: 'Punched in and out, and the stint was at least four hours.' },
  L: { label: 'Late', tone: 'warning', because: `Arrived more than ${LATE_GRACE_MIN} minutes after the shift started. Three of these are half a day, which is the rule the payroll applies.` },
  HD: { label: 'Half day', tone: 'warning', because: `Present, but under ${HALF_DAY_HOURS} hours. Half a day’s pay, and the reason is recorded against the day.` },
  A: { label: 'Absent', tone: 'critical', because: 'No punch, no leave, no training. The register counts it, and it is the row a person comes to HR about.' },
  LV: { label: 'Leave', tone: 'info', because: 'Approved paid leave. The entitlement is spent in the leave register, and this day simply does not cost the payroll anything.' },
  LWP: { label: 'Leave without pay', tone: 'warning', because: 'Approved unpaid leave. The day comes out of the gross rather than out of the entitlement, which is why it is a different code.' },
  WO: { label: 'Weekly off', tone: 'neutral', because: 'The roster’s own rest day. A weekly off that is worked is overtime with a rule behind it, not an absence.' },
  PH: { label: 'Public holiday', tone: 'neutral', because: 'A gazetted holiday the office closes for. Ward staff work it, and the register records the day so a compensatory off can be given deliberately rather than forgotten.' },
  T: { label: 'Training or outside duty', tone: 'info', because: 'A workshop, a blood drive, a referral escort, or a holiday worked. Present for the hospital and not on the ward, which the coverage table needs to know.' },
};

/** The days the payroll pays for: a worked day, however the punch came out. */
export const WORKED_CODES: RegisterCode[] = ['P', 'L', 'HD', 'T'];
/** The days that cost the payroll the full day's rate, worked or on paid leave. */
export const PAID_CODES: RegisterCode[] = ['P', 'L', 'HD', 'T', 'LV'];

export interface LeaveSpan {
  staffCode: string;
  typeCode: string;
  from: string;
  to: string;
  paid: boolean;
  documentNo?: string;
}

/** Spans the preview seeds: a maternity absence that runs the whole month, one long earned leave, and two short ones. */
export function seedLeaveSpans(monthIso: string, directory: HrStaff[]): LeaveSpan[] {
  const first = `${monthIso}-01`;
  const last = `${monthIso}-${String(monthDays(monthIso).length).padStart(2, '0')}`;
  const mid = `${monthIso}-14`;
  const find = (predicate: (s: HrStaff) => boolean, skip = 0) => directory.filter(predicate)[skip];
  const midwife = find((s) => s.role === 'Midwife') ?? find((s) => s.role === 'Staff nurse');
  const accountant = find((s) => s.designation === 'Accounts officer') ?? find((s) => s.departmentId === 'accounts');
  const technologist = find((s) => s.designation === 'Medical technologist') ?? find((s) => s.departmentId === 'lab');
  const outsourced = find((s) => s.employment === 'Outsourced') ?? find((s) => s.departmentId === 'support');
  return [
    ...(midwife ? [{ staffCode: midwife.code, typeCode: 'MAT', from: first, to: last, paid: true, documentNo: 'MAT-CERT-2026-118' }] : []),
    ...(accountant ? [{ staffCode: accountant.code, typeCode: 'EARN', from: `${monthIso}-05`, to: mid, paid: true }] : []),
    ...(technologist ? [{ staffCode: technologist.code, typeCode: 'SICK', from: `${monthIso}-08`, to: `${monthIso}-10`, paid: true, documentNo: 'SICK-2026-0442' }] : []),
    ...(outsourced ? [{ staffCode: outsourced.code, typeCode: 'LWP', from: `${monthIso}-20`, to: `${monthIso}-22`, paid: false }] : []),
  ];
}

export interface RegisterDay {
  day: string;
  code: RegisterCode;
  hours: number;
  lateMinutes: number;
  otMinutes: number;
  note?: string;
}

export interface RegisterRow {
  staffCode: string;
  name: string;
  designation: string;
  departmentId: string;
  wardId?: string;
  employment: string;
  days: RegisterDay[];
  summary: {
    present: number;
    late: number;
    half: number;
    absent: number;
    leave: number;
    unpaid: number;
    weeklyOff: number;
    holiday: number;
    training: number;
    workedDays: number;
    otHours: number;
    lateMarks: number;
  };
}

export interface RegisterException {
  staffCode: string;
  name: string;
  day: string;
  kind: 'no-punch' | 'late' | 'short' | 'unpaired' | 'device';
  text: string;
}

export interface RegisterMonth {
  month: string;
  days: string[];
  rows: RegisterRow[];
  spans: LeaveSpan[];
  stats: {
    staff: number;
    presentDays: number;
    paidDays: number;
    absentDays: number;
    leaveDays: number;
    unpaidDays: number;
    lateMarks: number;
    halfDays: number;
    otHours: number;
    holidaysWorked: number;
    exceptions: number;
  };
  exceptions: RegisterException[];
}

/** Public holidays the branch observes. Ward staff work them, which is why the code distinguishes worked from off. */
export const PUBLIC_HOLIDAYS: Array<{ day: string; label: string }> = [
  { day: '2026-01-01', label: 'New Year’s Day' },
  { day: '2026-02-21', label: 'Language Martyrs’ Day' },
  { day: '2026-03-17', label: 'Sheikh Mujibur Rahman’s birthday' },
  { day: '2026-03-26', label: 'Independence Day' },
  { day: '2026-05-01', label: 'May Day' },
  { day: '2026-08-15', label: 'National Mourning Day' },
  { day: '2026-12-16', label: 'Victory Day' },
  { day: '2026-12-25', label: 'Christmas Day' },
];

export const holidayOn = (dayIso: string): { day: string; label: string } | undefined => PUBLIC_HOLIDAYS.find((h) => h.day === dayIso);

/**
 * The month's register: every staff member, every day, one code each — built from the same generator the payroll
 * consumes, so the figure on the payslip and the row on the register come from one place.
 */
export function attendanceRegister(monthIso: string, directory: HrStaff[], spans: LeaveSpan[] = seedLeaveSpans(monthIso, directory)): RegisterMonth {
  const days = monthDays(monthIso);
  const mine = directory.filter((s) => HR_NODES.includes(s.branch));
  const rows: RegisterRow[] = [];
  const exceptions: RegisterException[] = [];

  for (const staff of mine) {
    const out: RegisterDay[] = [];
    /** The one weekday a shift worker is off, rotated per person so a ward is never off on the same day. */
    const offWeekday = [...`${monthIso}:${staff.code}`].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
    for (const day of days) {
      const holiday = holidayOn(day);
      const span = spans.find((s) => s.staffCode === staff.code && s.from <= day && s.to >= day);
      const r = seededRng(`${monthIso}:${staff.code}:${day}`)();

      if (span) {
        out.push({ day, code: span.paid ? 'LV' : 'LWP', hours: 0, lateMinutes: 0, otMinutes: 0, note: span.typeCode });
        continue;
      }
      const office = staff.departmentId === 'front' || staff.departmentId === 'accounts' || staff.departmentId === 'admin' || staff.departmentId === 'hr' || staff.departmentId === 'support';
      if (office && isWeekend(day)) {
        out.push({ day, code: 'WO', hours: 0, lateMinutes: 0, otMinutes: 0 });
        continue;
      }
      if (!office && new Date(`${day}T00:00:00Z`).getUTCDay() === offWeekday) {
        out.push({ day, code: 'WO', hours: 0, lateMinutes: 0, otMinutes: 0 });
        continue;
      }
      if (holiday && office) {
        out.push({ day, code: 'PH', hours: 0, lateMinutes: 0, otMinutes: 0, note: holiday.label });
        continue;
      }
      if (r > 0.978) {
        out.push({ day, code: 'A', hours: 0, lateMinutes: 0, otMinutes: 0, note: 'No punch, no leave' });
        exceptions.push({ staffCode: staff.code, name: staff.name, day, kind: 'no-punch', text: `${staff.name} has no punch on ${day} and no leave against it. The register counts it as an absence; if the reader was down or the badge was lost, the shift manager corrects the day with their name against it.` });
        continue;
      }
      if (r < 0.012) {
        out.push({ day, code: 'HD', hours: 3.5, lateMinutes: 0, otMinutes: 0, note: 'Left after three and a half hours' });
        continue;
      }
      if (r > 0.958) {
        const lateMinutes = 12 + Math.floor(r * 40);
        out.push({ day, code: 'L', hours: 7.6, lateMinutes, otMinutes: 0, note: `Arrived ${lateMinutes} minutes after the shift started` });
        exceptions.push({ staffCode: staff.code, name: staff.name, day, kind: 'late', text: `${staff.name} was ${lateMinutes} minutes late on ${day}. Three late marks in a month are half a day, and the payroll takes it.` });
        continue;
      }
      if (holiday) {
        out.push({ day, code: 'T', hours: 8, lateMinutes: 0, otMinutes: 0, note: `${holiday.label} — worked` });
        continue;
      }
      if (r > 0.988 && staff.wardId) {
        out.push({ day, code: 'T', hours: 8, lateMinutes: 0, otMinutes: 0, note: 'Workshop or outside duty' });
        continue;
      }
      out.push({ day, code: 'P', hours: 8, lateMinutes: 0, otMinutes: staff.wardId || staff.departmentId === 'nursing' ? otForDay(r) : 0 });
    }

    const summary = {
      present: out.filter((d) => d.code === 'P').length,
      late: out.filter((d) => d.code === 'L').length,
      half: out.filter((d) => d.code === 'HD').length,
      absent: out.filter((d) => d.code === 'A').length,
      leave: out.filter((d) => d.code === 'LV').length,
      unpaid: out.filter((d) => d.code === 'LWP').length,
      weeklyOff: out.filter((d) => d.code === 'WO').length,
      holiday: out.filter((d) => d.code === 'PH').length,
      training: out.filter((d) => d.code === 'T').length,
      workedDays: 0,
      otHours: Math.round((out.reduce((n, d) => n + d.otMinutes, 0) / 60) * 10) / 10,
      lateMarks: out.filter((d) => d.code === 'L').length,
    };
    summary.workedDays = summary.present + summary.late + summary.half + summary.training;

    rows.push({
      staffCode: staff.code,
      name: staff.name,
      designation: staff.designation,
      departmentId: staff.departmentId,
      wardId: staff.wardId,
      employment: staff.employment,
      days: out,
      summary,
    });
  }

  const all = rows.flatMap((r) => r.days);
  return {
    month: monthIso,
    days,
    rows,
    spans,
    stats: {
      staff: rows.length,
      presentDays: all.filter((d) => WORKED_CODES.includes(d.code)).length,
      paidDays: all.filter((d) => PAID_CODES.includes(d.code)).length,
      absentDays: all.filter((d) => d.code === 'A').length,
      leaveDays: all.filter((d) => d.code === 'LV').length,
      unpaidDays: all.filter((d) => d.code === 'LWP').length,
      lateMarks: all.filter((d) => d.code === 'L').length,
      halfDays: all.filter((d) => d.code === 'HD').length,
      otHours: Math.round((all.reduce((n, d) => n + d.otMinutes, 0) / 60) * 10) / 10,
      holidaysWorked: all.filter((d) => d.code === 'T').length,
      exceptions: exceptions.length,
    },
    exceptions,
  };
}

/** Overtime only for the shifts that carry it: two to four hours a fortnight, never a habit. */
function otForDay(r: number): number {
  if (r > 0.88) return 120;
  if (r > 0.78) return 60;
  return 0;
}

/** What the payroll needs from the register, per person: one walk of the same month. */
export function payrollAttendance(month: RegisterMonth): Record<string, PayrollAttendance> {
  const daysInMonth = month.days.length;
  const out: Record<string, PayrollAttendance> = {};
  for (const row of month.rows) {
    out[row.staffCode] = {
      staffCode: row.staffCode,
      workedDays: row.summary.workedDays,
      absentDays: row.summary.absent,
      halfDays: row.summary.half,
      paidLeaveDays: row.summary.leave,
      unpaidLeaveDays: row.summary.unpaid,
      lateMarks: row.summary.lateMarks,
      overtimeHours: row.summary.otHours,
      holidays: row.summary.training,
      daysInMonth,
    };
  }
  return out;
}

/** What is wrong with a month, in the order a shift manager would deal with it. */
export function registerDigest(month: RegisterMonth): Array<{ label: string; count: number; tone: 'critical' | 'warning' | 'info'; because: string }> {
  const withNoPunch = month.exceptions.filter((e) => e.kind === 'no-punch').length;
  const late = month.exceptions.filter((e) => e.kind === 'late').length;
  const unpaid = month.rows.filter((r) => r.summary.unpaid > 0);
  return [
    { label: 'Days with no punch and no leave', count: withNoPunch, tone: 'critical', because: 'Each one is an absence the payroll will take, so each one is a conversation in the first week of the month rather than a deduction at the end of it.' },
    { label: 'Late arrivals', count: late, tone: 'warning', because: `Every ${LATE_MARKS_PER_HALF_DAY} late marks are half a day. The register counts them from the reader, so the figure is the same one the payroll uses.` },
    { label: 'Short stints (under four hours)', count: month.stats.halfDays, tone: 'warning', because: 'A half day is half a day’s pay. Recorded with the reason, because a ward that went quiet is not the same as a person who left early.' },
    { label: 'Leave without pay', count: unpaid.length, tone: 'info', because: 'Approved unpaid leave comes out of the gross rather than out of the entitlement, and it needs a name against the approval.' },
    { label: 'Public holidays worked', count: month.stats.holidaysWorked, tone: 'info', because: 'Ward staff work gazetted holidays. The register records them so a compensatory off is given deliberately instead of being forgotten.' },
  ];
}

/** The branches whose attendance this node holds. The payroll screen and the register both read it. */
export const attendanceBranches = (): StaffBranch[] => branches.filter((b) => HR_NODES.includes(b));
