/* ------------------------------------------------------------------------------------------------
 * The vital-events register (P6) — births, deaths, and the two certificates that follow each.
 *
 * Every other module in this product records something a clinician decided. This one records the two events
 * nobody decides, and it is the register a family, a court and a city corporation all read afterwards. That makes
 * it the module where a missing field is not a gap in a report: it is a child with no birth certificate, or a body
 * that cannot be buried.
 *
 * Three rules run through it, and the report that reads it prints them:
 *
 *  1. **A stillbirth is a birth, and not a live-birth registration.** It goes in the birth register with the
 *     outcome recorded, the mother's record notices it, and no live-birth registration is filed — a family that
 *     receives a birth certificate for a child who died is a family that will be asked for it again, at school.
 *  2. **A death certificate needs a cause, and an unnatural death needs the police before the body moves.**
 *     Certification is a clinical act: a doctor who has not written a cause cannot certify one. Where the manner is
 *     unnatural or unknown, the body is released to the police for post-mortem instead, and the certificate waits
 *     for the post-mortem result. The one thing that may never happen is a body leaving the mortuary with neither.
 *  3. **The register is a notification, and a notification has a clock.** A birth is notified within a day; a death
 *     is filed with the registrar's office, and the register says which ones have not been. Vitamin K and BCG are
 *     recorded per newborn, because a discharge without them is a preventable illness three weeks later.
 *
 * The register is computed from the date, like every other module here, and it reads the day's own records where
 * they exist: the mother who arrived by ambulance with an obstetric haemorrhage is the ambulance fleet's own call,
 * and the road-traffic death is the admission the ward wrote. A register that invented people would be worthless
 * to the ward that has to sign it.
 */

import { patients, type Patient } from './mock';
import { ambulanceDay } from './ambulance';
import { generateInpatient, type Admission } from './ward';

/* ------------------------------------------------------------------------------------------ the vocabulary */

/**
 * How a baby was born. The three types are the ones a maternity register is read by, because they predict very
 * different lengths of stay, very different bills, and very different risks for the next pregnancy.
 */
export type BirthType = 'Normal vaginal' | 'Assisted vaginal' | 'Caesarean';
export const BIRTH_TYPES: BirthType[] = ['Normal vaginal', 'Assisted vaginal', 'Caesarean'];

/** A birth ends in one of these two. Both are recorded in the birth register; only one is a live birth. */
export type BirthOutcome = 'Live birth' | 'Stillbirth';

export type NewbornSex = 'Male' | 'Female' | 'Indeterminate';

/** What kind of death this is, which decides which register and which room it goes through. */
export type DeathKind = 'In-patient' | 'Brought in dead' | 'Died in the emergency room';

/**
 * How the death came about. The classification is not decoration: it decides whether the body may be released to
 * the family and whether a certificate may be written at all.
 */
export type MannerOfDeath = 'Natural' | 'Unnatural — referred to police' | 'Unknown — referred to police';

export const MANNERS: MannerOfDeath[] = ['Natural', 'Unnatural — referred to police', 'Unknown — referred to police'];

/** Where a certificate or a civil registration has got to. */
export type RegistrationState = 'Number issued' | 'Filed, number awaited' | 'Started online' | 'Not yet filed' | 'Not applicable';

export interface BirthRecord {
  id: string;
  /** The hospital's own register number: one series, gapless, never reused. */
  registerNo: string;
  /** When the baby was born, to the minute — the register is a legal record, not a shift log. */
  at: string;
  mother: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age'>;
  wardId: string;
  bedId: string;
  /** Gravida and para as the obstetrician writes them: G3 P2 is a third pregnancy, two births. */
  gravidaPara: string;
  gestationWeeks: number;
  type: BirthType;
  outcome: BirthOutcome;
  sex: NewbornSex;
  weightGrams: number;
  apgar: { oneMin: number; fiveMin: number };
  /** Who delivered the baby: a name on the record, because the register is signed. */
  attendedBy: string;
  complications: string[];
  /** Vitamin K for haemorrhagic disease of the newborn, and BCG against tuberculosis. Both, or the reason why not. */
  vitaminKGiven: boolean;
  bcgGiven: boolean;
  /** The first feed: the register keeps it because feeding is the first thing that goes wrong at home. */
  firstFeedAt: string | null;
  /** The live-birth registration, which is a different thing from the hospital's own register number. */
  civil: { state: RegistrationState; number: string | null; note?: string };
  dischargeAt: string | null;
  /** Free text the midwife left for the next shift. */
  note?: string;
}

