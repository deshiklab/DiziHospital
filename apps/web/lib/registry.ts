/* ----------------------------------------------------------------------------------------------------
 * The vital-events register, writing side (P7) — the birth and death forms.
 *
 * `birthdeath.ts` (P6) reads the register: it computes the day’s births and deaths and the rules they have to
 * satisfy, and the report suite prints them. This module is the other half — the thirty-four fields a birth
 * record is taken with and the eighteen a death record is, the numbers they are issued from, and the same rules
 * applied as the form is filled in rather than the morning after.
 *
 * The fields are data, not markup, for two reasons:
 *
 *  1. **The count is checkable.** The screens map captured 34 fields on the birth record and 18 on the death
 *     record against the legacy product, and the harness compares this file against that plan. A field quietly
 *     dropped from a legal register is exactly the kind of change a phase should not be able to make in silence.
 *  2. **A legible field is a required one.** Each field says who reads it and which rule it feeds, so the form
 *     asks for what the register refuses without, and nothing else.
 *
 * Numbers are drawn from the node’s own block, like every other register in the platform: the hospital’s series
 * is gapless and never reused, which is what makes a missing entry visible rather than merely absent.
 */

import { patients } from './mock';
import {
  BIRTH_RULES,
  BIRTH_TYPES,
  DEATH_RULES,
  MANNERS,
  birthDeathDay,
  checkBirth,
  checkDeath,
  type BirthRecord,
  type DeathRecord,
  type VitalCheck,
} from './birthdeath';

export { BIRTH_RULES, DEATH_RULES };

export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'select' | 'toggle' | 'textarea';

export interface RegistryField {
  key: string;
  label: string;
  section: string;
  kind: FieldKind;
  options?: string[];
  /** Required by the register, and the field says which rule makes it so. */
  required?: boolean;
  hint: string;
  /** The rule this field feeds, so the form and the register cannot disagree about why it is asked. */
  feeds?: string;
}

/* --------------------------------------------------------------------------------------------- birth fields */

