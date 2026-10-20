/* ----------------------------------------------------------------------------------------------------
 * The Download Centre (P8) — content types, uploads and the share list.
 *
 * Three screens over one decision, which is why they are one module:
 *
 *   1. **What a file is** — its content type. The type carries the default audience, whether an approver has to
 *      see it before a patient does, and how long a share of it stays open. A file with no type is a file nobody
 *      can reason about, so the type is required before anything else happens.
 *   2. **Where it came from** — the upload. The bytes land in this node's own store and the row carries the
 *      SHA-256, which is what makes an upload safe with the uplink down: a replay cannot attach different bytes
 *      to the same row. The file name is checked, because a file name travels further than the file does.
 *   3. **Who may see it** — the share list. Every recipient is a row of its own, so a document can be taken back
 *      from one person without taking it from the others, and the withdrawal keeps a reason and a name.
 *
 * The rule the phase is built around: an item may only be shared to a patient, or to the public website, once the
 * type says it is patient-facing **and** an approver has released it (`dizi.content-not-approved`). Everything a
 * patient reads has been read by a clinician first.
 */

export type Audience = 'internal' | 'patients' | 'public';

export interface ContentType {
  key: string;
  label: string;
  description: string;
  audienceDefault: Audience;
  /** True for anything a patient may see: the file is released by an approver before it can leave the hospital. */
  requiresApproval: boolean;
  /** How long a share of this type stays open. Zero is "until withdrawn", and only the internal types use it. */
  retentionDays: number;
  /** The largest file this type may carry, in megabytes. Imaging is big; a portal download is not. */
  maxMb: number;
  active: boolean;
}

export const CONTENT_TYPES: ContentType[] = [
  { key: 'report', label: 'Report', description: 'A released investigation or consultation report that the patient is entitled to.', audienceDefault: 'patients', requiresApproval: true, retentionDays: 90, maxMb: 10, active: true },
  { key: 'imaging', label: 'Imaging', description: 'A scan or an image series. Large, and usually shared to a patient as a report rather than as a series.', audienceDefault: 'internal', requiresApproval: true, retentionDays: 30, maxMb: 50, active: true },
  { key: 'discharge', label: 'Discharge summary', description: 'What the patient goes home with. The one document the portal exists for.', audienceDefault: 'patients', requiresApproval: true, retentionDays: 180, maxMb: 5, active: true },
  { key: 'policy', label: 'Policy', description: 'An internal policy or a standing instruction. Nobody outside the hospital sees these, ever.', audienceDefault: 'internal', requiresApproval: false, retentionDays: 0, maxMb: 20, active: true },
  { key: 'notice', label: 'Circular', description: 'A hospital-wide circular: a roster change, an outbreak instruction, a supply notice.', audienceDefault: 'internal', requiresApproval: false, retentionDays: 0, maxMb: 10, active: true },
  { key: 'form', label: 'Form', description: 'A form for staff or for patients: consent, admission, feedback, a claim.', audienceDefault: 'internal', requiresApproval: true, retentionDays: 0, maxMb: 5, active: true },
  { key: 'teaching', label: 'Teaching material', description: 'Slides and handouts. Internal by default: a teaching deck carries cases in it.', audienceDefault: 'internal', requiresApproval: false, retentionDays: 0, maxMb: 40, active: true },
  { key: 'public-info', label: 'Public information', description: 'Diet charts, vaccination schedules, visiting rules — written for the public website.', audienceDefault: 'public', requiresApproval: true, retentionDays: 365, maxMb: 5, active: true },
  { key: 'billing-doc', label: 'Billing document', description: 'A bill copy, a receipt or an estimate given to the patient or to a payer.', audienceDefault: 'patients', requiresApproval: false, retentionDays: 90, maxMb: 5, active: false },
];

export const contentTypeByKey = (key: string): ContentType | undefined => CONTENT_TYPES.find((t) => t.key === key);

