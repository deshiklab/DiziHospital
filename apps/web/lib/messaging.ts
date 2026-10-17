/* ----------------------------------------------------------------------------------------------------
 * Messaging (P8) — the noticeboard that works offline, and the outbound channels that do not.
 *
 * The module is one screen over two very different things, and keeping them apart is the design:
 *
 *  - **The noticeboard is a record.** It is written on this node, read from the branch replica, receipted when
 *    somebody opens it, and it works perfectly well with the uplink down — which is exactly when a notice matters,
 *    because the thing that has gone wrong is usually the uplink.
 *  - **An outbound SMS, WhatsApp or email is not a record.** It leaves the hospital through a third-party gateway
 *    carrying patient information, it cannot be recalled, and it can fail silently. So it is `online-only` by
 *    contract, it refuses without a recorded consent (`dizi.consent-missing`), and the screen says so before the
 *    button is pressed rather than after.
 *
 * The rules the screen enforces:
 *
 *  - a notice to a group nobody is in is refused — the recipient counts come from the staff register, so “all
 *    department heads” means the four people who exist rather than the five somebody remembered;
 *  - a notice may carry an MRN and never a clinical detail: the noticeboard is read by the whole hospital, and
 *    “bed 12, the dengue positive in SH-102341” is a clinical record in a place that has no consent for it;
 *  - a read receipt is a record, not a courtesy, and it is appended: a hospital answering “were you told?” needs
 *    the answer to be a fact rather than a recollection;
 *  - patient messaging has quiet hours, because an appointment reminder at 23:40 is a message that wakes a
 *    household up for something that could have waited until morning.
 */

import { staffDirectory, type HrStaff } from './hr';
import { NOTIFICATIONS } from './messaging-api';

/**
 * The channels this hospital uses: two that are records on this node and two that leave through somebody else's
 * gateway.
 *
 * `sms` is deliberately absent. It is the channel the vendor's Twilio addon would carry and this node does not, so a
 * choice of SMS here would be a screen offering a send that cannot happen — the contract's `x-dizi-notifications`
 * names exactly two outbound channels, and this list is those two. WhatsApp and e-mail are **separate consents** for
 * the same reason they are separate channels: a patient regularly gives one and not the other.
 */
export type Channel = 'board' | 'push' | 'whatsapp' | 'email';
export type Priority = 'normal' | 'urgent';
export type NoticeStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'cancelled';

export interface ChannelSpec {
  channel: Channel;
  label: string;
  /** Whether it is a record on this node or a message through a gateway. This is the whole distinction. */
  kind: 'record' | 'outbound';
  worksOffline: boolean;
  /** What has to be true before a message may be sent at all. */
  needs: string;
  /** What the screen does when it cannot be honoured. */
  refusedBy: string;
}

export const CHANNELS: ChannelSpec[] = [
  { channel: 'board', label: 'Noticeboard', kind: 'record', worksOffline: true, needs: 'Nothing beyond the branch replica: the notice is written here and read here.', refusedBy: 'A notice to a group nobody is in is refused, and the group counts come from the staff register rather than from the message.' },
  { channel: 'push', label: 'Push (the staff app)', kind: 'record', worksOffline: true, needs: 'A staff member with the app on a device this node has seen.', refusedBy: 'Falls back to the noticeboard: a push that cannot be delivered is still a notice, and the register shows both.' },
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    kind: 'outbound',
    worksOffline: false,
    /* The contract's own sentence, in the contract's own words: `x-dizi-notifications.channels.whatsapp`. */
    needs: NOTIFICATIONS.channels.whatsapp?.needs ?? 'A recorded consent for WhatsApp and a number on the patient’s file.',
    refusedBy: NOTIFICATIONS.channels.whatsapp?.refusedBy ?? 'dizi.consent-missing, and the patient is offered the portal or the printed copy instead.',
  },
  {
    channel: 'email',
    label: 'Email',
    kind: 'outbound',
    worksOffline: false,
    needs: NOTIFICATIONS.channels.email?.needs ?? 'An address on the record and a recorded consent for e-mail.',
    refusedBy: NOTIFICATIONS.channels.email?.refusedBy ?? 'dizi.consent-missing and dizi.recipient-missing.',
  },
];

export const channelSpec = (channel: Channel): ChannelSpec => CHANNELS.find((c) => c.channel === channel) ?? CHANNELS[0];

