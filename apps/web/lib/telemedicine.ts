/* ----------------------------------------------------------------------------------------------------
 * Live consultation and live meeting (P8).
 *
 * Two screens, one record. A consultation is a room with a patient in it and a meeting is a room with a
 * department in it; the lifecycle, the waiting list, the start time and the outcome are identical, and the
 * contract models them as one `telemedicine.session` with a `kind` for exactly that reason. What differs is the
 * rules, and the rules are the interesting part:
 *
 *  - a consultation without an MRN is not a consultation, it is a meeting;
 *  - the room is allocated **here**, by this node, before the cloud is asked, so a room exists even with the
 *    uplink down — and the appointment slot it belongs to is confirmed when the queue drains (`dizi.slot-taken`
 *    is the refusal, and it names the alternatives rather than moving the patient);
 *  - recording is a consent question, not a settings question: the patient is told, and the register keeps the
 *    answer;
 *  - a minor is seen with an attendant named on the session, because a doctor examining a child on video with
 *    nobody in the room is a clinical decision the hospital has to be able to defend;
 *  - the waiting list is ordered by the time the patient arrived, not by the time they were booked, because
 *    that is the queue a patient can see from the corridor.
 */

import { DOCTORS, doctorById, type Doctor } from './appointments';
import type { HrStaff } from './hr';

export type SessionKind = 'consultation' | 'meeting';
export type Channel = 'video' | 'audio' | 'chat';
export type SessionStatus = 'scheduled' | 'waiting' | 'live' | 'ended' | 'missed';
export type Recording = 'none' | 'consented' | 'refused';

export interface TeleSession {
  id: string;
  kind: SessionKind;
  title: string;
  /** Allocated by this node at booking time: the room exists before the cloud knows about it. */
  room: string;
  channel: Channel;
  /** A consultation names a patient. A meeting names a department and, sometimes, an outside guest. */
  patientMrn: string | null;
  patientName: string | null;
  patientAge: number | null;
  doctorId: string;
  doctorName: string;
  /** Staff invited to a meeting, or the nurse and attendant in the room for a consultation. */
  participants: string[];
  department: string;
  /** Minutes from midnight, like every other appointment in the app. */
  start: number;
  durationMin: number;
  status: SessionStatus;
  waitingSince: number | null;
  startedAt: number | null;
  endedAt: number | null;
  outcome: string;
  followUpOn: string | null;
  recording: Recording;
  /** Who consented and when, when recording was agreed. An empty string means nobody agreed yet. */
  consentRef: string;
  attendantName: string;
  reason: string;
  externalGuest: string;
  version: number;
}

/* ------------------------------------------------------------------ the rules */

export interface TeleRule {
  key: string;
  label: string;
  because: string;
}

export const TELE_RULES: TeleRule[] = [
  { key: 'mrN-required', label: 'A consultation names a patient', because: 'A video room with no MRN on it is a meeting. The register has to be able to say whose consultation it was, and a room nobody can attribute is a room whose outcome goes in the wrong file.' },
  { key: 'consent-before-room', label: 'The patient is told before the room opens', because: 'Who they are seeing, what it costs, and that the room is not recorded. A patient who finds out at the join link that they are on camera has been handled badly.' },
  { key: 'recording-consent', label: 'Recording needs the patient’s own yes', because: 'A recorded consultation is a document that lives afterwards. Consent is recorded against the session, and “refused” is a normal answer rather than an error.' },
  { key: 'minor-attendant', label: 'A patient under 18 is seen with an adult named', because: 'Nobody should be examining a child through a camera with no adult in the room, and the session says who was there.' },
  { key: 'queue-by-arrival', label: 'The waiting list is ordered by arrival', because: 'The clock the patient can see is the one that decides who goes next. Booking time decides the slot; arrival decides the queue.' },
  { key: 'device-before-doctor', label: 'The room is tested before the doctor joins', because: 'A consultation lost to a muted microphone wastes the one slot the patient travelled for. The pre-call check is part of the screen, not advice in a manual.' },
  { key: 'late-window', label: 'A room opened late is still recorded as late', because: 'A late start is a fact the clinic reads next month. The register keeps the booked time and the started time apart instead of rewriting one into the other.' },
  { key: 'end-with-outcome', label: 'A session ends with an outcome', because: '“Ended” on its own tells the next clinician nothing. The outcome is what the follow-up list is built from, and it is written while the doctor remembers it.' },
];

/* What the patient is told before the room opens. Read from the branch’s own telemedicine setting, and printed
 * on the screen so the person opening the room can check it without leaving the page. */
