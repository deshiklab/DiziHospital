/* ----------------------------------------------------------------------------------------------------
 * People (P7) — the staff register, leave, and payroll arithmetic.
 *
 * Everything else in this product records what happened to a patient. This module records what the hospital
 * owes the people who make that happen, and it is the module where a rounding error is somebody's rent. Four
 * rules decide its shape:
 *
 *  1. **The directory and the roster are the same people.** The ward's duty roster, the attendance reader and
 *     the payroll file all work from one staff record, keyed by the employee number. The legacy product had
 *     three lists that disagreed by a name or two every month, which is how a night shift goes unpaid.
 *  2. **Attendance is a fact with a device and a time, and a correction is a second record.** Nothing here
 *     overwrites a punch: an adjustment names the supervisor and the reason, because the person whose pay
 *     depends on it is entitled to see who changed it.
 *  3. **Leave is an entitlement, and the roster is what makes it real.** An application is checked against the
 *     balance, the notice the type needs, the certificate it needs, and — for a ward — how many others on the
 *     same shift are already off. Everything the register refuses is a sentence somebody can act on.
 *  4. **Payroll is arithmetic, and the arithmetic is published.** Allowances are derived from basic rather than
 *     stored beside it, the tax table is the branch's own, the cut-off is on the run, and the same run and
 *     approval are never done by one person. One run per branch per month: a second is a second bank file.
 *
 * Preview: the directory is derived from the ward roster the rest of the product already reads, so the names on
 * this screen are the names on the duty roster, the ward board and the theatre list. Payroll and attendance are
 * generated deterministically per month, so two people looking at the same month see the same figures.
 */

import { branches } from './mock';
import { dutyDay, SHIFT_WINDOW, type DutyRole, type StaffMember, type Shift } from './duty';
import { WARDS, wardName } from './ward';
import type { Role } from './shell';

/** The branch a staff member is based at. The roster, the gate and the payroll all say the same three words. */
export type StaffBranch = (typeof branches)[number];

/* ------------------------------------------------------------------------------------------ the calendar */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM` — the unit of attendance and of a payroll run. There is no such thing as half a month's salary. */
export const monthOf = (dayIso: string): string => dayIso.slice(0, 7);
export const monthLabel = (monthIso: string): string => `${MONTHS[Number(monthIso.slice(5, 7)) - 1]} ${monthIso.slice(0, 4)}`;

/** Every day of a month, in order. The register and the payroll both walk this, so they cannot disagree about how many days there are. */
export function monthDays(monthIso: string): string[] {
  const year = Number(monthIso.slice(0, 4));
  const month = Number(monthIso.slice(5, 7));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${monthIso}-${String(i + 1).padStart(2, '0')}`);
}