/* ------------------------------------------------------------------ audiences, from the register */

export interface Audience {
  kind: 'staff' | 'department' | 'role' | 'branch';
  ref: string;
  label: string;
  /** The people this expands to, resolved from the staff register rather than typed. */
  members: HrStaff[];
}

/**
 * The roles the hospital recognises, whether or not anybody holds them here today.
 *
 * The roster's own titles, plus the allied-health desks that are staffed intermittently. A role nobody holds stays
 * on the list showing zero rather than disappearing: an audience that quietly vanishes from the picker is how a
 * notice reaches nobody and the sender believes otherwise.
 */
export const RECOGNISED_ROLES: string[] = ['Consultant', 'Registrar', 'Intern', 'Senior staff nurse', 'Staff nurse', 'Midwife', 'Aya', 'Ward boy', 'Physiotherapist', 'Radiographer', 'Dietitian'];

/** Every audience the noticeboard can send to, with the count the register actually holds. */
export function audiences(day: string): Audience[] {
  const directory = staffDirectory(day);
  const byRole = new Map<string, HrStaff[]>();
  const byDepartment = new Map<string, HrStaff[]>();
  const byBranch = new Map<string, HrStaff[]>();
  for (const person of directory) {
    byRole.set(person.role, [...(byRole.get(person.role) ?? []), person]);
    byDepartment.set(person.departmentId, [...(byDepartment.get(person.departmentId) ?? []), person]);
    byBranch.set(person.branch, [...(byBranch.get(person.branch) ?? []), person]);
  }
  for (const role of RECOGNISED_ROLES) if (!byRole.has(role)) byRole.set(role, []);
  const roles: Audience[] = [...byRole.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([ref, members]) => ({ kind: 'role', ref, label: `${ref} (everyone in the role)`, members }));
  const departments: Audience[] = [...byDepartment.entries()].map(([ref, members]) => ({ kind: 'department', ref, label: `Department ${ref}`, members }));
  const branches: Audience[] = [...byBranch.entries()].map(([ref, members]) => ({ kind: 'branch', ref, label: ref, members }));
  const individuals: Audience[] = directory.slice(0, 24).map((person) => ({ kind: 'staff', ref: person.code, label: `${person.name} — ${person.designation}`, members: [person] }));
  return [...roles, ...departments, ...branches, ...individuals];
}

/* ------------------------------------------------------------------ the noticeboard */

export interface NoticeReceipt {
  noticeId: string;
  staffCode: string;
  staffName: string;
  readAt: string;
  deviceNodeId: string;
}

export interface Notice {
  id: string;
  channel: Channel;
  priority: Priority;
  audience: string;
  audienceLabel: string;
  subject: string;
  body: string;
  fromCode: string;
  fromName: string;
  sentAt: string;
  status: NoticeStatus;
  recipientCount: number;
  /** How many of the recipients have opened it. Read from the receipts, not counted twice. */
  readCount: number;
  relatedTo: string;
  /** Set when outbound and refused: the sentence the sender saw instead of a sent tick. */
  refusedReason?: string;
}

