/* -----------------------------------------------------------------------------
 * After discharge, and the OPD queue.
 *
 * Two registers that the legacy product kept in different places and neither of them closed the loop:
 *
 *  **Discharged patients.** A patient leaving a bed is not finished being a patient. This file keeps the register
 *  the discharge desk actually needs and encodes the rules that stop a discharge from being an exit:
 *   - a discharge is not complete without a typed summary, and the summary is a document — diagnosis, course,
 *     treatment, condition on discharge and advice in Bangla;
 *   - the medicines the patient goes home with are checked against what was actually dispensed, because "the
 *     family will buy it" is how an antibiotic course stops on day two;
 *   - results that were pending at discharge are followed to the patient, not to the bed: a haemoglobin culture
 *     that grows something after the patient has gone home is a phone call somebody has to make;
 *   - a follow-up date is a promise with a date on it, and a surgical patient is called if they do not come back;
 *   - money owed at discharge is recorded, because a ward bill that follows a patient out of the building is a
 *     debt nobody in the accounts office can reconstruct a month later;
 *   - a readmission inside thirty days is flagged against the discharge that preceded it, which is the single
 *     most useful number a discharge register produces.
 *
 *  **The OPD queue.** The queue is a clock, not a list. A token is called; the time between check-in and the
 *  consultation is measured; a patient who is not there when their token is called is skipped, not held, and the
 *  skip is recorded so the next token is not delayed by a corridor. Priorities are explicit — an emergency walk-in
 *  goes to the duty doctor rather than to the front of the OPD queue, because putting a chest pain in front of
 *  twenty people waiting for a prescription is not triage, it is triage by queue position.
 *
 * Preview: both registers are synthetic and derived from the same generators the ward and appointments screens
 * use, so the three can never disagree. Nothing survives a reload; the rules do.
 */

import { DOCTORS, generateAppointments, todayIso, type Appointment } from './appointments';
import { generateInpatient, type DischargeRecord, type InpatientDay } from './ward';
import { TESTS } from './diagnostics';

export const today = todayIso;

/* ================================================================ discharged patients */

export type FollowUpState = 'Booked' | 'Due today' | 'Overdue' | 'Not needed' | 'Not booked';

export interface DischargedPatient {
  record: DischargeRecord;
  /** The day the patient left, as a date only, for the register filters. */
  day: string;
  /** What the summary is missing, if anything. Empty means the document is done. */
  summaryGaps: string[];
  /** Results that were not verified before the patient left — somebody has to ring them. */
  pendingResults: Array<{ testName: string; dueAt: string; recall: string }>;
  /** Everything still owed at discharge and what has been settled since. */
  dues: { amount: number; settledAt?: string; note?: string };
  followUp: { state: FollowUpState; on?: string; department: string; note: string };
  /** Set when the patient was readmitted inside the window, with the day count. */
  readmittedInDays?: number;
  /** Take-home medicines: written, dispensed, and the difference. */
  medicines: Array<{ name: string; written: number; dispensed: number }>;
  flags: Array<{ kind: 'critical' | 'warning' | 'info'; text: string }>;
}

/** Results chased after discharge: this is the window in which a growing culture is still worth a phone call. */
export const PENDING_RESULT_FOLLOW_UP_HOURS = 48;
/** A readmission inside this window is counted against the discharge that preceded it. */
export const READMISSION_WINDOW_DAYS = 30;
/** Follow-up that should happen, by discharge type. */
export const FOLLOW_UP_DEFAULT_DAYS: Record<string, number> = {
  Recovered: 7,
  'Improved, follow-up in OPD': 7,
  'Referred to a higher centre': 0,
  'Discharged on request': 3,
  'Left against medical advice': 3,
  'Transferred to another branch': 0,
  Died: 0,
};
/** A patient who leaves against advice is called: the risk is not the paperwork, it is what happens at home. */
export const CALL_AGAIN_TYPES = ['Left against medical advice', 'Discharged on request'] as const;

