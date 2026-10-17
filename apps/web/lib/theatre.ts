/* -----------------------------------------------------------------------------
 * Operating theatre.
 *
 * A theatre list is a promise made to several people at once: the patient who has stopped eating, the surgeon,
 * the anaesthetist and the next patient behind them. The rules in this file are the ones a theatre in-charge
 * would keep on a clipboard, written down:
 *
 *  - **No case starts without the three safety gates closed**: identity and procedure confirmed with the patient,
 *    the site marked by the person operating, and the anaesthetic assessment done. Consent is a document, and
 *    "verbal consent" is not one.
 *  - **The WHO checklist has three moments** — sign in before anaesthesia, time out before the incision, sign out
 *    before the patient leaves the room — and the case record carries who read each one aloud.
 *  - **Counts come before closure.** Swabs, instruments and needles are counted before the wound is closed, and a
 *    discrepancy is not a note in the margin: it stops the closure until it is resolved.
 *  - **Turn-around is a clinical interval, not a gap.** Cleaning plus instrument preparation, and the next patient
 *    goes in only when it is finished.
 *  - **An emergency inserted into the list bumps a case**, and the bumped case is recorded with the reason. The
 *    theatre that silently slips is the theatre where somebody waits all day without breakfast.
 *
 * Preview: the list is synthetic. The rules are real.
 */

export const addMinutes = (iso: string, minutes: number): string => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 16);
};

export type Anaesthesia = 'General' | 'Spinal' | 'Regional block' | 'Local + sedation' | 'Local';
export type CaseState = 'Scheduled' | 'In theatre' | 'In recovery' | 'Completed' | 'Cancelled' | 'Bumped';
export type Urgency = 'Elective' | 'Urgent' | 'Emergency';

export interface Theatre {
  id: string;
  code: string;
  name: string;
  specialties: string[];
  /** Minutes of cleaning and preparation between two cases. */
  turnaroundMin: number;
  equipment: string[];
  state: 'In use' | 'Available' | 'Cleaning' | 'Out of service';
  note?: string;
}

export interface SurgicalCase {
  id: string;
  theatreId: string;
  /** The list number the patient was told, and the number the family watches. */
  listNo: number;
  patientMrn: string;
  patientName: string;
  age: number;
  procedure: string;
  side?: 'Left' | 'Right' | 'Midline';
  surgeon: string;
  assistant?: string;
  anaesthetist: string;
  anaesthesia: Anaesthesia;
  urgency: Urgency;
  scheduledStart: string;
  expectedMin: number;
  state: CaseState;
  /** The three gates, in the order a theatre actually closes them. */
  gates: {
    consentVerifiedAt?: string;
    consentBy?: string;
    siteMarked?: boolean;
    siteMarkedBy?: string;
    anaestheticReviewAt?: string;
    npoSince?: string;
    investigationsReviewed?: boolean;
    bloodReserved?: string;
  };
  /** WHO surgical safety checklist. One entry per stage, with who read it aloud. */
  checklist: {
    signIn?: { at: string; by: string; confirmed: string[] };
    timeOut?: { at: string; by: string; confirmed: string[] };
    signOut?: { at: string; by: string; confirmed: string[] };
  };
  counts?: { swabs: number; instruments: number; needles: number; correct: boolean; checkedBy: string; at: string; resolution?: string };
  implants?: Array<{ item: string; lot: string; expiry: string }>;
  specimen?: { label: string; destination: string; loggedAt?: string };
  actualStart?: string;
  actualEnd?: string;
  outOfTheatreAt?: string;
  recovery?: RecoveryRecord;
  cancelled?: { reason: string; at: string; by: string; rebookedTo?: string };
  bumped?: { by: string; reason: string; at: string };
  note?: string;
}

export interface RecoveryRecord {
  inAt: string;
  /** Aldrete-style score 0–10: activity, breathing, circulation, consciousness, oxygen saturation. */
  score: number;
  observations: Array<{ at: string; score: number; systolic: number; pulse: number; spo2: number; pain: number; note?: string }>;
  outAt?: string;
  toWard?: string;
  nausea: boolean;
  shivering: boolean;
}

