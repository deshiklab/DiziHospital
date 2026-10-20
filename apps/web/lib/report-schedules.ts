/* ---------------------------------------------------------------------------------------------------------------
 * Scheduled report exports (the P6 leftovers, third item) — the register's own sentence, made operable.
 *
 * Every report in `report-suite.ts` already carries a `schedule` sentence: “Sent to the finance manager and the
 * accountant every evening at 21:00.” That sentence is a specification, and until now the screen printed it and
 * said a server would have to run it. This module is the part that does not need a server:
 *
 *  1. **A cadence is arithmetic, not prose.** Daily, weekly or monthly, with the times the register names, so
 *     “every Monday and Thursday at 08:00” becomes four checkable dates a reader can look at. A branch that
 *     discovers its monthly report lands on a Friday has discovered it from the schedule rather than from an
 *     empty inbox.
 *  2. **The working day comes from the branch's own calendar.** “The first working day of the month” is computed
 *     against `HOLIDAYS_2026` and the Friday–Saturday weekend — and where the calendar holds a *provisional*
 *     holiday, the schedule says the date can still move, because the sighting committee has not announced it.
 *  3. **The file is built here; only the sending needs the server.** `exportReport` runs the report's own
 *     generator at the schedule's scope and period and writes a spreadsheet-ready CSV — numbers as numbers, the
 *     definitions and the control total in the preamble. So a schedule can be checked before it is trusted, and
 *     the sheet gets out today by somebody pressing Download.
 *  4. **What the server still has to do is named, not implied.** `runReportSchedule` is in the contract as an
 *     online-only operation: a run renders the file, sends it, and records the delivery receipt. This node cannot
 *     send mail, so nothing here goes out on its own and no screen pretends it did.
 *
 * The refusals are the ones a branch would otherwise find out about after the file had gone: a schedule with
 * nobody to send to, a WhatsApp recipient for a spreadsheet, a monthly run on the thirty-first, a period wider
 * than the report's data, and a report that nobody is sent at all because it is a live board.
 */

import { HOLIDAYS_2026, type HolidayRow } from './calendar';
import {
  CONSOLIDATED,
  buildReport,
  rangeOf,
  reportByTopic,
  type RangeId,
  type ReportTable,
  type Scope,
} from './report-suite';

/* ------------------------------------------------------------------------------------------------ channels */

export type ChannelId = 'print-desk' | 'hospital-mail' | 'public-mail' | 'whatsapp';

export interface Channel {
  id: ChannelId;
  label: string;
  /** Whether the channel carries a file or only a message, and whether it leaves the hospital. */
  carries: 'file-in-the-building' | 'file-leaves' | 'message-only';
  note: string;
}

export const CHANNELS: Channel[] = [
  {
    id: 'print-desk',
    label: 'Printed at a counter',
    carries: 'file-in-the-building',
    note: 'A person at a named counter picks the sheet up and signs for it. Nothing leaves the building, which is why the cash sheet is delivered this way.',
  },
  {
    id: 'hospital-mail',
    label: 'The hospital’s own mail server',
    carries: 'file-in-the-building',
    note: 'Inside the LAN, on the branch’s own server, with the delivery in its log. The usual channel for a management report.',
  },
  {
    id: 'public-mail',
    label: 'A mailbox outside the hospital',
    carries: 'file-leaves',
    note: 'A Gmail or Yahoo mailbox. A file that leaves the building cannot be recalled, so the schedule warns when the file names people.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    carries: 'message-only',
    note: 'A message, not a filing cabinet: a link or a sentence, never the spreadsheet. It is refused as a place to send a report file.',
  },
];

export const channelById = (id: ChannelId): Channel => CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];

/* -------------------------------------------------------------------------------------------------- cadence */

export type CadenceId = 'daily' | 'weekly' | 'monthly';

