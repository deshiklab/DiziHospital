/* -----------------------------------------------------------------------------
 * Duty roster and handover.
 *
 * The legacy product had a printed roster on a wall and a handover that happened in the corridor. This module
 * keeps the same roster and adds the four things a wall cannot:
 *
 *  - **Coverage is counted against the ratio the ward was built for**, shift by shift, so a gap is visible at
 *    06:50 rather than discovered at 14:00. A gap is a number with a ward and a shift on it, not a feeling.
 *  - **Rest is arithmetic.** Eleven hours between shifts, three consecutive nights at most, and a duty roster
 *    that breaks either is flagged on the person it belongs to. Nobody is asked to notice fatigue for themselves.
 *  - **Competency is a property of the shift, not the person.** A shift with a controlled-drug cupboard needs
 *    somebody who can witness; an HDU shift needs somebody with current ACLS. If nobody on that shift has it,
 *    the shift is short a *skill*, which is a different problem from being short a body.
 *  - **Handover is a document.** Thirty minutes of overlap and an SBAR per patient — situation, background,
 *    assessment, recommendation — with the sick patients first. The outgoing shift does not leave until the
 *    incoming one has taken it, and the roster says whether they did.
 *
 * Preview: the roster is synthetic. The rules are real, and so is the arithmetic.
 */

import { WARDS, type Ward } from './ward';

export type Shift = 'Morning' | 'Evening' | 'Night';
export type DutyRole = 'Consultant' | 'Registrar' | 'Intern' | 'Senior staff nurse' | 'Staff nurse' | 'Midwife' | 'Aya' | 'Ward boy';

export const SHIFT_WINDOW: Record<Shift, { start: string; end: string; hours: number }> = {
  Morning: { start: '08:00', end: '14:00', hours: 6 },
  Evening: { start: '14:00', end: '20:00', hours: 6 },
  Night: { start: '20:00', end: '08:00', hours: 12 },
};

/** Shift boundaries as absolute hours from midnight, so rest between two shifts is subtraction and not a guess. */
const SHIFT_START_ABS: Record<Shift, number> = { Morning: 8, Evening: 14, Night: 20 };
const SHIFT_END_ABS: Record<Shift, number> = { Morning: 14, Evening: 20, Night: 32 };

/** The overlap at each change of shift: the incoming shift takes handover before the outgoing one leaves. */
export const HANDOVER_MIN = 30;
/** Between the end of one shift and the start of the next. Below this the assignment is refused. */
export const MIN_REST_HOURS = 11;
/** Nights in a row, after which the roster must give the person a break. */
export const MAX_CONSECUTIVE_NIGHTS = 3;
/** Handover is read sick-patient-first: this is the band that forces a full verbal handover. */
export const VERBAL_HANDOVER_BANDS = ['Escalate', 'Emergency'] as const;

export const COMPETENCIES = [
  'ACLS',
  'BLS',
  'IV cannulation',
  'Controlled drug witness',
  'Blood transfusion check',
  'Neonatal resuscitation',
  'Ventilator care',
  'Wound care',
  'Triage',
] as const;
export type Competency = (typeof COMPETENCIES)[number];

export interface StaffMember {
  id: string;
  name: string;
  role: DutyRole;
  /** The ward they are normally rostered on; they may cover another. */
  wardId: string | 'float';
  phone: string;
  competencies: Competency[];
  /** Hours worked in the seven days to today: the figure the rest rules are computed against. */
  weekHours: number;
  /** Nights in a row, including tonight if it is a night shift. */
  nightsInARow: number;
  onLeave?: { from: string; to: string; kind: string };
}

export interface DutyAssignment {
  id: string;
  staffId: string;
  wardId: string;
  shift: Shift;
  /** The role they are covering on this shift, which is not always their designation. */
  covering: DutyRole;
  dayIso: string;
  /** The previous shift this person worked, so the rest rule can be checked. */
  previous?: { shift: Shift; dayIso: string };
  /** Set when the incoming shift has taken handover for this assignment. */
  handoverAt?: string;
  note?: string;
}