/** Minutes between cases: cleaning, linen, and the instrument set for the next one. */
export const TURNAROUND_FLOOR_MIN = 15;
/** A recovering patient is not sent to the ward below this Aldrete-style score. */
export const RECOVERY_DISCHARGE_SCORE = 9;
/** Observations in recovery: every 15 minutes until the discharge score is reached. */
export const RECOVERY_OBS_MIN = 15;
/** Fasting before anaesthesia: 6 hours for solids, 2 for clear fluids. */
export const NPO_SOLID_HOURS = 6;
export const NPO_CLEAR_HOURS = 2;

export const GATE_CHECKLIST = {
  signIn: ['Identity, procedure and consent confirmed with the patient', 'Site marked by the person doing the operation', 'Anaesthetic assessment and allergies checked', 'Airway risk and equipment assessed', 'Blood loss risk and access planned'],
  timeOut: ['Team introduced: surgeon, anaesthetist, nurses', 'Patient, procedure and site confirmed aloud', 'Antibiotic prophylaxis given within the last hour', 'Imaging and results displayed', 'Sterile field and instrument set confirmed'],
  signOut: ['Procedure recorded by name', 'Counts of swabs, instruments and needles confirmed', 'Specimen labelled with the patient’s name and destination', 'Equipment problems recorded', 'Recovery and ward plan handed over'],
};

export const CANCELLATION_REASONS = [
  'Patient not fit — new fever or a rising early-warning score',
  'Consent not signed by the patient or the guardian',
  'Anaesthetic review not completed',
  'Fasting instructions not followed',
  'No ICU or HDU bed for the post-operative plan',
  'Blood not available for a procedure that may need it',
  'Instrument set not sterile or incomplete',
  'Patient did not attend',
  'Surgeon called to an emergency elsewhere',
  'Theatre time lost to a previous case over-running',
];

/* ------------------------------------------------------------------ the rules, as functions */

export interface Readiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  /** The gate that is still open, so the list can show it without reading the whole record. */
  nextGate: 'consent' | 'site' | 'anaesthesia' | 'checklist' | 'counts' | 'ready';
}

export function readiness(c: SurgicalCase, dayIso: string): Readiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (c.state === 'Cancelled' || c.state === 'Bumped') {
    return { ready: false, blockers: [c.cancelled?.reason ?? c.bumped?.reason ?? 'Not on the list'], warnings, nextGate: 'ready' };
  }
  if (!c.gates.consentVerifiedAt) blockers.push('Consent is not recorded. A signed consent is a document; a conversation in the corridor is not one, however clearly it was understood.');
  if (!c.gates.siteMarked) blockers.push('The site is not marked. For a left-or-right procedure the mark is made by the person doing the operation, with the patient awake and agreeing.');
  if (!c.gates.anaestheticReviewAt) blockers.push('The anaesthetist has not reviewed the patient. Nobody is anaesthetised on the basis of a form.');
  if (!c.gates.investigationsReviewed) warnings.push('Investigations not marked as reviewed — check the last haemoglobin, coagulation and cross-match.');
  if (c.gates.npoSince) {
    const hours = (new Date(`${dayIso}T${c.scheduledStart.split('T')[1] ?? '08:00'}`).getTime() - new Date(c.gates.npoSince).getTime()) / 3_600_000;
    if (hours > 0 && hours < NPO_SOLID_HOURS) {
      blockers.push(`The patient has been fasting since ${c.gates.npoSince.slice(11)} — ${hours.toFixed(1)} h, and ${NPO_SOLID_HOURS} h is the minimum for solids. Anaesthetising a full stomach is how aspiration happens.`);
    }
  } else {
    warnings.push('Fasting time not recorded.');
  }
  if (c.urgency === 'Emergency') warnings.push('An emergency: the gates are closed in the anaesthetic room, with the pre-operative checks done there rather than at the desk.');
  if (c.gates.bloodReserved) warnings.push(`Blood: ${c.gates.bloodReserved}.`);

  const nextGate: Readiness['nextGate'] = !c.gates.consentVerifiedAt
    ? 'consent'
    : !c.gates.siteMarked
      ? 'site'
      : !c.gates.anaestheticReviewAt
        ? 'anaesthesia'
        : !c.checklist.signIn
          ? 'checklist'
          : !c.counts
            ? 'counts'
            : 'ready';

  return { ready: blockers.length === 0, blockers, warnings, nextGate };
}

