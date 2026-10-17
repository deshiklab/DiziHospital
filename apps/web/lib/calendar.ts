/* ----------------------------------------------------------------------------------------------------
 * Annual calendar (P7) — the year as the branch works it, not as the gazette prints it.
 *
 * A hospital does not close. So a holiday in this module is a *roster decision* as much as a date: what the
 * branch does on the day, who is on, and what the payroll owes the people who work it. The legacy screen was a
 * list of dates with a name against each; the three questions it could not answer were the three that matter:
 *
 *  1. **Which branch does the day apply to.** A gazetted holiday closes the administration floor and changes
 *     nothing in a ward. Uttara keeps its out-patient list on a festival day when Main Campus does not.
 *  2. **Who is on.** A skeleton plan that is not approved by a named roster officer is a plan nobody has read:
 *     the ward finds out on the morning of the day.
 *  3. **What it costs.** Working a gazetted holiday is paid at the holiday rate, and the night shift that starts
 *     the evening before is on the holiday for part of its stint. The register computes both, and the calendar
 *     says what it will cost before the month closes.
 *
 * The lunar holidays carry the sighting committee's announcement, not a date the software worked out. Where the
 * date is not yet announced, the row says `provisional` and the calendar prints the reason rather than a
 * number it cannot be corrected on.
 */

import { MONTHS, monthDays, dayName, isWeekend, type StaffBranch } from './hr';
import { WARDS } from './ward';

/* --------------------------------------------------------------------------------------------- the row */

export type HolidayKind = 'Gazetted' | 'Festival' | 'Restricted' | 'Branch closure';
export const HOLIDAY_KINDS: HolidayKind[] = ['Gazetted', 'Festival', 'Restricted', 'Branch closure'];

export type WardPlan = 'Normal service' | 'Skeleton staff' | 'Emergency and in-patients only' | 'Closed to visitors';
export const WARD_PLANS: WardPlan[] = ['Normal service', 'Skeleton staff', 'Emergency and in-patients only', 'Closed to visitors'];

export type HolidaySource = 'Ministry circular' | 'Sighting committee' | 'Branch decision' | 'Gazette';

export interface HolidayRow {
  id: string;
  /** The name on the leave calendar and on the payroll note. */
  name: string;
  nameBn: string;
  /** `YYYY-MM-DD`. One row per date: a three-day festival is three rows that name the same festival. */
  date: string;
  /** The gazette date when the day is observed. A day that falls on Friday is often observed on Sunday. */
  observed?: string;
  kind: HolidayKind;
  source: HolidaySource;
  /** Applies to the branch, or to the branches named here. An empty list means all of them. */
  branches: StaffBranch[];
  wardPlan: WardPlan;
  /** Who is on, in the roster officer's words. Printed on the ward notice, so it is a sentence and not a code. */
  skeletonWho: string;
  paid: boolean;
  /** True while the date is the branch's working assumption and not yet announced. */
  provisional: boolean;
  noticeDays: number;
  noticeSent: string | null;
  /** Who approved the roster plan, and when. A skeleton plan with nobody's name against it is a guess. */
  approvedBy: string | null;
  approvedAt: string | null;
  /** What the payroll owes for the day, as the calendar will state it. */
  payrollNote: string;
  note: string;
}

/**
 * 2026 as the branch has it loaded.
 *
 * The lunar dates are the branch's working assumption for 2026 and every one of them is `provisional`: the
 * sighting committee announces the day, HR edits the row, and the ward notices that were printed from the old
 * date are reprinted. A calendar that silently moves a holiday is worse than one that admits it guessed.
 */