export const NOTICES: Notice[] = [
  { id: 'nt-1', channel: 'board', priority: 'urgent', audience: 'role:Staff nurse', audienceLabel: 'Staff nurse (everyone in the role)', subject: 'Night shift on Ward 3 is short — can you cover?', body: 'Two of the four night nurses are down with dengue and the third is on leave. If you can cover tonight (22:00–06:00), telephone the ward manager rather than replying here: the board is not read every ten minutes. Overtime is approved.', fromCode: 'EMP-1013', fromName: 'M. Ali', sentAt: '2026-10-16 14:05', status: 'delivered', recipientCount: 62, readCount: 41, relatedTo: 'Ward 3 roster' },
  { id: 'nt-2', channel: 'board', priority: 'urgent', audience: 'branch:Main Campus', audienceLabel: 'Main Campus (all staff)', subject: 'Oxygen manifold pressure alarm at 03:10 — resolved, but read this', body: 'The manifold low-pressure alarm sounded at 03:10 and the reserve bank came in automatically. Engineering has replaced the regulator. If you were on shift and heard the alarm, the report is with the ward manager — nothing you did was wrong, and the alarm is why the changeover worked.', fromCode: 'EMP-1042', fromName: 'R. Howlader', sentAt: '2026-10-16 08:20', status: 'delivered', recipientCount: 118, readCount: 96, relatedTo: 'Incident 2026-10-16' },
  { id: 'nt-3', channel: 'board', priority: 'normal', audience: 'department:nursing', audienceLabel: 'Department nursing', subject: 'Hand-hygiene audit starts Monday — the five moments, not the gel', body: 'Auditors will be on the wards from Monday. What is counted is the five moments, not the number of times somebody uses the gel bottle. The September figure was 62% with the biggest gap at “before touching a patient”. Ask if you are not sure which moment is which.', fromCode: 'EMP-1013', fromName: 'M. Ali', sentAt: '2026-10-15 16:40', status: 'delivered', recipientCount: 46, readCount: 39, relatedTo: 'Infection control' },
  { id: 'nt-4', channel: 'board', priority: 'normal', audience: 'role:Consultant', audienceLabel: 'Consultant (everyone in the role)', subject: 'Formulary: ceftriaxone restricted from Monday', body: 'The drugs committee has restricted ceftriaxone to the indications in the revised list. The change follows the resistance pattern in the September cultures. The restricted list is in the Download Centre under the pharmacy type.', fromCode: 'EMP-1120', fromName: 'H. Mia', sentAt: '2026-10-14 11:15', status: 'delivered', recipientCount: 14, readCount: 13, relatedTo: 'Formulary 2026-10' },
  { id: 'nt-5', channel: 'board', priority: 'normal', audience: 'role:Physiotherapist', audienceLabel: 'Physiotherapist (everyone in the role)', subject: 'Physiotherapy huddle — nobody is in the audience', body: 'This notice was written for the physiotherapy team. The register holds nobody with that role at this branch, so this text is what the screen shows instead of sending it: a notice written to a role nobody holds is a message the sender believes went somewhere.', fromCode: 'EMP-1042', fromName: 'R. Howlader', sentAt: '2026-10-16 14:20', status: 'cancelled', recipientCount: 0, readCount: 0, relatedTo: '', refusedReason: 'No member of staff holds this role at this branch. The audience is not sent to, and the sender is told which audience has nobody in it rather than finding out later.' },
  { id: 'nt-6', channel: 'board', priority: 'normal', audience: 'department:med', audienceLabel: 'Department med', subject: 'Diabetic foot clinic moves to Tuesday afternoons', body: 'From next week the clinic runs Tuesday 14:00–17:00 in OPD-4 instead of Wednesday morning. Patients are being told at their appointments and through the portal. The dressing room stays where it is.', fromCode: 'EMP-1042', fromName: 'R. Howlader', sentAt: '2026-10-13 09:05', status: 'delivered', recipientCount: 38, readCount: 35, relatedTo: 'OPD timetable' },
  /* The outbound attempts: one that was refused, one that went out, and one still held. */
  { id: 'nt-7', channel: 'whatsapp', priority: 'normal', audience: 'patient:SH-102355', audienceLabel: 'Fatema Begum (SH-102355)', subject: 'Appointment reminder', body: 'Your antenatal check at Dizi Main Campus is tomorrow at 11:00 with Dr. R. Akter. Please bring your card. Dizi Hospital.', fromCode: 'EMP-1077', fromName: 'S. Ahmed', sentAt: '2026-10-15 18:00', status: 'delivered', recipientCount: 1, readCount: 1, relatedTo: 'SH-102355' },
  { id: 'nt-8', channel: 'whatsapp', priority: 'normal', audience: 'patient:SH-102397', audienceLabel: 'Jahangir Alam (SH-102397)', subject: 'Report ready', body: 'Your ultrasound report is ready and can be seen in the patient portal. If you would prefer a printed copy, the records desk is open 08:00–20:00. Dizi Hospital.', fromCode: 'EMP-1042', fromName: 'R. Howlader', sentAt: '2026-10-16 15:02', status: 'failed', recipientCount: 1, readCount: 0, relatedTo: 'SH-102397', refusedReason: 'dizi.consent-missing — this patient has consented to e-mail but not to WhatsApp, and the two are different consents. The report is in the portal already; the desk will telephone instead.' },
  { id: 'nt-9', channel: 'email', priority: 'normal', audience: 'patient:SH-102388', audienceLabel: 'Shahidul Islam (SH-102388)', subject: 'Discharge summary attached', body: 'Please find your discharge summary attached. Dizi Hospital.', fromCode: 'EMP-1042', fromName: 'R. Howlader', sentAt: '2026-10-16 15:20', status: 'cancelled', recipientCount: 1, readCount: 0, relatedTo: 'SH-102388', refusedReason: 'An attachment is refused: a clinical document goes through the Download Centre, where the share can be withdrawn and the opening is recorded. An email cannot un-share anything.' },
];