export const AUDIENCE_LABELS: Record<Audience, { label: string; who: string; because: string }> = {
  internal: { label: 'Hospital staff only', who: 'Staff of this branch, from the Download Centre', because: 'Nothing patient-facing. A file that was never meant to leave the building should not have a share button at all — and here it does not.' },
  patients: { label: 'The patient it is about', who: 'The patient’s own portal account, and nobody else', because: 'A share to a patient is a share to one MRN, not to “patients”. A document shared to the wrong MRN is the failure this is designed around.' },
  public: { label: 'The public', who: 'The patient portal and the public website', because: 'Public means it may be read by somebody who is not a patient at all, so it is approved by a clinician and it carries no patient identifiers.' },
};

export type ItemStatus = 'uploaded' | 'approved' | 'shared' | 'returned' | 'withdrawn';

export interface ContentItem {
  id: string;
  /** The number the Download Centre shows: `DC-2026-0142`. Stable, and what a telephone call quotes. */
  ref: string;
  title: string;
  fileName: string;
  mb: number;
  mimeType: string;
  contentTypeKey: string;
  audience: Audience;
  tags: string[];
  ownerCode: string;
  ownerName: string;
  department: string;
  /** `sha256:…` — the bytes are addressed by hash, so a drain cannot attach different bytes to the row. */
  sha256: string;
  status: ItemStatus;
  uploadedOn: string;
  expiresOn: string | null;
  shareCount: number;
  openCount: number;
  /** Set when an approver returned it: what the uploader has to change. */
  returnedNote?: string;
  approvedBy?: string;
  approvedOn?: string;
}

export interface ContentShare {
  id: string;
  itemId: string;
  recipientKind: 'staff' | 'department' | 'role' | 'patient' | 'public';
  recipientRef: string;
  recipientName: string;
  sharedByCode: string;
  sharedOn: string;
  expiresOn: string | null;
  note: string;
  notified: boolean;
  openCount: number;
  revokedOn: string | null;
  revokedBy: string | null;
  revokeReason: string;
}

const sha = (seed: string): string => {
  // A stable, obviously-fake digest: the length is the point (a real one is 64 hex characters).
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const block = () => (h >>> 0).toString(16).padStart(8, '0');
  return `sha256:${block()}${block()}${block()}${block()}${block()}a41c2f${block().slice(0, 4)}`;
};

const item = (
  n: number,
  title: string,
  fileName: string,
  contentTypeKey: string,
  audience: Audience,
  tags: string[],
  owner: [string, string, string],
  mb: number,
  status: ItemStatus,
  uploadedOn: string,
  shares: number,
  opens: number,
  approvedBy?: string,
  expiresOn?: string,
  returnedNote?: string,
): ContentItem => ({
  id: `dc-${n}`,
  ref: `DC-2026-${String(140 + n).padStart(4, '0')}`,
  title,
  fileName,
  mb,
  mimeType: contentTypeKey === 'imaging' ? 'application/dicom' : fileName.endsWith('.pdf') ? 'application/pdf' : fileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain',
  contentTypeKey,
  audience,
  tags,
  ownerCode: owner[0],
  ownerName: owner[1],
  department: owner[2],
  sha256: sha(`${title}:${fileName}:${n}`),
  status,
  uploadedOn,
  expiresOn: expiresOn ?? null,
  shareCount: shares,
  openCount: opens,
  approvedBy,
  approvedOn: approvedBy ? `${uploadedOn} 16:20` : undefined,
  returnedNote,
});