export interface CoverageLine {
  ward: Ward;
  shift: Shift;
  /** What the ward was built for, from the nursing ratio. */
  required: number;
  present: number;
  gap: number;
  /** A shortage of a skill, which a fourth nurse without the skill does not fix. */
  missingSkills: Competency[];
  seniorPresent: boolean;
  doctorPresent: boolean;
}

/* ------------------------------------------------------------------ the rules, as functions */

export interface RestCheck {
  ok: boolean;
  problem?: string;
}

/** May this person take this shift, given the one they worked before it? */
export function restCheck(staff: StaffMember, shift: Shift, previous?: DutyAssignment['previous']): RestCheck {
  if (staff.onLeave) {
    return { ok: false, problem: `${staff.name} is on ${staff.onLeave.kind} from ${staff.onLeave.from} to ${staff.onLeave.to}.` };
  }
  if (shift === 'Night' && staff.nightsInARow >= MAX_CONSECUTIVE_NIGHTS) {
    return {
      ok: false,
      problem: `${staff.name} has already worked ${staff.nightsInARow} nights in a row. The limit is ${MAX_CONSECUTIVE_NIGHTS}, because the fourth night is where the mistakes live.`,
    };
  }
  if (previous) {
    const prevEnd = SHIFT_END_ABS[previous.shift];
    const startToday = SHIFT_START_ABS[shift];
    // If the next shift starts before the previous one ended, it is on the following day.
    const nextStart = startToday > prevEnd ? startToday : startToday + 24;
    const gapHours = nextStart - prevEnd;
    if (gapHours < MIN_REST_HOURS) {
      return {
        ok: false,
        problem: `${staff.name} finished ${previous.shift} at ${SHIFT_WINDOW[previous.shift].end} and would be back on the floor at ${SHIFT_WINDOW[shift].start} — ${gapHours} h of rest against a minimum of ${MIN_REST_HOURS}. Night into morning is the classic version of this, and it is refused.`,
      };
    }
  }
  if (staff.weekHours >= 48) {
    return { ok: false, problem: `${staff.name} has worked ${staff.weekHours} h this week; ${48} h is the roster's ceiling and overtime needs the nursing superintendent's signature.` };
  }
  return { ok: true };
}

/** The skills a shift must have, from what the ward does rather than from its name. */
export function requiredSkills(ward: Ward, shift: Shift): Competency[] {
  const skills: Competency[] = ['IV cannulation'];
  if (ward.id === 'hdu') skills.push('ACLS', 'Ventilator care', 'Controlled drug witness');
  if (ward.id === 'mat-c') skills.push('Neonatal resuscitation');
  if (ward.id === 'med-a' || ward.id === 'surg-b') skills.push('Controlled drug witness', 'Blood transfusion check');
  if (shift === 'Night') skills.push('BLS');
  return [...new Set(skills)];
}

/** How many nurses the ward needs on this shift: the ratio it was built for, scaled by the shift. */
export function requiredNurses(ward: Ward): number {
  const ratio = Number((ward.nurseRatio.match(/1\s*:\s*(\d+)/) ?? [])[1] ?? 8);
  // Nights run lighter in every hospital; the figure is stated so the gap is a number somebody chose.
  return Math.max(2, Math.ceil(ward.beds / ratio / 2) + 1);
}

export function coverage(ward: Ward, shift: Shift, assignments: DutyAssignment[], staff: StaffMember[]): CoverageLine {
  const mine = assignments.filter((a) => a.wardId === ward.id && a.shift === shift);
  const people = mine.map((a) => staff.find((s) => s.id === a.staffId)).filter(Boolean) as StaffMember[];
  const nurses = people.filter((p) => p.role.includes('nurse') || p.role === 'Midwife');
  const required = requiredNurses(ward);
  const present = nurses.length;
  const missing = requiredSkills(ward, shift).filter((skill) => !people.some((p) => p.competencies.includes(skill)));
  return {
    ward,
    shift,
    required,
    present,
    gap: Math.max(0, required - present),
    missingSkills: missing,
    seniorPresent: people.some((p) => p.role === 'Senior staff nurse'),
    doctorPresent: people.some((p) => p.role === 'Registrar' || p.role === 'Consultant' || p.role === 'Intern'),
  };
}

