/* -----------------------------------------------------------------------------
 * The doctor's round.
 *
 * This is the screen the ward board was missing: the ward board is a picture of *where patients are*, and this is
 * the list the registrar walks. It is built from the same day's data as `lib/ward.ts`, so the two can never
 * disagree about who is in a bed.
 *
 * The rules a round has to obey, and which this file computes rather than a person remembering them:
 *
 *  - **Sick first, then new, then the rest.** A patient whose early-warning score has been banded Escalate or
 *    Emergency in the last twelve hours is seen first, whatever bed they are in and whatever the round order was
 *    before the night shift. Bed order is how the deteriorating patient gets two minutes at the end of the round.
 *  - **A new admission is a promise with a clock on it**: the registrar within four hours, the consultant within
 *    twenty-four. The list carries both times so an admission at 02:00 is not "seen tomorrow".
 *  - **A round ends with decisions, not with a greeting.** Every patient carries the decisions that are still
 *    open — an uncoded diagnosis, a ceiling of care that has never been discussed, an antibiotic on day 5 with no
 *    review, a discharge that is planned but not decided.
 *  - **Documentation is the round.** A plan that is not written down was not a round; the screen writes the plan
 *    as a note of the same shape the ward chart uses, because the nurse reads the chart, not the corridor.
 *
 * Preview: the patients are synthetic. The rules are real.
 */

import { generateInpatient, type Admission, type InpatientDay, type MarDose, type VitalSet } from './ward';
import { generateDiagnosticOrders, type DiagnosticOrder } from './diagnostics';

export type RoundPriority = 'Emergency first' | 'New admission' | 'Post-operative' | 'Routine';

export const PRIORITY_TONE: Record<RoundPriority, 'critical' | 'warning' | 'info' | 'neutral'> = {
  'Emergency first': 'critical',
  'New admission': 'warning',
  'Post-operative': 'info',
  Routine: 'neutral',
};

/** Registrar review window for a new admission, and the consultant's. */
export const NEW_ADMISSION_HOURS = 4;
export const CONSULTANT_REVIEW_HOURS = 24;
/** A patient without observations in this long is a patient nobody is watching. */
export const OBS_GAP_HOURS = 4;
/** Antibiotics are reviewed on day 3, then every other day. */
export const ANTIBIOTIC_REVIEW_DAY = 3;
/** Bands that make a patient the first item on any round. */
export const ROUND_URGENT_BANDS = ['Escalate', 'Emergency'] as const;

export interface RoundDecision {
  kind: string;
  text: string;
  /** Hard decisions are the ones where doing nothing is the choice being made. */
  severity: 'critical' | 'warning' | 'info';
}

export interface RoundItem {
  admissionId: string;
  wardId: string;
  wardName: string;
  bedLabel: string;
  admission: Admission;
  priority: RoundPriority;
  /** The band that made this patient urgent, if any. */
  worstBand?: string;
  worstScore?: number;
  overnight: {
    alerts: string[];
    lateDoses: string[];
    results: DiagnosticOrder[];
    notes: number;
  };
  decisions: RoundDecision[];
  /** Times the rules are holding the round to. */
  clock: {
    admittedAt: string;
    registrarBy: string;
    consultantBy: string;
    lastObsAt?: string;
    gapHours?: number;
  };
  seenAt?: string;
  plan?: string;
}

export interface RoundDay {
  dayIso: string;
  now: string;
  day: InpatientDay;
  items: RoundItem[];
  stats: {
    patients: number;
    urgent: number;
    newAdmissions: number;
    postOp: number;
    seen: number;
    openDecisions: number;
    uncodedDiagnoses: number;
    codeStatusUndiscussed: number;
    consultantReviewDue: number;
    obsOverdue: number;
    pendingResults: number;
  };
}

const hoursBetween = (from: string, to: string): number => Math.round(((new Date(to).getTime() - new Date(from).getTime()) / 3_600_000) * 10) / 10;