export const RECEIPTS: NoticeReceipt[] = [
  { noticeId: 'nt-1', staffCode: 'EMP-1055', staffName: 'N. Sultana', readAt: '2026-10-16 14:07', deviceNodeId: 'DHK-01' },
  { noticeId: 'nt-1', staffCode: 'EMP-1013', staffName: 'M. Ali', readAt: '2026-10-16 14:09', deviceNodeId: 'DHK-01' },
  { noticeId: 'nt-3', staffCode: 'EMP-1013', staffName: 'M. Ali', readAt: '2026-10-15 16:41', deviceNodeId: 'DHK-01' },
  { noticeId: 'nt-4', staffCode: 'EMP-1031', staffName: 'Dr. N. Islam', readAt: '2026-10-14 11:20', deviceNodeId: 'DHK-01' },
  { noticeId: 'nt-2', staffCode: 'EMP-1042', staffName: 'R. Howlader', readAt: '2026-10-16 08:21', deviceNodeId: 'DHK-01' },
];

export const noticesFor = (audienceRef: string, notices: Notice[] = NOTICES): Notice[] =>
  notices.filter((n) => n.audience === audienceRef || n.channel === 'board');

export const receiptsFor = (noticeId: string, receipts: NoticeReceipt[] = RECEIPTS): NoticeReceipt[] => receipts.filter((r) => r.noticeId === noticeId);

/** Who has not opened it — the list a “were you told?” question is actually answered from. */
export function unreadBy(notice: Notice, audience: Audience, receipts: NoticeReceipt[]): HrStaff[] {
  const read = new Set(receiptsFor(notice.id, receipts).map((r) => r.staffCode));
  return audience.members.filter((person) => !read.has(person.code));
}

/* ------------------------------------------------------------------ patient consent, per channel */

export interface Consent {
  mrn: string;
  patientName: string;
  channel: Channel;
  agreedOn: string;
  /** Where the consent was taken: a form at the desk, the portal, or a signed sheet scanned in. */
  how: string;
  withdrawnOn?: string;
}

export const CONSENTS: Consent[] = [
  { mrn: 'SH-102355', patientName: 'Fatema Begum', channel: 'whatsapp', agreedOn: '2026-03-02', how: 'Registration form, ticked and signed' },
  { mrn: 'SH-102355', patientName: 'Fatema Begum', channel: 'email', agreedOn: '2026-03-02', how: 'Registration form, ticked and signed' },
  { mrn: 'SH-102388', patientName: 'Shahidul Islam', channel: 'email', agreedOn: '2026-10-13', how: 'Admission form at the ward desk' },
  { mrn: 'SH-102397', patientName: 'Jahangir Alam', channel: 'email', agreedOn: '2026-06-11', how: 'Registration form, ticked and signed' },
  { mrn: 'SH-102398', patientName: 'Ayesha Siddika', channel: 'whatsapp', agreedOn: '2026-09-30', how: 'Portal, agreed by the mother as guardian' },
  { mrn: 'SH-102402', patientName: 'Kamrul Hossain', channel: 'whatsapp', agreedOn: '2026-09-20', how: 'Portal, agreed at the appointment reminder screen' },
  /* Withdrawn: the row is kept, because the hospital has to be able to show when consent ended. */
  { mrn: 'SH-102341', patientName: 'Rafiqul Hasan', channel: 'whatsapp', agreedOn: '2025-11-04', how: 'Registration form', withdrawnOn: '2026-08-12' },
];

export const consentFor = (mrn: string, channel: Channel, consents: Consent[] = CONSENTS): Consent | undefined =>
  consents.find((c) => c.mrn === mrn && c.channel === channel && !c.withdrawnOn);

/* ------------------------------------------------------------------ the refusals */

export interface MessageIssue {
  code: string;
  message: string;
}