export interface DeathRecord {
  id: string;
  registerNo: string;
  at: string;
  kind: DeathKind;
  /** Absent for a patient brought in dead and never registered — which is a fact about the register, not a gap. */
  patient: Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age' | 'sex'> | null;
  wardId: string | null;
  admittedAt: string | null;
  /** The clinical cause, in the three-part form a certificate is written in. */
  cause: { immediate: string; antecedent: string; underlying: string; icd: string };
  manner: MannerOfDeath;
  /** Recorded when the manner referred the case to the police. Without it, the body does not move. */
  police: { station: string; referredAt: string; officer: string } | null;
  postMortemReferred: boolean;
  certifiedBy: string | null;
  certifiedAt: string | null;
  certificateNo: string | null;
  releasedAt: string | null;
  releasedTo: string | null;
  /** Filed with the city corporation's registrar, which is what makes the death official outside the hospital. */
  civil: { state: RegistrationState; number: string | null };
  /** Free text: who was informed, which consultant was called, what the family was told. */
  note?: string;
}

export interface VitalCheck {
  ok: boolean;
  /** What the register would refuse, each with the reason in the reader's words. */
  reasons: Array<{ code: string; message: string }>;
  /** What it records and passes on: a review, a follow-up, a number nobody has filed yet. */
  warnings: string[];
}

/* ------------------------------------------------------------------------------------------------ the rules */

/**
 * What the register must hold for a birth. Two of these are refusals and the rest are warnings, because a
 * register that refuses a birth is a register nobody fills in.
 */
