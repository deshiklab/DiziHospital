/* ----------------------------------------------------------------------------------------------------
 * Certificates and identity cards (P8) — the numbered documents a hospital hands over.
 *
 * Three screens over one idea: a document with a number on it, printed here, and handed to a person who will
 * still be holding it when the uplink comes back. That is why the number comes from a block already reserved to
 * this node — the certificate or the card can be printed now, and the register entry drains later. It is also why
 * nothing in this module is ever edited in place: a certificate that has been handed over is a fact, and a wrong
 * one is superseded or revoked, with the reason on the register.
 *
 * The rules are the substance, because a certificate is a statement the hospital signs its name to:
 *
 *   - a medical certificate needs a consultation inside the last ninety days, and a fitness certificate needs the
 *     vitals from that consultation. A certificate the hospital cannot point at evidence for is a letter, not a
 *     medical certificate;
 *   - an experience certificate needs a staff record that has actually been a record for long enough to have
 *     experience, and a character certificate needs a completed probation;
 *   - a card needs a photograph, its holder's name in Bangla, and — for a clinical staff member — cannot outlive
 *     the professional licence the card is the physical evidence of;
 *   - a revoked card or certificate never releases its number back into the series.
 */

export type CertificateKind = 'medical' | 'fitness' | 'vaccination' | 'experience' | 'salary' | 'character' | 'referral';
export type CardSubject = 'staff' | 'patient';

export interface CertificateSpec {
  kind: CertificateKind;
  label: string;
  /** What the certificate is for, in the terms the register stores. */
  purpose: string;
  /** The evidence the hospital must already hold. This is what makes each kind more than a template. */
  evidence: string;
  /** The template key on the printing side, so the sheet and the register cannot disagree. */
  templateKey: string;
  /** Who may sign it. A salary certificate is not signed by a registrar, however helpful they are. */
  issuedBy: string;
  defaultValidityDays: number;
  /** What the certificate may not say, which is usually the more useful half. */
  cannot: string;
}

export const CERTIFICATE_KINDS: CertificateSpec[] = [
  { kind: 'medical', label: 'Medical certificate', purpose: 'Illness, fitness for work, rest, or the reason a patient could not attend', evidence: 'A consultation at this hospital in the last 90 days, with the diagnosis recorded on it', templateKey: 'certificate-medical', issuedBy: 'The treating consultant or registrar of the visit it refers to', defaultValidityDays: 30, cannot: 'Certify a diagnosis nobody here made, or a period of rest longer than the illness the consultant recorded' },
  { kind: 'fitness', label: 'Fitness certificate', purpose: 'Return to work, fitness for surgery, fitness to travel', evidence: 'The last recorded vitals and the consultation they belong to — a fitness opinion is an opinion about a person’s body today', templateKey: 'certificate-medical', issuedBy: 'The consultant who examined the patient, and never the desk', defaultValidityDays: 14, cannot: 'Certify fitness on vitals older than the visit it is written from, or sign off a fitness assessment as the records clerk' },
  { kind: 'vaccination', label: 'Vaccination certificate', purpose: 'Proof of vaccination for travel, for school or for an employer', evidence: 'The doses on the patient’s record, with batch numbers', templateKey: 'certificate-medical', issuedBy: 'The vaccination clinic', defaultValidityDays: 365, cannot: 'Certify a dose the hospital did not give, or a batch number it does not hold' },
  { kind: 'experience', label: 'Experience certificate', purpose: 'Employment history for a member of staff leaving or applying elsewhere', evidence: 'The staff record: joining date, designation, department and the employment history behind it', templateKey: 'certificate-experience', issuedBy: 'Human resources, countersigned by the head of department', defaultValidityDays: 0, cannot: 'Backdate a designation the record does not show, or omit a disciplinary finding the record holds' },
  { kind: 'salary', label: 'Salary certificate', purpose: 'Proof of income for a loan, a visa or a landlord', evidence: 'A payroll run that includes the staff member, for each month the certificate states', templateKey: 'certificate-experience', issuedBy: 'Accounts, against the payroll register', defaultValidityDays: 30, cannot: 'State a figure the payroll register does not show, including allowances a stopped run removed' },
  { kind: 'character', label: 'Character certificate', purpose: 'A statement about a member of staff for an employer or an authority', evidence: 'A staff record past probation, with no unresolved disciplinary case on it', templateKey: 'certificate-experience', issuedBy: 'Human resources, with the branch head’s signature', defaultValidityDays: 90, cannot: 'Be issued during probation, or while a disciplinary case is open — the certificate would hide a process that has not finished' },
  { kind: 'referral', label: 'Referral letter', purpose: 'Referring a patient to another hospital or a specialist', evidence: 'The diagnosis being referred, the treatment already given, and the question the referral is asking', templateKey: 'certificate-medical', issuedBy: 'The consultant who is making the referral', defaultValidityDays: 60, cannot: 'Refer a patient whose diagnosis is not recorded, or ask a question the record does not reach' },
];

export const certificateSpec = (kind: CertificateKind): CertificateSpec => CERTIFICATE_KINDS.find((c) => c.kind === kind) ?? CERTIFICATE_KINDS[0];