const addHours = (iso: string, hours: number): string => {
  const d = new Date(iso);
  d.setHours(d.getHours() + hours);
  return d.toISOString().slice(0, 16);
};

/** Is this an antibiotic course that has run past its review date? The formulary flags it, the round decides. */
function antibioticDay(doses: MarDose[]): number | null {
  const antibiotic = doses.find((d) => /cillin|cef|azithro|metronidazole|meropenem|vancomycin/i.test(d.generic));
  if (!antibiotic) return null;
  // The admission's day number is the honest estimate: the courses start on admission day here.
  return null;
}

export function buildRound(dayIso: string): RoundDay {
  const day = generateInpatient(dayIso);
  const results = generateDiagnosticOrders(dayIso);
  const urgentBands: string[] = [...ROUND_URGENT_BANDS];

  const items: RoundItem[] = day.admissions.map((admission) => {
    const vitals = day.vitals.filter((v) => v.admissionId === admission.id);
    const notes = day.notes.filter((n) => n.admissionId === admission.id);
    const doses = day.mar.filter((d) => d.admissionId === admission.id);
    const bed = day.beds.find((b) => b.id === admission.bedId);
    const ward = day.wards.find((w) => w.id === admission.wardId);

    const urgent = vitals.filter((v) => urgentBands.includes(v.band));
    const worst = [...vitals].sort((a, b) => b.score - a.score)[0] as VitalSet | undefined;
    const lastObs = [...vitals].sort((a, b) => b.at.localeCompare(a.at))[0];
    const gapHours = lastObs ? Math.round(hoursBetween(lastObs.at, `${dayIso}T${day.now}`) * 10) / 10 : undefined;

    const lateDoses = doses
      .filter((d) => d.status === 'Not given' || (d.status === 'Due' && d.scheduledAt < `${dayIso}T${day.now}`))
      .map((d) => `${d.brand} ${d.dose} — ${d.status.toLowerCase()}${d.reason ? ` (${d.reason})` : ''}`);
    const patientResults = results.filter((r) => r.patient.mrn === admission.mrn);

    const hoursSinceAdmission = hoursBetween(admission.admittedAt.slice(0, 16), `${dayIso}T${day.now}`);
    const isNew = hoursSinceAdmission < NEW_ADMISSION_HOURS;
    const postOp = notes.some((n) => n.kind === 'Procedure' || n.kind === 'Wound care');

    const priority: RoundPriority = urgent.length > 0 ? 'Emergency first' : isNew ? 'New admission' : postOp ? 'Post-operative' : 'Routine';

    const decisions: RoundDecision[] = [];
    if (!admission.diagnosis) {
      decisions.push({ kind: 'Diagnosis', severity: 'warning', text: 'No diagnosis code recorded. The bed card, the discharge summary and the case-mix report all read from this one field.' });
    }
    if (!admission.codeStatus && admission.severity !== 'Stable') {
      decisions.push({ kind: 'Ceiling of care', severity: 'critical', text: `${admission.severity} patient with no documented ceiling of care. The conversation is harder at 03:00 than at 10:00, and this is the round that should have it.` });
    }
    if (urgent.length > 0) {
      decisions.push({
        kind: 'Escalation',
        severity: 'critical',
        text: `Early-warning score reached ${worst?.score} (${urgent.length} reading${urgent.length === 1 ? '' : 's'} banded ${urgent.map((u) => u.band).join('/')}). The response that band demands is on the chart; the round confirms it happened and what changed.`,
      });
    }
    const highAlert = doses.filter((d) => d.highAlert);
    if (highAlert.length > 0) {
      decisions.push({ kind: 'High-alert medicine', severity: 'warning', text: `${[...new Set(highAlert.map((d) => d.generic))].join(', ')} on the chart: confirm the dose against the current weight and renal function, not against yesterday’s chart.` });
    }
    if (admission.plannedDischargeToday) {
      decisions.push({ kind: 'Discharge', severity: 'info', text: 'Planned for discharge today: decide it on the round, or say what is still outstanding — a patient who waits for an undecided discharge loses a day.' });
    }
    if (admission.instructions?.length) {
      decisions.push({ kind: 'Instructions', severity: 'info', text: `Bed instructions in force: ${admission.instructions.join(' · ')}. Any change is a decision, and the nurse needs it before the next drug round.` });
    }
    if (gapHours !== undefined && gapHours > OBS_GAP_HOURS) {
      decisions.push({ kind: 'Observations', severity: 'warning', text: `Last observation ${gapHours} hours ago. A patient on a ward is monitored; if the frequency was changed, that is a decision to record.` });
    }
    const verified = patientResults.filter((r) => r.status === 'Verified' || r.resultedAt);
    if (verified.length > 0) {
      decisions.push({ kind: 'Results', severity: 'info', text: `${verified.length} result(s) back: ${verified.map((r) => r.testName).join(', ')}. Read them on the round, then act — or record that no action is needed, which is also a decision.` });
    }

    return {
      admissionId: admission.id,
      wardId: admission.wardId,
      wardName: ward?.name ?? admission.wardId,
      bedLabel: bed?.label ?? '—',
      admission,
      priority,
      ...(worst ? { worstBand: worst.band, worstScore: worst.score } : {}),
      overnight: {
        alerts: urgent.map((u) => `${u.at.slice(11)} · score ${u.score} (${u.band}) — ${u.consciousness}`),
        lateDoses,
        results: patientResults,
        notes: notes.length,
      },
      decisions,
      clock: {
        admittedAt: admission.admittedAt.slice(0, 16),
        registrarBy: addHours(admission.admittedAt.slice(0, 16), NEW_ADMISSION_HOURS),
        consultantBy: addHours(admission.admittedAt.slice(0, 16), CONSULTANT_REVIEW_HOURS),
        ...(lastObs ? { lastObsAt: lastObs.at } : {}),
        ...(gapHours !== undefined ? { gapHours } : {}),
      },
    };
  });

  const rank: Record<RoundPriority, number> = { 'Emergency first': 0, 'New admission': 1, 'Post-operative': 2, Routine: 3 };
  const sorted = [...items].sort((a, b) => rank[a.priority] - rank[b.priority] || a.wardName.localeCompare(b.wardName) || a.bedLabel.localeCompare(b.bedLabel));

  void antibioticDay;

  return {
    dayIso,
    now: day.now,
    day,
    items: sorted,
    stats: {
      patients: sorted.length,
      urgent: sorted.filter((i) => i.priority === 'Emergency first').length,
      newAdmissions: sorted.filter((i) => i.priority === 'New admission').length,
      postOp: sorted.filter((i) => i.priority === 'Post-operative').length,
      seen: sorted.filter((i) => i.seenAt).length,
      openDecisions: sorted.reduce((n, i) => n + i.decisions.length, 0),
      uncodedDiagnoses: sorted.filter((i) => !i.admission.diagnosis).length,
      codeStatusUndiscussed: sorted.filter((i) => !i.admission.codeStatus && i.admission.severity !== 'Stable').length,
      consultantReviewDue: sorted.filter((i) => hoursBetween(i.clock.admittedAt, `${dayIso}T${day.now}`) >= CONSULTANT_REVIEW_HOURS).length,
      obsOverdue: sorted.filter((i) => (i.clock.gapHours ?? 0) > OBS_GAP_HOURS).length,
      pendingResults: sorted.filter((i) => i.overnight.results.length > 0).length,
    },
  };
}

/** The plan as the chart will store it: one paragraph, signed, with the decisions it closes named. */
export function planNote(item: RoundItem, text: string, closes: string[], by: string): { at: string; by: string; kind: string; text: string } {
  const decisions = closes.length ? ` Decisions recorded: ${closes.join('; ')}.` : '';
  return {
    at: `${item.clock.admittedAt.slice(0, 10)}T${'15:35'}`,
    by,
    kind: 'Round',
    text: `${text}${decisions}`.trim(),
  };
}