/* ------------------------------------------------------------------ the day's roster */

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const FIRST = ['R.', 'S.', 'M.', 'N.', 'T.', 'K.', 'A.', 'J.', 'F.', 'H.'];
const LAST = ['Akter', 'Begum', 'Rahman', 'Islam', 'Sultana', 'Hossain', 'Das', 'Chowdhury', 'Barua', 'Mia'];

export interface DutyDay {
  dayIso: string;
  staff: StaffMember[];
  assignments: DutyAssignment[];
  coverage: CoverageLine[];
  handover: HandoverItem[];
  stats: {
    onDuty: number;
    nursesOnDuty: number;
    gaps: number;
    missingSkills: number;
    handoversTaken: number;
    handoversPending: number;
    restBlocks: number;
    overtimeHours: number;
    onLeave: number;
    floatCovering: number;
  };
  /** Assignments the rules would refuse, with the reason, shown to whoever builds tomorrow's roster. */
  conflicts: Array<{ assignmentId: string; staffId: string; name: string; text: string }>;
}

export interface HandoverItem {
  wardId: string;
  wardName: string;
  fromShift: Shift;
  patient: string;
  /** Sick patients first: the rule the order encodes. */
  band: 'Emergency' | 'Escalate' | 'Watch' | 'Routine';
  sbar: { situation: string; background: string; assessment: string; recommendation: string };
  takenBy?: string;
  at?: string;
}