export interface Cadence {
  id: CadenceId;
  /** `HH:MM` on the branch's own clock, in the order they happen. A sheet sent twice a day names both times. */
  times: string[];
  /** Weekly only: 0–6, Sunday first — the week here starts on Sunday. */
  weekdays?: number[];
  /** Monthly only: the day of the month, 1–28. Beyond that a month is skipped, which is a refusal, not a detail. */
  day?: number;
  /** Monthly only: the first day that is neither a weekend nor a gazetted holiday, instead of a fixed date. */
  firstWorkingDay?: boolean;
  /** Why that time — “after the counters close” is what makes 22:00 mean something to the person setting it. */
  because: string;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Friday and Saturday: the branch's weekend, and the reason a report is not scheduled on a Friday morning. */
const WEEKEND = [5, 6];

const at = (day: string, time: string) => `${day} ${time}`;
const addDaysIso = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const isWeekendDay = (day: string): boolean => WEEKEND.includes(weekdayOf(day));

/** Every holiday row that lands on the day, including one observed on a different date than the gazette. */
export const holidaysOn = (day: string, rows: HolidayRow[] = HOLIDAYS_2026): HolidayRow[] =>
  rows.filter((h) => h.date === day || h.observed === day);

/**
 * A day the administration works.
 *
 * A hospital never closes, so this is narrower than “the branch is shut”: only a *gazetted* day closes the
 * administrative floor the monthly reports are read on. A festival with a skeleton roster is a working day for a
 * report — the figures exist and the reader wants them — and a restricted holiday is a leave decision, not a
 * closure. Saying which of the three a date is, rather than hiding the judgement, is what makes the schedule
 * checkable.
 */
export const isWorkingDay = (day: string, rows: HolidayRow[] = HOLIDAYS_2026): boolean =>
  !isWeekendDay(day) && !holidaysOn(day, rows).some((h) => h.kind === 'Gazetted');

/** The branch's holiday calendar holds one year; a run beyond it is computed from the week alone, and says so. */
export const CALENDAR_YEARS = ['2026'];
export const calendarCovers = (day: string): boolean => CALENDAR_YEARS.includes(day.slice(0, 4));

const firstWorkingDayOf = (monthIso: string, rows: HolidayRow[]): string => {
  for (let i = 1; i <= 31; i += 1) {
    const day = `${monthIso}-${String(i).padStart(2, '0')}`;
    if (day.slice(0, 7) !== monthIso) break;
    if (isWorkingDay(day, rows)) return day;
  }
  return `${monthIso}-01`;
};

const monthOf = (day: string): string => day.slice(0, 7);

/**
 * The next runs, as `YYYY-MM-DD HH:MM` stamps, in order and strictly after `from`.
 *
 * `from` is a day, not a moment: the schedule is checked against the branch's calendar, and a screen that asked
 * “what time is it” to draw a schedule would be a screen that renders one thing on the server and another in the
 * browser. The day's own runs are included, so “the next four” reads from this morning.
 */
export function nextRuns(cadence: Cadence, from: string, count: number, rows: HolidayRow[] = HOLIDAYS_2026): string[] {
  const times = [...cadence.times].sort((a, b) => minutesOf(a) - minutesOf(b));
  const runs: string[] = [];

  if (cadence.id === 'daily') {
    for (let d = 0; runs.length < count && d < count + 3; d += 1) {
      const day = addDaysIso(from, d);
      for (const time of times) {
        if (runs.length >= count) break;
        /* The day's runs are included when the day is `from` itself: the caller asked what this schedule does
           from here, and “today at 22:00” is part of the answer. */
        runs.push(at(day, time));
      }
    }
    return runs;
  }

  if (cadence.id === 'weekly') {
    const weekdays = [...(cadence.weekdays ?? [0])].sort((a, b) => a - b);
    for (let d = 0; runs.length < count && d < 8 * count; d += 1) {
      const day = addDaysIso(from, d);
      if (!weekdays.includes(weekdayOf(day))) continue;
      for (const time of times) {
        if (runs.length >= count) break;
        runs.push(at(day, time));
      }
    }
    return runs;
  }

  /* Monthly. The first working day is recomputed month by month, because a gazetted holiday moves it. */
  for (let m = 0; runs.length < count && m < count + 2; m += 1) {
    const base = monthOf(from);
    const monthIso = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1 + m, 1)).toISOString().slice(0, 7);
    const day = cadence.firstWorkingDay ? firstWorkingDayOf(monthIso, rows) : `${monthIso}-${String(Math.min(cadence.day ?? 1, 28)).padStart(2, '0')}`;
    if (day < from) continue;
    for (const time of times) {
      if (runs.length >= count) break;
      runs.push(at(day, time));
    }
  }
  return runs;
}