/* ------------------------------------------------------------------ the number blocks
 *
 * The design decision the whole module rests on: numbers are drawn from a block already reserved to this node, so
 * a certificate or a card can be printed with the uplink down and the register entry drains later. Gaps are
 * accepted — a number drawn and never used is a gap, not a reuse — and a block that runs out stops the desk
 * rather than letting it invent a number.
 */

export interface NumberBlock {
  series: string;
  node: string;
  from: number;
  to: number;
  issued: number;
  /** The counter is the number last drawn, which is not always `from + issued - 1`: a reprint draws nothing. */
  lastDrawn: number;
  reservedOn: string;
}

export const NUMBER_BLOCKS: NumberBlock[] = [
  { series: 'CERT-2026', node: 'DHK-01', from: 5001, to: 5500, issued: 137, lastDrawn: 5138, reservedOn: '2026-01-04' },
  { series: 'CARD-S-2026', node: 'DHK-01', from: 1001, to: 2000, issued: 214, lastDrawn: 1215, reservedOn: '2026-01-04' },
  { series: 'CARD-P-2026', node: 'DHK-01', from: 3001, to: 4000, issued: 388, lastDrawn: 3389, reservedOn: '2026-01-04' },
  /* The node that has run out: the case the refusal exists for. */
  { series: 'CERT-U-2026', node: 'DHK-02', from: 7001, to: 7100, issued: 100, lastDrawn: 7100, reservedOn: '2026-01-04' },
];

export const blockFor = (series: string): NumberBlock | undefined => NUMBER_BLOCKS.find((b) => b.series === series);

export const blockRemaining = (block: NumberBlock): number => Math.max(0, block.to - block.lastDrawn);
export const blockExhausted = (block: NumberBlock): boolean => blockRemaining(block) === 0;

/** The next number this node would draw. It does not advance the block — the write does, on the node. */
export const nextNumber = (block: NumberBlock): string => `${block.series.replace(/-2026$/, '')}/${block.lastDrawn + 1}`;

export interface Certificate {
  no: string;
  kind: CertificateKind;
  subjectKind: CardSubject;
  subjectMrn: string;
  subjectName: string;
  subjectStaffCode: string;
  purpose: string;
  body: string;
  issuedBy: string;
  issuedOn: string;
  validUntil: string | null;
  templateKey: string;
  status: 'issued' | 'superseded' | 'revoked';
  supersedes: string;
  revokedOn: string | null;
  revokeReason: string;
  printed: number;
  /** The consultation or payroll run the certificate points at: the evidence, named on the register. */
  evidenceRef: string;
}

const cert = (
  no: number,
  kind: CertificateKind,
  subjectKind: CardSubject,
  subjectName: string,
  subjectMrn: string,
  subjectStaffCode: string,
  purpose: string,
  issuedBy: string,
  issuedOn: string,
  validUntil: string | null,
  status: Certificate['status'],
  evidenceRef: string,
  printed: number,
  body = '',
  supersedes = '',
  revokedOn: string | null = null,
  revokeReason = '',
): Certificate => ({
  no: `CERT/${no}`,
  kind,
  subjectKind,
  subjectMrn,
  subjectName,
  subjectStaffCode,
  purpose,
  body,
  issuedBy,
  issuedOn,
  validUntil,
  templateKey: certificateSpec(kind).templateKey,
  status,
  supersedes,
  revokedOn,
  revokeReason,
  printed,
  evidenceRef,
});