export interface MessageCheck {
  ok: boolean;
  reasons: MessageIssue[];
  warnings: MessageIssue[];
  /** Resolved recipients, for the sentence the screen shows before sending. */
  recipients: HrStaff[];
}

export interface NoticeDraft {
  subject: string;
  body: string;
  priority: Priority;
  audienceRef: string;
  relatedTo: string;
  channel: Channel;
}

/** A notice may name an MRN and never a clinical detail: the board is read by the whole hospital. */
export const CLINICAL_DETAIL = /\b(hiv|hbsag|hepatitis|covid|tubercul|tb positive|cancer|malignan|pregnan|abortion|psychiatric|suicid|overdose|dengue positive|positive for)\b/i;
export const IDENTIFIER = /\b(SH-\d{6}|EMP-\d{4}|01\d{9})\b/;

export interface MessagingContext {
  today: string;
  nowMinute: number;
  audiences: Audience[];
  notices: Notice[];
  receipts: NoticeReceipt[];
  /** True when the desk is on this node rather than the cloud. */
  cloudReachable: boolean;
}

export function checkNotice(draft: NoticeDraft, ctx: MessagingContext): MessageCheck {
  const reasons: MessageIssue[] = [];
  const warnings: MessageIssue[] = [];
  const audience = ctx.audiences.find((a) => `${a.kind}:${a.ref}` === draft.audienceRef);
  const recipients = audience?.members ?? [];

  if (!draft.subject.trim()) {
    reasons.push({ code: 'no-subject', message: 'A notice needs a subject that says what it is about from the list. “URGENT” as a subject is read as noise by the fourth person who sees it.' });
  }
  if (draft.body.trim().length < 20) {
    reasons.push({ code: 'too-short', message: 'Write the notice. A board message of four words is read as a hint and answered with a telephone call, which is not what the board is for.' });
  }
  if (!draft.audienceRef) {
    reasons.push({ code: 'no-audience', message: 'Choose who it is for. The counts come from the staff register: “all nurses” means the sixty-two people who exist, not the number somebody remembered.' });
  }
  if (audience && recipients.length === 0) {
    reasons.push({
      code: 'empty-audience',
      message: `Nobody holds “${audience.ref}” at this branch. The notice is not sent: a message to a role nobody has is one the sender believes went somewhere. Pick the audience that exists, or name the people directly.`,
    });
  }
  if (draft.priority === 'urgent' && !/\b(now|tonight|today|immediately|before|by \d)\b/i.test(draft.body)) {
    warnings.push({ code: 'urgent-without-when', message: 'Marked urgent with no time in the text. Urgent means “act before you do the next thing”, and a notice without a when is read as one more thing on the board.' });
  }
  if (CLINICAL_DETAIL.test(draft.body) || CLINICAL_DETAIL.test(draft.subject)) {
    reasons.push({
      code: 'clinical-detail',
      message: 'The notice carries a clinical detail about a patient. The board is read by the whole hospital, including people with no part in the care: an MRN is fine — it points at the record — and a diagnosis in the text is a clinical record in a place that has no consent for it.',
    });
  }
  if (draft.priority === 'urgent' && /^(all|everyone)/i.test(draft.subject) === false && recipients.length > 60) {
    warnings.push({ code: 'urgent-wide', message: `${recipients.length} people will be interrupted by this. That is the right call for a shift that needs covering tonight, and the wrong one for a timetable change — the difference is whether somebody has to act before their next task.` });
  }
  if (draft.channel === 'board' && draft.body.length > 1200) {
    warnings.push({ code: 'long-notice', message: 'A long notice on a board is read on a phone between patients. Anything over a couple of paragraphs belongs in the Download Centre with a notice pointing at it.' });
  }
  if (draft.channel === 'push' && !ctx.cloudReachable) {
    warnings.push({ code: 'push-offline', message: 'Push needs the cloud to reach a phone outside the building. On this node the notice goes to the board as well, and the register shows which one people actually read.' });
  }
  if (draft.relatedTo.trim() && IDENTIFIER.test(draft.relatedTo) && !/^SH-\d{6}$/.test(draft.relatedTo.trim())) {
    warnings.push({ code: 'loose-reference', message: 'The reference is an identifier rather than an MRN or an admission. Referencing a record is useful; pasting a number into a free-text field is how a board message ends up meaning nothing in a week.' });
  }
  const duplicateToday = ctx.notices.find((n) => n.channel === 'board' && n.subject.trim().toLowerCase() === draft.subject.trim().toLowerCase() && n.sentAt.startsWith(ctx.today));
  if (duplicateToday) {
    warnings.push({ code: 'already-sent', message: `“${duplicateToday.subject}” was already sent today at ${duplicateToday.sentAt.slice(11)} to ${duplicateToday.audienceLabel}. Sending it again means the second one is read as a correction — add what changed to the text instead.` });
  }
  return { ok: reasons.length === 0, reasons, warnings, recipients };
}