export const BIRTH_FIELDS: RegistryField[] = [
  { key: 'motherMrn', label: 'Mother’s MRN', section: 'Mother', kind: 'text', required: true, hint: 'The hospital number the ward, the theatre list and the bill all point at. A birth recorded against a name alone cannot be tied to the admission it happened during.', feeds: 'The mother’s own record notices the birth.' },
  { key: 'motherName', label: 'Mother’s name', section: 'Mother', kind: 'text', required: true, hint: 'As it appears on her registration. The register is read years later by people who will not have the admission file.' },
  { key: 'motherAge', label: 'Age', section: 'Mother', kind: 'number', required: true, hint: 'In years. It is on the register because the maternal review reads it, and because a birth to a fifteen-year-old is a different conversation.' },
  { key: 'gravidaPara', label: 'Gravida / para', section: 'Mother', kind: 'text', required: true, hint: 'G3 P2 as the obstetrician writes it: which pregnancy, and how many births before it. The next pregnancy is planned around this line.' },
  { key: 'bloodGroup', label: 'Blood group', section: 'Mother', kind: 'select', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Not known'], required: true, hint: 'Known before delivery, wherever it is known: it is the one fact that is too late to look up during a haemorrhage.' },
  { key: 'phone', label: 'Mobile', section: 'Mother', kind: 'text', required: true, hint: 'The number the ward calls about the baby’s follow-up. A birth with no number on it is a follow-up that never happens.' },
  { key: 'wardId', label: 'Ward and bed', section: 'Mother', kind: 'select', options: ['mat-c / C-01', 'mat-c / C-02', 'mat-c / C-03', 'mat-c / C-04', 'Emergency / trolley', 'Brought in from home'], required: true, hint: 'Where it happened. “Brought in from home” is a real answer and the register keeps it rather than leaving the ward blank.' },

  { key: 'birthDate', label: 'Date of birth', section: 'Delivery', kind: 'date', required: true, hint: 'The date on the certificate. It is a legal fact, not a shift log.' },
  { key: 'birthTime', label: 'Time (24 h)', section: 'Delivery', kind: 'time', required: true, hint: 'To the minute. A register that records the hour cannot settle which of two babies was born first.' },
  { key: 'type', label: 'How the baby was born', section: 'Delivery', kind: 'select', options: [...BIRTH_TYPES], required: true, hint: 'Normal, assisted or caesarean. It predicts the length of stay, the bill and the risk in the next pregnancy.', feeds: 'A caesarean carries an indication.' },
  { key: 'indication', label: 'Indication (caesarean)', section: 'Delivery', kind: 'text', hint: 'Required for a caesarean, optional otherwise. Fetal distress, previous caesarean, obstructed labour — the next obstetrician plans the next pregnancy around this.', feeds: 'caesarean-without-indication' },
  { key: 'attendedBy', label: 'Delivered by', section: 'Delivery', kind: 'text', required: true, hint: 'The name of the person who delivered the baby. Every birth is signed by somebody: an unsigned entry is one nobody can be asked about.', feeds: 'no-attendant' },
  { key: 'attendantDesignation', label: 'Attendant’s designation', section: 'Delivery', kind: 'select', options: ['Consultant', 'Registrar', 'Intern', 'Senior staff nurse', 'Staff nurse', 'Midwife'], required: true, hint: 'The register prints the designation beside the name, because a signature without one says nothing about who was there.' },
  { key: 'presentation', label: 'Presentation', section: 'Delivery', kind: 'select', options: ['Cephalic', 'Breech', 'Transverse', 'Face', 'Compound', 'Not recorded'], hint: 'How the baby presented. It is what makes an assisted delivery legible a year later.' },
  { key: 'complications', label: 'Complications', section: 'Delivery', kind: 'textarea', hint: 'Post-partum haemorrhage, cord round the neck, shoulder dystocia, none. Free text, printed on the record, because the words matter more than the coding.', feeds: 'The maternal review reads this.' },

  { key: 'outcome', label: 'Outcome', section: 'Newborn', kind: 'select', options: ['Live birth', 'Stillbirth'], required: true, hint: 'Both are recorded in the birth register; only one is a live-birth registration. Getting this wrong is a birth certificate for a child who did not live.', feeds: 'stillbirth-as-live-birth' },
  { key: 'sex', label: 'Sex', section: 'Newborn', kind: 'select', options: ['Male', 'Female', 'Indeterminate'], required: true, hint: 'Indeterminate is a real value and not a gap: the register keeps what was recorded rather than a guess made at a desk.' },
  { key: 'weightGrams', label: 'Weight', section: 'Newborn', kind: 'number', required: true, hint: 'In grams. Under 2 500 g the baby is a low-birth-weight baby with a feeding plan and a follow-up date rather than a routine discharge.', feeds: 'The low-birth-weight follow-up.' },
  { key: 'lengthCm', label: 'Length', section: 'Newborn', kind: 'number', hint: 'In centimetres. Recorded at the first examination; it is what the growth chart is read against.' },
  { key: 'apgarOne', label: 'Apgar at 1 minute', section: 'Newborn', kind: 'number', hint: 'Zero to ten. A stillbirth has no Apgar: there is no living newborn to score, and a score on the record reads as “might have survived”.', feeds: 'stillbirth-with-apgar' },
  { key: 'apgarFive', label: 'Apgar at 5 minutes', section: 'Newborn', kind: 'number', hint: 'Zero to ten, and the same rule applies: no score on a stillbirth.' },
  { key: 'resuscitation', label: 'Resuscitation', section: 'Newborn', kind: 'select', options: ['None', 'Stimulation', 'Bag and mask', 'Intubation', 'Chest compressions'], hint: 'What was done in the first minutes. The register keeps it because the paediatric follow-up reads it.' },
  { key: 'congenitalAnomaly', label: 'Congenital anomaly', section: 'Newborn', kind: 'textarea', hint: 'Noted at the first examination, or “none seen”. A blank field reads as nobody looked.' },
  { key: 'deliveryNote', label: 'Note for the next shift', section: 'Newborn', kind: 'textarea', hint: 'Free text the midwife leaves: feeding, colour, what to watch. Kept verbatim — it is the register’s only prose.' },

  { key: 'vitaminK', label: 'Vitamin K given', section: 'Care before discharge', kind: 'toggle', required: true, hint: 'Recorded per newborn. The illness it prevents arrives three weeks later, at home, with nobody connecting it to the register.', feeds: 'vitaminKGiven' },
  { key: 'bcg', label: 'BCG given', section: 'Care before discharge', kind: 'toggle', required: true, hint: 'Recorded per newborn, in the same breath as the vitamin K: both, or the reason why not on the record.' },
  { key: 'firstFeed', label: 'First feed', section: 'Care before discharge', kind: 'time', hint: 'The time of the first feed. Feeding is the first thing that goes wrong at home, so the register opens it.' },
  { key: 'dischargeDate', label: 'Discharge date', section: 'Care before discharge', kind: 'date', hint: 'When the mother and baby leave. A discharge before the vitamin K and the BCG are given prints a warning rather than being silently allowed.' },
  { key: 'dischargeNote', label: 'Discharge advice', section: 'Care before discharge', kind: 'textarea', hint: 'Feeding, cord care, danger signs, the follow-up date. Printed on the record the family takes home.' },

  { key: 'civilState', label: 'Civil registration', section: 'Registration', kind: 'select', options: ['Number issued', 'Filed, number awaited', 'Started online', 'Not yet filed', 'Not applicable'], required: true, hint: 'The city corporation’s registration, which is a different thing from the hospital’s own register number. A stillbirth is “Not applicable”: this is the field that keeps a live-birth certificate out of a family’s hands.', feeds: 'The registration clock.' },
  { key: 'civilNumber', label: 'Civil registration number', section: 'Registration', kind: 'text', hint: 'The corporation’s number where it has been issued. A stillbirth may not carry one — the register refuses it outright.', feeds: 'stillbirth-as-live-birth' },
  { key: 'informant', label: 'Informant', section: 'Registration', kind: 'text', hint: 'Who brought the family in to register the birth, or “not yet applied”. The registrar reads this name out.' },
  { key: 'informantRelation', label: 'Informant’s relationship', section: 'Registration', kind: 'select', options: ['Father', 'Mother', 'Grandparent', 'Guardian', 'Hospital staff', 'Not yet applied'], hint: 'Recorded beside the name: “the family” is not an answer anybody can be held to.' },
  { key: 'registerNote', label: 'Registrar’s note', section: 'Registration', kind: 'textarea', hint: 'Anything the next reader needs: a corrected spelling, a second certificate, a name changed after the fact.' },
];

/* --------------------------------------------------------------------------------------------- death fields */

export const DEATH_FIELDS: RegistryField[] = [
  { key: 'patientMrn', label: 'Patient MRN', section: 'Identity', kind: 'text', hint: 'Absent for a patient brought in dead and never registered — which is a fact about the register rather than a gap in it.' },
  { key: 'patientName', label: 'Name', section: 'Identity', kind: 'text', required: true, hint: 'As the ward knew them. A body is released to a named person, and the register names the patient the same way.' },
  { key: 'age', label: 'Age', section: 'Identity', kind: 'number', hint: 'In years. It decides which reviews the death opens by itself: a death in a woman of childbearing age goes to the maternal review.' },

  { key: 'deathDate', label: 'Date of death', section: 'When and where', kind: 'date', required: true, hint: 'The date the certificate states. The register is a legal record, not a shift log.' },
  { key: 'deathTime', label: 'Time (24 h)', section: 'When and where', kind: 'time', required: true, hint: 'To the minute. A death within twenty-four hours of admission goes to the mortality review whatever the cause.' },
  { key: 'deathKind', label: 'Where they died', section: 'When and where', kind: 'select', options: ['In-patient', 'Brought in dead', 'Died in the emergency room'], required: true, hint: 'An in-patient death has an admission behind it; a patient brought in dead does not, and the certificate is written from a different set of facts.' },
  { key: 'admittedAt', label: 'Admitted', section: 'When and where', kind: 'date', hint: 'The admission date, where there is one. It is what makes “died within 24 hours” a computed fact rather than a recollection.' },
  { key: 'wardBed', label: 'Ward and bed', section: 'When and where', kind: 'select', options: ['med-a', 'surg-b', 'mat-c', 'hdu', 'Emergency', 'Brought in dead'], required: true, hint: 'Where the death happened. The review reads it against the ward’s staffing and the escalation log.' },

  { key: 'immediateCause', label: 'Cause — immediate', section: 'Cause of death', kind: 'text', required: true, hint: 'What stopped the patient: sepsis, myocardial infarction, haemorrhage. The first of the three lines a certificate is written in.', feeds: 'no-cause' },
  { key: 'antecedentCause', label: 'Cause — antecedent', section: 'Cause of death', kind: 'text', hint: 'What led to it. Optional where the immediate and underlying causes tell the whole story.' },
  { key: 'underlyingCause', label: 'Cause — underlying', section: 'Cause of death', kind: 'text', required: true, hint: 'What started it. A certificate without this line is one an insurer, a court and a registrar all send back.', feeds: 'no-cause' },
  { key: 'icdCode', label: 'ICD-10 code', section: 'Cause of death', kind: 'text', hint: 'The code the district statistics read. Optional at the bedside, required before the certificate is filed.' },

  { key: 'manner', label: 'Manner of death', section: 'Manner', kind: 'select', options: [...MANNERS], required: true, hint: 'Natural, or referred to the police. Where the manner is unnatural or unknown, the body does not move until the referral is on the record.', feeds: 'unnatural-without-referral' },
  { key: 'policeStation', label: 'Police station', section: 'Manner', kind: 'text', hint: 'The station the case was referred to. Without it, the body is in the mortuary on the hospital’s authority, which is not the hospital’s to give.' },
  { key: 'postMortemReferred', label: 'Post-mortem referred', section: 'Manner', kind: 'toggle', hint: 'For an unnatural death the post-mortem is what the certificate will be written from, so a referral to the police without one is an incomplete referral.', feeds: 'The certificate that follows.' },

  { key: 'certifiedBy', label: 'Certified by', section: 'Certificate', kind: 'text', hint: 'The doctor who wrote the cause. Certification is a clinical act: a doctor who has not written a cause cannot certify one.', feeds: 'certificate-without-cause' },
  { key: 'certificateNo', label: 'Certificate number', section: 'Certificate', kind: 'text', hint: 'Issued against a cause, never before it. The register refuses a number with no cause on the same record.', feeds: 'certificate-without-cause' },
  { key: 'civilState', label: 'Civil registration', section: 'Certificate', kind: 'select', options: ['Number issued', 'Filed, number awaited', 'Started online', 'Not yet filed'], hint: 'The registrar’s record. A death that is not filed becomes invisible to every district statistic, including the ones that decide where a maternity unit is built.' },

];

/* --------------------------------------------------------------------------------------------------- rows */

export interface RegistryColumn {
  key: string;
  header: string;
  width?: string;
}

/** Eleven columns on the birth register, the widest of the legacy grid. */
export const BIRTH_COLUMNS: RegistryColumn[] = [
  { key: 'registerNo', header: 'Register no.', width: '8rem' },
  { key: 'at', header: 'Born', width: '8.5rem' },
  { key: 'mother', header: 'Mother (MRN)' },
  { key: 'gravidaPara', header: 'G/P', width: '4.5rem' },
  { key: 'wardBed', header: 'Ward / bed', width: '6rem' },
  { key: 'type', header: 'Delivery' },
  { key: 'outcome', header: 'Outcome' },
  { key: 'sex', header: 'Sex', width: '5rem' },
  { key: 'weightGrams', header: 'Weight', width: '5.5rem' },
  { key: 'apgar', header: 'Apgar', width: '5rem' },
  { key: 'civil', header: 'Civil registration' },
];

/** Ten columns on the death register. */
export const DEATH_COLUMNS: RegistryColumn[] = [
  { key: 'registerNo', header: 'Register no.', width: '8rem' },
  { key: 'at', header: 'Died', width: '8.5rem' },
  { key: 'patient', header: 'Patient (MRN)' },
  { key: 'kind', header: 'Where' },
  { key: 'cause', header: 'Cause' },
  { key: 'manner', header: 'Manner' },
  { key: 'certificate', header: 'Certificate' },
  { key: 'releasedTo', header: 'Released to' },
  { key: 'civil', header: 'Civil registration' },
  { key: 'review', header: 'Review opened' },
];

/* ------------------------------------------------------------------------------------------------ numbers */

/** `BR-2026-0414` / `DR-2026-0091` — the day’s own series, continued from the last entry and never reused. */
export function nextRegisterNo(kind: 'birth' | 'death', dayIso: string, existing: string[]): string {
  const year = dayIso.slice(0, 4);
  const prefix = kind === 'birth' ? 'BR' : 'DR';
  const highest = existing
    .map((no) => Number(no.split('-')[2] ?? 0))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${year}-${String(highest + 1).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------------------------------------- drafts */

export type Draft = Record<string, string>;

export function emptyBirthDraft(dayIso: string, registerNo: string): Draft {
  return {
    registerNo,
    motherMrn: '',
    motherName: '',
    motherAge: '',
    gravidaPara: '',
    bloodGroup: 'B+',
    phone: '',
    wardId: 'mat-c / C-04',
    birthDate: dayIso,
    birthTime: '03:40',
    type: 'Normal vaginal',
    indication: '',
    attendedBy: '',
    attendantDesignation: 'Senior staff nurse',
    presentation: 'Cephalic',
    complications: '',
    outcome: 'Live birth',
    sex: 'Female',
    weightGrams: '',
    lengthCm: '',
    apgarOne: '',
    apgarFive: '',
    resuscitation: 'None',
    congenitalAnomaly: '',
    deliveryNote: '',
    vitaminK: 'yes',
    bcg: 'yes',
    eyeCare: 'yes',
    firstFeed: '',
    dischargeDate: '',
    dischargeNote: '',
    civilState: 'Started online',
    civilNumber: '',
    informant: '',
    informantRelation: 'Father',
    registerNote: '',
  };
}

export function emptyDeathDraft(dayIso: string, registerNo: string): Draft {
  return {
    registerNo,
    patientMrn: '',
    patientName: '',
    age: '',
    deathDate: dayIso,
    deathTime: '06:10',
    deathKind: 'In-patient',
    admittedAt: '',
    wardBed: 'med-a',
    immediateCause: '',
    antecedentCause: '',
    underlyingCause: '',
    icdCode: '',
    manner: 'Natural',
    policeStation: '',
    postMortemReferred: 'no',
    certifiedBy: '',
    certificateNo: '',
    civilState: 'Not yet filed',
    deathNote: '',
    releasedTo: '',
    releasedRelation: '',
  };
}

const bool = (draft: Draft, key: string): boolean => (draft[key] ?? '').toLowerCase() === 'yes';
const int = (draft: Draft, key: string): number => {
  const n = Number(draft[key]);
  return Number.isFinite(n) ? n : 0;
};

/** The birth record as the register holds it, built from the form. One shape, so the report and the form agree. */
export function birthFromDraft(draft: Draft, dayIso: string): BirthRecord {
  const mother = patients.find((p) => p.mrn === draft.motherMrn.trim());
  const [wardId, bedId] = (draft.wardId ?? '').split(' / ');
  return {
    id: `birth-form-${draft.registerNo}`,
    registerNo: draft.registerNo,
    at: `${draft.birthDate} ${draft.birthTime}`,
    mother: {
      mrn: draft.motherMrn.trim() || 'UNREGISTERED',
      name: draft.motherName.trim() || mother?.name || 'Unnamed mother',
      nameBn: mother?.nameBn ?? '',
      age: int(draft, 'motherAge') || mother?.age || 0,
    },
    wardId: wardId ?? '',
    bedId: bedId ?? '',
    gravidaPara: draft.gravidaPara.trim(),
    gestationWeeks: int(draft, 'gestationWeeks') || 38,
    type: (draft.type as BirthRecord['type']) ?? 'Normal vaginal',
    outcome: (draft.outcome as BirthRecord['outcome']) ?? 'Live birth',
    sex: (draft.sex as BirthRecord['sex']) ?? 'Female',
    weightGrams: int(draft, 'weightGrams'),
    apgar: { oneMin: int(draft, 'apgarOne'), fiveMin: int(draft, 'apgarFive') },
    attendedBy: draft.attendedBy.trim(),
    /* The P6 register carries the caesarean indication in `complications`, which is where `checkBirth` reads it —
       the array is what happened in labour, and the indication is the first thing that happened. */
    complications: [
      ...(draft.complications ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      ...(draft.indication?.trim() && draft.type === 'Caesarean' ? [`Caesarean indication: ${draft.indication.trim()}`] : []),
    ],
    vitaminKGiven: bool(draft, 'vitaminK'),
    bcgGiven: bool(draft, 'bcg'),
    firstFeedAt: draft.firstFeed ? `${draft.birthDate} ${draft.firstFeed}` : null,
    civil: {
      state: (draft.civilState as BirthRecord['civil']['state']) ?? 'Not yet filed',
      number: draft.civilNumber.trim() || null,
      ...(draft.registerNote?.trim() ? { note: draft.registerNote.trim() } : {}),
    },
    dischargeAt: draft.dischargeDate ? `${draft.dischargeDate} 11:00` : null,
    ...(draft.deliveryNote?.trim() ? { note: draft.deliveryNote.trim() } : {}),
  };
}

/** The death record as the register holds it. */
export function deathFromDraft(draft: Draft, dayIso: string): DeathRecord {
  const patient = patients.find((p) => p.mrn === draft.patientMrn.trim());
  const referred = draft.manner !== 'Natural';
  return {
    id: `death-form-${draft.registerNo}`,
    registerNo: draft.registerNo,
    at: `${draft.deathDate} ${draft.deathTime}`,
    kind: (draft.deathKind as DeathRecord['kind']) ?? 'In-patient',
    patient: draft.patientName.trim()
      ? { mrn: draft.patientMrn.trim() || 'UNREGISTERED', name: draft.patientName.trim(), nameBn: patient?.nameBn ?? '', age: int(draft, 'age') || patient?.age || 0, sex: (patient?.sex as 'Male' | 'Female' | undefined) ?? (draft.sex as 'Male' | 'Female' | undefined) ?? 'Male' }
      : null,
    wardId: draft.wardBed === 'Brought in dead' ? null : draft.wardBed,
    admittedAt: draft.admittedAt ? `${draft.admittedAt} ${draft.deathTime}` : null,
    cause: { immediate: draft.immediateCause.trim(), antecedent: draft.antecedentCause.trim(), underlying: draft.underlyingCause.trim(), icd: draft.icdCode.trim() },
    manner: (draft.manner as DeathRecord['manner']) ?? 'Natural',
    police: referred && draft.policeStation.trim() ? { station: draft.policeStation.trim(), referredAt: `${draft.deathDate} ${draft.deathTime}`, officer: 'Duty officer' } : null,
    postMortemReferred: bool(draft, 'postMortemReferred'),
    certifiedBy: draft.certifiedBy.trim() || null,
    certifiedAt: draft.certifiedBy.trim() ? `${draft.deathDate} ${draft.deathTime}` : null,
    certificateNo: draft.certificateNo.trim() || null,
    releasedAt: draft.releasedTo.trim() ? `${draft.deathDate} 15:30` : null,
    releasedTo: draft.releasedTo.trim() ? `${draft.releasedTo.trim()}${draft.releasedRelation?.trim() ? ` (${draft.releasedRelation.trim()})` : ''}` : null,
    civil: { state: (draft.civilState as DeathRecord['civil']['state']) ?? 'Not yet filed', number: draft.civilNumber?.trim() || null },
    ...(draft.deathNote?.trim() ? { note: draft.deathNote.trim() } : {}),
  } as DeathRecord;
}

/** The register’s own verdict on a draft, from the same rules the report prints. */
export function checkBirthDraft(draft: Draft, dayIso: string): VitalCheck {
  const record = birthFromDraft(draft, dayIso);
  const reasons = checkBirth(record).reasons.slice();
  if (!draft.weightGrams.trim()) reasons.push({ code: 'no-weight', message: 'A birth is recorded with the baby’s weight. Under 2 500 g the baby is a low-birth-weight baby with a feeding plan and a follow-up date, and nobody can work that out from a blank field.' });
  if (draft.outcome === 'Live birth' && (!draft.apgarOne.trim() || !draft.apgarFive.trim())) reasons.push({ code: 'no-apgar', message: 'A live birth carries an Apgar at one and five minutes: it is how the resuscitation decision is read afterwards.' });
  if (!draft.gravidaPara.trim()) reasons.push({ code: 'no-gravida', message: 'Gravida and para go on the register: the next pregnancy is planned around this line, and “first baby” is not a safe assumption.' });
  return { ...checkBirth(record), ok: reasons.length === 0, reasons };
}

export function checkDeathDraft(draft: Draft, dayIso: string): VitalCheck {
  const record = deathFromDraft(draft, dayIso);
  const reasons = checkDeath(record).reasons.slice();
  if (draft.manner !== 'Natural' && !draft.policeStation.trim()) {
    reasons.push({ code: 'no-station', message: 'A death referred to the police names the station. Without it the referral is a sentence in a note rather than a record the station can be asked about.' });
  }
  if (!draft.releasedTo.trim() && draft.releasedRelation.trim()) {
    reasons.push({ code: 'relation-without-name', message: 'A relationship without a name tells nobody who collected the body. The register keeps both, and a relationship alone is the one half that cannot be checked.' });
  }
  return { ...checkDeath(record), ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------------------- the register the screens read */

export interface RegistryDay {
  day: string;
  births: BirthRecord[];
  deaths: DeathRecord[];
  /** Entries made on this device that the cloud has not seen: they are in the register below and not in the report yet. */
  queuedBirths: number;
  queuedDeaths: number;
}

/** The day’s register: the P6 records plus anything written here that is still in the outbox. */
export function registryDay(dayIso: string, localBirths: BirthRecord[] = [], localDeaths: DeathRecord[] = []): RegistryDay {
  const register = birthDeathDay(dayIso);
  return {
    day: dayIso,
    births: [...localBirths, ...register.births],
    deaths: [...localDeaths, ...register.deaths],
    queuedBirths: localBirths.filter((b) => b.at.slice(0, 10) === dayIso).length,
    queuedDeaths: localDeaths.filter((d) => d.at.slice(0, 10) === dayIso).length,
  };
}

export const REGISTRY_NOTE =
  'A birth or a death written on this screen is queued through the contract and appears in Reports › Birth Death once the server has it. The report reads the register, and the register is the hospital’s own series — gapless, never reused, which is what makes a missing entry visible.';

/** Fields in one section, in the order the form shows them — the sections are the fields' own, not a second list. */
export const sectionsOf = (fields: RegistryField[]): Array<{ section: string; fields: RegistryField[] }> => {
  const out: Array<{ section: string; fields: RegistryField[] }> = [];
  for (const field of fields) {
    const last = out.find((s) => s.section === field.section);
    if (last) last.fields.push(field);
    else out.push({ section: field.section, fields: [field] });
  }
  return out;
};