export const CERTIFICATES: Certificate[] = [
  cert(5138, 'medical', 'patient', 'Rafiqul Hasan', 'SH-102341', '', 'Employer — leave of absence, 12 to 16 October 2026', 'Dr. N. Islam (Cardiology)', '2026-10-16', '2026-11-15', 'issued', 'OPD visit 2026-10-15, cardiology', 1, 'Admitted 13–15 October 2026 for hypertensive urgency. Rest advised to 20 October 2026.'),
  cert(5137, 'fitness', 'patient', 'Shahidul Islam', 'SH-102388', '', 'Employer — return to work after orthopaedic surgery', 'Dr. M. Khan (Orthopaedics)', '2026-10-16', '2026-10-30', 'issued', 'Post-operative review 2026-10-15, orthopaedics', 2, 'Fit for desk work from 20 October 2026. Not fit for lifting above five kilograms until 20 November 2026.'),
  cert(5136, 'vaccination', 'patient', 'Ayesha Siddika', 'SH-102398', '', 'School admission — EPI schedule', 'N. Sultana (Paediatrics)', '2026-10-15', '2027-10-15', 'issued', 'EPI card, doses to 2026-09-30', 1, 'BCG, OPV 0–4, Pentavalent 1–3, MR 1–2 as recorded. Batch numbers on the attached schedule.'),
  cert(5135, 'referral', 'patient', 'Kamrul Hossain', 'SH-102402', '', 'Referral to the National Institute of Cardiovascular Diseases', 'Dr. S. Chowdhury (Medicine)', '2026-10-15', '2026-12-14', 'issued', 'OPD visits 2026-09-20 and 2026-10-14, medicine', 1, 'Type 2 diabetes with a rising fasting glucose and new exertional chest pain. Question: does this need angiography, and if so, how soon?'),
  cert(5134, 'salary', 'staff', 'N. Sultana', '', 'EMP-1055', 'Bank — mortgage application, April to September 2026', 'Accounts (R. Howlader)', '2026-10-14', '2026-11-13', 'issued', 'Payroll runs 2026-04 to 2026-09, Main Campus', 1),
  cert(5133, 'experience', 'staff', 'H. Mia', '', 'EMP-1120', 'Pharmacist council — registration renewal', 'Human resources (R. Howlader)', '2026-10-13', null, 'issued', 'Staff record EMP-1120, joined 2019-03-11', 1),
  cert(5132, 'character', 'staff', 'M. Ali', '', 'EMP-1013', 'Passport office', 'Human resources (R. Howlader)', '2026-10-08', '2027-01-06', 'issued', 'Staff record EMP-1013, probation completed 2018-07-01', 1),
  /* Superseded, because the hospital was wrong the first time — not because the patient was. */
  cert(5129, 'medical', 'patient', 'Rehana Parvin', 'SH-102361', '', 'Employer — leave of absence, 2 to 6 October 2026', 'Dr. A. Rahman (Medicine)', '2026-10-02', '2026-11-01', 'superseded', 'OPD visit 2026-10-01, medicine', 1, 'Rest advised 2–6 October 2026.', '', null, ''),
  cert(5127, 'medical', 'patient', 'Rehana Parvin', 'SH-102361', '', 'Employer — leave of absence, 2 to 9 October 2026', 'Dr. A. Rahman (Medicine)', '2026-10-03', '2026-11-02', 'issued', 'OPD visit 2026-10-01, medicine', 1, 'Rest advised 2–9 October 2026: the earlier certificate dated the return a week too early.', 'CERT/5129'),
  /* Revoked: the numbers stay out of circulation, and the register says why. */
  cert(5121, 'fitness', 'patient', 'Mizanur Rahman', 'SH-102410', '', 'School — sports participation', 'R. Howlader (Records)', '2026-09-28', '2026-10-12', 'revoked', 'No consultation located', 1, '', '', '2026-09-29', 'Signed by the records desk rather than the examining consultant. Revoked the next morning, and the family was telephoned before the school received it.'),
];

export interface IdentityCard {
  no: string;
  subject: CardSubject;
  holderName: string;
  holderNameBn: string;
  staffCode: string;
  mrn: string;
  designation: string;
  department: string;
  bloodGroup: string;
  phone: string;
  address: string;
  photoRef: string;
  validUntil: string;
  issuedOn: string;
  issuedBy: string;
  templateKey: string;
  status: 'active' | 'superseded' | 'revoked';
  supersedes: string;
  revokedOn: string | null;
  revokeReason: 'LOST' | 'DAMAGED' | 'REPLACED' | 'LEFT SERVICE' | 'OTHER' | '';
  printed: number;
  /** A card is issued against a licence for clinical staff, and cannot outlive it. */
  licenceExpiry: string | null;
}

const card = (
  no: string,
  subject: CardSubject,
  holderName: string,
  holderNameBn: string,
  ids: { staffCode?: string; mrn?: string },
  role: [string, string],
  bloodGroup: string,
  phone: string,
  address: string,
  photoRef: string,
  validUntil: string,
  issuedOn: string,
  issuedBy: string,
  status: IdentityCard['status'],
  printed: number,
  extra: Partial<IdentityCard> = {},
): IdentityCard => ({
  no,
  subject,
  holderName,
  holderNameBn,
  staffCode: ids.staffCode ?? '',
  mrn: ids.mrn ?? '',
  designation: role[0],
  department: role[1],
  bloodGroup,
  phone,
  address,
  photoRef,
  validUntil,
  issuedOn,
  issuedBy,
  templateKey: subject === 'staff' ? 'id-card-staff' : 'id-card-patient',
  status,
  supersedes: '',
  revokedOn: null,
  revokeReason: '',
  printed,
  licenceExpiry: null,
  ...extra,
});