export function overdueBy(iso: string | undefined, dayIso: string): number {
  if (!iso) return 0;
  return Math.round((new Date(`${dayIso}T00:00:00Z`).getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
}

export function buildAftercare(dayIso: string): {
  discharged: DischargedPatient[];
  day: InpatientDay;
  stats: {
    today: number;
    thisWeek: number;
    summariesIncomplete: number;
    pendingResults: number;
    recallsToMake: number;
    followUpOverdue: number;
    followUpsNotBooked: number;
    readmitted30: number;
    duesOutstanding: number;
    duesPatients: number;
    againstAdvice: number;
    averageStayDays: number;
  };
} {
  const day = generateInpatient(dayIso);
  const discharged: DischargedPatient[] = day.discharges.map((record, index) => {
    const summaryGaps: string[] = [];
    if (!record.summary.course?.trim()) summaryGaps.push('the course in hospital');
    if (!record.summary.treatment?.trim()) summaryGaps.push('the treatment given');
    if (!record.summary.condition?.trim()) summaryGaps.push('the condition on discharge');
    if (!record.summary.adviceBn?.trim()) summaryGaps.push('advice in Bangla for the family');
    if (!record.diagnosis?.code) summaryGaps.push('a coded diagnosis');

    const pendingResults = index % 3 === 1
      ? [{
          testName: TESTS.find((t) => t.code === 'LAB-BC')?.name ?? 'Blood culture',
          dueAt: `${dayIso}T18:00`,
          recall: 'A positive culture is recalled by telephone, day or night: the result is only useful if it reaches somebody who can act on it.',
        }]
      : [];

    const defaultFollowUpDays = FOLLOW_UP_DEFAULT_DAYS[record.type] ?? 7;
    const followUpOn = defaultFollowUpDays === 0 ? undefined : addDays(record.dischargedAt.slice(0, 10), defaultFollowUpDays);
    const overdue = overdueBy(followUpOn, dayIso);

    const medicines = [
      { name: 'Amoxicillin 500 mg', written: 21, dispensed: index % 2 === 0 ? 21 : 15 },
      { name: 'Paracetamol 500 mg', written: 20, dispensed: 20 },
      { name: 'Omeprazole 20 mg', written: 14, dispensed: index % 3 === 0 ? 0 : 14 },
    ];

    const flags: DischargedPatient['flags'] = [];
    if (summaryGaps.length) flags.push({ kind: 'critical', text: `Summary incomplete: ${summaryGaps.join(', ')}.` });
    if (pendingResults.length) flags.push({ kind: 'warning', text: 'A result was pending at discharge — the patient is rung, not the bed.' });
    if (index === 1) flags.push({ kind: 'warning', text: 'Left against medical advice: the follow-up call is part of the discharge, not a courtesy.' });
    if (medicines.some((m) => m.dispensed < m.written)) flags.push({ kind: 'warning', text: 'Take-home medicines were not fully dispensed: the difference is a course that stops early.' });

    return {
      record,
      day: record.dischargedAt.slice(0, 10),
      summaryGaps,
      pendingResults,
      dues: index === 1 ? { amount: 4850 } : { amount: 0, settledAt: `${record.dischargedAt.slice(0, 10)} 14:10` },
      followUp: {
        state: defaultFollowUpDays === 0 ? 'Not needed' : overdue > 0 ? 'Overdue' : overdue === 0 ? 'Due today' : 'Booked',
        ...(followUpOn ? { on: followUpOn } : {}),
        department: record.consultantName.includes('Surgery') ? 'Surgery OPD' : 'Medicine OPD',
        note: defaultFollowUpDays === 0
          ? 'Referred or transferred: the receiving team owns the follow-up, and the referral letter says so.'
          : `A ${record.type.toLowerCase()} discharge is reviewed in ${defaultFollowUpDays} days — the date is written on the summary, not left to the family to remember.`,
      },
      ...(index === 3 ? { readmittedInDays: 12 } : {}),
      medicines,
      flags,
    };
  });

  // Older discharges: the register is only useful if it has history, so three earlier days are seeded from the
  // same generator rather than invented here.
  const earlier = [3, 6, 9].flatMap((ago) => {
    const past = generateInpatient(addDays(dayIso, -ago));
    return past.discharges.slice(0, 3).map((r, i) => ({
      record: r,
      day: r.dischargedAt.slice(0, 10),
      summaryGaps: i === 1 ? ['advice in Bangla for the family'] : [],
      pendingResults: [],
      dues: i === 0 ? { amount: 1200 } : { amount: 0, settledAt: `${r.dischargedAt.slice(0, 10)} 12:00` },
      followUp: {
        state: (['Booked', 'Overdue', 'Not booked'] as FollowUpState[])[(ago + i) % 3],
        on: addDays(r.dischargedAt.slice(0, 10), 7),
        department: 'Medicine OPD',
        note: 'The date on the summary came from the discharge desk, not from the family’s memory of what the doctor said.',
      },
      ...(ago === 3 && i === 0 ? { readmittedInDays: 9 } : {}),
      medicines: [{ name: 'Amoxicillin 500 mg', written: 21, dispensed: 21 }],
      flags: [] as DischargedPatient['flags'],
    } as DischargedPatient));
  });

  const all = [...discharged, ...earlier];
  const outstanding = all.filter((p) => !p.dues.settledAt && p.dues.amount > 0);

  return {
    discharged: all,
    day,
    stats: {
      today: discharged.length,
      thisWeek: all.filter((p) => overdueBy(p.day, dayIso) <= 7).length,
      summariesIncomplete: all.filter((p) => p.summaryGaps.length > 0).length,
      pendingResults: all.reduce((n, p) => n + p.pendingResults.length, 0),
      recallsToMake: all.filter((p) => p.pendingResults.length > 0).length,
      followUpOverdue: all.filter((p) => p.followUp.state === 'Overdue').length,
      followUpsNotBooked: all.filter((p) => p.followUp.state === 'Not booked').length,
      readmitted30: all.filter((p) => p.readmittedInDays !== undefined).length,
      duesOutstanding: outstanding.reduce((n, p) => n + p.dues.amount, 0),
      duesPatients: outstanding.length,
      againstAdvice: all.filter((p) => (CALL_AGAIN_TYPES as readonly string[]).includes(p.record.type)).length,
      averageStayDays: Math.round((all.reduce((n, p) => n + p.record.stayedDays, 0) / (all.length || 1)) * 10) / 10,
    },
  };
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ================================================================ the OPD queue */

export type QueueStage = 'Checked in' | 'Waiting' | 'Called' | 'In consultation' | 'Skipped' | 'Completed';

export interface QueueEntry {
  appointment: Appointment;
  /** Minutes from midnight, from check-in to consultation: the two numbers the wait is made of. */
  checkedInAt?: number;
  calledAt?: number;
  startedAt?: number;
  completedAt?: number;
  stage: QueueStage;
  /** Set when the token was called and nobody came: the patient waits for the next call, the queue does not. */
  skippedAt?: number;
  /** Reason a walk-in was taken out of the queue and sent to the duty doctor. */
  triaged?: { at: number; reason: string; sentTo: string };
}

/** A patient is not called twice in a row; after this many minutes absent they are put back in the line. */
export const SKIP_REQUEUE_MIN = 15;
/** Consultation time inside which the average is computed — the figure the board shows to the room. */
export const AVERAGE_WINDOW = 8;
/** Priority order for the queue: nothing jumps the line except clinical need. */
export const QUEUE_PRIORITY: Array<{ label: string; because: string }> = [
  { label: 'Emergency walk-in', because: 'Screened at the door and sent to the duty doctor, not to the front of the OPD queue — a chest pain in front of twenty prescriptions is not triage.' },
  { label: 'Booked slot', because: 'The appointment promised a time; the token is called in slot order, not arrival order.' },
  { label: 'Walk-in without a slot', because: 'Seen in the gaps, and told what the likely wait is rather than asked to sit down and find out.' },
  { label: 'Follow-up', because: 'A follow-up within seven days is not charged again and is seen quickly, because the whole point of it is to catch a complication early.' },
];

export interface QueueDay {
  dayIso: string;
  nowMinutes: number;
  entries: QueueEntry[];
  stats: {
    checkedIn: number;
    waiting: number;
    inConsultation: number;
    completed: number;
    skipped: number;
    averageWaitMin: number | null;
    longestWaitMin: number | null;
    averageConsultMin: number | null;
    noShows: number;
    walkIns: number;
    triagedToEmergency: number;
    waitingNow: number;
    /** Tokens still to be called for the doctors who are in the room. */
    pendingTokens: number;
  };
  byRoom: Array<{ doctorId: string; room: string; doctor: string; waiting: number; nowServing?: QueueEntry; nextUp?: QueueEntry; completedCount: number }>;
}

/**
 * The queue as it stands at `now` (default 11:40): some patients are through, some are waiting, one has been
 * called and skipped, and one walk-in was triaged to the emergency department instead of the line.
 */
export function buildQueue(dayIso: string, nowMinutes = 11 * 60 + 40): QueueDay {
  const appointments = generateAppointments(dayIso);
  const entries: QueueEntry[] = appointments.map((a, index) => {
    const checkedInAt = a.start - 25 + ((index * 7) % 20);
    if (a.status === 'Completed' && index % 5 !== 0) {
      return { appointment: a, checkedInAt, calledAt: a.start, startedAt: a.start + 4, completedAt: a.start + 18, stage: 'Completed' as QueueStage };
    }
    if (a.start < nowMinutes - 15) {
      // Called and nobody came: skipped, and the queue moved on. One of them comes back.
      const skipped = index % 4 === 0;
      if (skipped && a.start < nowMinutes - 40) {
        return { appointment: a, checkedInAt, calledAt: a.start, skippedAt: a.start + 2, stage: 'Skipped' as QueueStage };
      }
      return { appointment: a, checkedInAt, calledAt: a.start, startedAt: a.start + 3, stage: 'In consultation' as QueueStage };
    }
    if (a.status === 'Checked in' || a.status === 'Waiting' || checkedInAt <= nowMinutes) {
      const called = a.start <= nowMinutes && a.start > nowMinutes - 10;
      return { appointment: a, checkedInAt, stage: called ? ('Called' as QueueStage) : ('Waiting' as QueueStage), ...(called ? { calledAt: nowMinutes - 2 } : {}) };
    }
    return { appointment: a, stage: 'Checked in' as QueueStage };
  });

  // A walk-in taken out of the queue: the rule the board is proudest of.
  const triagedIndex = entries.findIndex((e) => e.stage === 'Waiting');
  if (triagedIndex >= 0) {
    entries[triagedIndex] = {
      ...entries[triagedIndex],
      stage: 'Skipped',
      triaged: { at: nowMinutes - 12, reason: 'Chest pain on the door: screened, ECG in the emergency room', sentTo: 'Emergency department — duty doctor' },
    };
  }

  const waiting = entries.filter((e) => e.stage === 'Waiting' || e.stage === 'Called');
  const waits = waiting.map((e) => nowMinutes - (e.checkedInAt ?? nowMinutes)).filter((n) => n > 0);
  const consults = entries.filter((e) => e.startedAt && e.completedAt).map((e) => e.completedAt! - e.startedAt!);

  const rooms = [...new Set(entries.map((e) => e.appointment.doctorId))].map((doctorId) => {
    const mine = entries.filter((e) => e.appointment.doctorId === doctorId);
    const doctor = mine[0]?.appointment;
    const doctorRecord = DOCTORS.find((d) => d.id === doctorId);
    const inRoom = mine.find((e) => e.stage === 'In consultation' || e.stage === 'Called');
    const next = mine.filter((e) => e.stage === 'Waiting').sort((a, b) => a.appointment.start - b.appointment.start)[0];
    void doctor;
    return {
      doctorId,
      room: doctorRecord?.room ?? 'OPD',
      doctor: doctorRecord?.name ?? doctorId,
      waiting: mine.filter((e) => e.stage === 'Waiting').length,
      ...(inRoom ? { nowServing: inRoom } : {}),
      ...(next ? { nextUp: next } : {}),
      completedCount: mine.filter((e) => e.stage === 'Completed').length,
    };
  });

  return {
    dayIso,
    nowMinutes,
    entries,
    stats: {
      checkedIn: entries.filter((e) => e.checkedInAt !== undefined).length,
      waiting: entries.filter((e) => e.stage === 'Waiting').length,
      inConsultation: entries.filter((e) => e.stage === 'In consultation' || e.stage === 'Called').length,
      completed: entries.filter((e) => e.stage === 'Completed').length,
      skipped: entries.filter((e) => e.stage === 'Skipped').length,
      averageWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      longestWaitMin: waits.length ? Math.max(...waits) : null,
      averageConsultMin: consults.length ? Math.round(consults.reduce((a, b) => a + b, 0) / consults.length) : null,
      noShows: entries.filter((e) => e.checkedInAt === undefined).length,
      walkIns: entries.filter((e) => e.appointment.source === 'Walk-in').length,
      triagedToEmergency: entries.filter((e) => e.triaged).length,
      waitingNow: waiting.length,
      pendingTokens: entries.filter((e) => e.stage === 'Waiting' || e.stage === 'Called').length,
    },
    byRoom: rooms,
  };
}

/** Called in slot order, with the skipped patient re-queued behind the next token rather than at the front. */
export function nextToken(queue: QueueDay): QueueEntry | undefined {
  return queue.entries
    .filter((e) => e.stage === 'Waiting')
    .sort((a, b) => (a.skippedAt ? 1 : 0) - (b.skippedAt ? 1 : 0) || a.appointment.start - b.appointment.start)[0];
}

/** The room a doctor is in, from the appointments module: a board that invents a room sends patients to the wrong door. */
export const roomFor = (doctorId: string): string => DOCTORS.find((d) => d.id === doctorId)?.room ?? 'OPD';

export const clockLabel = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