export const PATIENT_BRIEFING: string[] = [
  'The doctor’s name, department and the exact time of the room.',
  'That this is a video consultation, that it is not a substitute for an examination, and what brings them in anyway.',
  'That the room is not recorded, unless they agree to it — and that they may say no.',
  'The consultation fee, and that it is the same fee as the physical chamber.',
  'The number to call if the connection fails: the desk, not the doctor’s mobile.',
];

export const CHANNEL_QUALITY: Array<{ channel: Channel; needs: string; fallback: string }> = [
  { channel: 'video', needs: '1.5 Mbps up and down, and a device with a camera', fallback: 'Drop to audio and keep the consultation, rather than dropping the consultation.' },
  { channel: 'audio', needs: '300 kbps, a phone with credit', fallback: 'Read the prescription number aloud; the pharmacy looks it up by MRN.' },
  { channel: 'chat', needs: 'A text connection at any speed', fallback: 'The desk telephones the patient within the hour, and the room stays open until they answer.' },
];

export const DEVICE_CHECKS: Array<{ key: string; label: string; passes: string; fails: string }> = [
  { key: 'camera', label: 'Camera', passes: 'The doctor can see the patient', fails: 'Audio only, said out loud at the start of the call' },
  { key: 'mic', label: 'Microphone', passes: 'Both sides can hear', fails: 'The desk telephones the patient and joins them in' },
  { key: 'speaker', label: 'Speaker', passes: 'The patient can hear the doctor', fails: 'The attendant holds the phone and repeats — recorded as an assisted consultation' },
  { key: 'uplink', label: 'Uplink', passes: 'The cloud is reachable, so the room joins', fails: 'The room is booked and printed here; the link goes out when the queue drains' },
  { key: 'consent', label: 'Consent', passes: 'The patient was told and agreed', fails: 'The room does not open for recording, and the screen says why' },
];

/* ------------------------------------------------------------------ the day’s rooms */

const pad = (n: number) => String(n).padStart(2, '0');
const roomSuffix = (day: string) => day.replace(/-/g, '').slice(2);
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

interface Seed {
  id: string;
  kind: SessionKind;
  title: string;
  channel: Channel;
  patientMrn: string | null;
  patientName: string | null;
  patientAge: number | null;
  doctorId: string;
  participants: string[];
  department: string;
  start: number;
  durationMin: number;
  status: SessionStatus;
  waitingSince: number | null;
  startedAt: number | null;
  endedAt: number | null;
  outcome: string;
  followUpOn: string | null;
  recording: Recording;
  consentRef: string;
  attendantName: string;
  reason: string;
  externalGuest: string;
}

/* Two rooms that are the reason this screen exists at all: one already live with the doctor running late, and
 * one patient sitting in the waiting list with the uplink out. */