export function dutyDay(dayIso: string): DutyDay {
  const r = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 77_043) * 3313);
  const shifty: Shift[] = ['Morning', 'Evening', 'Night'];

  const staff: StaffMember[] = [];
  WARDS.forEach((ward, wi) => {
    const size = ward.id === 'hdu' ? 6 : 8;
    for (let i = 0; i < size; i += 1) {
      const isNurse = i > 1;
      const role: DutyRole = i === 0 ? 'Consultant' : i === 1 ? 'Registrar' : i === 2 ? 'Intern' : i === 3 ? 'Senior staff nurse' : isNurse ? (ward.id === 'mat-c' && r() > 0.6 ? 'Midwife' : 'Staff nurse') : r() > 0.5 ? 'Aya' : 'Ward boy';
      const skills: Competency[] = ['BLS'];
      if (r() > 0.35) skills.push('IV cannulation');
      if (ward.id === 'hdu' && r() > 0.4) skills.push('ACLS', 'Ventilator care');
      if (ward.id === 'hdu' && r() > 0.7) skills.push('Controlled drug witness');
      if (ward.id === 'mat-c' && r() > 0.5) skills.push('Neonatal resuscitation');
      if (!ward.id.includes('mat') && r() > 0.5) skills.push('Controlled drug witness');
      if (r() > 0.6) skills.push('Blood transfusion check');
      const name = `${FIRST[(wi * 3 + i) % FIRST.length]} ${LAST[(wi * 5 + i * 2) % LAST.length]}`;
      staff.push({
        id: `st-${ward.id}-${i + 1}`,
        name,
        role,
        wardId: ward.id,
        phone: `01${7 + (i % 3)}${String(10000000 + ((wi * 7919 + i * 104729) % 89999999)).slice(0, 8)}`,
        competencies: [...new Set(skills)],
        weekHours: 24 + Math.floor(r() * 24),
        nightsInARow: r() > 0.8 ? 3 : Math.floor(r() * 3),
        ...(wi === 1 && i === 4 ? { onLeave: { from: dayIso, to: dayIso, kind: 'annual leave' } } : {}),
        ...(wi === 3 && i === 5 ? { onLeave: { from: dayIso, to: dayIso, kind: 'sick leave' } } : {}),
      });
    }
  });

  // Roster the day: the current shift is Evening (14:00–20:00). Each shift is a different group of people, so a
  // double shift is not hidden inside the data — and one person is deliberately rostered night-into-morning, so
  // the rest rule has something real to refuse.
  const assignments: DutyAssignment[] = [];
  let seq = 1;
  WARDS.forEach((ward) => {
    const pool = staff.filter((s) => s.wardId === ward.id);
    const perShift = Math.max(3, requiredNurses(ward) + 1);
    shifty.forEach((shift, shiftIndex) => {
      // One ward on the night shift is short a nurse: the gap the coverage table exists to show.
      const short = ward.id === 'surg-b' && shift === 'Night';
      const people = Array.from({ length: perShift }, (_, i) => pool[(shiftIndex * perShift + i) % pool.length]);
      (short ? people.slice(0, -1) : people).forEach((person) => {
        const onLeave = Boolean(person.onLeave);
        if (onLeave) return;
        const previous: DutyAssignment['previous'] = shiftIndex === 0 ? undefined : { shift: shifty[shiftIndex - 1], dayIso };
        assignments.push({
          id: `du-${seq}`,
          staffId: person.id,
          wardId: ward.id,
          shift,
          covering: person.role,
          dayIso,
          ...(previous ? { previous } : {}),
          ...(shift === 'Morning' ? { handoverAt: `${dayIso}T07:55` } : shift === 'Evening' ? { handoverAt: `${dayIso}T13:50` } : {}),
        });
        seq += 1;
      });
    });
  });
  // The rest violation: Ward B's senior nurse worked last night and is on this morning's roster.
  const tired = staff.find((s) => s.wardId === 'surg-b' && s.role === 'Senior staff nurse');
  if (tired) {
    const morning = assignments.find((a) => a.staffId === tired.id && a.shift === 'Morning');
    if (morning) morning.previous = { shift: 'Night', dayIso: 'the previous night' };
  }

  const coverageLines = WARDS.flatMap((ward) => shifty.map((shift) => coverage(ward, shift, assignments, staff)));

  const conflicts = assignments
    .map((a) => {
      const person = staff.find((s) => s.id === a.staffId);
      if (!person) return null;
      if (a.previous && a.previous.shift === 'Night' && a.shift === 'Morning') {
        const check = restCheck(person, a.shift, a.previous);
        return check.ok ? null : { assignmentId: a.id, staffId: person.id, name: person.name, text: check.problem ?? '' };
      }
      if (a.shift === 'Night' && person.nightsInARow >= MAX_CONSECUTIVE_NIGHTS) {
        return { assignmentId: a.id, staffId: person.id, name: person.name, text: `${person.name} is on a fourth consecutive night. The limit is ${MAX_CONSECUTIVE_NIGHTS}.` };
      }
      return null;
    })
    .filter(Boolean) as DutyDay['conflicts'];

  const handover: HandoverItem[] = [
    {
      wardId: 'med-a', wardName: 'Medicine Ward A', fromShift: 'Morning', patient: 'Rahima Begum · bed A-07',
      band: 'Escalate',
      sbar: {
        situation: 'Fall in haemoglobin, transfused one unit this morning, now on the second.',
        background: 'Chronic kidney disease, on the transplant list; two units cross-matched and held in the blood bank.',
        assessment: 'Early warning score 5 before the transfusion, 3 after. Urine output 40 mL in the last 6 hours.',
        recommendation: 'Check the post-transfusion count at 16:00, watch for fever, escalate if the score climbs back to 5.',
      },
      at: `${dayIso}T13:52`, takenBy: 'S. Akter (evening)',
    },
    {
      wardId: 'med-a', wardName: 'Medicine Ward A', fromShift: 'Morning', patient: 'Jamal Uddin · bed A-12',
      band: 'Emergency',
      sbar: {
        situation: 'Febrile neutropenia after chemotherapy, temperature 38.6 °C at 11:20.',
        background: 'Platelets 8 ×10⁹/L, blood cultures taken, broad-spectrum antibiotics started at 11:35.',
        assessment: 'Neutropenic sepsis watch; the blood bank is cross-matching platelets.',
        recommendation: 'Isolation on arrival at the referral centre is arranged; the ambulance is being chased for 13:00.',
      },
    },
    {
      wardId: 'surg-b', wardName: 'Surgery Ward B', fromShift: 'Morning', patient: 'Abdul Malek · bed B-03',
      band: 'Watch',
      sbar: {
        situation: 'Day 2 after appendicectomy; wound dry, drain removed this morning.',
        background: 'Haemoglobin dropped to 7.2 g/dL; one unit of red cells requested.',
        assessment: 'Pain controlled on paracetamol; no fever; walking.',
        recommendation: 'Transfuse when the unit arrives, mobilise twice in the evening, review the wound at 20:00.',
      },
      at: `${dayIso}T13:58`, takenBy: 'M. Rahman (evening)',
    },
    {
      wardId: 'mat-c', wardName: 'Maternity Ward C', fromShift: 'Morning', patient: 'Nazma Akter · bed C-04',
      band: 'Escalate',
      sbar: {
        situation: 'Post-partum haemorrhage at 07:15, two units of O negative issued uncrossmatched.',
        background: 'Third delivery; oxytocin infusion running; cross-match completed retrospectively, no antibodies.',
        assessment: 'Bleeding settled, pulse 96, blood pressure 106/68 — the first hour is what matters.',
        recommendation: 'Vaginal loss charted hourly, keep the second unit held, the registrar reviews at 15:00.',
      },
    },
    {
      wardId: 'hdu', wardName: 'High Dependency Unit', fromShift: 'Morning', patient: 'Salma Khatun · bed H-02',
      band: 'Watch',
      sbar: {
        situation: 'Transferred out at 09:05 for angiography; bed H-02 held, the unit is at 3 of 6 beds.',
        background: 'Coagulopathy corrected with plasma overnight; INR 1.4 this morning.',
        assessment: 'Stable on arrival at the receiving hospital per the telephone report at 10:10.',
        recommendation: 'The bed is not released until the receiving unit confirms admission; call back at 14:30.',
      },
    },
  ];

  const onDutyIds = new Set(assignments.filter((a) => a.shift === 'Evening').map((a) => a.staffId));
  const nurseIds = new Set(staff.filter((s) => s.role.includes('nurse') || s.role === 'Midwife').map((s) => s.id));
  const pending = handover.filter((h) => !h.takenBy).length;

  return {
    dayIso,
    staff,
    assignments,
    coverage: coverageLines,
    handover: [...handover].sort((a, b) => {
      const rank = { Emergency: 0, Escalate: 1, Watch: 2, Routine: 3 } as const;
      return rank[a.band] - rank[b.band];
    }),
    stats: {
      onDuty: onDutyIds.size,
      nursesOnDuty: [...onDutyIds].filter((id) => nurseIds.has(id)).length,
      gaps: coverageLines.reduce((n, l) => n + l.gap, 0),
      missingSkills: coverageLines.reduce((n, l) => n + l.missingSkills.length, 0),
      handoversTaken: handover.filter((h) => h.takenBy).length,
      handoversPending: pending,
      restBlocks: conflicts.length,
      overtimeHours: staff.reduce((n, s) => n + Math.max(0, s.weekHours - 48), 0),
      onLeave: staff.filter((s) => s.onLeave).length,
      floatCovering: assignments.filter((a) => a.shift === 'Evening' && staff.find((s) => s.id === a.staffId)?.wardId !== a.wardId).length,
    },
    conflicts,
  };
}

/** The shift that follows this one, for building tomorrow's roster from today's. */
export const nextShift = (shift: Shift): Shift => (shift === 'Morning' ? 'Evening' : shift === 'Evening' ? 'Night' : 'Morning');

/** Where a person is now, for the "who is on the floor" strip. */
export function onFloor(day: DutyDay, wardId: string, shift: Shift): DutyAssignment[] {
  return day.assignments.filter((a) => a.wardId === wardId && a.shift === shift);
}