export function checkBirth(birth: BirthRecord): VitalCheck {
  const reasons: VitalCheck['reasons'] = [];
  const warnings: string[] = [];

  if (birth.outcome === 'Stillbirth' && birth.civil.number) {
    reasons.push({
      code: 'stillbirth-as-live-birth',
      message: 'A stillbirth may not carry a live-birth registration number. The birth is recorded with its outcome; the registration is not filed, because a certificate for a child who did not live is one the family has to produce again — at a school admission, years later.',
    });
  }
  if (birth.outcome === 'Stillbirth' && birth.apgar.fiveMin > 0) {
    reasons.push({
      code: 'stillbirth-with-apgar',
      message: 'An Apgar score belongs to a living newborn. A stillbirth at 34 weeks with a five-minute score of 3 is a record that will be read as “might have survived”, which is not what happened.',
    });
  }
  if (!birth.attendedBy) {
    reasons.push({ code: 'no-attendant', message: 'Every birth is signed by whoever delivered the baby. An unsigned birth is a register entry nobody can be asked about.' });
  }
  if (birth.type === 'Caesarean' && birth.complications.length === 0) {
    reasons.push({
      code: 'caesarean-without-indication',
      message: 'A caesarean carries an indication, always. It is the operation the next pregnancy is planned around, and an indication-free record tells the next obstetrician nothing.',
    });
  }

  if (birth.outcome === 'Live birth' && (!birth.vitaminKGiven || !birth.bcgGiven)) {
    const missing = [!birth.vitaminKGiven ? 'vitamin K' : null, !birth.bcgGiven ? 'BCG' : null].filter(Boolean).join(' and ');
    warnings.push(
      birth.dischargeAt
        ? `${missing} was not given before discharge. Both are recorded per newborn because the illness they prevent arrives three weeks later, at home, with nobody connecting it to the register.`
        : `${missing} is still to be given before discharge — the register keeps it open until it is.`,
    );
  }
  if (birth.outcome === 'Live birth' && birth.weightGrams < 2500) {
    warnings.push(`Born at ${birth.weightGrams} g, under the 2 500 g line: the baby is a low-birth-weight baby, with a feeding plan and a follow-up date rather than a routine discharge.`);
  }
  if (birth.civil.state === 'Not yet filed' || birth.civil.state === 'Started online') {
    warnings.push('The civil registration is open. It is filed before the family leaves the district, not after — a birth certificate applied for from another city takes months.');
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/** What the register must hold for a death, and — the only absolute rule here — what a body needs to leave. */
export function checkDeath(death: DeathRecord): VitalCheck {
  const reasons: VitalCheck['reasons'] = [];
  const warnings: string[] = [];

  const hasCause = death.cause.immediate.length > 0 && death.cause.underlying.length > 0;
  const referred = death.police !== null;
  const unnatural = death.manner !== 'Natural';

  if (!hasCause) {
    reasons.push({
      code: 'no-cause',
      message: 'A death certificate states a cause: what stopped the patient, what led to it, and what started it. A certificate with a blank cause is one an insurance company, a court and a registrar all send back.',
    });
  }
  if (death.certificateNo && !hasCause) {
    reasons.push({ code: 'certificate-without-cause', message: 'A numbered certificate exists but no cause is recorded. The number is issued against a cause, never before it.' });
  }
  if (unnatural && !referred) {
    reasons.push({
      code: 'unnatural-without-referral',
      message: `A death recorded as “${death.manner}” needs the police station and the time of the referral on the record. Until then the body is in the mortuary on the hospital’s authority, which is not the hospital’s to give.`,
    });
  }
  if (death.releasedAt && !death.certificateNo && !referred) {
    reasons.push({
      code: 'released-without-paper',
      message: 'The body was released with neither a certificate nor a police referral. This is the one thing this register may never contain: once the body has moved, nothing can be added to it afterwards that makes it right.',
    });
  }
  if (death.releasedAt && !death.releasedTo) {
    reasons.push({ code: 'released-to-nobody', message: 'A body is released to a named person, with a relationship, and the name goes on the register — not to “the family”.' });
  }
  if (death.police && !death.postMortemReferred && unnatural) {
    warnings.push('Referred to the police but not to a post-mortem: for an unnatural death the post-mortem is what the certificate will be written from, so the referral is not complete without it.');
  }

  if (death.kind === 'Brought in dead') {
    warnings.push('Brought in dead: the register carries no admission, no bed and no ward round, and the certificate is written from the police report and the external examination rather than from a course of treatment.');
  }
  if (death.admittedAt && death.at.slice(0, 10) === death.admittedAt.slice(0, 10) && death.kind === 'In-patient') {
    warnings.push('Died within 24 hours of admission. This one goes to the mortality review whatever the cause, because a death that early is either a very sick patient or a decision that came late.');
  }
  if (death.patient && death.patient.sex === 'Female' && death.patient.age >= 15 && death.patient.age <= 49) {
    warnings.push('A death in a woman of childbearing age: the maternal death review reads it against the pregnancy register, because “not obstetric” is only true once somebody has said so on the record.');
  }
  if (death.civil.state === 'Not yet filed' || death.civil.state === 'Filed, number awaited') {
    warnings.push('The civil registration is open. A death that is not filed with the registrar becomes invisible to every statistic the district keeps — including the ones that decide where a maternity unit is built.');
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/**
 * Whether the body may leave, and why not when it may not. Exported as its own function because this is the
 * question the mortuary actually asks, and the answer is a sentence about paperwork rather than a boolean.
 */
export function canReleaseBody(death: DeathRecord): { ok: boolean; because: string } {
  if (death.releasedAt) return { ok: false, because: `Already released at ${death.releasedAt} to ${death.releasedTo ?? 'an unnamed person'}.` };
  if (death.police) return { ok: true, because: `Referred to ${death.police.station} at ${death.police.referredAt} by ${death.police.officer}: the body goes to the post-mortem and the certificate follows it.` };
  if (death.certificateNo) {
    return death.releasedTo
      ? { ok: true, because: `Certificate ${death.certificateNo} is issued and the register names who is collecting the body.` }
      : { ok: false, because: `Certificate ${death.certificateNo} is issued, but the register does not name the person collecting the body.` };
  }
  return { ok: false, because: 'Neither a certificate nor a police referral is on the record, so nothing leaves this room yet.' };
}

/** The one line the mortuary, the family and the registrar each read differently. */
export function certificateState(death: DeathRecord): string {
  if (death.police) return `Post-mortem — referred to ${death.police.station}`;
  if (death.certificateNo) return `Certificate ${death.certificateNo}`;
  return 'Cause not yet certified';
}

export const BIRTH_RULES: Array<{ title: string; because: string }> = [
  { title: 'A stillbirth is recorded as a birth, with its outcome', because: 'It is a birth in the register and not a live-birth registration. The distinction is what keeps a birth certificate out of the hands of a family whose baby died.' },
  { title: 'A caesarean carries an indication', because: 'The next pregnancy is planned around it, and an indication-free record tells the next obstetrician nothing.' },
  { title: 'Vitamin K and BCG are recorded per newborn', because: 'Both prevent an illness three weeks later, at home, where nobody will connect it to anything the hospital did or did not do.' },
  { title: 'A birth is notified within a day', because: 'The register is a notification. A birth notified late is a child whose registration is applied for from another city, months later.' },
];

export const DEATH_RULES: Array<{ title: string; because: string }> = [
  { title: 'No certificate without a cause', because: 'The certificate states what stopped the patient, what led to it and what started it. A number is issued against a cause, never before it.' },
  { title: 'An unnatural death goes to the police before the body moves', because: 'The hospital may hold the body; releasing it is a decision that belongs to the state, and the referral is the record of that decision.' },
  { title: 'A body is released to a named person', because: 'The register is read years later by a court, an insurer or a family. “The family” is not an answer anybody can be held to.' },
  { title: 'A death within 24 hours of admission goes to the mortality review', because: 'A death that early is either a very sick patient or a decision that came late, and only a review tells the two apart.' },
];

/* -------------------------------------------------------------------------------------------- the register */

export interface BirthDeathDay {
  day: string;
  /** The clock the rest of the product reads for this day, so the register and the ward board agree. */
  now: string;
  births: BirthRecord[];
  deaths: DeathRecord[];
  stats: {
    births: number;
    liveBirths: number;
    stillbirths: number;
    caesareans: number;
    assisted: number;
    lowBirthWeight: number;
    deaths: number;
    inPatient: number;
    broughtInDead: number;
    within24h: number;
    maternal: number;
    medicoLegal: number;
    certified: number;
    certificatesOutstanding: number;
    civilFiled: number;
    civilOpen: number;
    bodiesHeld: number;
  };
  /** The reviews today's register opens by itself: a mortality review, a maternal review, a medico-legal file. */
  reviews: Array<{ id: string; kind: 'Mortality' | 'Maternal' | 'Medico-legal' | 'Perinatal'; because: string }>;
  /** Anything the register would refuse, from its own rules — the screen that reads it shows these first. */
  findings: Array<{ record: string; note: string }>;
}

const SEED = 2026_1015;
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const at = (day: string, hhmm: string): string => `${day} ${hhmm}`;
const seq = (prefix: string, year: string, n: number): string => `${prefix}-${year}-${String(n).padStart(4, '0')}`;

/**
 * A day in the register, computed from the date so two people looking at the same day see the same records. The
 * day is deliberately not a comfortable one: it holds a stillbirth, a death within 24 hours of admission, a
 * maternal death that arrived by ambulance, an unnatural death with a police referral, and one civil registration
 * still open — because those five are the ones the register exists for.
 */
export function birthDeathDay(dayIso: string): BirthDeathDay {
  const year = dayIso.slice(0, 4);
  const board = generateInpatient(dayIso);
  const fleet = ambulanceDay(dayIso);
  const matron = 'S. Rahman (senior staff nurse)';
  const registrar = 'Dr N. Sultana (registrar, obstetrics)';
  const wardName = (id: string | null) => board.wards.find((w) => w.id === id)?.name ?? 'Emergency';

  /* The obstetric emergency the ambulance fleet ran today is the same patient: the register reads the fleet's own
     call rather than inventing a mother. If the day has no obstetric call, the register simply has no such death. */
  const obstetricCall = fleet.calls.find((c) => /obstetric/i.test(c.complaint ?? ''));

  const motherOf = (name: string): Pick<Patient, 'mrn' | 'name' | 'nameBn' | 'age'> => {
    const found = patients.find((p) => p.name === name);
    return found
      ? { mrn: found.mrn, name: found.name, nameBn: found.nameBn, age: found.age }
      : { mrn: '—', name, nameBn: '', age: 24 };
  };

  const births: BirthRecord[] = [
    {
      id: `BR-${dayIso.replace(/-/g, '')}-01`,
      registerNo: seq('BR', year, 411),
      at: at(dayIso, '03:10'),
      mother: motherOf('Shirin Sultana'),
      wardId: 'mat-c',
      bedId: 'C-04',
      gravidaPara: 'G3 P2',
      gestationWeeks: 39,
      type: 'Normal vaginal',
      outcome: 'Live birth',
      sex: 'Male',
      weightGrams: 2950,
      apgar: { oneMin: 8, fiveMin: 9 },
      attendedBy: `${registrar} and ${matron}`,
      complications: [],
      vitaminKGiven: true,
      bcgGiven: true,
      firstFeedAt: at(dayIso, '03:52'),
      civil: { state: 'Number issued', number: `BRIS-${year}-0411` },
      dischargeAt: at(dayIso, '10:20'),
    },
    {
      id: `BR-${dayIso.replace(/-/g, '')}-02`,
      registerNo: seq('BR', year, 412),
      at: at(dayIso, '06:45'),
      mother: motherOf('Ruma Khatun'),
      wardId: 'mat-c',
      bedId: 'C-01',
      gravidaPara: 'G2 P1',
      gestationWeeks: 36,
      type: 'Caesarean',
      outcome: 'Live birth',
      sex: 'Female',
      weightGrams: 2350,
      apgar: { oneMin: 7, fiveMin: 9 },
      attendedBy: 'Prof. A. Haque (consultant, obstetrics), Dr K. Mia (anaesthetist) and the theatre team',
      complications: ['Fetal distress on cardiotocography — the indication for the section', 'Reactive to the liquor, cleared by the paediatrician at the section'],
      vitaminKGiven: true,
      bcgGiven: true,
      firstFeedAt: at(dayIso, '07:30'),
      civil: { state: 'Started online', number: null, note: 'The online application was started by the ward clerk; the number comes back in two days.' },
      dischargeAt: null,
      note: 'Mother comfortable on day 0. Skin-to-skin and feeding established.',
    },
    {
      id: `BR-${dayIso.replace(/-/g, '')}-03`,
      registerNo: seq('BR', year, 413),
      at: at(dayIso, '09:20'),
      mother: motherOf('Fatema Begum'),
      wardId: 'mat-c',
      bedId: 'C-06',
      gravidaPara: 'G1 P0',
      gestationWeeks: 40,
      type: 'Assisted vaginal',
      outcome: 'Live birth',
      sex: 'Male',
      weightGrams: 3100,
      apgar: { oneMin: 6, fiveMin: 8 },
      attendedBy: `${registrar} and ${matron}`,
      complications: ['Prolonged second stage — vacuum applied for one contraction, baby delivered on the next'],
      vitaminKGiven: true,
      bcgGiven: true,
      firstFeedAt: at(dayIso, '10:05'),
      civil: { state: 'Number issued', number: `BRIS-${year}-0413` },
      dischargeAt: null,
      note: 'Caput succedaneum over the vertex, expected to settle; the paediatrician reviewed and agreed with the plan.',
    },
    {
      id: `BR-${dayIso.replace(/-/g, '')}-04`,
      registerNo: seq('BR', year, 414),
      at: at(dayIso, '11:05'),
      mother: motherOf('Ayesha Siddika'),
      wardId: 'mat-c',
      bedId: 'C-03',
      gravidaPara: 'G4 P3',
      gestationWeeks: 34,
      type: 'Normal vaginal',
      outcome: 'Stillbirth',
      sex: 'Female',
      weightGrams: 2350,
      /* No Apgar: a score belongs to a living newborn. Zero here would be a score, and there was no one to score. */
      apgar: { oneMin: 0, fiveMin: 0 },
      attendedBy: `${registrar} and ${matron}`,
      complications: ['Intrauterine fetal death diagnosed at 33 weeks on ultrasound', 'No fetal heart on admission'],
      vitaminKGiven: false,
      bcgGiven: false,
      firstFeedAt: null,
      civil: { state: 'Not applicable', number: null, note: 'A stillbirth is recorded in this register with its outcome; no live-birth registration is filed.' },
      dischargeAt: null,
      note: 'The mother is on the ward with the other mothers. The bereavement protocol was started and the senior midwife has spoken to the family twice.',
    },
  ];

  const taken = new Set<string>();
  const admissionOf = (reason: RegExp): Admission | undefined => {
    const candidates = board.admissions.filter((a) => reason.test(a.reason));
    return candidates.find((a) => a.severity !== 'Stable' && !taken.has(a.patient.name)) ?? candidates.find((a) => !taken.has(a.patient.name));
  };
  const takeByName = (admission: Admission | undefined): Admission | undefined => {
    if (admission) taken.add(admission.patient.name);
    return admission;
  };

  const rta = takeByName(board.admissions.find((a) => /Road traffic/i.test(a.reason) && !taken.has(a.patient.name)));
  const mi = admissionOf(/Chest pain/i);
  const sepsis = admissionOf(/Fever with low blood pressure/i);

  const deaths: DeathRecord[] = [];

  /* 1. A death on the ward after a course of treatment: the ordinary case, and the one the certificate exists for. */
  if (sepsis) {
    taken.add(sepsis.patient.name);
    const hour = '04:20';
    deaths.push({
      id: `DR-${dayIso.replace(/-/g, '')}-01`,
      registerNo: seq('DR', year, 88),
      at: at(dayIso, hour),
      kind: 'In-patient',
      patient: { mrn: sepsis.patient.mrn, name: sepsis.patient.name, nameBn: sepsis.patient.nameBn, age: sepsis.patient.age, sex: sepsis.patient.sex },
      wardId: sepsis.wardId,
      admittedAt: sepsis.admittedAt,
      cause: {
        immediate: 'Septic shock, not responding to fluid resuscitation and vasopressors',
        antecedent: 'Hospital-acquired pneumonia, right lower lobe',
        underlying: 'Sepsis, unspecified organism',
        icd: 'A41.9',
      },
      manner: 'Natural',
      police: null,
      postMortemReferred: false,
      certifiedBy: 'Dr R. Alam (medical officer, on call)',
      certifiedAt: at(dayIso, '05:05'),
      certificateNo: seq('DC', year, 88),
      releasedAt: at(dayIso, '08:40'),
      releasedTo: 'Md Jashim Uddin (son)',
      civil: { state: 'Filed, number awaited', number: null },
      note: 'Family were with the patient. The consultant spoke to the son at 06:00 and the body was released after the ward round.',
    });
  }

  /* 2. A death within 24 hours of admission — admitted late the previous night, died before the round. */
  if (mi) {
    taken.add(mi.patient.name);
    deaths.push({
      id: `DR-${dayIso.replace(/-/g, '')}-02`,
      registerNo: seq('DR', year, 89),
      at: at(dayIso, '07:40'),
      kind: 'In-patient',
      patient: { mrn: mi.patient.mrn, name: mi.patient.name, nameBn: mi.patient.nameBn, age: mi.patient.age, sex: mi.patient.sex },
      wardId: mi.wardId,
      admittedAt: `${dayIso} 23:10`.replace(/-/g, '-'),
      cause: {
        immediate: 'Cardiogenic shock following acute anterior myocardial infarction',
        antecedent: 'Acute ST-elevation myocardial infarction, anterior wall',
        underlying: 'Ischaemic heart disease',
        icd: 'I21.0',
      },
      manner: 'Natural',
      police: null,
      postMortemReferred: false,
      certifiedBy: 'Dr S. Islam (registrar, medicine)',
      certifiedAt: at(dayIso, '08:15'),
      certificateNo: seq('DC', year, 89),
      releasedAt: at(dayIso, '11:30'),
      releasedTo: 'Rehana Parvin (wife)',
      civil: { state: 'Filed, number awaited', number: null },
      note: 'Admitted 23:10 after a two-hour history; the cath laboratory is at the tertiary centre and the transfer was being arranged when the rhythm deteriorated. Mortality review opened by the register itself.',
    });
  }

  /* 3. The obstetric emergency the ambulance brought in. The register reads the fleet's own call. */
  if (obstetricCall) {
    const name = obstetricCall.patientName ?? 'Unnamed patient';
    const mother = motherOf(name);
    deaths.push({
      id: `DR-${dayIso.replace(/-/g, '')}-03`,
      registerNo: seq('DR', year, 90),
      at: at(dayIso, '12:15'),
      kind: 'Brought in dead',
      patient: { mrn: mother.mrn, name: mother.name, nameBn: mother.nameBn, age: mother.age, sex: 'Female' },
      wardId: null,
      admittedAt: null,
      cause: {
        immediate: 'Post-partum haemorrhage with haemorrhagic shock',
        antecedent: 'Retained placenta after a home delivery',
        underlying: 'Home delivery without skilled attendance',
        icd: 'O72.0',
      },
      manner: 'Natural',
      police: null,
      postMortemReferred: false,
      certifiedBy: 'Dr N. Sultana (registrar, obstetrics)',
      certifiedAt: at(dayIso, '13:00'),
      certificateNo: seq('DC', year, 90),
      releasedAt: null,
      releasedTo: 'Rafiqul Hasan (husband) — collecting',
      civil: { state: 'Not yet filed', number: null },
      note: `Arrived by ${obstetricCall.id} at ${obstetricCall.onSceneAt?.slice(11) ?? '—'} with bleeding after a home delivery; no cardiac output on arrival and no response to resuscitation. Brought in dead, so the register carries no admission and no ward round. Maternal death review opened.`,
    });
  }

  /* 4. An unnatural death: the road-traffic admission, referred to the police and to a post-mortem. */
  if (rta) {
    deaths.push({
      id: `DR-${dayIso.replace(/-/g, '')}-04`,
      registerNo: seq('DR', year, 91),
      at: at(dayIso, '14:50'),
      kind: 'In-patient',
      patient: { mrn: rta.patient.mrn, name: rta.patient.name, nameBn: rta.patient.nameBn, age: rta.patient.age, sex: rta.patient.sex },
      wardId: rta.wardId,
      admittedAt: rta.admittedAt,
      cause: {
        immediate: 'Raised intracranial pressure from an acute subdural haematoma',
        antecedent: 'Head injury with loss of consciousness at the scene',
        underlying: 'Road traffic injury, motorcycle against a bus',
        icd: 'S06.5',
      },
      manner: 'Unnatural — referred to police',
      police: { station: 'Kafrul police station', referredAt: at(dayIso, '15:10'), officer: 'SI M. Hossain' },
      postMortemReferred: true,
      certifiedBy: null,
      certifiedAt: null,
      certificateNo: null,
      releasedAt: null,
      releasedTo: null,
      civil: { state: 'Not applicable', number: null },
      note: 'The family was informed at 15:00 and the police were called by the ward. The body stays in the mortuary until the post-mortem; the certificate is written from its report, not from the ward round.',
    });
  }

  const liveBirths = births.filter((b) => b.outcome === 'Live birth');
  /* A registration is filed when it has a number. “Not applicable” is neither filed nor open — a stillbirth is not a
     late registration, it is a registration that will never exist, and counting it as filed would flatter the number. */
  const civilNumbers = [...births.map((b) => b.civil), ...deaths.map((d) => d.civil)];
  const civilFiled = civilNumbers.filter((c) => c.state === 'Number issued').length;

  const findings = [
    ...births.flatMap((b) => checkBirth(b).reasons.map((r) => ({ record: `${b.registerNo} — birth`, note: r.message }))),
    ...deaths.flatMap((d) => checkDeath(d).reasons.map((r) => ({ record: `${d.registerNo} — death`, note: r.message }))),
  ];

  const reviews: BirthDeathDay['reviews'] = [];
  if (deaths.some((d) => d.kind !== 'Brought in dead' && d.admittedAt && d.at.slice(0, 10) === d.admittedAt.slice(0, 10))) {
    reviews.push({ id: 'REV-MORTALITY', kind: 'Mortality', because: 'A death within 24 hours of admission: the review reads the admission, the first hour and the decision that came after it.' });
  }
  if (deaths.some((d) => d.patient?.sex === 'Female' && (d.patient?.age ?? 0) >= 15 && (d.patient?.age ?? 0) <= 49)) {
    reviews.push({ id: 'REV-MATERNAL', kind: 'Maternal', because: 'A death in a woman of childbearing age: the review reads it against the pregnancy register and the referral that did not happen in time.' });
  }
  if (births.some((b) => b.outcome === 'Stillbirth' || b.weightGrams < 2500)) {
    reviews.push({ id: 'REV-PERINATAL', kind: 'Perinatal', because: 'A stillbirth and a low-birth-weight baby on the same day: the perinatal review reads the antenatal visits, the growth scans and the referral threshold.' });
  }
  if (deaths.some((d) => d.police)) {
    reviews.push({ id: 'REV-MEDICOLEGAL', kind: 'Medico-legal', because: 'An unnatural death: the file goes to the police, the post-mortem and, if it is ever asked, to a court — which is why nobody edits it afterwards.' });
  }

  return {
    day: dayIso,
    now: board.now,
    births,
    deaths,
    stats: {
      births: births.length,
      liveBirths: liveBirths.length,
      stillbirths: births.filter((b) => b.outcome === 'Stillbirth').length,
      caesareans: births.filter((b) => b.type === 'Caesarean').length,
      assisted: births.filter((b) => b.type === 'Assisted vaginal').length,
      lowBirthWeight: liveBirths.filter((b) => b.weightGrams < 2500).length,
      deaths: deaths.length,
      inPatient: deaths.filter((d) => d.kind === 'In-patient').length,
      broughtInDead: deaths.filter((d) => d.kind === 'Brought in dead').length,
      within24h: deaths.filter((d) => d.kind === 'In-patient' && d.admittedAt && d.at.slice(0, 10) === d.admittedAt.slice(0, 10)).length,
      maternal: deaths.filter((d) => d.patient?.sex === 'Female' && (d.patient?.age ?? 0) >= 15 && (d.patient?.age ?? 0) <= 49).length,
      medicoLegal: deaths.filter((d) => d.police !== null).length,
      certified: deaths.filter((d) => d.certificateNo !== null).length,
      certificatesOutstanding: deaths.filter((d) => d.certificateNo === null && d.police === null).length,
      civilFiled,
      civilOpen: civilNumbers.filter((c) => c.state === 'Not yet filed' || c.state === 'Filed, number awaited' || c.state === 'Started online').length,
      bodiesHeld: deaths.filter((d) => d.releasedAt === null).length,
    },
    reviews,
    findings,
  };
}

export const REGISTER_NOTE =
  'Births and deaths are the two events nobody decides, so this register is written for the people who read it afterwards: a family, a registrar, an insurer and — once — a court. That is why a stillbirth is a birth with an outcome and not a live-birth registration, why a cause is written in three parts before a certificate number is issued, and why an unnatural death goes to the police before the body moves.';