export const IDENTITY_CARDS: IdentityCard[] = [
  card('CARD/S/1215', 'staff', 'Dr. N. Islam', 'ডা. এন. ইসলাম', { staffCode: 'EMP-1031' }, ['Consultant', 'Cardiology'], 'B+', '01711-405061', 'House 12, Road 7, Dhanmondi, Dhaka', 'photo/EMP-1031-2026.jpg', '2027-06-30', '2026-07-01', 'R. Howlader', 'active', 1, { licenceExpiry: '2027-06-30' }),
  card('CARD/S/1214', 'staff', 'N. Sultana', 'নাসরিন সুলতানা', { staffCode: 'EMP-1055' }, ['Senior staff nurse', 'Paediatrics'], 'O+', '01712-338214', 'Flat 3B, Mirpur 10, Dhaka', 'photo/EMP-1055-2026.jpg', '2029-07-31', '2026-08-01', 'R. Howlader', 'active', 1),
  card('CARD/S/1213', 'staff', 'M. Ali', 'মো. আলী', { staffCode: 'EMP-1013' }, ['Ward manager', 'Nursing'], 'A+', '01715-992731', 'Sector 4, Uttara, Dhaka', 'photo/EMP-1013-2026.jpg', '2029-08-31', '2026-09-01', 'R. Howlader', 'active', 1),
  card('CARD/P/3389', 'patient', 'Rafiqul Hasan', 'রফিকুল হাসান', { mrn: 'SH-102341' }, ['', ''], 'B+', '01818-447203', 'Village Bashabo, Dhaka', '', '2031-10-15', '2026-10-16', 'R. Howlader', 'active', 1),
  card('CARD/P/3388', 'patient', 'Fatema Begum', 'ফাতেমা বেগম', { mrn: 'SH-102355' }, ['', ''], 'O−', '01912-883044', 'Mohakhali, Dhaka', '', '2031-10-14', '2026-10-15', 'R. Howlader', 'active', 1, { supersedes: 'CARD/P/2011' }),
  card('CARD/P/3387', 'patient', 'Ayesha Siddika', 'আয়েশা সিদ্দিকা', { mrn: 'SH-102398' }, ['', ''], 'A+', '01777-201558', 'Tikatuli, Dhaka', 'photo/SH-102398-2026.jpg', '2029-10-15', '2026-10-15', 'R. Howlader', 'active', 1),
  /* Superseded: the card was reissued for a corrected Bangla spelling, which is a real reason. */
  card('CARD/P/2011', 'patient', 'Fatema Begum', 'ফাতেমা বেগম', { mrn: 'SH-102355' }, ['', ''], 'O−', '01912-883044', 'Mohakhali, Dhaka', '', '2029-03-02', '2024-03-02', 'S. Ahmed', 'superseded', 1, { revokedOn: '2026-10-15', revokeReason: 'REPLACED' }),
  /* The card that is the reason the register exists: reported lost, and dead in the register the same morning. */
  card('CARD/S/1099', 'staff', 'K. Barua', 'কে. বরুয়া', { staffCode: 'EMP-1160' }, ['Store keeper', 'Stores'], 'AB+', '01611-774400', 'Narayanganj', 'photo/EMP-1160-2025.jpg', '2027-11-30', '2025-12-01', 'R. Howlader', 'revoked', 1, { revokedOn: '2026-10-11', revokeReason: 'LOST' }),
];

export const certificateByNo = (no: string): Certificate | undefined => CERTIFICATES.find((c) => c.no === no);
export const cardByNo = (no: string): IdentityCard | undefined => IDENTITY_CARDS.find((c) => c.no === no);

/* ------------------------------------------------------------------ the card’s fields, per subject */

export interface CardField {
  key: string;
  label: string;
  /** Printed on a staff card. */
  staff: boolean;
  /** Printed on a patient card. */
  patient: boolean;
  /** Where the value comes from: a field from a record, or typed at the desk. */
  source: string;
  required: boolean;
  /** The rule the field carries, when it has one. */
  rule?: string;
}

export const CARD_FIELDS: CardField[] = [
  { key: 'no', label: 'Card number', staff: true, patient: true, source: 'The node’s card series, drawn when the card is issued', required: true, rule: 'From the block reserved to this node, so a card can be printed with the uplink down. A card number never returns to the series, not even a revoked one.' },
  { key: 'holderName', label: 'Name', staff: true, patient: true, source: 'The staff or patient record', required: true },
  { key: 'holderNameBn', label: 'Name in Bangla', staff: true, patient: true, source: 'The record’s Bangla name', required: true, rule: 'A card is read by its holder and by a guard at the gate, and both read Bangla first. The screen refuses to transliterate: the Bangla name comes from the record or the card is not printed.' },
  { key: 'photoRef', label: 'Photograph', staff: true, patient: false, source: 'The staff photograph on the node', required: true, rule: 'A staff card without a photograph is a card that identifies nobody. A patient card may be issued without one, and then prints an explicit “no photograph” block rather than a placeholder face.' },
  { key: 'designation', label: 'Designation', staff: true, patient: false, source: 'The staff record’s designation', required: true, rule: 'Taken from the register, never typed: the card and the payroll have to say the same thing about a person.' },
  { key: 'department', label: 'Department', staff: true, patient: false, source: 'The staff record', required: true },
  { key: 'staffCode', label: 'Employee number', staff: true, patient: false, source: 'The staff record', required: true, rule: 'The number the roster, the gate and the payroll all resolve back to. The card carries it so that a shift can be checked without a system.' },
  { key: 'bloodGroup', label: 'Blood group', staff: true, patient: true, source: 'The record, where it is known', required: false, rule: 'Empty prints as “not known”, which is honest. A guessed blood group on a card is worse than no blood group on a card.' },
  { key: 'phone', label: 'Phone', staff: true, patient: true, source: 'The record', required: false },
  { key: 'address', label: 'Address', staff: false, patient: true, source: 'The patient record', required: false },
  { key: 'mrn', label: 'MRN', staff: false, patient: true, source: 'The patient record', required: true, rule: 'The MRN is the identity of a patient card. A card with a name and no MRN cannot be looked up at the desk, which is the only thing the card is for.' },
  { key: 'validUntil', label: 'Valid until', staff: true, patient: true, source: 'The validity rule for the subject', required: true, rule: 'A clinical staff card cannot outlive the professional licence it is evidence of; a patient card runs five years at most, because the photograph stops identifying anybody after that.' },
  { key: 'issuedOn', label: 'Issued on', staff: true, patient: true, source: 'The day it was printed', required: true },
  { key: 'status', label: 'State', staff: true, patient: true, source: 'The register', required: true, rule: 'Active, superseded or revoked. A superseded card is not the same as a lost one, and the difference is the sentence a security desk acts on.' },
  { key: 'printed', label: 'Prints', staff: true, patient: true, source: 'The register', required: true, rule: 'Counted because a card is a physical object: “printed twice” is a question a security review asks, and the register has to have an answer.' },
];