/** Counts must be right before the wound is closed. A discrepancy stops the closure. */
export function countVerdict(c: SurgicalCase, counts: { swabs: number; instruments: number; needles: number }, expected: { swabs: number; instruments: number; needles: number }): { ok: boolean; text: string } {
  const wrong: string[] = [];
  if (counts.swabs !== expected.swabs) wrong.push(`swabs ${counts.swabs} against ${expected.swabs}`);
  if (counts.instruments !== expected.instruments) wrong.push(`instruments ${counts.instruments} against ${expected.instruments}`);
  if (counts.needles !== expected.needles) wrong.push(`needles ${counts.needles} against ${expected.needles}`);
  if (wrong.length === 0) {
    return { ok: true, text: `Counts agree: ${counts.swabs} swabs, ${counts.instruments} instruments, ${counts.needles} needles. The wound may be closed.` };
  }
  return {
    ok: false,
    text: `Do not close: ${wrong.join('; ')}. A count that does not agree is resolved inside the theatre — a retained swab or a lost needle is not something a note fixes later. The resolution is recorded with the name of the person who found the discrepancy.`,
  };
}

/** Can this theatre take this case now: it must be free, with its turn-around finished. */
export function theatreAvailable(t: Theatre, cases: SurgicalCase[]): { ok: boolean; until?: string; because: string } {
  if (t.state === 'Out of service') return { ok: false, because: t.note ?? 'Out of service.' };
  const live = cases.filter((c) => c.theatreId === t.id && (c.state === 'In theatre' || c.state === 'In recovery'));
  if (live.length === 0) return { ok: true, because: `${t.code} is free.` };
  const current = live.find((c) => c.state === 'In theatre') ?? live[0];
  const finish = current.actualEnd ?? nextStartOf(current);
  const free = addMinutes(finish, t.turnaroundMin);
  return {
    ok: false,
    until: free,
    because: `${t.code} is finishing ${current.listNo}. ${current.patientName} (${current.procedure}); the room is free at ${free.slice(11)} after ${t.turnaroundMin} minutes of turn-around.`,
  };
}

const nextStartOf = (c: SurgicalCase): string => addMinutes(c.actualStart ?? c.scheduledStart, c.expectedMin);

/** Recovery: obs every 15 minutes, and the ward only when the score is there. */
export function recoveryVerdict(r: RecoveryRecord | undefined): { ok: boolean; text: string } {
  if (!r) return { ok: false, text: 'The patient is still in theatre.' };
  if (r.outAt) return { ok: true, text: `Left recovery at ${r.outAt.slice(11)} for ${r.toWard}.` };
  const last = r.observations.at(-1);
  if (!last) return { ok: false, text: 'No observations recorded in recovery — nobody goes to the ward on the strength of the anaesthetic wearing off.' };
  if (last.score >= RECOVERY_DISCHARGE_SCORE) {
    return { ok: true, text: `Score ${last.score} of 10 at ${last.at.slice(11)}: awake, breathing, stable blood pressure, oxygen saturation held. Fit for the ward with the anaesthetist’s agreement.` };
  }
  return {
    ok: false,
    text: `Score ${last.score} of 10 at ${last.at.slice(11)} — under ${RECOVERY_DISCHARGE_SCORE} the patient stays. Observations every ${RECOVERY_OBS_MIN} minutes until the score is there.`,
  };
}

export interface TheatreDay {
  dayIso: string;
  theatres: Theatre[];
  cases: SurgicalCase[];
  stats: {
    listed: number;
    completed: number;
    inTheatre: number;
    inRecovery: number;
    cancelled: number;
    bumped: number;
    emergencies: number;
    utilisationPct: number;
    averageTurnaroundMin: number;
    onTimeStarts: number;
    lateStarts: number;
    listOverrunMin: number;
    lastCaseEndsAt: string;
    cancellationsReasons: Array<{ caseId: string; reason: string }>;
  };
}

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const SURGEONS = ['Prof. A. Haque', 'Dr S. Islam', 'Dr N. Sultana', 'Dr T. Chowdhury', 'Dr R. Begum'];
const ANAESTHETISTS = ['Dr K. Mia', 'Dr F. Rahman', 'Dr J. Begum'];