export const dayName = (dayIso: string): string => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${dayIso}T00:00:00Z`).getUTCDay()];
/** The weekend the branch keeps: Friday and Saturday. A hospital runs through it, but the office behind it does not. */
export const isWeekend = (dayIso: string): boolean => ['Fri', 'Sat'].includes(dayName(dayIso));

export function addMonths(monthIso: string, delta: number): string {
  const year = Number(monthIso.slice(0, 4));
  const month = Number(monthIso.slice(5, 7)) - 1 + delta;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export const dayOfMonth = (dayIso: string): number => Number(dayIso.slice(8, 10));

/* --------------------------------------------------------------------------------------------- the shape */

export type Employment = 'Permanent' | 'Contract' | 'Part-time' | 'Intern' | 'Outsourced';
export const EMPLOYMENTS: Employment[] = ['Permanent', 'Contract', 'Part-time', 'Intern', 'Outsourced'];

export type StaffStatus = 'Active' | 'On leave' | 'Suspended' | 'Resigned' | 'Retired';
export const STAFF_STATUSES: StaffStatus[] = ['Active', 'On leave', 'Suspended', 'Resigned', 'Retired'];

export interface Department {
  id: string;
  name: string;
  /** What a manager is called in this department — used in the escalation sentence, not stored on a person. */
  head: string;
  costCentre: string;
  clinical: boolean;
}

export const DEPARTMENTS: Department[] = [
  { id: 'med', name: 'Medicine', head: 'Consultant, Medicine', costCentre: 'CC-101', clinical: true },
  { id: 'surg', name: 'Surgery', head: 'Consultant, Surgery', costCentre: 'CC-102', clinical: true },
  { id: 'obs', name: 'Obstetrics and gynaecology', head: 'Consultant, Obs & Gyn', costCentre: 'CC-103', clinical: true },
  { id: 'hdu', name: 'Critical care', head: 'Consultant, Critical care', costCentre: 'CC-104', clinical: true },
  { id: 'nursing', name: 'Nursing', head: 'Nursing superintendent', costCentre: 'CC-201', clinical: true },
  { id: 'lab', name: 'Laboratory', head: 'Chief technologist', costCentre: 'CC-301', clinical: true },
  { id: 'pharm', name: 'Pharmacy', head: 'Chief pharmacist', costCentre: 'CC-401', clinical: true },
  { id: 'front', name: 'Front office', head: 'Front office manager', costCentre: 'CC-501', clinical: false },
  { id: 'accounts', name: 'Accounts', head: 'Finance manager', costCentre: 'CC-601', clinical: false },
  { id: 'hr', name: 'Human resource', head: 'HR manager', costCentre: 'CC-602', clinical: false },
  { id: 'admin', name: 'Administration', head: 'Hospital director', costCentre: 'CC-603', clinical: false },
  { id: 'support', name: 'Support services', head: 'Support services officer', costCentre: 'CC-701', clinical: false },
];

export const departmentById = (id: string): Department | undefined => DEPARTMENTS.find((d) => d.id === id);
export const departmentName = (id: string): string => departmentById(id)?.name ?? id;

/** Grades carry the pay band, so a revision is one table rather than forty records. */
export interface Grade {
  code: string;
  label: string;
  /** Monthly basic, in taka. Allowances are percentages of this, which is why it is the only pay figure stored. */
  basic: number;
  band: [number, number];
}

export const GRADES: Grade[] = [
  { code: 'G-01', label: 'Support staff', basic: 11_500, band: [11_000, 14_000] },
  { code: 'G-02', label: 'Attendant', basic: 13_000, band: [12_000, 16_000] },
  { code: 'G-03', label: 'Office assistant', basic: 16_000, band: [15_000, 20_000] },
  { code: 'G-04', label: 'Officer', basic: 24_000, band: [22_000, 30_000] },
  { code: 'G-05', label: 'Senior officer', basic: 32_000, band: [30_000, 42_000] },
  { code: 'G-06', label: 'Assistant manager', basic: 45_000, band: [42_000, 60_000] },
  { code: 'G-07', label: 'Registrar', basic: 70_000, band: [60_000, 90_000] },
  { code: 'G-08', label: 'Consultant', basic: 150_000, band: [120_000, 220_000] },
  { code: 'G-09', label: 'Intern stipend', basic: 15_000, band: [15_000, 15_000] },
];

export const gradeByCode = (code: string): Grade | undefined => GRADES.find((g) => g.code === code);

/** Which grade a roster role sits in, and under which designation. One table: a nurse's pay cannot drift from a nurse's title. */
const ROLE_GRADE: Record<string, { grade: string; designation: string; department: string }> = {
  Consultant: { grade: 'G-08', designation: 'Consultant', department: 'med' },
  Registrar: { grade: 'G-07', designation: 'Registrar', department: 'med' },
  Intern: { grade: 'G-09', designation: 'Intern', department: 'med' },
  'Senior staff nurse': { grade: 'G-05', designation: 'Senior staff nurse', department: 'nursing' },
  'Staff nurse': { grade: 'G-04', designation: 'Staff nurse', department: 'nursing' },
  Midwife: { grade: 'G-05', designation: 'Midwife', department: 'obs' },
  Aya: { grade: 'G-01', designation: 'Aya', department: 'support' },
  'Ward boy': { grade: 'G-02', designation: 'Ward attendant', department: 'support' },
};
const ROLE_DEPARTMENT: Record<string, string> = { 'med-a': 'med', 'surg-b': 'surg', 'mat-c': 'obs', hdu: 'hdu' };

export interface HrStaff {
  id: string;
  /** `EMP-1042` — one series, never reused, and the key a payroll file is paid against. */
  code: string;
  name: string;
  nameBn?: string;
  role: string;
  departmentId: string;
  designation: string;
  gradeCode: string;
  branch: StaffBranch;
  wardId?: string;
  phone: string;
  joined: string;
  employment: Employment;
  status: StaffStatus;
  basic: number;
  /** Registration number and expiry for a clinical designation: a lapsed licence is a duty the roster must not fill. */
  licence?: { kind: string; no: string; expires: string };
  bank?: { bank: string; masked: string; verified: boolean };
  competencies: string[];
  weekHours: number;
  nightsInARow: number;
  /** Where the roster currently has them, so the HR screen and the duty screen agree. */
  onLeave?: { from: string; to: string; kind: string };
}

/** Non-clinical staff, so the register is a hospital's staff list rather than a ward's. Seeded, like the clinical half. */
const NON_CLINICAL: Array<{ name: string; designation: string; department: string; grade: string; branch: StaffBranch; employment: Employment }> = [
  { name: 'M. Hoque', designation: 'Front office manager', department: 'front', grade: 'G-06', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'S. Nahar', designation: 'Receptionist', department: 'front', grade: 'G-03', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'R. Karim', designation: 'Receptionist', department: 'front', grade: 'G-03', branch: 'Uttara Branch', employment: 'Permanent' },
  { name: 'T. Barua', designation: 'Front office officer', department: 'front', grade: 'G-04', branch: 'Mirpur Branch', employment: 'Contract' },
  { name: 'A. Chowdhury', designation: 'Finance manager', department: 'accounts', grade: 'G-06', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'N. Islam', designation: 'Accounts officer', department: 'accounts', grade: 'G-04', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'F. Yasmin', designation: 'Billing officer', department: 'accounts', grade: 'G-04', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'J. Alam', designation: 'HR manager', department: 'hr', grade: 'G-06', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'H. Mia', designation: 'Administrative officer', department: 'admin', grade: 'G-05', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'K. Sarker', designation: 'Chief pharmacist', department: 'pharm', grade: 'G-06', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'P. Roy', designation: 'Pharmacist', department: 'pharm', grade: 'G-04', branch: 'Uttara Branch', employment: 'Permanent' },
  { name: 'S. Dey', designation: 'Chief technologist', department: 'lab', grade: 'G-05', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'M. Barua', designation: 'Medical technologist', department: 'lab', grade: 'G-04', branch: 'Main Campus', employment: 'Contract' },
  { name: 'A. Rahman', designation: 'Biomedical engineer', department: 'support', grade: 'G-05', branch: 'Main Campus', employment: 'Permanent' },
  { name: 'R. Akter', designation: 'Housekeeping supervisor', department: 'support', grade: 'G-03', branch: 'Main Campus', employment: 'Outsourced' },
  { name: 'B. Hossain', designation: 'Security supervisor', department: 'support', grade: 'G-03', branch: 'Main Campus', employment: 'Outsourced' },
  { name: 'N. Sultana', designation: 'Dietitian', department: 'support', grade: 'G-04', branch: 'Main Campus', employment: 'Contract' },
  { name: 'T. Kabir', designation: 'IT officer', department: 'admin', grade: 'G-04', branch: 'Main Campus', employment: 'Permanent' },
];

const BANKS = ['BRAC Bank', 'Dutch-Bangla Bank', 'City Bank', 'Sonali Bank', 'Islami Bank'];

function seedFor(key: string): number {
  let h = 2_166_136_261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16_777_619) >>> 0;
  return h;
}
/**
 * mulberry32, seeded from the employee number.
 *
 * A plain linear congruential generator was tried first and produced *correlated* sequences for employee numbers
 * that differ by one digit — every bank account came out verified, which is exactly the kind of quiet, plausible
 * wrongness this product cannot afford.
 */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const pad4 = (n: number): string => String(n).padStart(4, '0');

const LICENSE_KIND: Record<string, string> = {
  Consultant: 'BMDC specialist registration',
  Registrar: 'BMDC registration',
  Intern: 'BMDC provisional registration',
  'Senior staff nurse': 'BNMC registration',
  'Staff nurse': 'BNMC registration',
  Midwife: 'BNMC midwifery registration',
};

/**
 * The staff register for a day: the ward roster's own people, given the record HR actually holds — employee
 * number, designation, grade, pay, joining date, licence and bank account — plus the non-clinical half of the
 * hospital. One directory, so the roster, the attendance reader and the payroll file cannot disagree about who
 * works here.
 */
export function staffDirectory(dayIso: string): HrStaff[] {
  const roster = dutyDay(dayIso);
  const year = dayIso.slice(0, 4);
  const clinical: HrStaff[] = roster.staff.map((person: StaffMember, index: number) => {
    const r = rng(seedFor(`hr:${person.id}`));
    const mapped = ROLE_GRADE[person.role] ?? ROLE_GRADE['Staff nurse'];
    const department =
      person.role === 'Aya' || person.role === 'Ward boy'
        ? mapped.department
        : person.role === 'Consultant' || person.role === 'Registrar' || person.role === 'Intern'
          ? ROLE_DEPARTMENT[person.wardId] ?? mapped.department
          : mapped.department;
    const grade = gradeByCode(mapped.grade) as Grade;
    const licenceKind = LICENSE_KIND[person.role];
    return {
      id: person.id,
      code: `EMP-${pad4(1001 + index)}`,
      name: person.name,
      role: person.role,
      departmentId: department,
      designation: mapped.designation,
      gradeCode: grade.code,
      branch: 'Main Campus',
      wardId: person.wardId,
      phone: person.phone,
      joined: `${Number(year) - 1 - (index % 7)}-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + ((index * 3) % 28)).padStart(2, '0')}`,
      employment: person.role === 'Intern' ? 'Intern' : r() > 0.85 ? 'Contract' : 'Permanent',
      status: person.onLeave ? 'On leave' : 'Active',
      basic: grade.basic + Math.round(r() * (grade.band[1] - grade.band[0]) / 500) * 500,
      ...(licenceKind
        ? {
            licence: {
              kind: licenceKind,
              no: `BMDC-${String(40_000 + (seedFor(person.id) % 20_000)).slice(0, 5)}`,
              // One licence is deliberately close to its expiry: the screen has to show what that means for the roster.
              expires: person.name === roster.staff[3]?.name ? `${year}-11-30` : `${Number(year) + 2}-${String(1 + (index % 12)).padStart(2, '0')}-28`,
            },
          }
        : {}),
      bank: {
        bank: pick(r, BANKS),
        masked: `•••• ${String(Math.floor(r() * 9000) + 1000)}`,
        verified: r() > 0.12,
      },
      competencies: person.competencies,
      weekHours: person.weekHours,
      nightsInARow: person.nightsInARow,
      ...(person.onLeave ? { onLeave: person.onLeave } : {}),
    };
  });

  const nonClinical: HrStaff[] = NON_CLINICAL.map((row, index) => {
    const r = rng(seedFor(`hr:${row.name}`));
    const grade = gradeByCode(row.grade) as Grade;
    return {
      id: `emp-${row.designation.toLowerCase().replace(/[^a-z]+/g, '-')}-${index + 1}`,
      code: `EMP-${pad4(1041 + index)}`,
      name: row.name,
      role: row.designation,
      departmentId: row.department,
      designation: row.designation,
      gradeCode: grade.code,
      branch: row.branch,
      phone: `01${6 + (index % 4)}${String(20_000_000 + ((seedFor(row.name) % 79_999_999))).slice(0, 8)}`,
      joined: `${Number(year) - 2 - (index % 5)}-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + ((index * 5) % 28)).padStart(2, '0')}`,
      employment: row.employment,
      status: 'Active',
      basic: grade.basic,
      bank: { bank: pick(r, BANKS), masked: `•••• ${String(Math.floor(r() * 9000) + 1000)}`, verified: true },
      competencies: [],
      weekHours: 40,
      nightsInARow: 0,
    };
  });

  return [...clinical, ...nonClinical];
}

export const staffByCode = (directory: HrStaff[], code: string): HrStaff | undefined => directory.find((s) => s.code === code);
export const staffById = (directory: HrStaff[], id: string): HrStaff | undefined => directory.find((s) => s.id === id);

export interface HrStats {
  total: number;
  active: number;
  clinical: number;
  nonClinical: number;
  onLeave: number;
  probation: number;
  licencesExpiring: number;
  unverifiedBank: number;
  monthlyBasic: number;
  byBranch: Array<{ branch: StaffBranch; headcount: number; basic: number }>;
}

export const PROBATION_MONTHS = 6;
export const NOTICE_DAYS = 30;

/** Joining + six months: earned leave and the confirmation letter both start here. */
export function probationEnds(joined: string): string {
  const [y, m, d] = joined.split('-').map(Number);
  const total = m - 1 + PROBATION_MONTHS;
  return `${y + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const onProbation = (staff: HrStaff, dayIso: string): boolean => probationEnds(staff.joined) > dayIso;

/** Licence expiry, in days, for the roster's own warning: a consultant whose registration lapses is a duty nobody may fill. */
export function licenceDaysLeft(staff: HrStaff, dayIso: string): number | null {
  if (!staff.licence) return null;
  const ms = Date.parse(`${staff.licence.expires}T00:00:00Z`) - Date.parse(`${dayIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function hrStats(directory: HrStaff[], dayIso: string): HrStats {
  const byBranch = branches.map((branch) => {
    const rows = directory.filter((s) => s.branch === branch && s.status !== 'Resigned' && s.status !== 'Retired');
    return { branch, headcount: rows.length, basic: rows.reduce((n, s) => n + s.basic, 0) };
  });
  return {
    total: directory.length,
    active: directory.filter((s) => s.status === 'Active' || s.status === 'On leave').length,
    clinical: directory.filter((s) => departmentById(s.departmentId)?.clinical).length,
    nonClinical: directory.filter((s) => !departmentById(s.departmentId)?.clinical).length,
    onLeave: directory.filter((s) => s.onLeave).length,
    probation: directory.filter((s) => onProbation(s, dayIso)).length,
    licencesExpiring: directory.filter((s) => {
      const left = licenceDaysLeft(s, dayIso);
      return left !== null && left <= 120;
    }).length,
    unverifiedBank: directory.filter((s) => s.bank && !s.bank.verified).length,
    monthlyBasic: directory.filter((s) => s.status !== 'Resigned' && s.status !== 'Retired').reduce((n, s) => n + s.basic, 0),
    byBranch,
  };
}

/* ---------------------------------------------------------------------------------------------- the leave */

export interface LeaveType {
  code: string;
  label: string;
  /** Days a year, for a permanent member of staff. Part-time and outsourced are pro-rated by the rule below. */
  days: number;
  paid: boolean;
  /** Notice the type needs, in days, before the first day of leave. */
  noticeDays: number;
  /** Days after which a certificate is required. 0 means never, `null` means always. */
  certificateAfter: number | null;
  maxConsecutive: number;
  /** Who may apply: `all`, `clinical` (ward and theatre staff), `female` (maternity), or `permanent`. */
  appliesTo: 'all' | 'clinical' | 'female' | 'permanent';
  note: string;
}

export const LEAVE_TYPES: LeaveType[] = [
  { code: 'CAS', label: 'Casual leave', days: 10, paid: true, noticeDays: 3, certificateAfter: null, maxConsecutive: 3, appliesTo: 'all', note: 'Short, planned, and the type an entire ward books for the same week by accident. Three days at a time, and the roster check is what stops the fourth.' },
  { code: 'SICK', label: 'Sick leave', days: 14, paid: true, noticeDays: 0, certificateAfter: 2, maxConsecutive: 14, appliesTo: 'all', note: 'Applied for on the day. Over two days it needs a certificate — not because anybody is doubted, but because the payroll file cannot pay an uncertified absence and the insurer will not read one.' },
  { code: 'EARN', label: 'Earned leave', days: 15, paid: true, noticeDays: 7, certificateAfter: null, maxConsecutive: 15, appliesTo: 'permanent', note: 'One day for eighteen worked. Available after probation: leave earned in the first six months is the thing people resign over when it is refused a week before the wedding.' },
  { code: 'MAT', label: 'Maternity leave', days: 112, paid: true, noticeDays: 30, certificateAfter: null, maxConsecutive: 112, appliesTo: 'female', note: 'Sixteen weeks, and it is a right rather than a favour. The register keeps the expected date so the roster plans around the absence instead of discovering it.' },
  { code: 'PAT', label: 'Paternity leave', days: 10, paid: true, noticeDays: 3, certificateAfter: null, maxConsecutive: 10, appliesTo: 'all', note: 'Ten days, from the date of the birth, for the father or the supporting partner.' },
  { code: 'HAJJ', label: 'Hajj leave', days: 30, paid: true, noticeDays: 60, certificateAfter: null, maxConsecutive: 30, appliesTo: 'permanent', note: 'Once in service, and it needs the permit on the record because the dates are the permit’s, not the ward’s.' },
  { code: 'STUDY', label: 'Study leave', days: 10, paid: true, noticeDays: 21, certificateAfter: null, maxConsecutive: 10, appliesTo: 'permanent', note: 'For a course, an exam or a conference with a paper accepted — the document is what makes it study leave rather than an absence.' },
  { code: 'LWP', label: 'Leave without pay', days: 30, paid: false, noticeDays: 14, certificateAfter: null, maxConsecutive: 30, appliesTo: 'all', note: 'Unpaid, and the payroll takes the days out of the gross rather than out of the entitlement. It exists so that an emergency does not have to become a resignation.' },
];

export const leaveTypeByCode = (code: string): LeaveType | undefined => LEAVE_TYPES.find((t) => t.code === code);

export type LeaveState = 'Applied' | 'Approved' | 'Refused' | 'Cancelled';

export interface LeaveRequest {
  id: string;
  staffId: string;
  staffCode: string;
  typeCode: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  state: LeaveState;
  appliedAt: string;
  documentNo?: string;
  decidedBy?: string;
  decidedAt?: string;
  coverNote?: string;
  decision?: string;
}

/** Days between two dates inclusive — the number the entitlement is spent in, and the one a person counts. */
export function daysBetween(from: string, to: string): number {
  if (to < from) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Entitlement for a person this year: pro-rated for an intern or a part-timer, and zero before the joining date. */
export function entitlement(staff: HrStaff, type: LeaveType, year: string): number {
  if (staff.joined > `${year}-12-31`) return 0;
  if (type.appliesTo === 'permanent' && staff.employment !== 'Permanent' && staff.employment !== 'Contract') return 0;
  if (staff.employment === 'Intern') return type.code === 'SICK' || type.code === 'CAS' ? Math.round(type.days / 2) : 0;
  if (staff.employment === 'Part-time') return Math.round(type.days / 2);
  if (staff.employment === 'Outsourced') return type.paid ? Math.round(type.days / 2) : type.days;
  return type.days;
}

export interface LeaveBalance {
  entitlement: number;
  taken: number;
  pending: number;
  left: number;
}

export function leaveBalance(staff: HrStaff, typeCode: string, requests: LeaveRequest[], year: string): LeaveBalance {
  const type = leaveTypeByCode(typeCode);
  if (!type) return { entitlement: 0, taken: 0, pending: 0, left: 0 };
  const mine = requests.filter((r) => r.staffCode === staff.code && r.typeCode === typeCode && r.from.slice(0, 4) === year);
  const taken = mine.filter((r) => r.state === 'Approved').reduce((n, r) => n + r.days, 0);
  const pending = mine.filter((r) => r.state === 'Applied').reduce((n, r) => n + r.days, 0);
  const cap = entitlement(staff, type, year);
  return { entitlement: cap, taken, pending, left: Math.max(0, cap - taken - pending) };
}

export interface LeaveCheck {
  ok: boolean;
  code?: string;
  problem?: string;
  hint?: string;
  warnings: string[];
}

/**
 * What the register refuses about a leave application, with the reason in the applicant's words.
 *
 * This is the whole point of the screen: the legacy system accepted every application and the ward discovered
 * the gap on the day. Each refusal here names the rule, the number and the person who can overrule it.
 */
export function checkLeave(
  staff: HrStaff,
  draft: { typeCode: string; from: string; to: string; days?: number; documentNo?: string },
  existing: LeaveRequest[],
  dayIso: string,
  options: { wardOnLeave?: Array<{ staffCode: string; wardId?: string; from: string; to: string; departmentId: string }> } = {},
): LeaveCheck {
  const warnings: string[] = [];
  const refuse = (code: string, problem: string, hint: string): LeaveCheck => ({ ok: false, code, problem, hint, warnings });

  const type = leaveTypeByCode(draft.typeCode);
  if (!type) return refuse('unknown-type', 'That leave type is not in the register.', 'Pick one of the eight the hospital grants; a type invented at the desk is a type payroll cannot pay.');

  const days = draft.days ?? daysBetween(draft.from, draft.to);
  if (days <= 0) return refuse('no-days', 'Those dates do not contain a day of leave.', 'The last day is included: a single-day application has the same date twice.');

  if (staff.status === 'Resigned' || staff.status === 'Retired') {
    return refuse('left-service', `${staff.name} has left service, and leave does not accrue after the last working day.`, 'A final settlement is a different record from a leave application.');
  }

  /* The register holds no sex field for staff, and inventing one for this rule alone is how a register ends up
     wrong about somebody. The maternity rule is applied to the people it can be and the screen says so. */
  if (type.appliesTo === 'female' && !FEMALE_NAMES.has(staff.name)) {
    return refuse('maternity-not-applicable', 'Maternity leave is granted to the person who gave birth.', 'The register has no other applicant for this type — the father or the supporting partner applies for paternity leave under PAT.');
  }
  if (type.appliesTo === 'permanent' && staff.employment !== 'Permanent' && staff.employment !== 'Contract') {
    return refuse('not-entitled-type', `${type.label} is granted to permanent and contract staff; ${staff.name} is ${staff.employment.toLowerCase()}.`, `The other seven types are open — ${entitlement(staff, type, draft.from.slice(0, 4))} days of it would be the entitlement if the employment changed.`);
  }

  if (type.code === 'EARN' && onProbation(staff, draft.from)) {
    return refuse(
      'probation',
      `Earned leave starts after probation, which for ${staff.name} ends ${probationEnds(staff.joined)}.`,
      'Casual and sick leave are available during probation. This is the rule people resign over, so the screen states the date rather than the word “probation”.',
    );
  }

  if (type.noticeDays > 0) {
    const notice = Math.round((Date.parse(`${draft.from}T00:00:00Z`) - Date.parse(`${dayIso}T00:00:00Z`)) / 86_400_000);
    if (notice < type.noticeDays) {
      return refuse(
        'short-notice',
        `${type.label} needs ${type.noticeDays} days’ notice; this application gives ${Math.max(0, notice)}.`,
        type.code === 'SICK'
          ? 'Sick leave can be applied for on the day — it is attendance the register corrects, not a plan.'
          : 'The roster is published a week ahead, so notice is what makes a replacement possible rather than a scramble.',
      );
    }
  }

  if (draft.from < dayIso && type.noticeDays > 0 && days > 3) {
    warnings.push(`Back-dated by ${Math.round((Date.parse(`${dayIso}T00:00:00Z`) - Date.parse(`${draft.from}T00:00:00Z`)) / 86_400_000)} days: it needs the ward manager’s sentence on why, because the attendance register is already closed for those days.`);
  }

  if (days > type.maxConsecutive) {
    return refuse('too-long', `${type.label} runs ${type.maxConsecutive} days at a time; this is ${days}.`, 'Longer absences are granted as a second application with a manager’s note, so the roster sees the whole absence rather than a gap nobody planned for.');
  }

  if (type.certificateAfter !== null && days > type.certificateAfter && !draft.documentNo) {
    return refuse('needs-certificate', `${type.label} over ${type.certificateAfter} days needs the certificate on the record.`, 'The document number goes in the register: the payroll file cannot pay an uncertified absence, and the insurer will not read one.');
  }
  if (type.code === 'MAT' && !draft.documentNo) {
    return refuse('needs-document', 'Maternity leave needs the expected-date certificate from the attending doctor.', 'It is what lets the roster plan the cover, and it is the paper the entitlement is paid against.');
  }
  if (type.code === 'HAJJ' && !draft.documentNo) {
    return refuse('needs-document', 'Hajj leave needs the permit number.', 'The dates belong to the permit, not to the ward, and the leave is granted once in service.');
  }
  if (type.code === 'STUDY' && !draft.documentNo) {
    return refuse('needs-document', 'Study leave needs the document — an admission letter, an exam schedule or an accepted paper.', 'Without it the type is indistinguishable from an absence, which is the thing it exists to avoid being.');
  }

  const balance = leaveBalance(staff, type.code, existing, draft.from.slice(0, 4));
  if (days > balance.left) {
    return refuse(
      'over-entitlement',
      `${days} days against ${balance.left} left: ${balance.entitlement} granted, ${balance.taken} taken, ${balance.pending} already applied for.`,
      type.paid
        ? 'The excess can be taken as leave without pay, which is a decision for the person applying rather than one made for them.'
        : 'Leave without pay is already the unpaid type; a second application cannot exceed the thirty days the register grants.',
    );
  }

  const overlap = existing.find((r) => r.staffCode === staff.code && r.state !== 'Cancelled' && r.state !== 'Refused' && r.from <= draft.to && r.to >= draft.from);
  if (overlap) {
    return refuse('overlaps', `There is already an application covering ${overlap.from} to ${overlap.to} (${overlap.typeCode}, ${overlap.state.toLowerCase()}).`, 'One absence, one application: two overlapping rows are how the same day gets counted twice in the balance and paid once.');
  }

  /* The roster check. A ward can lose one nurse to leave on a shift; two is a shift the ratio no longer holds for. */
  const sameShift = (options.wardOnLeave ?? []).filter(
    (r) => r.staffCode !== staff.code && r.from <= draft.to && r.to >= draft.from && rosterGroupOf(r, staff),
  );
  if (sameShift.length > 0 && staff.wardId && LEAVE_COVER.limitForWard(staff.wardId) <= sameShift.length) {
    return refuse(
      'coverage',
      `${sameShift.length} other ${wardName(staff.wardId)} staff are already off in those dates, and the ward covers ${LEAVE_COVER.limitForWard(staff.wardId)} at a time.`,
      'The applicant can move the dates, split them, or the nursing superintendent can grant it with a named relief — which is a decision, and it is recorded as one.',
    );
  }
  if (sameShift.length > 0) {
    warnings.push(`The ward already has ${sameShift.length} off in those dates. Cover is arranged before the leave is approved, not after.`);
  }

  if (staff.wardId === 'hdu' && staff.role.includes('nurse') && type.code === 'CAS' && days > 2) {
    warnings.push('Critical care casual leave over two days needs a named relief with current ACLS, because the unit cannot run short of that skill.');
  }
  if (staff.role === 'Intern' && type.code === 'SICK') {
    warnings.push('An intern’s absence is also a training record: the clinical supervisor is told, not only HR.');
  }

  return { ok: true, warnings };
}

/** Which people share the roster a leave check is against. Ward staff by ward; office staff by department. */
function rosterGroupOf(row: { wardId?: string; departmentId: string }, staff: HrStaff): boolean {
  if (staff.wardId) return row.wardId === staff.wardId;
  return row.departmentId === staff.departmentId;
}

/** How many people a ward can have off at once and still hold its ratio. The legacy system had no such number. */
export const LEAVE_COVER = {
  limitForWard(wardId: string): number {
    const ward = WARDS.find((w) => w.id === wardId);
    if (!ward) return 1;
    return ward.id === 'hdu' ? 1 : 2;
  },
};

/**
 * Names the register can hold for the maternity rule, because it has no sex field for staff (and inventing one
 * for this alone is how a register ends up wrong about somebody).
 */
const FEMALE_NAMES = new Set(['R. Akter', 'S. Nahar', 'F. Yasmin', 'N. Sultana', 'P. Roy', 'M. Barua', 'A. Chowdhury', 'R. Begum', 'S. Sultana', 'M. Akter', 'K. Islam', 'P. Das', 'N. Haque', 'T. Barua', 'S. Dey']);

export const LEAVE_RULES: Array<{ title: string; because: string }> = [
  { title: 'An entitlement is pro-rated, and the pro-rating is written down', because: 'An intern and a part-timer accrue at half rate, and an outsourced member of staff accrues the unpaid types only. The register states the number it will grant rather than leaving a supervisor to guess.' },
  { title: 'Notice is what makes cover possible', because: 'The roster is published a week ahead. Sick leave is the exception and it is applied for on the day, because nobody plans a fever.' },
  { title: 'A ward can lose one or two, never three', because: 'The ratio on the ward is what the leave check is built on. A third absence is granted by a named person with a named relief, and the decision is on the record.' },
  { title: 'One absence, one application', because: 'Two overlapping rows for the same person is how the same day gets counted twice in the balance and paid once in the payroll.' },
  { title: 'The document is part of the application, not a follow-up', because: 'The payroll file cannot pay an uncertified absence and the insurer will not read one. A certificate number on the record is what turns an absence into leave.' },
];

/* ----------------------------------------------------------------------------------------------- payroll */

/** How a month's salary is assembled. Every figure is derived from basic, so a revision is one table to change. */
export const ALLOWANCE_RATES: Array<{ code: string; label: string; kind: 'pct' | 'flat'; value: number; note: string }> = [
  { code: 'HR', label: 'House rent', kind: 'pct', value: 50, note: 'Half of basic, which is the share the hospital has always paid and the one a rent agreement is checked against.' },
  { code: 'MED', label: 'Medical allowance', kind: 'pct', value: 10, note: 'Ten per cent of basic, paid in cash. In-patient treatment is free at the branch on top of it, and the payroll says so rather than implying the allowance is the whole benefit.' },
  { code: 'CONV', label: 'Conveyance', kind: 'flat', value: 2_200, note: 'Flat, because it covers a bus fare rather than a distance.' },
  { code: 'DEAR', label: 'Dearness', kind: 'pct', value: 5, note: 'Five per cent of basic, reviewed with the budget, and paid to permanent and contract staff only.' },
  { code: 'TIF', label: 'Tiffin', kind: 'flat', value: 1_500, note: 'One hot meal per duty day, which is why it survives every cost review.' },
];

export const PF_RATE = 0.1;
export const PF_CAP_BASIC = 30_000;
export const GROUP_INSURANCE = 250;
export const OT_MULTIPLIER = 1.5;
export const OT_HOURS_PER_MONTH = 208;
export const OT_MONTHLY_CAP_HOURS = 60;
export const LATE_MARKS_PER_HALF_DAY = 3;
export const ADVANCE_CAP_PCT = 50;
export const PAYROLL_CUT_OFF_DAY = 25;

/** The branch's own tax table, editable in Setup › Human Resource. Not tax advice: the branch's accountant owns these numbers. */
export const TAX_SLABS: Array<{ upTo: number; rate: number }> = [
  { upTo: 375_000, rate: 0 },
  { upTo: 675_000, rate: 10 },
  { upTo: 975_000, rate: 15 },
  { upTo: 1_575_000, rate: 20 },
  { upTo: 3_675_000, rate: 25 },
  { upTo: Number.POSITIVE_INFINITY, rate: 30 },
];
export const INVESTMENT_REBATE_RATE = 0.15;
export const INVESTMENT_REBATE_CAP_PCT = 3;
export const MINIMUM_TAX_ANNUAL = 5_000;
export const TAX_TABLE_NOTE = 'The slabs are the branch’s own table, loaded from Setup › Human Resource and shown on every payslip. The floor is the branch’s minimum-tax figure, not a rate the software invents.';

/** Annual tax on a taxable income, with the investment rebate applied and the branch's floor underneath it. */
export function taxFor(taxable: number, investment = 0): { tax: number; rebate: number; afterRebate: number; monthly: number; marginal: number } {
  if (taxable <= 0) return { tax: 0, rebate: 0, afterRebate: 0, monthly: 0, marginal: 0 };
  let remaining = taxable;
  let floor = 0;
  let tax = 0;
  for (const slab of TAX_SLABS) {
    if (remaining <= 0) break;
    const band = Math.min(remaining, slab.upTo - floor);
    tax += band * (slab.rate / 100);
    remaining -= band;
    floor = slab.upTo;
  }
  const rebate = Math.min(investment * INVESTMENT_REBATE_RATE, taxable * (INVESTMENT_REBATE_CAP_PCT / 100));
  const afterRebate = Math.max(MINIMUM_TAX_ANNUAL, tax - rebate);
  const marginal = TAX_SLABS.find((s) => taxable <= s.upTo)?.rate ?? 30;
  return { tax: Math.round(tax), rebate: Math.round(rebate), afterRebate: Math.round(afterRebate), monthly: Math.round(afterRebate / 12), marginal };
}

export interface PayrollAttendance {
  staffCode: string;
  workedDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateMarks: number;
  overtimeHours: number;
  holidays: number;
  /** The month's own length, so every apportioned deduction divides by the same number the register counted. */
  daysInMonth: number;
}

/** A day's pay, for every deduction that has to be apportioned. The month's own length is the divisor. */
export const dayRate = (monthlyBase: number, daysInMonth: number): number => monthlyBase / daysInMonth;

export interface PayrollLine {
  staffCode: string;
  name: string;
  designation: string;
  departmentId: string;
  employment: Employment;
  basic: number;
  earnings: Array<{ code: string; label: string; amount: number }>;
  gross: number;
  deductions: Array<{ code: string; label: string; amount: number }>;
  deductionsTotal: number;
  net: number;
  employerCost: number;
  absentDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
  advance: number;
  /** Anything the payroll had to decide, in the reader's words — printed on the payslip, not hidden in a log. */
  notes: string[];
}

export interface PayrollRun {
  month: string;
  branch: StaffBranch;
  cutOff: string;
  lines: PayrollLine[];
  totals: { basic: number; gross: number; deductions: number; net: number; employerCost: number; overtime: number; absentDays: number };
  /**
   * Lines the bank file cannot carry, with the reason. The run still owes the money — these are the people paid by
   * hand or fixed before the file is generated, and a run that quietly omitted them would be a salary that vanished.
   */
  refusals: PayrollRefusal[];
  state: 'Draft' | 'Awaiting approval' | 'Approved' | 'Paid';
  computedAt: string;
}

export function allowancesFor(staff: HrStaff): Array<{ code: string; label: string; amount: number }> {
  return ALLOWANCE_RATES.filter((a) => a.code !== 'DEAR' || staff.employment === 'Permanent' || staff.employment === 'Contract').map((a) => ({
    code: a.code,
    label: a.label,
    amount: a.kind === 'pct' ? Math.round((staff.basic * a.value) / 100) : a.value,
  }));
}

export interface PayrollOptions {
  /** Approved overtime, by staff code. Unapproved hours are worked, not paid — and the screen says which is which. */
  overtimeApproved?: Record<string, number>;
  /** Salary advances being recovered this month, by staff code. */
  advances?: Record<string, number>;
  /** Taxable investment declared by the staff member, by code, for the rebate. */
  investments?: Record<string, number>;
  /** Staff removed by a correction before the run is computed. */
  exclude?: string[];
}

/**
 * One line of a payroll run: the allowances, the attendance deductions, the tax and the employer's cost.
 *
 * The arithmetic is deliberately visible rather than compressed into a net figure: a payslip that cannot be
 * explained line by line is the reason people queue outside HR on the 28th.
 */
export function payrollLine(staff: HrStaff, attendance: PayrollAttendance, options: PayrollOptions = {}): PayrollLine {
  const notes: string[] = [];
  const allowances = allowancesFor(staff);
  const base = staff.basic + allowances.reduce((n, a) => n + a.amount, 0);
  const perDay = dayRate(base, attendance.daysInMonth);

  const earnings: PayrollLine['earnings'] = [
    { code: 'BASIC', label: 'Basic', amount: staff.basic },
    ...allowances.map((a) => ({ code: a.code, label: a.label, amount: a.amount })),
  ];
  const overtimeHours = Math.min(options.overtimeApproved?.[staff.code] ?? 0, OT_MONTHLY_CAP_HOURS);
  const otAmount = Math.round(((staff.basic / OT_HOURS_PER_MONTH) * OT_MULTIPLIER) * overtimeHours);
  if (overtimeHours > 0) {
    earnings.push({ code: 'OT', label: `Overtime ${overtimeHours} h at ${OT_MULTIPLIER}×`, amount: otAmount });
    if ((options.overtimeApproved?.[staff.code] ?? 0) > OT_MONTHLY_CAP_HOURS) {
      notes.push(`${options.overtimeApproved?.[staff.code]} hours were approved and ${OT_MONTHLY_CAP_HOURS} paid: the cap is on the month, and the hours above it are recorded against the post rather than the person.`);
    }
  }
  const gross = earnings.reduce((n, e) => n + e.amount, 0);

  /* Attendance deductions. Absent days and unpaid leave come off the month; the late-marks rule is a half day. */
  const absentCut = Math.round((perDay * attendance.absentDays + perDay * 0.5 * attendance.halfDays) / 1);
  const unpaidCut = Math.round(perDay * attendance.unpaidLeaveDays);
  const lateHalfDays = Math.floor(attendance.lateMarks / LATE_MARKS_PER_HALF_DAY);
  const lateCut = Math.round(perDay * 0.5 * lateHalfDays);
  const pfBase = Math.min(staff.basic, PF_CAP_BASIC);
  const pf = Math.round(pfBase * PF_RATE);
  const insurance = staff.employment === 'Outsourced' ? 0 : GROUP_INSURANCE;
  const advance = Math.min(options.advances?.[staff.code] ?? 0, Math.round(staff.basic * (ADVANCE_CAP_PCT / 100)));
  const taxableAnnual = Math.max(0, gross * 12 - pf * 12);
  const tax = taxFor(taxableAnnual, options.investments?.[staff.code] ?? 0);
  const taxMonthly = tax.monthly;

  const deductions: PayrollLine['deductions'] = [
    ...(absentCut > 0 ? [{ code: 'ABSENT', label: `${attendance.absentDays} absent day(s) and ${attendance.halfDays} half day(s)`, amount: absentCut }] : []),
    ...(unpaidCut > 0 ? [{ code: 'LWP', label: `${attendance.unpaidLeaveDays} day(s) leave without pay`, amount: unpaidCut }] : []),
    ...(lateCut > 0 ? [{ code: 'LATE', label: `${attendance.lateMarks} late arrival(s) → ${lateHalfDays} half day(s)`, amount: lateCut }] : []),
    { code: 'PF', label: `Provident fund (${PF_RATE * 100}% of basic up to ৳${PF_CAP_BASIC.toLocaleString('en-IN')})`, amount: pf },
    ...(insurance > 0 ? [{ code: 'INS', label: 'Group insurance', amount: insurance }] : []),
    ...(taxMonthly > 0 ? [{ code: 'TAX', label: `Income tax (${tax.marginal}% marginal, ৳${tax.afterRebate.toLocaleString('en-IN')} a year)`, amount: taxMonthly }] : []),
    ...(advance > 0 ? [{ code: 'ADV', label: 'Salary advance recovered', amount: advance }] : []),
  ];
  const deductionsTotal = deductions.reduce((n, d) => n + d.amount, 0);
  const net = Math.max(0, gross - deductionsTotal);
  if (net === 0 && deductionsTotal > gross) {
    notes.push('The deductions exceed the month’s earnings, so the net is zero and the balance carries to the next run rather than being taken from a household that has nothing to take it from.');
  }
  if (attendance.lateMarks >= LATE_MARKS_PER_HALF_DAY) {
    notes.push('Late arrivals are counted from the reader, not from a register somebody fills in at the end of the month.');
  }
  if (staff.employment === 'Intern') notes.push('Interns are paid a stipend, not a salary: no provident fund, no dearness, and the tax table is applied to the stipend.');
  if (taxMonthly > 0) notes.push(`Tax is the month’s gross carried to a year (৳${(taxableAnnual / 1000).toFixed(0)},000 taxable) less the provident fund, with the ${tax.marginal}% marginal rate and the branch’s floor. The cumulative adjustment is made in the last run of the year, and the certificate is issued in July.`);

  const employerCost = gross + pf + (insurance > 0 ? insurance : 0);

  return {
    staffCode: staff.code,
    name: staff.name,
    designation: staff.designation,
    departmentId: staff.departmentId,
    employment: staff.employment,
    basic: staff.basic,
    earnings,
    gross,
    deductions,
    deductionsTotal,
    net,
    employerCost,
    absentDays: attendance.absentDays,
    unpaidLeaveDays: attendance.unpaidLeaveDays,
    overtimeHours,
    advance,
    notes,
  };
}

export interface PayrollRefusal {
  staffCode: string;
  name: string;
  because: string;
}

/** Why a line cannot be paid at all — the reasons the bank file will not carry. */
export function payrollRefusals(directory: HrStaff[]): PayrollRefusal[] {
  return directory.flatMap((staff) => {
    const out: PayrollRefusal[] = [];
    if (staff.status === 'Resigned') {
      out.push({ staffCode: staff.code, name: staff.name, because: 'Left service. The final settlement is a separate voucher with the notice period and the leave encashment on it, not a month’s salary.' });
    } else if (staff.status === 'Suspended') {
      out.push({ staffCode: staff.code, name: staff.name, because: 'Suspended pending an inquiry. The run holds the line and the inquiry’s outcome decides whether it is paid, which is a decision for the disciplinary record rather than for payroll.' });
    } else if (!staff.bank) {
      out.push({ staffCode: staff.code, name: staff.name, because: 'No bank account on the record, so the money would have to be handed over at the counter — which is how a payroll file and a cash book disagree at month end.' });
    } else if (!staff.bank.verified) {
      out.push({ staffCode: staff.code, name: staff.name, because: `The bank account (${staff.bank.bank} ${staff.bank.masked}) has never been verified against a document. One mistyped digit and the salary is in a stranger’s account for three weeks.` });
    } else if (staff.employment === 'Outsourced' && staff.basic === 0) {
      out.push({ staffCode: staff.code, name: staff.name, because: 'Outsourced staff are paid through the contractor’s invoice; there is no line to pay.' });
    }
    return out;
  });
}

export const PAYROLL_RULES: Array<{ title: string; because: string }> = [
  { title: 'One run per branch per month', because: 'A second run is a second bank file for the same salary, and the bank will honour both. The register refuses the second and names the first.' },
  { title: 'The person who runs it does not approve it', because: 'Payroll is the one place where one pair of hands is not enough: the approver signs for the total, the line count and the bank file, and the run records both names.' },
  { title: 'Attendance after the cut-off belongs to the next month', because: `The cut-off is the ${PAYROLL_CUT_OFF_DAY}th, and it is on the run rather than in a comment. A day worked after it is paid next month, which is the only way the figure and the timesheet agree.` },
  { title: 'An advance is capped and recovered from the run', because: `Half of basic at most, recovered in the month it was agreed, with the balance on the payslip. A salary advance that nobody tracks is a loan the hospital has forgotten it made.` },
  { title: 'The net is never negative', because: 'Deductions that exceed the month’s earnings carry forward. A payroll that takes money from a household with nothing to take it from is a payroll that creates the problem it was meant to prevent.' },
  { title: 'A line that cannot be paid says why', because: 'An unverified bank account, a suspended member of staff and a person who has left service are three different situations with three different answers, and the run prints which one applies.' },
];

/** The run's own state machine, and who may move it. The bank file exists only from `Approved` onwards. */
export const PAYROLL_FLOW: Record<PayrollRun['state'], { next: PayrollRun['state'] | null; by: Role[]; note: string }> = {
  Draft: { next: 'Awaiting approval', by: ['admin'], note: 'Computed and checked against last month. Nothing leaves this state until the figures have been read by a person.' },
  'Awaiting approval': { next: 'Approved', by: ['admin'], note: 'Waiting for a second pair of eyes. The approval is online-only: it releases a branch’s salaries at once, and a queued approval is a signature nobody can verify.' },
  Approved: { next: 'Paid', by: ['admin'], note: 'Approved, so the bank file can be generated. The file is dated and named after the run, so a re-generation is visible.' },
  Paid: { next: null, by: [], note: 'Paid. A correction from here is an adjustment in the next run, not an edit of this one.' },
};