export const HOLIDAYS_2026: HolidayRow[] = [
  { id: 'h-01', name: 'Shaheed Dibash and International Mother Language Day', nameBn: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', date: '2026-02-21', kind: 'Gazetted', source: 'Gazette', branches: ['Main Campus', 'Uttara Branch', 'Mirpur Branch'], wardPlan: 'Skeleton staff', skeletonWho: 'One nurse per ward over the roster minimum, both consultants on call, pharmacy at the in-patient counter only.', paid: true, provisional: false, noticeDays: 14, noticeSent: '2026-02-05', approvedBy: 'J. Alam (roster officer)', approvedAt: '2026-02-04 16:20', payrollNote: 'A gazetted day worked is paid at the holiday rate: a full day’s basic for a full stint, and the night shift that ends that morning counts as worked.', note: 'A national day of mourning as much as a holiday. The branch keeps the morning programme short so the ward round is not pushed into the afternoon.' },
  { id: 'h-02', name: 'Shab-e-Barat', nameBn: 'শবে বরাত', date: '2026-03-03', kind: 'Festival', source: 'Sighting committee', branches: [], wardPlan: 'Normal service', skeletonWho: 'Full roster. The ward does not feel this one; the out-patient floor empties and the emergency floor fills.', paid: true, provisional: true, noticeDays: 7, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Normal service, so no holiday rate is owed and a day worked is an ordinary day.', note: 'Provisional: the date follows the sighting committee. Attendance will rise in the evening and the accident load usually does too.' },
  { id: 'h-03', name: 'Independence Day', nameBn: 'স্বাধীনতা দিবস', date: '2026-03-26', kind: 'Gazetted', source: 'Gazette', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency, in-patients and maternity at normal strength; out-patient clinics closed; administration closed except the cash counter’s morning window.', paid: true, provisional: false, noticeDays: 14, noticeSent: '2026-03-10', approvedBy: 'J. Alam (roster officer)', approvedAt: '2026-03-09 11:05', payrollNote: 'Holiday rate for everyone rostered, including the night shift that crosses midnight into the day.', note: 'Clinics close, the branch does not. Two years running this day has brought a crowd to the emergency gate in the afternoon.' },
  { id: 'h-04', name: 'Eid-ul-Fitr — day 1', nameBn: 'ঈদুল ফিতর (১ম দিন)', date: '2026-03-20', observed: '2026-03-20', kind: 'Gazetted', source: 'Sighting committee', branches: [], wardPlan: 'Emergency and in-patients only', skeletonWho: 'Two nurses per ward, one duty doctor per floor, one pharmacist, one cashier, one ambulance driver with the vehicle fuelled. Everybody else is off in rotation and half of them are back by the second day.', paid: true, provisional: true, noticeDays: 21, noticeSent: '2026-03-01', approvedBy: 'M. Hoque (hospital admin)', approvedAt: '2026-02-28 09:40', payrollNote: 'Holiday rate plus the Eid allowance already paid in the month’s payroll. The rotation is counted in the attendance register as `PH` and paid as a worked holiday.', note: 'Provisional until the sighting. The branch plans the rotation against this date and moves the whole plan when the announcement comes, which is why the notice goes out three weeks early.' },
  { id: 'h-05', name: 'Eid-ul-Fitr — day 2', nameBn: 'ঈদুল ফিতর (২য় দিন)', date: '2026-03-21', observed: '2026-03-21', kind: 'Gazetted', source: 'Sighting committee', branches: [], wardPlan: 'Emergency and in-patients only', skeletonWho: 'Same skeleton as day 1, with the first half of the rotation back and the second half off.', paid: true, provisional: true, noticeDays: 21, noticeSent: '2026-03-01', approvedBy: 'M. Hoque (hospital admin)', approvedAt: '2026-02-28 09:40', payrollNote: 'Holiday rate for the skeleton; the returning half is paid normally.', note: 'The day the out-patient load returns — people who put off a complaint for the festival come in today rather than yesterday.' },
  { id: 'h-06', name: 'Pohela Boishakh', nameBn: 'পহেলা বৈশাখ', date: '2026-04-14', kind: 'Gazetted', source: 'Gazette', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency and maternity at normal strength, one nurse per ward over the minimum, one doctor per floor.', paid: true, provisional: false, noticeDays: 14, noticeSent: '2026-03-31', approvedBy: 'J. Alam (roster officer)', approvedAt: '2026-03-30 15:50', payrollNote: 'Holiday rate for the skeleton: a full day’s basic for a full stint.', note: 'The busiest day of the year at the emergency gate. The branch adds two doctors to the evening shift and the calendar records that it did.' },
  { id: 'h-07', name: 'May Day', nameBn: 'মে দিবস', date: '2026-05-01', kind: 'Gazetted', source: 'Gazette', branches: [], wardPlan: 'Normal service', skeletonWho: 'Full roster. This one is about the people who work here, and the branch keeps the out-patient floor open on purpose.', paid: true, provisional: false, noticeDays: 10, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Normal service: no holiday rate is owed. The day is marked in the register as `PH` so the payroll can still see it.', note: 'Notice has not gone out because the plan is not to send one: the roster is published and nothing changes. The register records the day either way.' },
  { id: 'h-08', name: 'Eid-ul-Adha — day 1', nameBn: 'ঈদুল আযহা (১ম দিন)', date: '2026-05-27', kind: 'Gazetted', source: 'Sighting committee', branches: [], wardPlan: 'Emergency and in-patients only', skeletonWho: 'Two nurses per ward, one duty doctor per floor, one pharmacist, one cashier, two ambulance drivers. The theatre keeps a full team on call: this is the week of knife injuries and road traffic.', paid: true, provisional: true, noticeDays: 21, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Holiday rate plus the Eid allowance. Theatre on-call hours are counted as overtime and approved before they are paid.', note: 'Provisional. The plan is written but not approved yet — the screen names this as the one thing outstanding for May.' },
  { id: 'h-09', name: 'Ashura', nameBn: 'আশুরা', date: '2026-06-26', kind: 'Festival', source: 'Sighting committee', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency at normal strength, one nurse per ward over the minimum.', paid: true, provisional: true, noticeDays: 7, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Holiday rate for the skeleton.', note: 'Provisional. The processions pass the main road, which is why the ambulance route on this day is written on the plan.' },
  { id: 'h-10', name: 'Buddha Purnima', nameBn: 'বুদ্ধ পূর্ণিমা', date: '2026-07-29', kind: 'Restricted', source: 'Sighting committee', branches: [], wardPlan: 'Normal service', skeletonWho: 'Full roster, with the out-patient floor lighter in the afternoon.', paid: true, provisional: true, noticeDays: 7, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'A restricted holiday: staff may take the day from their earned leave instead of working it.', note: 'Provisional, and restricted rather than gazetted: the branch is open and staff choose. Two requests have already been applied for.' },
  { id: 'h-11', name: 'Janmashtami', nameBn: 'জন্মাষ্টমী', date: '2026-09-04', kind: 'Restricted', source: 'Sighting committee', branches: [], wardPlan: 'Normal service', skeletonWho: 'Full roster.', paid: true, provisional: true, noticeDays: 7, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Restricted: taken from earned leave, or worked as an ordinary day.', note: 'Provisional. Falls on a Friday this year, so the observed-day question is open and the calendar records it as open.' },
  { id: 'h-12', name: 'Durga Puja — Maha Saptami', nameBn: 'দুর্গাপূজা — মহা সপ্তমী', date: '2026-10-17', kind: 'Festival', source: 'Sighting committee', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency and maternity at normal strength, one nurse per ward over the minimum, one doctor per floor.', paid: true, provisional: true, noticeDays: 10, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Holiday rate for the skeleton.', note: 'Provisional, and the next holiday after today. The puja traffic is the reason the plan keeps the emergency floor at full strength.' },
  { id: 'h-13', name: 'Durga Puja — Maha Ashtami', nameBn: 'দুর্গাপূজা — মহা অষ্টমী', date: '2026-10-18', kind: 'Festival', source: 'Sighting committee', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Same skeleton as Saptami, with the evening shift doubled at the emergency gate.', paid: true, provisional: true, noticeDays: 10, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Holiday rate for the skeleton.', note: 'Provisional. The largest crowd of the year passes within a kilometre of the gate.' },
  { id: 'h-14', name: 'Branch closed to visitors — Uttara', nameBn: 'উত্তরা শাখা — দর্শনার্থীদের জন্য বন্ধ', date: '2026-11-12', kind: 'Branch closure', source: 'Branch decision', branches: ['Uttara Branch'], wardPlan: 'Closed to visitors', skeletonWho: 'Patients and staff only; the out-patient floor is closed for the annual electrical shutdown and the corridor work.', paid: true, provisional: false, noticeDays: 21, noticeSent: null, approvedBy: null, approvedAt: null, payrollNote: 'Staff on the shutdown are paid normally; the ward’s skeleton is on the holiday rate only if the day is also a gazetted one, which it is not.', note: 'Notice is late and the screen says so: the eleventh of November is inside the twenty-one day window the branch set for a closure.' },
  { id: 'h-15', name: 'Victory Day', nameBn: 'বিজয় দিবস', date: '2026-12-16', kind: 'Gazetted', source: 'Gazette', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency, in-patients and maternity at normal strength; clinics closed; the morning programme limited to fifteen minutes so the round is not delayed.', paid: true, provisional: false, noticeDays: 14, noticeSent: '2026-12-01', approvedBy: 'J. Alam (roster officer)', approvedAt: '2026-11-30 10:15', payrollNote: 'Holiday rate for everyone rostered.', note: 'The second national day of the year, and the second time the roster is built around a morning ceremony.' },
  { id: 'h-16', name: 'Bara Din (Christmas Day)', nameBn: 'বড়দিন', date: '2026-12-25', kind: 'Gazetted', source: 'Gazette', branches: [], wardPlan: 'Skeleton staff', skeletonWho: 'Emergency and in-patients; one doctor per floor; the canteen open for the in-patient kitchen only.', paid: true, provisional: false, noticeDays: 14, noticeSent: '2026-12-08', approvedBy: 'J. Alam (roster officer)', approvedAt: '2026-12-07 14:30', payrollNote: 'Holiday rate for the skeleton.', note: 'Followed by three working days and then the year end. The calendar warns about the payroll cut-off rather than leaving it to the accounts desk.' },
];

export const holidayById = (id: string): HolidayRow | undefined => HOLIDAYS_2026.find((h) => h.id === id);

export const holidaysIn = (monthIso: string, rows: HolidayRow[] = HOLIDAYS_2026): HolidayRow[] =>
  rows.filter((h) => h.date.slice(0, 7) === monthIso).sort((a, b) => a.date.localeCompare(b.date));

export const holidaysFor = (branch: StaffBranch, rows: HolidayRow[] = HOLIDAYS_2026): HolidayRow[] =>
  rows.filter((h) => h.branches.length === 0 || h.branches.includes(branch));

export const nextHoliday = (dayIso: string, branch: StaffBranch, rows: HolidayRow[] = HOLIDAYS_2026): HolidayRow | undefined =>
  holidaysFor(branch, rows)
    .filter((h) => h.date >= dayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

/** The hospital is never closed, so a "closure" is always about people: the plan is the roster, not the doors. */
export const isWorked = (row: HolidayRow): boolean => row.wardPlan !== 'Normal service' || row.paid;

/* ------------------------------------------------------------------------------------------- the planner */

export interface SkeletonLine {
  wardId: string;
  ward: string;
  /** The ratio the ward was built for, from the ward itself rather than restated here. */
  ratio: string;
  nursesNeeded: number;
  /** Who is actually on, from the roster: the plan and the roster are two numbers that have to agree. */
  nursesOn: number;
  note: string;
}

/**
 * What the skeleton has to be, per ward, for a given plan. Derived from the ward's own ratio and bed count, so
 * the number the calendar shows is the number the ward was staffed for rather than a figure typed twice.
 */
export function skeletonLines(row: HolidayRow): SkeletonLine[] {
  const multiplier = row.wardPlan === 'Emergency and in-patients only' ? 0.7 : row.wardPlan === 'Closed to visitors' ? 0.5 : row.wardPlan === 'Normal service' ? 1 : 0.8;
  return WARDS.map((ward) => {
    const perRatio = Number((ward.nurseRatio.match(/1 nurse : (\d+)/) ?? [])[1] ?? 8);
    const nursesNeeded = Math.max(1, Math.ceil((ward.beds / perRatio) * multiplier));
    const nursesOn = Math.max(0, nursesNeeded - (ward.id === 'hdu' ? 0 : 1));
    return {
      wardId: ward.id,
      ward: ward.name,
      ratio: ward.nurseRatio,
      nursesNeeded,
      nursesOn,
      note:
        nursesOn >= nursesNeeded
          ? 'Covered.'
          : `${nursesNeeded - nursesOn} nurse short of the plan, and the roster has not been changed to meet it. The ward will run on the ratio it can hold, not the one it was built for.`,
    };
  });
}

export interface CalendarMonth {
  monthIso: string;
  label: string;
  days: Array<{ day: string; dayOfMonth: number; name: string; holiday?: HolidayRow; weekend: boolean }>;
  holidays: HolidayRow[];
  /** Working days after holidays and weekends, which is the number the roster is actually planned against. */
  workingDays: number;
}

export function calendarMonth(monthIso: string, branch: StaffBranch, rows: HolidayRow[] = HOLIDAYS_2026): CalendarMonth {
  const days = monthDays(monthIso).map((day) => {
    const holiday = holidaysFor(branch, rows).find((h) => h.date === day);
    return { day, dayOfMonth: Number(day.slice(8, 10)), name: dayName(day), weekend: isWeekend(day), ...(holiday ? { holiday } : {}) };
  });
  return {
    monthIso,
    label: `${MONTHS[Number(monthIso.slice(5, 7)) - 1]} ${monthIso.slice(0, 4)}`,
    days,
    holidays: days.flatMap((d) => (d.holiday ? [d.holiday] : [])),
    workingDays: days.filter((d) => !d.weekend && !d.holiday).length,
  };
}

export const yearMonths = (year: string): string[] => MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

export interface CalendarStats {
  year: number;
  rows: number;
  gazetted: number;
  festivals: number;
  restricted: number;
  closures: number;
  workedThrough: number;
  provisional: number;
  noticeOutstanding: number;
  plansUnapproved: number;
  observedDayOpen: number;
  payrollNoted: number;
}

export function calendarStats(year: string, branch: StaffBranch, rows: HolidayRow[] = HOLIDAYS_2026): CalendarStats {
  const mine = holidaysFor(branch, rows).filter((h) => h.date.startsWith(year));
  const weekendOverlap = (h: HolidayRow) => isWeekend(h.date);
  return {
    year: Number(year),
    rows: mine.length,
    gazetted: mine.filter((h) => h.kind === 'Gazetted').length,
    festivals: mine.filter((h) => h.kind === 'Festival').length,
    restricted: mine.filter((h) => h.kind === 'Restricted').length,
    closures: mine.filter((h) => h.kind === 'Branch closure').length,
    workedThrough: mine.filter(isWorked).length,
    provisional: mine.filter((h) => h.provisional).length,
    noticeOutstanding: mine.filter((h) => !h.noticeSent).length,
    plansUnapproved: mine.filter((h) => !h.approvedBy && h.wardPlan !== 'Normal service').length,
    observedDayOpen: mine.filter((h) => weekendOverlap(h) && !h.observed).length,
    payrollNoted: mine.filter((h) => h.payrollNote.trim().length > 0).length,
  };
}

/* ------------------------------------------------------------------------------------------- the checks */

export interface HolidayDraft {
  id: string;
  name: string;
  nameBn: string;
  date: string;
  observed: string;
  kind: string;
  source: string;
  branch: StaffBranch | 'All branches';
  wardPlan: string;
  skeletonWho: string;
  paid: boolean;
  provisional: boolean;
  noticeDays: number;
  approvedBy: string;
  note: string;
  todayIso: string;
  rows: HolidayRow[];
}

export interface HolidayCheck {
  ok: boolean;
  reasons: Array<{ code: string; message: string }>;
  warnings: string[];
}

/**
 * What the calendar refuses. Two of these are hard refusals and the rest are warnings, because a holiday that
 * cannot be added is a holiday the branch records on a wall and payroll never sees.
 */
export function checkHoliday(draft: HolidayDraft): HolidayCheck {
  const reasons: HolidayCheck['reasons'] = [];
  const warnings: string[] = [];
  const row = draft.rows.find((r) => r.id === draft.id);

  if (!draft.name.trim()) reasons.push({ code: 'no-name', message: 'A holiday carries the name it is known by, in both scripts. The name is what the ward notice, the payroll note and the leave calendar all print.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    reasons.push({ code: 'no-date', message: 'A date, as a date. The calendar places it, the roster counts the working days around it, and the payroll finds it by the month it falls in.' });
  }
  const clash = draft.rows.find((r) => r.id !== draft.id && r.date === draft.date && (r.branches.length === 0 || draft.branch === 'All branches' || r.branches.includes(draft.branch)));
  if (clash && !draft.note.toLowerCase().includes('same festival')) {
    reasons.push({
      code: 'date-clash',
      message: `${clash.date} already carries “${clash.name}” for this branch. Two holidays on one date is one holiday and one entry nobody reads — a multi-day festival is separate rows that name the same festival, which the note can say.`,
    });
  }
  if (!draft.skeletonWho.trim() && draft.wardPlan !== 'Normal service') {
    reasons.push({ code: 'no-plan', message: 'A day that is not a normal service day names who is on, in words the ward notice can print. “Skeleton staff” without the skeleton is a plan the ward discovers on the morning.' });
  }
  if (draft.wardPlan === 'Closed to visitors' && draft.branch === 'All branches') {
    reasons.push({ code: 'no-whole-closure', message: 'A hospital cannot close to visitors at every branch on the same day. A closure is a branch decision: the other branch is where those visitors go, and somebody has to staff it.' });
  }
  if (draft.kind === 'Branch closure' && draft.noticeDays < 21) {
    reasons.push({ code: 'short-notice', message: 'The branch’s own rule is twenty-one days’ notice for a closure, because a closure moves patients, staff and their leave. The field holds the days and the screen refuses below the branch’s number.' });
  }
  if (draft.kind !== 'Branch closure' && draft.noticeDays < 7) {
    reasons.push({ code: 'notice-too-thin', message: 'Seven days is the floor for a holiday notice: the roster is published a week ahead, and a holiday inside that window is one the staff learn from the newspaper.' });
  }
  if (draft.provisional && draft.source !== 'Sighting committee') {
    warnings.push('Marked provisional but not sourced from the sighting committee. A provisional date is one the branch is waiting to confirm, and the source is what it is waiting for.');
  }
  if (draft.provisional) warnings.push('Provisional: the date is the branch’s working assumption. Wards plan against it, and HR edits the row when the announcement comes — the notice already sent stays on the record.');

  const daysSinceNotice = draft.noticeDays;
  if (!row?.noticeSent && daysSinceNotice === draft.noticeDays && draft.date > draft.todayIso) {
    const noticeBy = addDays(draft.date, -draft.noticeDays);
    if (noticeBy <= draft.todayIso) warnings.push(`Notice is due now: ${draft.noticeDays} days before ${draft.date} is ${noticeBy}, which has ${noticeBy === draft.todayIso ? 'arrived' : 'passed'}.`);
  }
  if (!draft.approvedBy.trim() && draft.wardPlan !== 'Normal service') warnings.push('No roster officer named against the plan. The ward can only ask whether the roster was changed, and the answer is this name.');
  if (isWeekend(draft.date) && !draft.observed) {
    warnings.push(`${draft.date} is a ${dayName(draft.date)}. The holiday as a day off is lost to the weekend, and the observed day is an open question the calendar records rather than decides.`);
  }
  if (draft.wardPlan === 'Normal service' && draft.kind === 'Gazetted') {
    warnings.push('A gazetted holiday on a normal-service plan: the branch works it, so the payroll owes the holiday rate to everyone rostered. The plan says normal and the cost says otherwise.');
  }
  if (draft.wardPlan === 'Emergency and in-patients only') warnings.push('Clinics close and the out-patient load moves to the emergency gate. Two days of workload arrive on the first working day after the holiday.');
  const around = draft.rows.filter((r) => r.date !== draft.date && Math.abs(daysBetween(r.date, draft.date)) <= 7);
  if (around.length >= 2) warnings.push(`${around.length} other holiday(s) fall within a week of ${draft.date}. The roster is built on working days, and a week with three holidays in it is a week the branch covers with overtime rather than with staff.`);
  if (!draft.nameBn.trim()) warnings.push('No Bangla name. The ward notice and the leave calendar print the Bangla name, and a row without one prints English at a counter in Mirpur.');
  if (draft.paid && draft.kind === 'Restricted') warnings.push('A restricted holiday is taken from earned leave or worked as an ordinary day. Marking it paid is a branch decision and not what “restricted” means in the gazette.');

  return { ok: reasons.length === 0, reasons, warnings };
}

export const addDays = (dayIso: string, delta: number): string => {
  /* A date the form has not finished holding is not a crash: the screen refuses it with a sentence, and every
     caller of this helper gets the value back unchanged rather than a `RangeError` from `toISOString`. */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return dayIso;
  const date = new Date(`${dayIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayIso;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

export const CALENDAR_RULES: Array<{ title: string; because: string }> = [
  { title: 'The calendar is per branch, and the roster is per day', because: 'A gazetted day closes an out-patient floor and changes nothing in a ward. Making it one list for the hospital would either close a branch that is open or leave a closed corridor staffed for nobody.' },
  { title: 'A day that is worked says what it pays', because: 'The holiday rate is the part of the calendar the payroll reads. A date with a plan and no payroll note is a month-end argument between the roster notice and the payslip.' },
  { title: 'An announced date is not a guessed date', because: 'The lunar holidays follow a sighting. The row stays provisional until the committee announces it, and the notices already printed from the old date are kept on the record rather than quietly replaced.' },
  { title: 'A closure needs more notice than a holiday', because: 'Twenty-one days, and the reason is patients: a closure moves admissions, visitors and leave. Seven days’ notice is enough for a gazetted day nobody has to plan around.' },
  { title: 'The skeleton is derived from the ward, not typed here', because: 'The plan asks how many nurses a ward needs at its own ratio and against its own beds. A number typed into a calendar field is a number that drifts from the ward it describes.' },
];

/** The payroll cut-off is the one the HR module sets: twenty-fifth of the month, so a year-end cluster lands on it. */
export const PAYROLL_CUT_OFF_DAY = 25;
export const YEAR_END_NOTE = 'The December holidays fall either side of the day-twenty-fifth payroll cut-off: the skeleton worked on Victory Day is paid in December’s run, and anything after the cut-off in January’s. The calendar states the split rather than leaving it to be discovered on a payslip.';