export const cardFieldsFor = (subject: CardSubject): CardField[] => CARD_FIELDS.filter((f) => (subject === 'staff' ? f.staff : f.patient));

/* ------------------------------------------------------------------ the refusals */

export interface DocumentIssue {
  code: string;
  message: string;
}

export interface DocumentCheck {
  ok: boolean;
  reasons: DocumentIssue[];
  warnings: DocumentIssue[];
}

export interface CertificateDraft {
  kind: CertificateKind;
  subjectKind: CardSubject;
  subjectMrn: string;
  subjectStaffCode: string;
  subjectName: string;
  purpose: string;
  body: string;
  validUntil: string;
  supersedes: string;
}

export interface Evidence {
  /** The last consultation this hospital holds for the patient, and its date. */
  lastConsultationOn: string | null;
  /** Whether the last consultation recorded the diagnosis the certificate is about. */
  diagnosisRecorded: boolean;
  /** Whether vitals were taken at that consultation. */
  vitalsRecorded: boolean;
  /** The staff record, for staff certificates. */
  staffJoinedOn: string | null;
  probationEndsOn: string | null;
  disciplinaryOpen: boolean;
  /** Payroll runs that include the staff member, by month. */
  payrollMonths: string[];
  /** For clinical staff: the professional licence the card is evidence of. */
  licenceExpiry: string | null;
}

export interface DocumentContext {
  today: string;
  certificates: Certificate[];
  cards: IdentityCard[];
  evidence: Evidence;
  /** The block the number will be drawn from. */
  block: NumberBlock;
  /** Who is signed in, and what they may sign. */
  signedInRole: string;
  signedInName: string;
}