/** The cadence as the person setting it reads it back. */
export function describeCadence(cadence: Cadence): string {
  const times = [...cadence.times].sort((a, b) => minutesOf(a) - minutesOf(b)).join(' and ');
  if (cadence.id === 'daily') return `Every day at ${times}`;
  if (cadence.id === 'weekly') {
    const names = (cadence.weekdays ?? [0]).map((d) => WEEKDAY_NAMES[d] ?? 'Sunday');
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Every ${list} at ${times}`;
  }
  return cadence.firstWorkingDay
    ? `The first working day of every month at ${times}`
    : `The ${ordinal(cadence.day ?? 1)} of every month at ${times}`;
}

const ordinal = (n: number): string => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
};

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A run as a person reads it back: “Monday 19 October 2026 at 08:00”, because the day of the week is the point. */
export function describeRun(stamp: string): string {
  const day = stamp.slice(0, 10);
  const time = stamp.slice(11);
  const month = MONTH_NAMES[Number(day.slice(5, 7)) - 1] ?? '';
  return `${WEEKDAY_NAMES[weekdayOf(day)]} ${Number(day.slice(8, 10))} ${month} ${day.slice(0, 4)} at ${time}`;
}

/* ------------------------------------------------------------------------------------------------- schedule */

export type SendFormat = 'csv' | 'print';
/** What the receiver is expected to do with it. A report nobody acts on is a report nobody reads. */
export type SendWhen = 'always' | 'when-there-is-a-row';

export interface Recipient {
  name: string;
  role: string;
  channel: ChannelId;
  /** An address where the channel needs one; a printed sheet is addressed to a counter, so it may be empty. */
  address: string;
}

export interface ReportSchedule {
  id: string;
  /** A report's own topic, so a schedule cannot name a report that does not exist. */
  topic: string;
  scope: Scope;
  range: RangeId;
  cadence: Cadence;
  format: SendFormat;
  recipients: Recipient[];
  /** The sentence printed beside the schedule: what the receiver does on the morning it arrives. */
  action: string;
  sendWhen: SendWhen;
  owner: string;
  /** A paused schedule keeps its settings, its place in the register and its history. */
  enabled: boolean;
  /** This node's own copy: who last saved it, and when. Absent on a schedule nobody has touched. */
  savedAt?: string;
  savedBy?: string;
}

/**
 * Reports nobody is sent, in the register's own words.
 *
 * The live consultation board is refreshed every minute and read where the work happens. A schedule for it would
 * produce a file that is a historical document by the time it arrived, and the register says so — so the screen
 * refuses to schedule it rather than producing the file nobody asked for.
 */
export const NOT_SENDABLE: Record<string, string> = {
  live_consultation:
    'Read live on the OPD board and refreshed every minute; nobody is sent it, because a picture e-mailed at 09:00 is a historical document by 09:02.',
};

/** The hour the counters close. A money report built before it carries a total that will still change. */
export const COUNTERS_CLOSE = '22:00';

const internal = (name: string, role: string): Recipient => ({ name, role, channel: 'hospital-mail', address: `${name.split(' ')[0].toLowerCase()}@dizihospital.example` });
const printed = (name: string, role: string, counter: string): Recipient => ({ name, role, channel: 'print-desk', address: counter });

/**
 * The register's own cadences, made operable.
 *
 * One schedule per report the register says is sent, reading the times out of the register's sentence rather than
 * inventing them — a branch that has read “every morning at 07:30” for two years should not find the software has
 * decided on 08:00. Where the sentence names two times in a day, both are here.
 */
export const SCHEDULES: ReportSchedule[] = [
  { id: 'sch-finance', topic: 'finance', scope: CONSOLIDATED, range: 'today', cadence: { id: 'daily', times: ['21:00'], because: 'The register says the day-book goes out in the evening, once the counters have finished for the day.' }, format: 'csv', recipients: [internal('N. Rahman', 'Finance manager'), printed('A. Karim', 'Accountant', 'Billing counter, Main Campus')], action: 'The accountant checks the day-book against the drawer count and signs it; the medical superintendent sees the control total the same evening.', sendWhen: 'always', owner: 'Finance manager', enabled: true },
  { id: 'sch-tpa', topic: 'tpa', scope: CONSOLIDATED, range: 'week', cadence: { id: 'weekly', weekdays: [1, 4], times: ['08:00'], because: 'The register names Monday and Thursday: the desk works claims twice a week, and the second run catches what arrived on Wednesday.' }, format: 'csv', recipients: [internal('S. Islam', 'TPA desk')], action: 'Anything past its settlement period is worked first, before the day’s new claims are opened.', sendWhen: 'when-there-is-a-row', owner: 'TPA desk', enabled: true },
  { id: 'sch-patient', topic: 'patient', scope: CONSOLIDATED, range: 'month', cadence: { id: 'monthly', day: 1, times: ['08:00'], because: 'The first of the month, before the monthly meeting: the register says the medical superintendent and the marketing office read it together.' }, format: 'csv', recipients: [internal('F. Akter', 'Medical superintendent'), internal('R. Chowdhury', 'Marketing office')], action: 'Case mix by band and the insured share, with the allergy register read as a safety figure rather than a marketing one.', sendWhen: 'always', owner: 'Medical superintendent', enabled: true },
  { id: 'sch-appointment', topic: 'appointment', scope: CONSOLIDATED, range: 'week', cadence: { id: 'daily', times: ['07:00'], because: 'Before the clinics open, so a consultant reads the week’s no-show pattern rather than yesterday’s list alone.' }, format: 'csv', recipients: [internal('OPD manager', 'OPD manager')], action: 'Each consultant gets their own row; a no-show rate that has doubled is a phone call rather than a note in a file.', sendWhen: 'when-there-is-a-row', owner: 'OPD manager', enabled: true },
  { id: 'sch-opd', topic: 'opd', scope: CONSOLIDATED, range: 'week', cadence: { id: 'daily', times: ['07:30'], because: 'The register’s own half past seven: the department heads read it before the morning round.' }, format: 'csv', recipients: [internal('F. Akter', 'Medical superintendent')], action: 'The unsigned notes are worked first, by name of department, before the day’s clinics fill the queue again.', sendWhen: 'when-there-is-a-row', owner: 'Medical superintendent', enabled: true },
  { id: 'sch-ipd', topic: 'ipd', scope: CONSOLIDATED, range: 'week', cadence: { id: 'daily', times: ['07:00', '19:00'], because: 'Twice a day, at the change of shift: the nursing superintendent reads the ward before the hand-over, not after.' }, format: 'csv', recipients: [internal('M. Sultana', 'Nursing superintendent')], action: 'A blocked bed is chased the same morning; the evening sheet is read at the hand-over.', sendWhen: 'always', owner: 'Nursing superintendent', enabled: true },
  { id: 'sch-pathology', topic: 'pathology', scope: CONSOLIDATED, range: 'week', cadence: { id: 'daily', times: ['07:30'], because: 'The pathologist reads the critical-value callbacks before the laboratory’s own morning meeting.' }, format: 'csv', recipients: [internal('D. Barua', 'Consultant pathologist')], action: 'Every critical value without a recorded call-back is a same-morning conversation with the clinician who ordered it.', sendWhen: 'when-there-is-a-row', owner: 'Consultant pathologist', enabled: true },
  { id: 'sch-radiology', topic: 'radiology', scope: CONSOLIDATED, range: 'week', cadence: { id: 'daily', times: ['07:30', '16:00'], because: 'Twice a day: the morning reads yesterday’s backlog, the late-afternoon sheet reads what is still awaiting a report before the second shift ends.' }, format: 'csv', recipients: [internal('K. Haque', 'Consultant radiologist')], action: 'The awaiting column is worked down in order of how long each study has waited.', sendWhen: 'when-there-is-a-row', owner: 'Consultant radiologist', enabled: true },
  { id: 'sch-ot', topic: 'ot', scope: CONSOLIDATED, range: 'today', cadence: { id: 'daily', times: ['20:00'], because: 'After the lists finish and before tomorrow’s is printed, so a cancelled case can be re-listed the same evening.' }, format: 'csv', recipients: [internal('T. Ahmed', 'Theatre manager')], action: 'A bumped or cancelled case is re-listed into the list attached to the sheet, with the reason it moved.', sendWhen: 'always', owner: 'Theatre manager', enabled: true },
  { id: 'sch-pharmacy', topic: 'pharmacy', scope: CONSOLIDATED, range: 'month', cadence: { id: 'daily', times: ['08:00'], because: 'The chief pharmacist reads the month’s margin before the day’s dispensary work starts.' }, format: 'csv', recipients: [internal('S. Nahar', 'Chief pharmacist')], action: 'The margin column is read against the cost of the medicines that moved most, and the controlled register is checked for witnesses.', sendWhen: 'when-there-is-a-row', owner: 'Chief pharmacist', enabled: true },
  { id: 'sch-inventory', topic: 'inventory', scope: 'Main Campus', range: 'today', cadence: { id: 'weekly', weekdays: [1], times: ['08:00'], because: 'Monday morning, when the store plans its fortnight and the short-dated batches are moved to the front of the shelf.' }, format: 'csv', recipients: [internal('J. Alam', 'Store keeper')], action: 'Expiring batches are either worked into the coming fortnight or sent back to the supplier while the credit note is still possible.', sendWhen: 'always', owner: 'Store keeper', enabled: true },
  { id: 'sch-blood_bank', topic: 'blood_bank', scope: 'Main Campus', range: 'today', cadence: { id: 'daily', times: ['07:00', '18:00'], because: 'The register names 07:00 and 18:00: the count is taken and read at the change of shift, when a shortage can still be filled by a donor call.' }, format: 'csv', recipients: [printed('Blood bank in-charge', 'Blood bank in-charge', 'Blood bank counter, Main Campus')], action: 'A group below its floor starts donor calls before the elective lists, not after the first transfusion is delayed.', sendWhen: 'always', owner: 'Blood bank in-charge', enabled: true },
  { id: 'sch-ambulance', topic: 'ambulance', scope: CONSOLIDATED, range: 'today', cadence: { id: 'daily', times: ['08:00'], because: 'The transport officer reads the previous day’s responses before the fleet is allocated for the day.' }, format: 'csv', recipients: [internal('H. Molla', 'Transport officer')], action: 'A response past its target is the day’s first conversation; the oxygen and fuel columns are read against the vehicle log.', sendWhen: 'always', owner: 'Transport officer', enabled: true },
  { id: 'sch-human_resource', topic: 'human_resource', scope: CONSOLIDATED, range: 'week', cadence: { id: 'weekly', weekdays: [1], times: ['07:00'], because: 'Monday, before the week’s roster is published: a gap that is known on Monday is filled by Thursday.' }, format: 'csv', recipients: [internal('M. Sultana', 'Nursing superintendent')], action: 'The rest violations come first in the sheet, because they are the ones that become sick leave.', sendWhen: 'when-there-is-a-row', owner: 'Nursing superintendent', enabled: true },
  { id: 'sch-log', topic: 'log', scope: CONSOLIDATED, range: 'month', cadence: { id: 'monthly', times: ['09:00'], firstWorkingDay: true, because: 'The audit committee reads the trail itself, on the first working day of the month — a gazetted holiday moves the reading, not the extract.' }, format: 'csv', recipients: [internal('Audit committee', 'Internal audit')], action: 'The committee works down the queued and refused entries; the extract is the trail itself, not a summary of it.', sendWhen: 'always', owner: 'Medical superintendent', enabled: true },
  { id: 'sch-birth_death', topic: 'birth_death', scope: CONSOLIDATED, range: 'today', cadence: { id: 'daily', times: ['07:00'], because: 'The medical records officer reads the register each morning, and the mortality review meets on it every Monday.' }, format: 'csv', recipients: [internal('R. Begum', 'Medical records officer')], action: 'A death within twenty-four hours of admission and any medico-legal case are reviewed the same week, by name of ward.', sendWhen: 'always', owner: 'Medical records officer', enabled: true },
];

export const scheduleById = (id: string): ReportSchedule | undefined => SCHEDULES.find((s) => s.id === id);

/** The cadence and the reason for its hour, which is what a reader needs to agree or disagree with it. */
export const describeSchedule = (s: ReportSchedule): string => `${describeCadence(s.cadence)} — ${s.cadence.because}`;

export const describeRecipients = (s: ReportSchedule): string =>
  s.recipients.length === 0 ? 'Nobody' : s.recipients.map((r) => `${r.name} (${channelById(r.channel).label})`).join(', ');

/* ------------------------------------------------------------------------------------------------- refusals */

export interface ScheduleProblem {
  code: 'dizi.schedule-refused' | 'dizi.channel-cannot-carry-a-file';
  title: string;
  message: string;
  /** The part of the schedule to fix, so the screen can point at it rather than at the schedule as a whole. */
  field?: 'topic' | 'scope' | 'range' | 'cadence' | 'recipients' | 'format';
  severity: 'reason' | 'warning';
}

export interface ScheduleCheck {
  ok: boolean;
  reasons: ScheduleProblem[];
  warnings: ScheduleProblem[];
  /** The runs the schedule would make from `today`, computed against the branch's own calendar. */
  next: string[];
}

/** Column keys that mean the file names a person — what turns a channel choice into a decision. */
const PERSON_KEYS = ['doctor', 'consultant', 'patient', 'name', 'staff', 'mrn', 'nurse'];

export const namesPeople = (table: ReportTable): string[] =>
  table.columns.filter((c) => PERSON_KEYS.includes(c.key)).map((c) => c.header);

export interface CheckOptions {
  /** The other schedules, so two of them sending the same report at the same minute is caught. */
  others?: ReportSchedule[];
  /** The branch's calendar, so a first-working-day run can be checked and a provisional holiday flagged. */
  holidays?: HolidayRow[];
}

/**
 * Whether this schedule could go out as it stands, and what a person has to change if it could not.
 *
 * The refusals are written as the thing that would have happened: a file sent before the drawers were counted, a
 * spreadsheet dropped into a messaging app, a monthly run that skips February, a period wider than the data. The
 * warnings are the ones a branch may legitimately accept — a schedule at 21:00 when the counters close at 22:00
 * is the register disagreeing with itself, and it is the branch's call which one it means.
 */
export function checkSchedule(schedule: ReportSchedule, today: string, options: CheckOptions = {}): ScheduleCheck {
  const others = options.others ?? SCHEDULES;
  const holidays = options.holidays ?? HOLIDAYS_2026;
  const reasons: ScheduleProblem[] = [];
  const warnings: ScheduleProblem[] = [];
  const def = reportByTopic(schedule.topic);
  const range = rangeOf(schedule.range);
  const next = nextRuns(schedule.cadence, today, 4, holidays);

  const refuse = (p: Omit<ScheduleProblem, 'code' | 'severity'> & { code?: ScheduleProblem['code'] }) =>
    reasons.push({ code: p.code ?? 'dizi.schedule-refused', severity: 'reason', title: p.title, message: p.message, ...(p.field ? { field: p.field } : {}) });
  const warn = (p: Omit<ScheduleProblem, 'code' | 'severity'> & { code?: ScheduleProblem['code'] }) =>
    warnings.push({ code: p.code ?? 'dizi.schedule-refused', severity: 'warning', title: p.title, message: p.message, ...(p.field ? { field: p.field } : {}) });

  if (!def) {
    refuse({ title: 'That report does not exist', message: `No report is registered under \`${schedule.topic}\`, so there is nothing to build. A schedule names a report the register holds.`, field: 'topic' });
  }

  const live = NOT_SENDABLE[schedule.topic];
  if (live) {
    refuse({ title: 'This report is read live, not sent', message: `${live} Keep it on the board; a schedule here would produce a file that is already stale.`, field: 'topic' });
  }

  if (schedule.recipients.length === 0) {
    refuse({ title: 'Nobody to send it to', message: 'A schedule with no recipient is a job that runs every morning and is read by nobody. Name the person who acts on it, not the office it belongs to.', field: 'recipients' });
  }

  for (const r of schedule.recipients) {
    const channel = channelById(r.channel);
    if (channel.carries === 'message-only') {
      refuse({
        code: 'dizi.channel-cannot-carry-a-file',
        title: 'A message is not a file',
        message: `A ${channel.label} message cannot carry the spreadsheet, and a link to a file that lives on the hospital network does not open outside it. Send it to ${r.name} on the hospital’s own mail, or print it at a counter.`,
        field: 'recipients',
      });
    }
    if (channel.carries !== 'file-in-the-building' && r.address.trim().length === 0) {
      refuse({ title: 'That channel needs an address', message: `${channel.label} needs somewhere to send to, and \`${r.name}\` has none. Leave the address empty only for a counter that picks the sheet up.`, field: 'recipients' });
    }
  }

  if (range.days > (def?.maxDays ?? 0)) {
    refuse({
      title: 'The period is wider than the data',
      message: `${def?.title ?? 'This report'} reads ${def?.maxDays ?? 0} day(s) of data and the schedule asks for ${range.days}. The heading would say ${range.label.toLowerCase()} and the rows underneath would be a shorter period — the one number a reader would get wrong. Move to a narrower period or schedule it more often.`,
      field: 'range',
    });
  }

  if (schedule.cadence.id === 'monthly' && !schedule.cadence.firstWorkingDay && (schedule.cadence.day ?? 0) > 28) {
    refuse({ title: 'That day skips a month', message: `A monthly run on the ${ordinal(schedule.cadence.day ?? 0)} has no date in February, and a report that quietly does not arrive in the shortest month is one nobody notices is missing. Use day 28 or earlier, or “the first working day”.`, field: 'cadence' });
  }

  if (schedule.cadence.times.length === 0) {
    refuse({ title: 'No time of day', message: 'A schedule with no time never runs. Name the hour the report should be read.', field: 'cadence' });
  }

  /* The 21:00 cash sheet against a 22:00 close. This is the register disagreeing with itself, and the branch —
     not the software — decides which sentence it meant, so it is stated rather than enforced. */
  const money = def?.group === 'Money' && schedule.range === 'today';
  const earliest = [...schedule.cadence.times].sort((a, b) => minutesOf(a) - minutesOf(b))[0] ?? '00:00';
  if (money && minutesOf(earliest) < minutesOf(COUNTERS_CLOSE)) {
    warn({
      title: 'That is before the counters close',
      message: `${def?.title ?? 'This report'} carries a day-book total that is still changing at ${earliest}: the counters close at ${COUNTERS_CLOSE}, and the drawer count is what the total is checked against. The register asks for ${earliest}, so the schedule keeps it — settle which sentence the branch means before the first month-end.`,
      field: 'cadence',
    });
  }

  const clash = others.find(
    (o) =>
      o.id !== schedule.id &&
      o.enabled &&
      o.topic === schedule.topic &&
      o.scope === schedule.scope &&
      o.cadence.id === schedule.cadence.id &&
      o.cadence.times.some((t) => schedule.cadence.times.includes(t)) &&
      (o.cadence.id !== 'weekly' || (o.cadence.weekdays ?? []).join(',') === (schedule.cadence.weekdays ?? []).join(',')),
  );
  if (clash) {
    warn({ title: 'Another schedule sends this too', message: `${clash.id} already sends ${def?.title ?? schedule.topic} for ${clash.scope} at ${clash.cadence.times.join(' and ')}. Two copies of the same file is how a reader stops opening either.`, field: 'cadence' });
  }

  if (schedule.format === 'print') {
    warn({ title: 'Printing is done on the server too', message: 'A printed run needs a printer the server can reach with paper in it. The download builds the same file here as CSV until the API exists.', field: 'format' });
  }

  if (def) {
    const table = buildReport(schedule.topic, { day: today, range: schedule.range, scope: schedule.scope });
    const open = schedule.recipients.filter((r) => channelById(r.channel).carries === 'file-leaves');
    const named = namesPeople(table);
    if (open.length > 0 && named.length > 0) {
      warn({ title: 'This file names people and leaves the building', message: `The sheet carries ${named.join(' and ')} and goes to ${open.map((r) => `${r.name} (${channelById(r.channel).label})`).join(', ')}. A file that has left cannot be recalled; send it on the hospital’s own mail unless the mailbox is one the hospital controls.`, field: 'recipients' });
    }
  }

  /* A run beyond the calendar, or one planned against a holiday nobody has announced yet. */
  const uncovered = next.find((stamp) => !calendarCovers(stamp.slice(0, 10)));
  if (uncovered) {
    warn({
      title: 'The holiday calendar stops before this run',
      message: `The branch\u2019s calendar holds ${CALENDAR_YEARS.join(', ')}, so the working day for ${uncovered.slice(0, 10)} is computed from the week alone — a gazetted holiday in a month it does not hold would be missed and the report would run as if the day were ordinary. Load the next year before the first run it covers.`,
      field: 'cadence',
    });
  }
  const first = next[0];
  if (first && schedule.cadence.firstWorkingDay) {
    const provisional = holidaysOn(first.slice(0, 10), holidays).filter((h) => h.provisional);
    if (provisional.length > 0) {
      warn({ title: 'That date is not announced yet', message: `${first.slice(0, 10)} is ${provisional[0].name}, and the branch has it as provisional until the sighting committee announces it. The run is planned against the provisional date and moves with it.`, field: 'cadence' });
    }
  }

  return { ok: reasons.length === 0, reasons, warnings, next };
}