export const CONTENT_ITEMS: ContentItem[] = [
  item(1, 'Discharge summary — R. Hasan, orthopaedic admission', 'discharge-SH102388-opd.pdf', 'discharge', 'patients', ['discharge', 'orthopaedics'], ['EMP-1042', 'R. Howlader', 'Medical records'], 0.4, 'shared', '2026-10-14', 3, 2, 'Dr. M. Khan', '2027-04-12'),
  item(2, 'Chest X-ray report — A. Siddika', 'cxr-report-SH102398.pdf', 'report', 'patients', ['radiology', 'paediatric'], ['EMP-1088', 'T. Akter', 'Radiology'], 0.7, 'shared', '2026-10-15', 2, 1, 'Dr. T. Hossain', '2027-01-13'),
  item(3, 'Hand-hygiene audit — September', 'hand-hygiene-2026-09.xlsx', 'policy', 'internal', ['infection control', 'audit'], ['EMP-1013', 'M. Ali', 'Nursing'], 1.2, 'approved', '2026-10-06', 2, 14),
  item(4, 'Antibiotic formulary — restricted list, October revision', 'formulary-restricted-2026-10.pdf', 'policy', 'internal', ['pharmacy', 'formulary'], ['EMP-1120', 'H. Mia', 'Pharmacy'], 2.8, 'shared', '2026-10-08', 4, 31),
  item(5, 'Vaccination schedule — EPI, Bangla and English', 'epi-schedule-bn-en.pdf', 'public-info', 'public', ['public', 'paediatrics'], ['EMP-1055', 'N. Sultana', 'Paediatrics'], 1.1, 'shared', '2026-09-28', 1, 96, 'Dr. T. Hossain', '2027-09-28'),
  item(6, 'Diabetic diet chart — Bangla', 'diet-diabetes-bn.pdf', 'public-info', 'public', ['public', 'diet'], ['EMP-1103', 'F. Yasmin', 'Dietetics'], 0.9, 'shared', '2026-09-30', 1, 143, 'Dr. A. Rahman', '2027-09-30'),
  item(7, 'CT abdomen series — suspected appendicitis', 'ct-abdomen-SH102410', 'imaging', 'internal', ['radiology', 'emergency'], ['EMP-1088', 'T. Akter', 'Radiology'], 42.6, 'approved', '2026-10-15', 2, 3),
  item(8, 'Consent form — surgery, revised September', 'consent-surgery-rev9.pdf', 'form', 'internal', ['consent', 'surgery'], ['EMP-1042', 'R. Howlader', 'Medical records'], 0.3, 'uploaded', '2026-10-15', 0, 0),
  item(9, 'Nursing roster — November draft', 'roster-2026-11-draft.xlsx', 'notice', 'internal', ['roster', 'nursing'], ['EMP-1013', 'M. Ali', 'Nursing'], 0.6, 'uploaded', '2026-10-16', 0, 0),
  item(10, 'ECG tracings — teaching set, atrial fibrillation', 'ecg-teaching-af.pdf', 'teaching', 'internal', ['teaching', 'cardiology'], ['EMP-1031', 'Dr. N. Islam', 'Cardiology'], 4.4, 'shared', '2026-10-02', 2, 22),
  item(11, 'Estimate — total knee replacement, self pay', 'estimate-tkr-SH102355.pdf', 'billing-doc', 'patients', ['billing', 'orthopaedics'], ['EMP-1077', 'S. Ahmed', 'Billing'], 0.2, 'shared', '2026-10-12', 1, 1, 'R. Howlader', '2027-01-10'),
  item(12, 'Lab report — CBC and CRP, A. Siddika', 'lab-cbc-crp-SH102398.pdf', 'report', 'patients', ['laboratory', 'paediatric'], ['EMP-1088', 'T. Akter', 'Laboratory'], 0.3, 'shared', '2026-10-15', 2, 2, 'Dr. T. Hossain', '2027-01-13'),
  /* The three the rules are about: a name that leaks more than the hospital meant it to, an approver who said no,
   * and a share that has already lapsed. */
  item(13, 'Diabetic foot clinic — wound photographs', 'photos-01817445566-DM-foot-14-10-2026.zip', 'imaging', 'internal', ['wound care', 'diabetes'], ['EMP-1042', 'R. Howlader', 'Surgery'], 28.4, 'uploaded', '2026-10-16', 0, 0, undefined, undefined, 'Not approved yet — a patient-facing share needs an approver, and this was uploaded to the wrong audience for its type.'),
  item(14, 'Ultrasonography report — obstetrics, 22 weeks', 'usg-obstetric-SH102355.pdf', 'report', 'patients', ['radiology', 'obstetrics'], ['EMP-1088', 'T. Akter', 'Radiology'], 1.4, 'returned', '2026-10-13', 0, 0, undefined, undefined, 'The patient’s name is in the report header but the MRN on the share was another patient’s. Check the file before re-sharing: the approver returned it rather than correcting it, because the document itself is wrong.'),
  item(15, 'Outbreak instruction — dengue season, staff briefing', 'dengue-briefing-2026-08.pdf', 'notice', 'internal', ['infection control', 'outbreak'], ['EMP-1013', 'M. Ali', 'Nursing'], 1.0, 'shared', '2026-08-04', 3, 88, 'Dr. S. Chowdhury', '2027-08-04'),
  item(16, 'Visiting hours and attendant rules', 'visiting-hours-2026.pdf', 'public-info', 'public', ['public', 'front office'], ['EMP-1042', 'R. Howlader', 'Front office'], 0.4, 'shared', '2026-07-01', 1, 210, 'R. Howlader', '2027-07-01'),
];