const days = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function checkCertificate(draft: CertificateDraft, ctx: DocumentContext): DocumentCheck {
  const reasons: DocumentIssue[] = [];
  const warnings: DocumentIssue[] = [];
  const spec = certificateSpec(draft.kind);
  const isStaff = draft.kind === 'experience' || draft.kind === 'salary' || draft.kind === 'character';

  if (isStaff && draft.subjectKind !== 'staff') {
    reasons.push({ code: 'wrong-subject', message: `A ${spec.label.toLowerCase()} is about a member of staff. This is a patient certificate: the register keeps the two series apart so that a patient’s documents are not filed among the payroll’s.` });
  }
  if (!isStaff && draft.subjectKind !== 'patient') {
    reasons.push({ code: 'wrong-subject', message: `A ${spec.label.toLowerCase()} is about a patient. Use the staff series for staff documents — an experience certificate in the patient series is unfindable when the staff member applies for a licence renewal.` });
  }
  if (!draft.purpose.trim()) {
    reasons.push({ code: 'no-purpose', message: 'Say who it is for and what for. A certificate without a stated purpose is a template with a signature on it, and it will be used for something nobody intended.' });
  }
  if (!draft.subjectName.trim()) {
    reasons.push({ code: 'no-subject', message: 'The certificate needs a subject. Name the person from their record rather than typing a name, so the number and the person are joined by the register and not by the paper.' });
  }
  if (draft.subjectKind === 'patient' && !draft.subjectMrn.trim()) {
    reasons.push({ code: 'no-mrn', message: 'A certificate about a patient carries the MRN. The evidence rules are checked against that record, and without it a medical certificate has no consultation behind it.' });
  }
  if (draft.subjectKind === 'staff' && !draft.subjectStaffCode.trim()) {
    reasons.push({ code: 'no-staff-code', message: 'A staff certificate carries the employee number. Until it does, the register cannot prove the person had the experience, the salary or the probation it certifies.' });
  }
  if (blockExhausted(ctx.block)) {
    reasons.push({
      code: 'number-block-exhausted',
      message: `dizi.number-block-exhausted — ${ctx.block.node} has drawn every number in its ${ctx.block.series} block (through ${ctx.block.lastDrawn}). The desk stops issuing rather than writing a number it invented, because the number is what the register finds the certificate by.`,
    });
  }

  /* The evidence rules: one per kind, and each one is the reason the kind exists. */
  if ((draft.kind === 'medical' || draft.kind === 'fitness' || draft.kind === 'referral' || draft.kind === 'vaccination') && ctx.evidence.lastConsultationOn) {
    const age = days(ctx.evidence.lastConsultationOn, ctx.today);
    if (draft.kind === 'medical' && age > 90) {
      reasons.push({ code: 'stale-consultation', message: `The last consultation for this patient was ${age} days ago (${ctx.evidence.lastConsultationOn}). A medical certificate is a statement about an illness the hospital saw, and ninety days is where that stops being true.` });
    }
    if (draft.kind === 'fitness' && !ctx.evidence.vitalsRecorded) {
      reasons.push({ code: 'no-vitals', message: 'A fitness certificate is an opinion about a person’s body today, so it needs the vitals from the consultation it is written from. None were recorded.' });
    }
    if (draft.kind === 'referral' && !ctx.evidence.diagnosisRecorded) {
      reasons.push({ code: 'no-diagnosis', message: 'The referral needs the diagnosis being referred, and the record does not have one. A referral letter that asks a question without stating what is known arrives back with the same question.' });
    }
    if (draft.kind === 'vaccination' && !ctx.evidence.lastConsultationOn) {
      reasons.push({ code: 'no-record', message: 'No vaccination history on this record. A vaccination certificate may only state doses this hospital gave, with the batch numbers it holds.' });
    }
  }
  if (draft.kind === 'character' && ctx.evidence.probationEndsOn && ctx.evidence.probationEndsOn > ctx.today) {
    reasons.push({ code: 'in-probation', message: `This member of staff is still on probation until ${ctx.evidence.probationEndsOn}. A character certificate written before probation ends certifies a judgement nobody has made yet.` });
  }
  if (draft.kind === 'character' && ctx.evidence.disciplinaryOpen) {
    reasons.push({ code: 'disciplinary-open', message: 'There is an open disciplinary case. A character certificate issued now would hide a process that has not finished — wait for the outcome and the certificate can state it.' });
  }
  if (draft.kind === 'salary' && ctx.evidence.payrollMonths.length === 0) {
    reasons.push({ code: 'no-payroll', message: 'No payroll run holds this staff member. A salary certificate states figures the payroll register shows, and this one would be stating figures nobody can check.' });
  }
  if (draft.kind === 'experience' && ctx.evidence.staffJoinedOn && days(ctx.evidence.staffJoinedOn, ctx.today) < 30) {
    warnings.push({ code: 'short-service', message: `Joined ${ctx.evidence.staffJoinedOn} — less than a month of service. The certificate can state that, and it is usually more useful to the person than a letter that hides it.` });
  }

  if (draft.validUntil && draft.validUntil < ctx.today) {
    reasons.push({ code: 'already-expired', message: 'The validity date has already passed. A certificate that expires before it is printed is one the receiving office will refuse on sight.' });
  }
  if (spec.defaultValidityDays > 0 && draft.validUntil && days(ctx.today, draft.validUntil) > spec.defaultValidityDays * 3) {
    warnings.push({ code: 'long-validity', message: `${spec.label} is usually valid for ${spec.defaultValidityDays} days; this one runs for ${days(ctx.today, draft.validUntil)}. A long validity is a statement the hospital is making about a future it cannot see.` });
  }
  if (draft.supersedes) {
    const original = ctx.certificates.find((c) => c.no === draft.supersedes);
    if (!original) {
      reasons.push({ code: 'unknown-original', message: `There is no certificate ${draft.supersedes} on the register. A superseding certificate has to point at the one it replaces, or two certificates exist with nobody to say which is current.` });
    } else if (original.status === 'revoked') {
      reasons.push({ code: 'supersede-revoked', message: `${draft.supersedes} was revoked rather than superseded (${original.revokeReason}). Issue a fresh certificate with no supersedes link: a revocation is a statement that the earlier document should never have existed.` });
    } else if (original.supersedes) {
      warnings.push({ code: 'supersede-chain', message: `${draft.supersedes} itself supersedes ${original.supersedes}. A chain of three is usually a symptom rather than a correction — check which version the receiving office actually has.` });
    }
  }
  if (draft.subjectKind === 'patient' && !ctx.evidence.lastConsultationOn && (draft.kind === 'medical' || draft.kind === 'fitness')) {
    reasons.push({ code: 'never-seen', message: 'This patient has no consultation at this hospital. A medical or fitness certificate may not be issued for somebody the hospital has not examined — the alternative is a letter with a hospital’s name on it and nothing behind it.' });
  }
  if (spec.issuedBy.startsWith('The consultant') && /records|clerk|reception/i.test(ctx.signedInRole)) {
    reasons.push({ code: 'wrong-signer', message: `${spec.label} is signed by ${spec.issuedBy.toLowerCase()}. The signed-in role is ${ctx.signedInRole}, and a fitness certificate signed by the records desk is the one kind of error that gets a certificate withdrawn after it has been used.` });
  }
  if (!draft.body.trim() && (draft.kind === 'medical' || draft.kind === 'fitness' || draft.kind === 'referral')) {
    warnings.push({ code: 'no-body', message: 'The body is empty, so the sheet will print the standard wording for this kind. Add a sentence when the receiving office needs the specifics — it is the difference between a certificate and a form.' });
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

export interface CardDraft {
  subject: CardSubject;
  holderName: string;
  holderNameBn: string;
  staffCode: string;
  mrn: string;
  designation: string;
  department: string;
  bloodGroup: string;
  phone: string;
  address: string;
  photoRef: string;
  validUntil: string;
  supersedes: string;
}

export function checkCard(draft: CardDraft, ctx: DocumentContext): DocumentCheck {
  const reasons: DocumentIssue[] = [];
  const warnings: DocumentIssue[] = [];
  const isStaff = draft.subject === 'staff';

  if (!draft.holderName.trim()) {
    reasons.push({ code: 'no-holder', message: 'Name the holder from their record. A card is a physical identity document, and a typed name is how two records end up with one card between them.' });
  }
  if (!draft.holderNameBn.trim()) {
    reasons.push({ code: 'no-bangla-name', message: 'The Bangla name is required. The card is read by its holder and by a guard at the gate, and both read Bangla first — the screen will not transliterate a name for them.' });
  }
  if (isStaff && !draft.staffCode.trim()) {
    reasons.push({ code: 'no-staff-code', message: 'A staff card carries the employee number. Without it the card cannot be matched to a shift, which is the first thing a gate or a fire roll call needs.' });
  }
  if (isStaff && !draft.photoRef.trim()) {
    reasons.push({ code: 'no-photo', message: 'A staff card without a photograph identifies nobody. A patient card may be issued without one and prints an explicit “no photograph” block instead — a staff card may not.' });
  }
  if (!isStaff && !draft.mrn.trim()) {
    reasons.push({ code: 'no-mrn', message: 'A patient card carries the MRN. It is the only thing that makes the card worth carrying: a name and a blood group at a desk is a search, and an MRN is an answer.' });
  }
  if (blockExhausted(ctx.block)) {
    reasons.push({
      code: 'number-block-exhausted',
      message: `dizi.number-block-exhausted — ${ctx.block.node} has drawn every number in its ${ctx.block.series} block (through ${ctx.block.lastDrawn}). The card desk waits for a new block instead of writing a number it invented.`,
    });
  }
  if (!draft.validUntil) {
    reasons.push({ code: 'no-validity', message: 'A card needs a validity date. A card with no expiry is one nobody ever reviews, and the photograph on it stops identifying anybody within a few years.' });
  }
  if (draft.validUntil && draft.validUntil < ctx.today) {
    reasons.push({ code: 'expired-on-issue', message: 'That validity date has passed. A card that expires before it is printed is worse than no card: the person carries it and assumes it works.' });
  }
  if (isStaff && ctx.evidence.probationEndsOn === null && ctx.evidence.staffJoinedOn === null) {
    reasons.push({ code: 'no-staff-record', message: 'No staff record for this employee number. A card is issued against the register — otherwise a card exists for somebody the hospital cannot roster, pay or account for.' });
  }
  if (isStaff && ctx.evidence.licenceExpiry && draft.validUntil > ctx.evidence.licenceExpiry) {
    reasons.push({ code: 'outlives-licence', message: `The card would be valid until ${draft.validUntil} and the professional licence expires ${ctx.evidence.licenceExpiry}. A hospital card is the physical evidence that somebody may practise here, so it cannot outlive the licence.` });
  }
  if (!draft.bloodGroup.trim()) {
    warnings.push({ code: 'no-blood-group', message: 'Blood group unknown: the card will print “not known”. That is the honest answer, and a guessed group on a card is worse than an empty field.' });
  }
  if (draft.subject === 'patient' && days(ctx.today, draft.validUntil) > 1826) {
    reasons.push({ code: 'too-long', message: 'A patient card runs five years at most. After that the photograph on it identifies nobody, and the address behind it has usually changed.' });
  }
  if (draft.supersedes) {
    const original = ctx.cards.find((c) => c.no === draft.supersedes);
    if (!original) {
      reasons.push({ code: 'unknown-original', message: `There is no card ${draft.supersedes} on the register. A re-issue points at the card it replaces, so the register can say which card was in circulation when.` });
    } else if (original.subject !== draft.subject) {
      reasons.push({ code: 'wrong-series', message: `${draft.supersedes} is a ${original.subject} card. The staff and patient series are kept apart: re-issuing across them would put a number from one series on the other.` });
    } else if (original.status === 'revoked' && original.revokeReason === 'LEFT SERVICE') {
      warnings.push({ code: 'reissue-after-service', message: `${draft.supersedes} was revoked when the holder left service. Re-issuing a card is a statement that they work here — if they have been re-employed, the staff record has to say so first.` });
    }
  }
  if (isStaff && draft.validUntil && ctx.evidence.probationEndsOn && ctx.evidence.probationEndsOn > ctx.today && days(ctx.today, draft.validUntil) > 365) {
    warnings.push({ code: 'probation-long-card', message: `Still on probation until ${ctx.evidence.probationEndsOn}, and this card runs to ${draft.validUntil}. Issuing probation cards to the end of probation is what stops a card outliving the job.` });
  }
  if (draft.subject === 'patient' && !draft.phone.trim()) {
    warnings.push({ code: 'no-phone', message: 'No telephone number on the record. The card is usually the moment the desk notices, and asking for the number is cheaper than finding out at the next appointment reminder.' });
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/** The renewals list: cards whose validity ends inside the window, so the desk re-issues before a gate refuses one. */
export function cardsExpiring(cards: IdentityCard[], today: string, withinDays = 60): IdentityCard[] {
  return cards
    .filter((c) => c.status === 'active' && days(today, c.validUntil) <= withinDays)
    .sort((a, b) => a.validUntil.localeCompare(b.validUntil));
}

export interface DocumentDigest {
  certificatesIssued: number;
  superseded: number;
  revoked: number;
  printed: number;
  cardsActive: number;
  staffCards: number;
  patientCards: number;
  cardsRevoked: number;
  expiring: number;
  blockRemaining: number;
}

export function documentDigest(certificates: Certificate[], cards: IdentityCard[], today: string, block: NumberBlock): DocumentDigest {
  return {
    certificatesIssued: certificates.filter((c) => c.status === 'issued').length,
    superseded: certificates.filter((c) => c.status === 'superseded').length,
    revoked: certificates.filter((c) => c.status === 'revoked').length,
    printed: certificates.reduce((n, c) => n + c.printed, 0),
    cardsActive: cards.filter((c) => c.status === 'active').length,
    staffCards: cards.filter((c) => c.subject === 'staff').length,
    patientCards: cards.filter((c) => c.subject === 'patient').length,
    cardsRevoked: cards.filter((c) => c.status === 'revoked').length,
    expiring: cardsExpiring(cards, today, 60).length,
    blockRemaining: blockRemaining(block),
  };
}

/** What the phase cannot do until the API exists, said on both screens. */
export const DOCUMENT_WAITING: string[] = [
  'The number block is a row in this build and a reserved block on the node in production: the desk draws numbers from what the node already holds, and the block is replenished by the cloud (P0-311). A node that has run out stops — that refusal is implemented and reachable on this screen.',
  'The printed sheet comes from the twelve print templates (P7), so the register and the paper cannot disagree about a certificate’s number. A drag-and-drop template designer is deliberately not built.',
  'A revoked card is dead in this register the moment the desk writes it. The gate reader that enforces it is hardware, and it arrives with the hospital-side pilot work (#45–#55).',
];

/* ------------------------------------------------------------------ the two card grids
 *
 * The staff card and the patient card are two screens over one register, and the difference between them is
 * exactly what is printed on the card: eleven columns for a member of staff (designation, department, employee
 * number, photograph) and seven for a patient (MRN, age, address). Putting the column lists here rather than in
 * the two pages is what stops the pair drifting — the harness reads these lists and asserts the counts the screen
 * map claims, so "the patient card is the staff card minus four fields" is a checked statement, not a comment.
 */

export interface CardColumn {
  key: keyof IdentityCard | 'age';
  header: string;
  width?: string;
  hideBelow?: 'lg' | 'xl';
}

export const CARD_COLUMNS: Record<CardSubject, CardColumn[]> = {
  staff: [
    { key: 'no', header: 'Card number', width: '10rem' },
    { key: 'holderName', header: 'Holder' },
    { key: 'holderNameBn', header: 'বাংলা নাম', width: '10rem', hideBelow: 'lg' },
    { key: 'staffCode', header: 'Employee no', width: '9rem' },
    { key: 'designation', header: 'Designation', width: '10rem' },
    { key: 'department', header: 'Department', width: '9rem', hideBelow: 'lg' },
    { key: 'bloodGroup', header: 'Blood', width: '5rem' },
    { key: 'phone', header: 'Phone', width: '9rem', hideBelow: 'xl' },
    { key: 'photoRef', header: 'Photograph', width: '8rem', hideBelow: 'xl' },
    { key: 'validUntil', header: 'Valid until', width: '8rem' },
    { key: 'status', header: 'State', width: '8rem' },
  ],
  patient: [
    { key: 'no', header: 'Card number', width: '10rem' },
    { key: 'holderName', header: 'Holder' },
    { key: 'holderNameBn', header: 'বাংলা নাম', width: '11rem', hideBelow: 'lg' },
    { key: 'mrn', header: 'MRN', width: '9rem' },
    { key: 'bloodGroup', header: 'Blood', width: '5rem' },
    { key: 'validUntil', header: 'Valid until', width: '9rem' },
    { key: 'status', header: 'State', width: '8rem' },
  ],
};

/** The validity rules, stated once: a clinical card dies with the licence, a patient card with its photograph. */
export const CARD_VALIDITY = {
  staffYears: 3,
  clinicalYears: 1,
  patientYears: 5,
  note: 'A clinical staff card runs to the professional licence expiry and never past it. An administrative card runs three years; a patient card five, because that is roughly how long a photograph keeps identifying anybody.',
};