export interface OutboundDraft {
  channel: Channel;
  patientMrn: string;
  patientName: string;
  phone: string;
  body: string;
  template: string;
  attachments: number;
  consent: Consent | undefined;
}

/** Minutes past midnight, from the contract's own `HH:MM`. */
const minutesOf = (clock: string): number => {
  const [hours, minutes] = clock.split(':').map(Number);

  return hours * 60 + minutes;
};

/**
 * The quiet window, read from `x-dizi-notifications.quietHours` rather than typed here.
 *
 * This is the third place this rule has been written down in this repository's life — the screen had 20:00, the
 * contract says 21:00 — and the lesson is the same one the contract gate exists for: a rule with two homes has a
 * bug in one of them. The screen reads it; the service enforces it.
 */
export const QUIET_HOURS = {
  from: minutesOf(NOTIFICATIONS.quietHours.from),
  to: minutesOf(NOTIFICATIONS.quietHours.to),
  note: NOTIFICATIONS.quietHours.note,
};

export function checkOutbound(draft: OutboundDraft, ctx: MessagingContext): MessageCheck {
  const reasons: MessageIssue[] = [];
  const warnings: MessageIssue[] = [];
  const spec = channelSpec(draft.channel);

  if (!draft.patientMrn.trim()) {
    reasons.push({ code: 'no-patient', message: 'A patient message is about one patient. The MRN is what the consent record, the number and the audit entry are all keyed on.' });
  }
  if (draft.attachments > 0) {
    reasons.push({ code: 'no-attachments', message: 'An attachment is refused on every outbound channel. A clinical document goes through the Download Centre, where the share can be withdrawn and the opening is recorded — an email cannot un-share anything.' });
  }
  if (!spec.worksOffline && !ctx.cloudReachable) {
    reasons.push({ code: 'offline-not-allowed', message: `${spec.label} goes through a third-party gateway, so it is online-only by contract: a queued message is one the hospital believes it sent and cannot verify. The noticeboard is unaffected.` });
  }
  if (!draft.consent) {
    reasons.push({
      code: 'consent-missing',
      message: `dizi.consent-missing — no consent for ${spec.label.toLowerCase()} on this patient’s file. SMS and WhatsApp are separate consents and patients regularly give one and not the other. Offer the portal or the printed copy instead: sending first and asking afterwards cannot be undone.`,
    });
  }
  if (!draft.phone.trim()) {
    reasons.push({ code: 'no-number', message: 'No number on the record to send to. The number on a message is the one the patient gave the hospital, never one typed into this sheet — a mistyped digit sends somebody else’s appointment to a stranger.' });
  }
  if (!draft.template.trim()) {
    warnings.push({ code: 'free-text', message: 'This is free text rather than a template. Templates are approved once, carry the hospital’s name and the number to call, and cannot be edited at 23:00 by somebody in a hurry — and WhatsApp refuses anything that is not an approved template outside the 24-hour window, so the free text may not go at all.' });
  }
  if (draft.body.trim().length < 30) {
    reasons.push({ code: 'too-short', message: 'A patient message has to say what it is about and what to do next. “Report ready” from an unknown number is read as a scam, and patients are right to treat it that way.' });
  }
  if (draft.channel === 'whatsapp' && draft.body.length > 480) {
    reasons.push({ code: 'too-long', message: `${draft.body.length} characters is a letter on a telephone. A patient message says what it is about and what to do next, and anything longer belongs in the portal or on the printed copy — send the summary and point at the rest.` });
  }
  const inQuietHours = ctx.nowMinute >= QUIET_HOURS.from || ctx.nowMinute < QUIET_HOURS.to;
  if (inQuietHours) {
    warnings.push({ code: 'quiet-hours', message: `${QUIET_HOURS.note} It is ${String(Math.floor(ctx.nowMinute / 60)).padStart(2, '0')}:${String(ctx.nowMinute % 60).padStart(2, '0')} — this will be held to the morning unless it is marked urgent, and the sender is told which happened.` });
  }
  if (CLINICAL_DETAIL.test(draft.body)) {
    reasons.push({ code: 'clinical-detail', message: 'The message carries a diagnosis. An SMS sits unencrypted on a handset that may be shared, and a clinical detail in it is a disclosure the patient did not ask for. Say that the result is ready and put the result in the portal.' });
  }
  if (/https?:\/\//i.test(draft.body)) {
    warnings.push({ code: 'link', message: 'The message contains a link. Links in hospital messages train patients to trust links, which is exactly what the next scam relies on — point at the portal by name instead.' });
  }
  return { ok: reasons.length === 0, reasons, warnings, recipients: [] };
}