export const SHARES: ContentShare[] = (() => {
  const out: ContentShare[] = [];
  const push = (share: Partial<ContentShare> & { itemId: string; recipientKind: ContentShare['recipientKind']; recipientRef: string; recipientName: string }) => {
    const n = out.length + 1;
    out.push({
      id: `sh-${n}`,
      sharedByCode: 'EMP-1042',
      sharedOn: '2026-10-15',
      expiresOn: '2027-01-13',
      note: '',
      notified: true,
      openCount: 0,
      revokedOn: null,
      revokedBy: null,
      revokeReason: '',
      ...share,
    });
  };
  // The discharge summary: a patient copy, the referring GP, and the physiotherapy department.
  push({ itemId: 'dc-1', recipientKind: 'patient', recipientRef: 'SH-102388', recipientName: 'Shahidul Islam (patient)', sharedOn: '2026-10-14', openCount: 2, note: 'Given to the patient at discharge and left in the portal for six months.' });
  push({ itemId: 'dc-1', recipientKind: 'department', recipientRef: 'physio', recipientName: 'Physiotherapy', sharedOn: '2026-10-14', expiresOn: '2026-11-14', openCount: 5 });
  push({ itemId: 'dc-1', recipientKind: 'staff', recipientRef: 'EMP-1150', recipientName: 'Dr. K. Rahman (referring GP)', sharedOn: '2026-10-15', expiresOn: '2026-11-14', notified: false, note: 'Sent to the referral inbox; the GP is outside this hospital’s mail, so it is shared, not emailed.' });
  // The X-ray report: patient and the paediatrics role.
  push({ itemId: 'dc-2', recipientKind: 'patient', recipientRef: 'SH-102398', recipientName: 'Ayesha Siddika (patient)', sharedOn: '2026-10-15', openCount: 1 });
  push({ itemId: 'dc-2', recipientKind: 'role', recipientRef: 'paediatrics', recipientName: 'Paediatrics (all staff in the role)', sharedOn: '2026-10-15', expiresOn: '2027-01-13', openCount: 6 });
  // The public pages: the one share that is not a person.
  push({ itemId: 'dc-5', recipientKind: 'public', recipientRef: 'website', recipientName: 'Public website and patient portal', sharedOn: '2026-09-28', expiresOn: '2027-09-28', openCount: 96, note: 'Published under Public information, so the site renders it and the portal links to it.' });
  push({ itemId: 'dc-6', recipientKind: 'public', recipientRef: 'website', recipientName: 'Public website and patient portal', sharedOn: '2026-09-30', expiresOn: '2027-09-30', openCount: 143 });
  // The teaching set, the formulary, the audit.
  push({ itemId: 'dc-10', recipientKind: 'role', recipientRef: 'doctor', recipientName: 'Doctors (all branches)', sharedOn: '2026-10-02', openCount: 22 });
  push({ itemId: 'dc-10', recipientKind: 'department', recipientRef: 'cardiology', recipientName: 'Cardiology', sharedOn: '2026-10-02', openCount: 8 });
  push({ itemId: 'dc-4', recipientKind: 'role', recipientRef: 'pharmacist', recipientName: 'Pharmacists', sharedOn: '2026-10-08', openCount: 12 });
  push({ itemId: 'dc-4', recipientKind: 'department', recipientRef: 'med', recipientName: 'Medicine', sharedOn: '2026-10-08', openCount: 19 });
  push({ itemId: 'dc-3', recipientKind: 'department', recipientRef: 'nursing', recipientName: 'Nursing', sharedOn: '2026-10-06', openCount: 14 });
  push({ itemId: 'dc-7', recipientKind: 'staff', recipientRef: 'EMP-1049', recipientName: 'Dr. M. Khan (operating surgeon)', sharedOn: '2026-10-15', expiresOn: '2026-11-14', openCount: 3 });
  push({ itemId: 'dc-12', recipientKind: 'patient', recipientRef: 'SH-102398', recipientName: 'Ayesha Siddika (patient)', sharedOn: '2026-10-15', openCount: 2 });
  push({ itemId: 'dc-11', recipientKind: 'patient', recipientRef: 'SH-102355', recipientName: 'Fatema Begum (patient)', sharedOn: '2026-10-12', expiresOn: '2027-01-10', openCount: 1 });
  /* Withdrawn, with the reason on it. */
  push({ itemId: 'dc-15', recipientKind: 'role', recipientRef: 'doctor', recipientName: 'Doctors (all branches)', sharedOn: '2026-08-04', expiresOn: '2027-08-04', openCount: 51 });
  push({ itemId: 'dc-15', recipientKind: 'department', recipientRef: 'nursing', recipientName: 'Nursing', sharedOn: '2026-08-04', expiresOn: '2027-08-04', openCount: 37 });
  push({ itemId: 'dc-1', recipientKind: 'staff', recipientRef: 'EMP-1013', recipientName: 'M. Ali (ward manager)', sharedOn: '2026-10-14', expiresOn: '2026-10-20', openCount: 1, revokedOn: '2026-10-15', revokedBy: 'R. Howlader', revokeReason: 'The summary was revised after the orthopaedic note was added; the earlier copy must not be the one the ward hands over.' });
  return out;
})();