const CONSULT_SEEDS: Seed[] = [
  { id: 'tele-01', kind: 'consultation', title: 'Follow-up — hypertension', channel: 'video', patientMrn: 'SH-102341', patientName: 'Rafiqul Hasan', patientAge: 61, doctorId: 'dr-islam', participants: ['N. Sultana (nurse)'], department: 'Cardiology', start: 9 * 60 + 30, durationMin: 20, status: 'ended', waitingSince: 9 * 60 + 22, startedAt: 9 * 60 + 34, endedAt: 9 * 60 + 52, outcome: 'BP 150/95 on the home readings. Amlodipine 5 mg continued, salt diary for two weeks, review with the 24-hour ABPM report.', followUpOn: null, recording: 'refused', consentRef: 'ptl-consent-8841', attendantName: 'Ruma Khatun (daughter)', reason: 'Review of home blood-pressure readings', externalGuest: '' },
  { id: 'tele-02', kind: 'consultation', title: 'Paediatric fever — same-day review', channel: 'video', patientMrn: 'SH-102398', patientName: 'Ayesha Siddika', patientAge: 4, doctorId: 'dr-hossain', participants: ['R. Khatun (nurse)'], department: 'Paediatrics', start: 10 * 60, durationMin: 15, status: 'live', waitingSince: 9 * 60 + 55, startedAt: 10 * 60 + 6, endedAt: null, outcome: '', followUpOn: null, recording: 'consented', consentRef: 'ptl-consent-8845', attendantName: 'Shirin Sultana (mother)', reason: 'Fever for three days, not settling on paracetamol', externalGuest: '' },
  { id: 'tele-03', kind: 'consultation', title: 'Report review — thyroid profile', channel: 'audio', patientMrn: 'SH-102377', patientName: 'Nasrin Akter', patientAge: 38, doctorId: 'dr-rahman', participants: [], department: 'Medicine', start: 10 * 60 + 30, durationMin: 15, status: 'waiting', waitingSince: 10 * 60 + 24, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: 'ptl-consent-8850', attendantName: '', reason: 'TSH report review, on levothyroxine since March', externalGuest: '' },
  { id: 'tele-04', kind: 'consultation', title: 'Antenatal check — second trimester', channel: 'video', patientMrn: 'SH-102355', patientName: 'Fatema Begum', patientAge: 27, doctorId: 'dr-akter', participants: ['S. Akter (midwife)'], department: 'Obstetrics', start: 11 * 60, durationMin: 20, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: 'Abdul Karim (husband)', reason: 'Routine antenatal review, 22 weeks', externalGuest: '' },
  { id: 'tele-05', kind: 'consultation', title: 'Diabetes education — diet review', channel: 'video', patientMrn: 'SH-102402', patientName: 'Kamrul Hossain', patientAge: 54, doctorId: 'dr-chowdhury', participants: ['F. Yasmin (dietitian)'], department: 'Medicine', start: 11 * 60 + 30, durationMin: 20, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Fasting glucose rising; diet and walking plan', externalGuest: '' },
  { id: 'tele-06', kind: 'consultation', title: 'Post-operative wound check', channel: 'video', patientMrn: 'SH-102388', patientName: 'Shahidul Islam', patientAge: 44, doctorId: 'dr-khan', participants: [], department: 'Orthopaedics', start: 12 * 60, durationMin: 15, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Day 10 after ORIF left tibia — dressing and suture line', externalGuest: '' },
  /* The two the rules are about: a patient who did not join, and a consultation booked with nobody in the room
   * to sit with a child. */
  { id: 'tele-07', kind: 'consultation', title: 'Follow-up — asthma inhaler technique', channel: 'video', patientMrn: 'SH-102361', patientName: 'Rehana Parvin', patientAge: 31, doctorId: 'dr-rahman', participants: [], department: 'Medicine', start: 9 * 60, durationMin: 15, status: 'missed', waitingSince: null, startedAt: null, endedAt: null, outcome: 'Did not join the room. Notified by SMS at 09:05 with the join link; the desk telephoned at 09:20.', followUpOn: null, recording: 'none', consentRef: 'ptl-consent-8832', attendantName: '', reason: 'Inhaler technique and spacer use', externalGuest: '' },
  { id: 'tele-08', kind: 'consultation', title: 'Paediatric rash — review', channel: 'video', patientMrn: 'SH-102410', patientName: 'Mizanur Rahman', patientAge: 9, doctorId: 'dr-hossain', participants: [], department: 'Paediatrics', start: 12 * 60 + 30, durationMin: 15, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Rash on both arms since Sunday', externalGuest: '' },
];

const MEETING_SEEDS: Seed[] = [
  { id: 'mtg-01', kind: 'meeting', title: 'Morning clinical handover', channel: 'video', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-rahman', participants: ['dr-chowdhury', 'dr-islam', 'dr-hossain', 'N. Sultana (nurse)', 'M. Ali (ward manager)'], department: 'Medicine', start: 9 * 60, durationMin: 20, status: 'ended', waitingSince: null, startedAt: 9 * 60 + 2, endedAt: 9 * 60 + 18, outcome: 'Two admissions overnight, one for observation. Bed 12 held for the post-operative transfer.', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Ward handover, night to day', externalGuest: '' },
  { id: 'mtg-02', kind: 'meeting', title: 'Infection-control committee', channel: 'video', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-chowdhury', participants: ['dr-islam', 'R. Howlader (admin)', 'M. Ali (ward manager)', 'T. Akter (lab)'], department: 'Administration', start: 10 * 60 + 30, durationMin: 45, status: 'live', waitingSince: null, startedAt: 10 * 60 + 33, endedAt: null, outcome: '', followUpOn: null, recording: 'consented', consentRef: 'mtg-consent-2211', attendantName: '', reason: 'Quarterly review: hand hygiene audit, one C. difficile case, theatre ventilation', externalGuest: 'Dr. S. Kabir (IEDCR)' },
  { id: 'mtg-03', kind: 'meeting', title: 'Pharmacy stock review', channel: 'audio', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-rahman', participants: ['H. Mia (pharmacist)', 'R. Howlader (admin)'], department: 'Pharmacy', start: 12 * 60, durationMin: 30, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Antibiotic stock-out list and the alternatives in the formulary', externalGuest: '' },
  { id: 'mtg-04', kind: 'meeting', title: 'Nursing roster — November', channel: 'video', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-akter', participants: ['N. Sultana (nurse)', 'S. Akter (midwife)', 'M. Ali (ward manager)'], department: 'Nursing', start: 15 * 60, durationMin: 30, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Cover for the Hajj leave and the two night-shift vacancies', externalGuest: '' },
  { id: 'mtg-05', kind: 'meeting', title: 'Discharge-process workshop', channel: 'video', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-islam', participants: ['dr-rahman', 'R. Howlader (admin)', 'H. Mia (pharmacist)', 'N. Sultana (nurse)'], department: 'Administration', start: 16 * 60, durationMin: 45, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Why the discharge summary reaches the pharmacy after the patient has left', externalGuest: '' },
  /* Nobody in the audience: the case the recipient check exists for. */
  { id: 'mtg-06', kind: 'meeting', title: 'Physiotherapy team huddle', channel: 'video', patientMrn: null, patientName: null, patientAge: null, doctorId: 'dr-khan', participants: [], department: 'Physiotherapy', start: 16 * 60 + 30, durationMin: 15, status: 'scheduled', waitingSince: null, startedAt: null, endedAt: null, outcome: '', followUpOn: null, recording: 'none', consentRef: '', attendantName: '', reason: 'Weekly case load', externalGuest: '' },
];

function build(seed: Seed, day: string, index: number): TeleSession {
  const doctor = doctorById(seed.doctorId);
  return {
    ...seed,
    room: `${seed.kind === 'consultation' ? 'TELE' : 'MTG'}-${roomSuffix(day)}-${pad(index + 1)}`,
    doctorName: doctor.name,
    version: 1 + (index % 3),
  };
}

const consultOf = (day: string) => CONSULT_SEEDS.map((seed, i) => build(seed, day, i));
const meetingsOf = (day: string) => MEETING_SEEDS.map((seed, i) => build(seed, day, i));

export interface TeleDigest {
  total: number;
  scheduled: number;
  waiting: number;
  live: number;
  ended: number;
  missed: number;
  avgWaitMin: number;
  longestWaitMin: number;
  consentedRecording: number;
  attendedByOthers: number;
  bookedMinutes: number;
  /** Consultations where the patient did not join, as a share. The figure the clinic argues about. */
  missedShare: number;
}

const statsOf = (sessions: TeleSession[]): TeleDigest => {
  const waited = sessions.filter((s) => s.waitingSince !== null && s.startedAt !== null).map((s) => s.startedAt! - s.waitingSince!);
  const live = sessions.filter((s) => s.status === 'live').length;
  const ended = sessions.filter((s) => s.status === 'ended').length;
  const missed = sessions.filter((s) => s.status === 'missed').length;
  return {
    total: sessions.length,
    scheduled: sessions.filter((s) => s.status === 'scheduled').length,
    waiting: sessions.filter((s) => s.status === 'waiting').length,
    live,
    ended,
    missed,
    avgWaitMin: waited.length ? Math.round(waited.reduce((a, b) => a + b, 0) / waited.length) : 0,
    longestWaitMin: waited.length ? Math.max(...waited) : 0,
    consentedRecording: sessions.filter((s) => s.recording === 'consented').length,
    attendedByOthers: sessions.filter((s) => s.attendantName.length > 0).length,
    bookedMinutes: sessions.reduce((n, s) => n + s.durationMin, 0),
    missedShare: sessions.length ? missed / sessions.length : 0,
  };
};

export interface TeleDay {
  day: string;
  sessions: TeleSession[];
  stats: TeleDigest;
  /** The queue, in the order a patient in the corridor can see it. */
  waiting: TeleSession[];
  live: TeleSession[];
  /** The next rooms to open, for the header’s “what is next” line. */
  upcoming: TeleSession[];
  roomsUsed: string[];
}

export function consultDay(day: string, extra: TeleSession[] = []): TeleDay {
  const sessions = [...extra, ...consultOf(day)].filter((s) => s.kind === 'consultation');
  return {
    day,
    sessions,
    stats: statsOf(sessions),
    waiting: sessions.filter((s) => s.status === 'waiting').sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0)),
    live: sessions.filter((s) => s.status === 'live'),
    upcoming: sessions.filter((s) => s.status === 'scheduled').sort((a, b) => a.start - b.start),
    roomsUsed: sessions.map((s) => s.room),
  };
}

export function meetingDay(day: string, extra: TeleSession[] = []): TeleDay {
  const sessions = [...extra, ...meetingsOf(day)].filter((s) => s.kind === 'meeting');
  return {
    day,
    sessions,
    stats: statsOf(sessions),
    waiting: sessions.filter((s) => s.status === 'waiting'),
    live: sessions.filter((s) => s.status === 'live'),
    upcoming: sessions.filter((s) => s.status === 'scheduled').sort((a, b) => a.start - b.start),
    roomsUsed: sessions.map((s) => s.room),
  };
}

/** A room name this node allocates, so the room exists before the cloud is asked about the slot. */
export function nextRoom(kind: SessionKind, day: string, sessions: TeleSession[]): string {
  const prefix = `${kind === 'consultation' ? 'TELE' : 'MTG'}-${roomSuffix(day)}-`;
  const used = sessions.filter((s) => s.room.startsWith(prefix)).length;
  return `${prefix}${pad(used + 1)}`;
}

export const waitingMinutes = (session: TeleSession, now: number): number => (session.waitingSince === null ? 0 : Math.max(0, now - session.waitingSince));

/** Who can be in a room, and what each of them may do. The doctor's name is on the register, not implied. */
export const ROOM_ROLES: Array<{ role: string; may: string }> = [
  { role: 'Consultant', may: 'Open and end the room, write the outcome, request the follow-up' },
  { role: 'Nurse or midwife', may: 'Join, take vitals on camera, and note them against the encounter' },
  { role: 'Attendant', may: 'Sit with the patient and be named on the session — nothing else' },
  { role: 'Interpreter', may: 'Join by invitation, and is named on the session for the same reason an attendant is' },
  { role: 'Outside guest', may: 'Join a meeting only, never a consultation, and only with a named internal host' },
];

/* ------------------------------------------------------------------ the refusals */

export interface TeleIssue {
  code: string;
  message: string;
}

export interface TeleCheck {
  ok: boolean;
  reasons: TeleIssue[];
  warnings: TeleIssue[];
}

export interface TeleDraft {
  kind: SessionKind;
  title: string;
  channel: Channel;
  patientMrn: string;
  patientAge: number | null;
  doctorId: string;
  participants: string[];
  department: string;
  start: number;
  durationMin: number;
  recording: Recording;
  consentRef: string;
  attendantName: string;
  reason: string;
  externalGuest: string;
  followUpOn: string;
}

export interface TeleContext {
  /** The node’s clock, in minutes from midnight. */
  nowMinute: number;
  day: string;
  sessions: TeleSession[];
  /** Doctors already live in another room right now. */
  liveDoctorIds: string[];
  /** The staff register, so a participant nobody employs is refused. */
  directory: HrStaff[];
  /** Whether the cloud answered. When it has not, the slot is only held here. */
  cloudReachable: boolean;
}

export const minutesOf = (clock: string): number => {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
};

export const clockOf = hhmm;

export function checkSession(draft: TeleDraft, ctx: TeleContext): TeleCheck {
  const reasons: TeleIssue[] = [];
  const warnings: TeleIssue[] = [];
  /* A consultation is led by a doctor and a meeting by a host who may be any staff member. Both are resolved
   * against the register, so the sentence the screen shows names the person the room will actually be waiting
   * for rather than a plausible-looking default. */
  const fromRegister = ctx.directory.find((m) => m.id === draft.doctorId || m.code === draft.doctorId || m.name === draft.doctorId);
  const personName = fromRegister?.name ?? doctorById(draft.doctorId).name;
  const personNoun = draft.kind === 'meeting' ? 'host' : 'doctor';

  if (!draft.title.trim()) {
    reasons.push({ code: 'no-title', message: 'The room needs a title. It is what the waiting list shows the desk and what the register shows next month.' });
  }
  if (!draft.reason.trim() && draft.kind === 'consultation') {
    reasons.push({ code: 'no-reason', message: 'Say what the consultation is about. A room titled “follow-up” with no reason is a room the doctor joins without knowing why.' });
  }
  if (draft.kind === 'consultation' && !draft.patientMrn.trim()) {
    reasons.push({ code: 'no-mrn', message: 'A consultation without an MRN is a meeting. Register the patient first, or book this as a meeting.' });
  }
  if (draft.kind === 'meeting' && draft.patientMrn.trim()) {
    reasons.push({ code: 'meeting-with-patient', message: 'A meeting that names a patient is a consultation: the patient has rights over a consultation record that a staff meeting does not give them.' });
  }
  if (draft.kind === 'meeting' && draft.participants.length === 0) {
    reasons.push({ code: 'no-audience', message: 'Invite somebody. A meeting with nobody in the audience is a room that opens, bills time and decides nothing.' });
  }
  if (draft.kind === 'consultation' && draft.patientAge !== null && draft.patientAge < 18 && !draft.attendantName.trim()) {
    reasons.push({ code: 'minor-alone', message: 'This patient is under 18. Name the adult who will be in the room — nobody examines a child through a camera alone.' });
  }
  if (draft.recording !== 'none' && !draft.consentRef.trim()) {
    reasons.push({ code: 'recording-without-consent', message: 'Recording needs the patient’s own consent recorded against the session. Ask, and record the answer — “refused” is an answer.' });
  }
  if (draft.kind === 'consultation' && draft.recording === 'consented' && !draft.attendantName.trim() && draft.patientAge !== null && draft.patientAge >= 18) {
    warnings.push({ code: 'consent-unwitnessed', message: 'The consent was taken by the person who will be recorded. Note who took it in the room — the register keeps their name.' });
  }
  if (draft.durationMin < 10 || draft.durationMin > 60) {
    reasons.push({ code: 'duration', message: 'A room is 10 to 60 minutes. Below ten there is no time to be examined; above an hour it is a clinic session, not one consultation.' });
  }
  if (draft.start < ctx.nowMinute - 15) {
    reasons.push({ code: 'in-the-past', message: 'That time has gone. Book forward, or record the room as it happened — the register refuses to pretend a room was booked before it was.' });
  }
  if (draft.start > ctx.nowMinute + 30 && !ctx.cloudReachable) {
    warnings.push({ code: 'slot-unconfirmed', message: 'Booked more than half an hour out with the cloud unreachable: this node holds the room, and the slot is confirmed when the queue drains. If another branch has taken it, the refusal arrives with the alternatives.' });
  }
  if (ctx.liveDoctorIds.includes(draft.doctorId)) {
    reasons.push({ code: 'doctor-busy', message: `${personName} is already live in another room. Nobody can be in two rooms, and the second one is waiting in front of a camera.` });
  }
  const unknown = draft.participants.filter((id) => !ctx.directory.some((m) => m.code === id || m.id === id || m.name === id));
  if (unknown.length) {
    reasons.push({ code: 'unknown-participant', message: `${unknown.join(', ')} is not on the staff register. Invite people by their staff record, so the room’s membership can be audited.` });
  }
  if (draft.externalGuest.trim() && draft.kind === 'consultation') {
    reasons.push({ code: 'guest-in-consultation', message: 'An outside guest may join a meeting and never a consultation. There is no way to consent a patient to a stranger in the room on the spot.' });
  }
  if (draft.externalGuest.trim() && draft.kind === 'meeting' && !draft.participants.length) {
    warnings.push({ code: 'guest-unhosted', message: 'An outside guest joins a meeting with a named internal host. Name the host in the participants so the room is not left to the guest.' });
  }
  const clash = ctx.sessions.find((s) => s.room && s.status !== 'ended' && s.status !== 'missed' && s.doctorId === draft.doctorId && Math.abs(s.start - draft.start) < s.durationMin && s.id !== '');
  if (clash) {
    reasons.push({ code: 'doctor-clash', message: `${personName} has ${clash.room} at ${hhmm(clash.start)} and it has not ended. Two rooms at once means one ${draft.kind === 'meeting' ? 'meeting' : 'patient'} waiting while the other is turned away.` });
  }
  if (draft.kind === 'consultation' && draft.channel === 'video' && draft.patientAge !== null && draft.patientAge >= 90) {
    warnings.push({ code: 'consider-audio', message: 'Video with a patient of this age is often a consultation an attendant conducts. Consider audio and a telephone number the desk can call.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/** The outcome text a follow-up list is built from. Ending without one is allowed but recorded as incomplete. */
export const OUTCOME_PROMPTS: string[] = [
  'What was decided — the diagnosis, the change, or the “no change”.',
  'What the patient has to do before the next contact, in their words.',
  'Whether the patient needs to be seen in person, and by when.',
];

/** Rooms that overran their booked time, and by how much: the number the clinic asks about. */
export function lateRooms(sessions: TeleSession[]): Array<{ session: TeleSession; minutes: number }> {
  return sessions
    .filter((s) => s.startedAt !== null && s.startedAt > s.start)
    .map((s) => ({ session: s, minutes: s.startedAt! - s.start }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** What the phase cannot do until the API service exists, said on the screen rather than discovered. */
export const TELE_WAITING: string[] = [
  'Room allocation is this node’s own, so booking and the waiting list work with the uplink down. Joining the call needs the cloud — the platform’s own signalling is P0-306 and the room names here are the ones it will carry.',
  'A consultation booked here holds a slot in the branch’s appointment book, and the clash with another branch is refused when the queue drains (dizi.slot-taken). Until the API exists the screen says the slot is held, not confirmed.',
  'Recording is modelled as consent plus a flag on the session; there is no media store yet, because storing a video of a patient is a decision the hospital has not made.',
];

/** The doctors who may hold a telemedicine room: the register’s own list, filtered by licence. */
export const teleDoctors = (directory: HrStaff[]): Doctor[] => {
  const licensed = new Set(directory.filter((m) => /consultant|registrar|medical officer|physician|surgeon|anaesthetist/i.test(m.designation)).map((m) => m.name));
  const list = DOCTORS.filter((d) => licensed.size === 0 || licensed.has(d.name));
  return list.length ? list : DOCTORS;
};

/* ------------------------------------------------------------------ meetings
 *
 * A meeting is the same record with a different set of rules, and the rules are the reason the screen is not just
 * the consultation list filtered by kind:
 *
 *  - an agenda is required, because a room with seven senior people in it and nothing to decide is the most
 *    expensive thing a hospital does;
 *  - a committee that takes a decision needs a quorum, and the register records whether it had one — a decision
 *    taken without a quorum is the one that gets argued about three months later;
 *  - an outside guest may join, and while they are in the room nothing with a patient identifier on it goes on
 *    the screen. That rule is on the screen rather than in a policy document nobody reads;
 *  - a series is not an occurrence: cancelling Tuesday's huddle does not cancel the huddle.
 */

export interface MeetingRule extends TeleRule {
  /** What the screen does about it, so the rule is not advice. */
  enforcedBy: string;
}

export const MEETING_RULES: MeetingRule[] = [
  { key: 'agenda', label: 'A meeting has an agenda before it opens', because: 'Six people at consultant rates around a table with nothing written down is the most expensive thing this hospital does, and the agenda is what makes it a meeting rather than a conversation.', enforcedBy: 'The room will not open without at least one agenda line.' },
  { key: 'host', label: 'Every meeting has one named host', because: 'A meeting with two owners has none, and the room needs somebody who can end it. The host is on the register and gets the join link first.', enforcedBy: 'The host is required and is one of the invited staff.' },
  { key: 'quorum', label: 'A committee that decides needs a quorum', because: 'Infection control, the drugs committee and the mortality review all take decisions that bind other people. A decision taken by two of seven gets re-litigated, and the register is where that is proved.', enforcedBy: 'The quorum is checked when the minutes are written, and the register records whether it was met.' },
  { key: 'guest-clean-screen', label: 'With an outside guest, nothing with a patient identifier is shared', because: 'A visitor joins through the same room link as a consultant. The one thing that must not happen is an MRN on a shared screen in front of somebody from another organisation.', enforcedBy: 'The screen shows the rule while an external guest is in the room, and the meeting sheet asks which documents will be shown.' },
  { key: 'minutes', label: 'A meeting that decided something records who decided it', because: 'The outcome line is what the next meeting starts from. “Discussed” is not an outcome; a decision, a name and a date are.', enforcedBy: 'Closing a decision meeting asks for the decisions and the attendees present.' },
  { key: 'series', label: 'Cancelling one occurrence does not cancel the series', because: 'A standing handover happens every morning. Cancelling today is a normal thing to do; cancelling the series has to be a separate, deliberate act.', enforcedBy: 'The occurrence and the series are separate actions on the sheet.' },
];

/** The committees, who has to be there for a decision to count, and what the decisions bind. */
export const COMMITTEES: Array<{ id: string; name: string; quorum: number; members: number; decides: string }> = [
  { id: 'icc', name: 'Infection-control committee', quorum: 4, members: 7, decides: 'Isolation policy, outbreak response, theatre ventilation' },
  { id: 'dtc', name: 'Drugs and therapeutics committee', quorum: 4, members: 8, decides: 'The formulary, antibiotic restrictions, the reserve list' },
  { id: 'mort', name: 'Mortality and morbidity review', quorum: 5, members: 9, decides: 'Case findings and the practice changes that follow them' },
  { id: 'ops', name: 'Operational huddle', quorum: 3, members: 6, decides: 'Today’s beds, today’s theatre list, today’s staffing gaps' },
];

export interface MeetingDraft {
  title: string;
  purpose: 'handover' | 'committee' | 'training' | 'review' | 'planning';
  committeeId: string;
  hostStaffId: string;
  department: string;
  invitees: string[];
  start: number;
  durationMin: number;
  channel: Channel;
  agenda: string[];
  externalGuest: string;
  guestHost: string;
  documentsShown: string;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
}

export interface MeetingCheck extends TeleCheck {
  /** Present when the meeting is a committee decision: whether the invited list makes the quorum. */
  quorumMet: boolean;
}

export function checkMeeting(draft: MeetingDraft, ctx: TeleContext): MeetingCheck {
  const base = checkSession(
    {
      kind: 'meeting',
      title: draft.title,
      channel: draft.channel,
      patientMrn: '',
      patientAge: null,
      doctorId: draft.hostStaffId,
      participants: draft.invitees,
      department: draft.department,
      start: draft.start,
      durationMin: draft.durationMin,
      recording: 'none',
      consentRef: '',
      attendantName: '',
      reason: draft.agenda[0] ?? '',
      externalGuest: draft.externalGuest,
      followUpOn: '',
    },
    ctx,
  );
  const reasons = [...base.reasons];
  const warnings = [...base.warnings];
  const committee = COMMITTEES.find((c) => c.id === draft.committeeId);

  if (draft.agenda.filter((a) => a.trim()).length === 0) {
    reasons.push({ code: 'no-agenda', message: 'Write the agenda. One line is enough — what the room has to decide, in the order it has to decide it.' });
  }
  if (draft.purpose === 'committee' && !committee) {
    reasons.push({ code: 'no-committee', message: 'A committee meeting names the committee. The quorum, and therefore whether the decision counts, comes from that row.' });
  }
  if (draft.purpose === 'committee' && committee && draft.invitees.length < committee.quorum) {
    reasons.push({
      code: 'below-quorum',
      message: `${committee.name} needs ${committee.quorum} of ${committee.members} present to decide anything. ${draft.invitees.length} invited: the room can still meet, but it cannot decide, and the register will say so.`,
    });
  }
  if (draft.purpose === 'committee' && committee && draft.invitees.length >= committee.quorum) {
    warnings.push({ code: 'quorum-invited', message: `Inviting ${draft.invitees.length} meets the quorum on paper. The register records who actually joined, so the minutes can say whether it was met.` });
  }
  if (!draft.hostStaffId) {
    reasons.push({ code: 'no-host', message: 'Name the host. A meeting with two owners has none, and somebody has to be the one who ends it.' });
  }
  if (draft.hostStaffId && !ctx.directory.some((m) => m.id === draft.hostStaffId || m.code === draft.hostStaffId || m.name === draft.hostStaffId)) {
    reasons.push({ code: 'host-unknown', message: 'The host is not on the staff register. Invite people by their staff record, so the room’s membership can be audited.' });
  }
  if (draft.externalGuest.trim() && !draft.guestHost.trim()) {
    reasons.push({ code: 'guest-unhosted', message: 'An outside guest joins with a named internal host. The host is responsible for what is on the screen while they are in the room.' });
  }
  if (draft.externalGuest.trim() && draft.purpose === 'review') {
    reasons.push({ code: 'guest-in-review', message: 'A case review with an outside guest in the room is not a review this hospital can hold. Take the guest out, or take the case out of the agenda.' });
  }
  if (draft.externalGuest.trim() && !draft.documentsShown.trim()) {
    warnings.push({ code: 'guest-documents', message: 'Say which documents will be shown. With a guest in the room, nothing with a patient identifier goes on the shared screen.' });
  }
  if (draft.durationMin > 60 && draft.agenda.filter((a) => a.trim()).length < 3) {
    warnings.push({ code: 'long-agenda', message: 'An hour with fewer than three agenda lines usually ends early or drifts. Cutting the booking is cheaper than the room sitting half empty.' });
  }
  if (draft.start > ctx.nowMinute + 30 && !ctx.cloudReachable) {
    warnings.push({ code: 'invites-queued', message: 'The room and the invitations are held on this node and sent when the queue drains. Staff who are off-site see it the moment the uplink returns.' });
  }
  return { ok: reasons.length === 0, reasons, warnings, quorumMet: committee ? draft.invitees.length >= committee.quorum : true };
}

/** The minutes a decision meeting has to produce. Minutes that record only attendance are the failure mode. */
export const MINUTE_PROMPTS: string[] = [
  'Each decision, in one line, with the name of the person accountable for it.',
  'Who was actually present, so the quorum can be checked rather than assumed.',
  'What the next meeting has to look at first — the follow-through from this one.',
];

export interface MeetingDigest extends TeleDigest {
  invitedStaff: number;
  departments: number;
  withExternalGuest: number;
  quorumRisk: number;
}

export function meetingStats(sessions: TeleSession[]): MeetingDigest {
  const base = statsOf(sessions);
  const invited = new Set(sessions.flatMap((s) => s.participants));
  return {
    ...base,
    invitedStaff: invited.size,
    departments: new Set(sessions.map((s) => s.department)).size,
    withExternalGuest: sessions.filter((s) => s.externalGuest.trim()).length,
    quorumRisk: sessions.filter((s) => s.participants.length > 0 && s.participants.length < 4 && s.durationMin >= 30).length,
  };
}

export const MEETING_WAITING: string[] = [
  'The room and the invitations are this node’s; joining the call needs the cloud, which is the same signalling gap the consultations have (P0-306).',
  'Recurrence is modelled as a series id on the record. The scheduler that materialises next month’s occurrences is server work and belongs with the appointment engine in the API service.',
  'Minutes are written against the meeting record. Publishing them to the noticeboard queues an internal notice — the channel that works offline — and never an outbound one.',
];