/* ------------------------------------------------------------------ the digest */

export interface MessagingDigest {
  notices: number;
  urgent: number;
  unreadUrgent: number;
  failed: number;
  cancelled: number;
  readRate: number;
  outboundSent: number;
  outboundRefused: number;
  consents: number;
  withdrawnConsents: number;
}

export function messagingDigest(notices: Notice[], consents: Consent[] = CONSENTS): MessagingDigest {
  const board = notices.filter((n) => n.channel === 'board' || n.channel === 'push');
  const outbound = notices.filter((n) => channelSpec(n.channel).kind === 'outbound');
  const sent = board.filter((n) => n.status !== 'cancelled');
  const recipients = sent.reduce((n, x) => n + x.recipientCount, 0);
  const read = sent.reduce((n, x) => n + x.readCount, 0);
  return {
    notices: notices.length,
    urgent: notices.filter((n) => n.priority === 'urgent').length,
    unreadUrgent: notices.filter((n) => n.priority === 'urgent' && n.status !== 'cancelled' && n.readCount < n.recipientCount).length,
    failed: outbound.filter((n) => n.status === 'failed').length,
    cancelled: notices.filter((n) => n.status === 'cancelled').length,
    readRate: recipients ? read / recipients : 0,
    outboundSent: outbound.filter((n) => n.status === 'delivered' || n.status === 'sent').length,
    outboundRefused: outbound.filter((n) => n.status === 'cancelled' || n.status === 'failed').length,
    consents: consents.filter((c) => !c.withdrawnOn).length,
    withdrawnConsents: consents.filter((c) => c.withdrawnOn).length,
  };
}

/** The template a patient message starts from. Templates are approved once and not edited by hand. */
export const TEMPLATES: Array<{ key: string; label: string; body: string; when: string }> = [
  { key: 'appointment-reminder', label: 'Appointment reminder', body: 'Your appointment at {hospital} is on {date} at {time} with {doctor}. Please bring your card and any previous reports. To change it, telephone {desk}.', when: 'Evening before, inside quiet hours' },
  { key: 'report-ready', label: 'Report ready', body: 'Your report for {panel} is ready and can be read in the patient portal. A printed copy is available at the records desk, 08:00–20:00. {hospital}.', when: 'When a result is released, never before' },
  { key: 'no-show', label: 'Missed appointment', body: 'You missed your appointment on {date}. Please telephone {desk} to book another one — nothing has been cancelled on your record. {hospital}.', when: 'Same day, after the clinic closes' },
  { key: 'due-vaccination', label: 'Vaccination due', body: 'The next dose for your child is due around {date}. Come to the vaccination clinic any morning, 08:00–12:00, and bring the card. {hospital}.', when: 'A week before the due date' },
];

/** What the phase cannot do until the API exists, said on the screen. */
export const MESSAGING_WAITING: string[] = [
  'The noticeboard is a record on this node and works with the uplink down — that is deliberate, because the failure people most often need to tell each other about is the uplink itself.',
  'The outbound half is served by the hospital server (P0-403): the send, the consent check, the quiet hours, the retry and the log all go through the contract’s own operations. No message has left this building from this repository: there is no Meta business account and no mail relay here, so the driver in force is `preview`, which renders the message, records what it would have sent and touches no network. The log says which driver carried each row.',
  'Delivery receipts from a gateway arrive by webhook, and the service has no endpoint for the provider to call yet. So the log says `sent` — the provider accepted it — and never `delivered` until something can verify it.',
];