export const sharesOf = (itemId: string): ContentShare[] => SHARES.filter((s) => s.itemId === itemId);
export const openShares = (shares: ContentShare[] = SHARES): ContentShare[] => shares.filter((s) => !s.revokedOn);
export const itemById = (id: string): ContentItem | undefined => CONTENT_ITEMS.find((i) => i.id === id);

/* ------------------------------------------------------------------ the refusals */

export interface ContentIssue {
  code: string;
  message: string;
}

export interface ContentCheck {
  ok: boolean;
  reasons: ContentIssue[];
  warnings: ContentIssue[];
}

export interface UploadDraft {
  title: string;
  fileName: string;
  mb: number;
  contentTypeKey: string;
  audience: Audience;
  tags: string[];
  expiresOn: string;
  note: string;
}

export interface ContentContext {
  items: ContentItem[];
  types: ContentType[];
  today: string;
  /** Whether this desk may see patient-facing types at all: a records clerk and a consultant do not share it. */
  approverAvailable: boolean;
}

/** A file name is checked because it travels further than the file: into an inbox, a download folder, a printout. */
export const SENSITIVE_FILE_NAME = /(SH-?\d{5,}|01\d{9}|nid|passport|hiv|hbsag|pregnan|psych|cancer|abortion)/i;

export function checkUpload(draft: UploadDraft, ctx: ContentContext): ContentCheck {
  const reasons: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const type = contentTypeByKey(draft.contentTypeKey);

  if (!draft.title.trim()) {
    reasons.push({ code: 'no-title', message: 'Give the file a title a person would search for. The file name is not a title — it is what a scanner produced.' });
  }
  if (!draft.fileName.trim()) {
    reasons.push({ code: 'no-file', message: 'There is no file attached. The upload stores the bytes on this node before the row is queued, so a row without bytes is a row that will drain into nothing.' });
  }
  if (!type) {
    reasons.push({ code: 'unknown-type', message: 'Choose a content type. The type is what decides the audience, whether a patient may see the file at all, and how long a share of it stays open.' });
  }
  if (type && !type.active) {
    reasons.push({ code: 'retired-type', message: `“${type.label}” is retired. Existing uploads keep it, but nothing new may be filed under it — filing one would put a new file in a taxonomy the hospital has stopped using.` });
  }
  if (type && draft.mb > type.maxMb) {
    reasons.push({ code: 'too-large', message: `${draft.mb} MB is over the ${type.maxMb} MB limit for ${type.label}. Split it, or file it as a type that carries this size — a patient on mobile data is the reason the limit exists.` });
  }
  if (type && draft.audience !== 'internal' && !type.requiresApproval) {
    warnings.push({ code: 'no-approval-needed', message: `${type.label} does not need approval and is being shared outside the hospital. It will still be recorded, and the approver is not in the way — but somebody has read it, presumably.` });
  }
  if (draft.audience !== 'internal' && SENSITIVE_FILE_NAME.test(draft.fileName)) {
    reasons.push({ code: 'name-leaks', message: `“${draft.fileName}” carries something it should not: an MRN, a phone number or a diagnosis. A file name is copied into inboxes and download folders — rename it before uploading, not after sharing it.` });
  }
  if (draft.audience !== 'internal' && SENSITIVE_FILE_NAME.test(draft.title)) {
    warnings.push({ code: 'title-leaks', message: 'The title names a patient or a condition. Titles appear in the portal’s list; keep the identifier in the record and out of the label.' });
  }
  if (draft.tags.filter((t) => t.trim()).length < 2) {
    warnings.push({ code: 'few-tags', message: 'Two tags, at least: the Download Centre is searched by tag far more than by title, and an untagged file is one nobody finds again.' });
  }
  if (draft.expiresOn && draft.expiresOn < ctx.today) {
    reasons.push({ code: 'expired-on-arrival', message: 'That share would expire before it was made. If the file is archived rather than shared, leave the expiry empty and file it internal.' });
  }
  if (type && draft.expiresOn && type.retentionDays > 0) {
    const days = Math.round((Date.parse(draft.expiresOn) - Date.parse(ctx.today)) / 86_400_000);
    if (days > type.retentionDays) {
      warnings.push({ code: 'beyond-retention', message: `The expiry is ${days} days out and ${type.label} keeps shares open for ${type.retentionDays}. A patient-facing document that outlives its clinical value is one the hospital has stopped standing behind.` });
    }
  }
  if (draft.audience !== 'internal' && !ctx.approverAvailable) {
    warnings.push({ code: 'approval-queue', message: 'Nobody with the approver role is on shift. The file is stored and goes into the approval queue — a patient-facing file cannot be shared until somebody releases it, which is the point.' });
  }
  if (draft.audience === 'public' && /(mrn|patient|case)/i.test(draft.title)) {
    reasons.push({ code: 'public-with-patient', message: 'A public file may not carry a patient reference at all. It is read by people who are not this hospital’s patients, and it is indexed long after the case is closed.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

export interface ShareCheck extends ContentCheck {
  /** The line the screen shows when a patient-facing share is what this is. */
  approvalNote: string;
}

export function checkShare(
  target: ContentItem,
  recipients: Array<{ kind: ContentShare['recipientKind']; ref: string; name: string }>,
  ctx: ContentContext & { shares: ContentShare[] },
): ShareCheck {
  const reasons: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const type = contentTypeByKey(target.contentTypeKey);
  const patientFacing = recipients.some((r) => r.kind === 'patient' || r.kind === 'public');
  let approvalNote = '';

  if (recipients.length === 0) {
    reasons.push({ code: 'no-recipients', message: 'A share with nobody in it is not a share. Add at least one recipient, or leave the file in the Download Centre where the ward can find it.' });
  }
  if (patientFacing && type?.requiresApproval && target.status !== 'approved' && target.status !== 'shared') {
    approvalNote = `dizi.content-not-approved — ${type.label} files are read by a clinician before a patient sees them, and this one has not been released.`;
    reasons.push({ code: 'not-approved', message: approvalNote });
  }
  if (patientFacing && target.audience === 'internal') {
    reasons.push({ code: 'internal-outward', message: 'This file is filed internal and cannot be shared with a patient or the public. Change the audience on the item first, which puts it back through approval.' });
  }
  for (const r of recipients) {
    if (r.kind === 'patient' && !/^SH-\d{6}$/.test(r.ref)) {
      reasons.push({ code: 'bad-mrn', message: `“${r.ref}” is not an MRN. A patient share is a share to one record — a name typed into a box is how a document reaches the wrong person.` });
    }
    if (r.kind === 'public' && !['public-info', 'form', 'notice'].includes(target.contentTypeKey)) {
      reasons.push({ code: 'public-type', message: `${type?.label ?? 'This type'} may not be published. Only public information, forms and circulars can go to the website.` });
    }
  }
  const duplicate = recipients.find((r) => ctx.shares.some((s) => s.itemId === target.id && !s.revokedOn && s.recipientRef === r.ref));
  if (duplicate) {
    warnings.push({ code: 'already-shared', message: `${duplicate.name} already has this file. Sharing again does not send a second copy: it keeps the earlier row, and the recipient sees one document with two dates on it if it is not withdrawn first.` });
  }
  if (patientFacing && !ctx.approverAvailable) {
    warnings.push({ code: 'no-approver', message: 'No approver is on shift, so a patient-facing file waits. The patient is better served by the counter copy today and the portal copy tomorrow, and the screen says which one they are getting.' });
  }
  if (patientFacing && target.expiresOn && target.expiresOn < ctx.today) {
    reasons.push({ code: 'item-lapsed', message: `The item’s own availability ended on ${target.expiresOn}. The portal refuses a lapsed share with dizi.document-expired rather than showing an old copy, so this share would reach nobody.` });
  }
  if (target.status === 'returned' && patientFacing) {
    reasons.push({ code: 'returned-item', message: `An approver returned this file: ${target.returnedNote ?? 'no reason recorded'}` });
  }
  return { ok: reasons.length === 0, reasons, warnings, approvalNote };
}

/** What the content-type screen refuses. One key, one label, and a retirement that waits for its files. */
export function checkContentType(draft: { key: string; label: string; audienceDefault: Audience; requiresApproval: boolean; retentionDays: number; active: boolean }, ctx: { types: ContentType[]; items: ContentItem[] }): ContentCheck {
  const reasons: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const existing = ctx.types.find((t) => t.key === draft.key);

  if (!/^[a-z][a-z0-9-]{2,}$/.test(draft.key)) {
    reasons.push({ code: 'bad-key', message: 'A key is lower-case words joined by dashes, at least three characters. It is the identity old uploads point at, so it is never rewritten once used.' });
  }
  if (!draft.label.trim()) {
    reasons.push({ code: 'no-label', message: 'The label is what staff read in the upload dialog. A type called “report” and one labelled “Miscellaneous” are the same thing to the person filing a discharge summary at 22:00 — the label has to mean something.' });
  }
  const labelClash = ctx.types.find((t) => t.label.toLowerCase() === draft.label.trim().toLowerCase() && t.key !== draft.key);
  if (labelClash) {
    reasons.push({ code: 'label-taken', message: `“${labelClash.label}” already exists as ${labelClash.key}. Two types with one label is how a hospital ends up with half its reports in each.` });
  }
  if (existing && !draft.active && ctx.items.some((i) => i.contentTypeKey === draft.key && i.status !== 'withdrawn')) {
    const count = ctx.items.filter((i) => i.contentTypeKey === draft.key).length;
    warnings.push({ code: 'retire-in-use', message: `Retiring ${draft.label} leaves ${count} file(s) filed under it. They keep the type and stay readable — a retired type is closed to new uploads, not erased from the ones that exist.` });
  }
  if (draft.retentionDays < 0 || draft.retentionDays > 730) {
    reasons.push({ code: 'retention-range', message: 'Retention is 0 to 730 days. Zero means “until withdrawn”, which is right for internal files and wrong for anything a patient reads.' });
  }
  if (draft.audienceDefault !== 'internal' && !draft.requiresApproval) {
    reasons.push({ code: 'patient-facing-unapproved', message: 'A type whose default audience is a patient or the public has to require approval. The alternative is a share button that puts the first version of a clinical document in front of a patient.' });
  }
  if (draft.audienceDefault === 'public' && draft.retentionDays === 0) {
    warnings.push({ code: 'public-forever', message: 'Public information with no retention stays on the website until somebody remembers it. Diet charts and vaccination schedules go out of date quietly.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/* ------------------------------------------------------------------ the digest */

export interface ContentDigest {
  items: number;
  storeMb: number;
  awaitingApproval: number;
  returned: number;
  openShares: number;
  lapsed: number;
  patientShares: number;
  publicShares: number;
  opened: number;
  neverOpened: number;
}

export function contentDigest(items: ContentItem[], shares: ContentShare[], today: string): ContentDigest {
  const open = openShares(shares);
  const lapsed = open.filter((s) => s.expiresOn && s.expiresOn < today);
  return {
    items: items.length,
    storeMb: Math.round(items.reduce((n, i) => n + i.mb, 0) * 10) / 10,
    awaitingApproval: items.filter((i) => i.status === 'uploaded').length,
    returned: items.filter((i) => i.status === 'returned').length,
    openShares: open.length,
    lapsed: lapsed.length,
    patientShares: open.filter((s) => s.recipientKind === 'patient').length,
    publicShares: open.filter((s) => s.recipientKind === 'public').length,
    opened: open.filter((s) => s.openCount > 0).length,
    neverOpened: open.filter((s) => s.openCount === 0).length,
  };
}

/** Shares about to lapse, so the desk can extend the ones that still matter instead of discovering it in the portal. */
export function expiringShares(shares: ContentShare[], today: string, withinDays = 30): ContentShare[] {
  return openShares(shares)
    .filter((s) => s.expiresOn && s.expiresOn >= today)
    .filter((s) => (Date.parse(s.expiresOn!) - Date.parse(today)) / 86_400_000 <= withinDays)
    .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''));
}

/** A share that has lapsed is still a row: the portal refuses it with `dizi.document-expired` and says so. */
export const LAPSED_SERVICE_LINE = 'A lapsed share is not deleted: the portal refuses it with dizi.document-expired and offers to request the document again, which is the difference between a patient asking the department and a patient assuming the hospital has forgotten them.';

export const CONTENT_WAITING: string[] = [
  'The bytes live in this node’s file store, not in the browser: the upload writes them beside the database so the ward can open a discharge scan with the uplink down. The object store the cloud will hold is part of the API service (P0-306).',
  'Outbound notification of a share — an SMS to a patient saying a report is ready — is the messaging module’s online-only operation, and it refuses without a consent record. The share itself still queues.',
  'Virus scanning and file-type sniffing run at the node in production; this build checks the declared type, the size and the name, and says so rather than implying a scan happened.',
];