export function theatreDay(dayIso: string): TheatreDay {
  const r = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 60_011) * 2711);

  const theatres: Theatre[] = [
    { id: 'ot-1', code: 'OT-1', name: 'Operating theatre 1 — major', specialties: ['General surgery', 'Gastrointestinal'], turnaroundMin: 20, equipment: ['Laparoscopy tower', 'Anaesthesia machine 1', 'Cautery', 'Cell saver'], state: 'In use' },
    { id: 'ot-2', code: 'OT-2', name: 'Operating theatre 2 — major', specialties: ['Orthopaedics'], turnaroundMin: 20, equipment: ['C-arm image intensifier', 'Anaesthesia machine 2', 'Power tools'], state: 'Available' },
    { id: 'ot-3', code: 'OT-3', name: 'Operating theatre 3 — minor', specialties: ['Minor procedures', 'Dressing', 'Endoscopy'], turnaroundMin: 12, equipment: ['Procedure table', 'Diathermy', 'Endoscopy stack'], state: 'Available' },
    { id: 'ot-4', code: 'OT-4', name: 'Obstetric theatre', specialties: ['Obstetrics', 'Caesarean'], turnaroundMin: 15, equipment: ['Neonatal resuscitaire', 'Warmer', 'Anaesthesia machine 3'], state: 'Cleaning', note: 'Cleaning after an emergency caesarean at 10:40; free at 11:25' },
  ];

  const mk = (o: Partial<SurgicalCase> & Pick<SurgicalCase, 'id' | 'theatreId' | 'listNo' | 'patientMrn' | 'patientName' | 'age' | 'procedure' | 'surgeon' | 'scheduledStart' | 'expectedMin' | 'state'>): SurgicalCase => ({
    anaesthetist: ANAESTHETISTS[Math.floor(r() * ANAESTHETISTS.length)],
    anaesthesia: 'General',
    urgency: 'Elective',
    gates: { consentVerifiedAt: `${dayIso}T07:30`, consentBy: o.patientName, siteMarked: true, siteMarkedBy: o.surgeon, anaestheticReviewAt: `${dayIso}T07:45`, npoSince: `${dayIso}T00:01`, investigationsReviewed: true },
    checklist: {},
    ...o,
  });

  const cases: SurgicalCase[] = [
    mk({
      id: 'OT-2681', theatreId: 'ot-1', listNo: 1, patientMrn: 'SH-104088', patientName: 'Abdul Malek', age: 47, procedure: 'Laparoscopic cholecystectomy', side: 'Right', surgeon: SURGEONS[0], scheduledStart: `${dayIso}T08:00`, expectedMin: 90, state: 'Completed',
      actualStart: `${dayIso}T08:05`, actualEnd: `${dayIso}T09:28`, outOfTheatreAt: `${dayIso}T09:32`,
      checklist: {
        signIn: { at: `${dayIso}T07:56`, by: 'Staff nurse R. Akter', confirmed: GATE_CHECKLIST.signIn.slice(0, 3) },
        timeOut: { at: `${dayIso}T08:03`, by: 'Dr S. Islam (surgeon)', confirmed: GATE_CHECKLIST.timeOut },
        signOut: { at: `${dayIso}T09:27`, by: 'Dr S. Islam (surgeon)', confirmed: GATE_CHECKLIST.signOut },
      },
      counts: { swabs: 10, instruments: 42, needles: 6, correct: true, checkedBy: 'Staff nurse R. Akter', at: `${dayIso}T09:25` },
      specimen: { label: 'Gallbladder, histopathology', destination: 'Pathology — routine', loggedAt: `${dayIso}T09:30` },
      recovery: {
        inAt: `${dayIso}T09:32`, score: 8, nausea: true, shivering: false,
        observations: [
          { at: `${dayIso}T09:32`, score: 8, systolic: 118, pulse: 88, spo2: 97, pain: 3, note: 'Nausea treated with ondansetron' },
          { at: `${dayIso}T09:47`, score: 9, systolic: 122, pulse: 82, spo2: 98, pain: 2 },
          { at: `${dayIso}T10:05`, score: 10, systolic: 120, pulse: 78, spo2: 98, pain: 2, note: 'Drinking sips; ready for the ward' },
        ],
        outAt: `${dayIso}T10:20`, toWard: 'Surgery Ward B · bed B-03',
      },
      note: 'Started five minutes late: the instrument set arrived from the steriliser at 07:58.',
    }),
    mk({
      id: 'OT-2682', theatreId: 'ot-4', listNo: 1, patientMrn: 'SH-101177', patientName: 'Nazma Akter', age: 29, procedure: 'Emergency lower segment caesarean section', surgeon: SURGEONS[3], scheduledStart: `${dayIso}T10:40`, expectedMin: 55, state: 'In recovery', urgency: 'Emergency', anaesthesia: 'Spinal',
      gates: { consentVerifiedAt: `${dayIso}T10:18`, consentBy: 'Husband, witnessed by staff nurse', siteMarked: true, siteMarkedBy: SURGEONS[3], anaestheticReviewAt: `${dayIso}T10:22`, npoSince: undefined, investigationsReviewed: true, bloodReserved: '2 units O negative issued, 1 transfused' },
      checklist: {
        signIn: { at: `${dayIso}T10:33`, by: 'Staff nurse T. Begum', confirmed: GATE_CHECKLIST.signIn.slice(0, 4) },
        timeOut: { at: `${dayIso}T10:41`, by: 'Dr R. Begum (surgeon)', confirmed: GATE_CHECKLIST.timeOut },
      },
      actualStart: `${dayIso}T10:41`, actualEnd: `${dayIso}T11:18`, outOfTheatreAt: `${dayIso}T11:22`,
      recovery: {
        inAt: `${dayIso}T11:22`, score: 7, nausea: false, shivering: true,
        observations: [
          { at: `${dayIso}T11:22`, score: 7, systolic: 104, pulse: 96, spo2: 97, pain: 4, note: 'Warm air blanket for shivering; oxytocin infusion running' },
          { at: `${dayIso}T11:37`, score: 8, systolic: 106, pulse: 92, spo2: 98, pain: 3 },
        ],
      },
      note: 'Baby to the newborn corner; both stable. Blood bank informed a second unit may be needed.',
    }),
    mk({
      id: 'OT-2683', theatreId: 'ot-1', listNo: 2, patientMrn: 'SH-103455', patientName: 'Jamal Uddin', age: 54, procedure: 'Incision and drainage of perianal abscess', side: 'Midline', surgeon: SURGEONS[1], scheduledStart: `${dayIso}T10:10`, expectedMin: 45, state: 'Bumped',
      bumped: { by: 'OT-2682', reason: 'Emergency caesarean took the theatre; the abscess case was moved to 14:30', at: `${dayIso}T10:05` },
      note: 'The patient is febrile and neutropenic; the surgeon has been told and the antibiotics continued.',
    }),
    mk({
      id: 'OT-2684', theatreId: 'ot-2', listNo: 1, patientMrn: 'SH-102345', patientName: 'Rokeya Sultana', age: 61, procedure: 'Total knee replacement — right', side: 'Right', surgeon: SURGEONS[2], scheduledStart: `${dayIso}T09:00`, expectedMin: 150, state: 'Cancelled', anaesthesia: 'Spinal',
      gates: { consentVerifiedAt: `${dayIso}T08:30`, consentBy: 'Patient', siteMarked: false, anaestheticReviewAt: `${dayIso}T08:45`, npoSince: `${dayIso}T00:30`, investigationsReviewed: true },
      cancelled: { reason: 'Blood not available for a procedure that may need it — cross-match pending on a positive antibody screen', at: `${dayIso}T08:50`, by: 'Theatre in-charge', rebookedTo: '2026-10-18' },
      note: 'The site was never marked because the case was cancelled first; the patient is told and rebooked, with the reason given to her rather than a phone call that never comes.',
    }),
    mk({
      id: 'OT-2685', theatreId: 'ot-3', listNo: 1, patientMrn: 'SH-101902', patientName: 'Habib Mia', age: 38, procedure: 'Upper GI endoscopy with biopsy', surgeon: SURGEONS[4], scheduledStart: `${dayIso}T11:30`, expectedMin: 30, state: 'Scheduled', anaesthesia: 'Local + sedation',
      gates: { consentVerifiedAt: `${dayIso}T11:00`, consentBy: 'Patient', siteMarked: true, siteMarkedBy: SURGEONS[4], anaestheticReviewAt: `${dayIso}T11:05`, npoSince: `${dayIso}T05:00`, investigationsReviewed: true },
    }),
    mk({
      id: 'OT-2686', theatreId: 'ot-3', listNo: 2, patientMrn: 'SH-100745', patientName: 'Shirin Aktar', age: 44, procedure: 'Excision of a lipoma — left forearm', side: 'Left', surgeon: SURGEONS[1], scheduledStart: `${dayIso}T12:30`, expectedMin: 40, state: 'Scheduled',
      gates: { consentVerifiedAt: `${dayIso}T12:00`, consentBy: 'Patient', siteMarked: false, anaestheticReviewAt: undefined, npoSince: `${dayIso}T06:00`, investigationsReviewed: true },
      note: 'Consent signed but the site is unmarked and the anaesthetist has not seen her yet — the two gates this screen refuses the case on.',
    }),
    mk({
      id: 'OT-2687', theatreId: 'ot-2', listNo: 2, patientMrn: 'SH-104512', patientName: 'Mizanur Rahman', age: 33, procedure: 'Open reduction and internal fixation — right radius', side: 'Right', surgeon: SURGEONS[0], scheduledStart: `${dayIso}T12:15`, expectedMin: 120, state: 'Scheduled', urgency: 'Urgent',
      gates: { consentVerifiedAt: `${dayIso}T11:40`, consentBy: 'Patient', siteMarked: true, siteMarkedBy: SURGEONS[0], anaestheticReviewAt: `${dayIso}T11:45`, npoSince: `${dayIso}T02:00`, investigationsReviewed: true, bloodReserved: 'Group and save only — no cross-match needed' },
      implants: [{ item: 'Distal radius plate 3.5 mm', lot: 'LOT-88421', expiry: '2029-04-30' }],
    }),
  ];

  const scheduledEnd = cases
    .filter((c) => c.state !== 'Cancelled' && c.state !== 'Bumped')
    .map((c) => addMinutes(c.actualStart ?? c.scheduledStart, c.expectedMin + 30))
    .sort()
    .at(-1) ?? `${dayIso}T13:00`;

  const inTheatre = cases.filter((c) => c.state === 'In theatre').length;
  const inRecovery = cases.filter((c) => c.state === 'In recovery').length;
  const completed = cases.filter((c) => c.state === 'Completed').length;
  const onTime = cases.filter((c) => c.actualStart && Math.abs(new Date(c.actualStart).getTime() - new Date(c.scheduledStart).getTime()) <= 10 * 60_000).length;
  const late = cases.filter((c) => c.actualStart && new Date(c.actualStart).getTime() - new Date(c.scheduledStart).getTime() > 10 * 60_000).length;

  return {
    dayIso,
    theatres,
    cases,
    stats: {
      listed: cases.length,
      completed,
      inTheatre,
      inRecovery,
      cancelled: cases.filter((c) => c.state === 'Cancelled').length,
      bumped: cases.filter((c) => c.state === 'Bumped').length,
      emergencies: cases.filter((c) => c.urgency === 'Emergency').length,
      utilisationPct: Math.round(((cases.reduce((n, c) => n + c.expectedMin, 0) + theatres.length * 20) / (4 * 6 * 60)) * 100),
      averageTurnaroundMin: 18,
      onTimeStarts: onTime,
      lateStarts: late,
      listOverrunMin: Math.max(0, Math.round((new Date(scheduledEnd).getTime() - new Date(`${dayIso}T14:00`).getTime()) / 60_000)),
      lastCaseEndsAt: scheduledEnd,
      cancellationsReasons: cases.filter((c) => c.cancelled).map((c) => ({ caseId: c.id, reason: c.cancelled?.reason ?? '' })),
    },
  };
}

export const caseById = (day: TheatreDay, id: string): SurgicalCase | undefined => day.cases.find((c) => c.id === id);
export const theatreById = (day: TheatreDay, id: string): Theatre | undefined => day.theatres.find((t) => t.id === id);