/**
 * Whether today's sheet would be sent, and why not, if it would not.
 *
 * `when-there-is-a-row` is the difference between a management report and a daily one: a sheet that is zero on a
 * quiet day trains people to stop opening it. The skip is a decision the receiver should be able to see, so it is
 * returned as a sentence rather than as a silent no-op.
 */
export function wouldSend(schedule: ReportSchedule, table: ReportTable): { send: boolean; because: string } {
  if (!schedule.enabled) return { send: false, because: 'The schedule is paused. Nothing is built and nothing is sent until somebody turns it back on.' };
  if (schedule.sendWhen === 'always') return { send: true, because: 'This one goes out whatever the figures say: a day with no collections is itself the fact the accountant signs.' };
  if (table.rows.length === 0) return { send: false, because: 'Nothing to report today, so the sheet is skipped rather than sent empty — a report that arrives saying “none” every quiet day stops being opened.' };
  return { send: true, because: `Something to report: ${table.rows.length} row(s) over ${table.daysRead.length} day(s) read.` };
}

/* ----------------------------------------------------------------------------------------------- the export */

export interface ReportExport {
  /** The file name as it lands in the downloads folder. */
  name: string;
  mime: string;
  text: string;
  rows: number;
  /** UTF-8 bytes, which is what the mail relay will count. */
  bytes: number;
  /** The sentences at the top of the file: what was read, for whom, and what the total has to agree with. */
  preamble: string[];
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * One cell, resolved the way the screen resolves it.
 *
 * A consolidated table carries a column per branch whose figure lives on the row (`from`), not in the row's own
 * cells — the value is per-branch by construction, so it cannot be read out of a total. Asked for a branch column
 * and handed an empty cell, an export would write a blank where the branch's share is, which is precisely the
 * column an accountant checks first.
 */
const valueAt = (row: ReportTable['rows'][number], key: string): number | string => {
  if (key.startsWith('branch:')) return row.from?.[key.slice('branch:'.length) as keyof typeof row.from] ?? '';
  return row.cells[key] ?? '';
};

const branchTotal = (rows: ReportTable['rows'], key: string): number =>
  rows.reduce((n, row) => n + (key.startsWith('branch:') ? ((row.from?.[key.slice('branch:'.length) as keyof typeof row.from] as number) ?? 0) : 0), 0);

const csvCell = (value: number | string): string => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * A spreadsheet-ready CSV for one schedule.
 *
 * The figures are written as numbers with the unit in the column heading rather than as formatted text: a file that
 * arrives with `৳1,200` in a cell is a file nobody can add up, which is the first thing a finance manager does with
 * it. The definitions, the period actually read and the control total go in the preamble, so a table that is
 * forwarded to somebody else still says what it is.
 */
export function exportReport(schedule: ReportSchedule, day: string): ReportExport {
  const def = reportByTopic(schedule.topic);
  if (!def) throw new Error(`no report named ${schedule.topic}`);
  const table = buildReport(schedule.topic, { day, range: schedule.range, scope: schedule.scope });
  const headings = table.columns.map((c) => (c.kind === 'money' ? `${c.header} (BDT)` : c.kind === 'percent' ? `${c.header} (%)` : c.header));

  /* The preamble is what makes a forwarded file readable a month later: the period actually read, the sentence the
     control total has to agree with, and the fact that this is a preview build from synthetic records. */
  const preamble = [
    ['Report', def.title],
    ['Question it answers', def.question],
    ['Scope', schedule.scope],
    ['Period', table.rangeNote],
    ['Built', `${day}, at this desk — ${describeCadence(schedule.cadence)}${schedule.format === 'print' ? ', printed when the server can reach a printer' : ''}`],
    ['Control total', table.closing],
    ['How it adds up', table.reconciliation],
    ['Owner', def.owner],
    ['Delivery', `Sent to ${schedule.recipients.map((r) => `${r.name} (${channelById(r.channel).label})`).join(', ') || 'nobody'}`],
    ['Source', 'DiziHospital preview build — synthetic records, read from the same generators the operational screens use.'],
  ].map(([k, v]) => `${csvCell(k)},${csvCell(v)}`);

  const body = table.rows.map((row) => [row.label, ...table.columns.map((c) => valueAt(row, c.key))].map(csvCell).join(','));
  const total = [
    'Total',
    ...table.columns
      .map((c) => (c.kind === 'text' ? '' : c.key.startsWith('branch:') ? branchTotal(table.rows, c.key) : (table.totals[c.key] ?? 0)))
      .map(csvCell),
  ].join(',');

  const text = [...preamble, '', ['Dimension', ...headings].map(csvCell).join(','), ...body, total].join('\n');

  return {
    name: `${slug(def.title)}-${slug(schedule.scope)}-${day}.csv`,
    mime: 'text/csv;charset=utf-8',
    text,
    rows: table.rows.length,
    bytes: new TextEncoder().encode(text).length,
    preamble,
  };
}

/* ------------------------------------------------------------------------------------------- the node's copy */

/* The same division as the print templates: the schedule a branch has saved is the branch's own, kept on this node
 * so a receiver's list is right with the uplink down, and queued to the cloud through `saveReportSchedule`. */

const NODES_KEY = 'dizi.report.schedules';
const DOWNLOADS_KEY = 'dizi.report.downloads';

export interface DownloadRecord {
  scheduleId: string;
  day: string;
  /** A stamp, from a clock read after mount — never during render. */
  at: string;
  who: string;
  rows: number;
  bytes: number;
  name: string;
  /** Where the file went, in the person's own words: the counter, the shared drive, or the mailbox. */
  wentTo: string;
  /** Set when today's sheet was skipped, so the history says what did not happen as well as what did. */
  skipped?: string;
}

const read = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const loadNodeSchedules = (): ReportSchedule[] => read<ReportSchedule[]>(NODES_KEY, []);

export function saveNodeSchedule(schedule: ReportSchedule): void {
  if (typeof window === 'undefined') return;
  const kept = loadNodeSchedules().filter((s) => s.id !== schedule.id);
  window.localStorage.setItem(NODES_KEY, JSON.stringify([...kept, schedule]));
}

/** The defaults, with this node's own saved version winning where it has one. */
export function schedulesForNode(defaults: ReportSchedule[] = SCHEDULES): ReportSchedule[] {
  const node = loadNodeSchedules();
  return defaults.map((d) => node.find((s) => s.id === d.id) ?? d);
}

export const loadNodeDownloads = (): DownloadRecord[] => read<DownloadRecord[]>(DOWNLOADS_KEY, []);

export function saveNodeDownload(record: DownloadRecord): void {
  if (typeof window === 'undefined') return;
  const kept = loadNodeDownloads().filter((r) => !(r.scheduleId === record.scheduleId && r.at === record.at));
  window.localStorage.setItem(DOWNLOADS_KEY, JSON.stringify([...kept, record].slice(-50)));
}

export const downloadsOf = (scheduleId: string, records: DownloadRecord[]): DownloadRecord[] =>
  records.filter((r) => r.scheduleId === scheduleId).sort((a, b) => b.at.localeCompare(a.at));

/* ----------------------------------------------------------------------------------- what the server owes */

/**
 * The delivery half, stated rather than implied.
 *
 * A run renders the file, sends it, and records the delivery — a receipt per recipient, because “we sent it” and
 * “it arrived” are different claims and only the second one is worth anything when a report is missed. That is
 * `runReportSchedule` in the contract, online-only: a node cannot send mail, and a queued send would tell a
 * manager the morning’s sheet is on its way while it sits in an outbox on a disconnected machine.
 */
export interface ServerDuty {
  title: string;
  endpoint: string;
  because: string;
}

export const SCHEDULING_SERVER_DUTIES: ServerDuty[] = [
  {
    title: 'The runner',
    endpoint: 'POST /reports/schedules/{id}/runs',
    because: 'Renders the file, sends it, and records a receipt per recipient. Until it exists nothing goes out on its own; the Download button builds the same file on this desk and the history below records that somebody took it.',
  },
  {
    title: 'The scheduler',
    endpoint: 'the API service’s own timer',
    because: 'One clock for the whole branch, in the server’s timezone, with a missed run catching up once rather than four times after an outage. A laptop that was asleep is not evidence that the day-end sheet went out.',
  },
  {
    title: 'The mail relay',
    endpoint: 'platform setting `reports.mailRelay`',
    because: 'Which server the reports leave through, and on whose authority. A report sent from a personal mailbox is a patient-data incident waiting to be written up; the relay’s log is what proves where a file went.',
  },
  {
    title: 'Retention',
    endpoint: 'platform setting `reports.retainMonths`',
    because: 'How long a sent file is kept, and who may read it afterwards. A schedule that keeps every month for ever is a second copy of the hospital’s figures in a directory nobody administers.',
  },
];

export const SCHEDULE_RULES: Array<{ title: string; because: string }> = [
  {
    title: 'A schedule is a branch’s own copy, queued to the cloud',
    because: 'The list of who gets the morning sheet is edited at the branch and saved on the node first, so a receiver is added with the uplink down — and the version queued to the cloud carries the same list to the other branches.',
  },
  {
    title: 'The file is built and checked here; only the sending is the server’s',
    because: 'Downloading today’s sheet is how a schedule is proved before it is trusted. It runs the report’s own generator at the schedule’s scope and period, so what arrives next month is the file that was checked, not a similar one.',
  },
  {
    title: 'A skipped run is recorded, not hidden',
    because: 'A daily report that is zero sends an empty sheet unless somebody says otherwise, and an empty sheet every quiet day is how a reader stops opening the report that matters. The rule lives on the schedule and the history says when it was used.',
  },
  {
    title: 'Two runs of the same report at the same minute are a mistake',
    because: 'The second copy is not a second opinion; it is the first one with a different time on it, and a reader who gets both stops trusting the register.',
  },
];
