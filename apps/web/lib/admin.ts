/* ----------------------------------------------------------------------------------------------------
 * Administration (P7) — the eighteen screens of the phase, the settings seven of them edit, and the rules.
 *
 * This module is deliberately one file with two halves, because both halves are lists that have to agree with
 * something outside them:
 *
 *  1. **The screen registry** mirrors `docs/plan/03-SCREEN-MAP.md` — every screen of the phase with the legacy
 *     path it replaces, its size, the field, grid, column and dialog counts captured from the running legacy
 *     product, and the route it now lives at. The hub renders it, and the test harness reads the same plan file
 *     and fails when the two drift apart: a screen cannot be quietly dropped from a phase and reported as done.
 *  2. **The setting definitions** are the seven configuration screens as data. Each field carries the thing the
 *     legacy system never did: who reads it, what breaks when it is wrong, and the value the screen refuses.
 *     A setting that no screen reads is a setting nobody should be able to change.
 *
 * Preview: settings are held in memory and each save is queued through the contract (a branch setting queues at
 * the node, a hospital-wide one is online-only), so the refused case is the real one rather than an illustration.
 */

import type { Role } from './shell';

/* =================================================================================================================
 * 1. The eighteen screens
 * =============================================================================================================== */

export interface AdminScreen {
  /** The screen's own key, used by the hub, the settings index and the harness. */
  id: string;
  /** What the plan calls it, verbatim, so a diff against the plan reads as a diff about the same screen. */
  title: string;
  /** The legacy path this replaces. */
  legacy: string;
  route: string;
  size: 'S' | 'M' | 'L';
  /** Captured from the legacy screen: fields, grid instances, the widest grid and the dialogs it opens. */
  fields: number;
  grids: number;
  maxCols: number;
  dialogs: number;
  /** `screen` for the sixteen, `sub` for the two the plan counts apart. */
  kind: 'screen' | 'sub';
  owner: 'legacy' | 'new';
  phase: 'P7';
  /** The one sentence the hub shows under the title: what this screen is for. */
  purpose: string;
  /** What this screen is still waiting for, if anything — printed, not implied. */
  waiting?: string;
}

const S = (row: AdminScreen): AdminScreen => row;

export const ADMIN_SCREENS: AdminScreen[] = [
  S({ id: 'multibranch-overview', title: 'Multi Branch › Overview', legacy: '/admin/multibranch/branch/overview', route: '/admin/multibranch', size: 'L', fields: 8, grids: 16, maxCols: 7, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'One wall for every branch: beds, out-patients, money, staffing and the state of each branch’s node — read per branch and added up, with a branch that cannot answer saying so.' }),
  S({ id: 'birth-record', title: 'Birth & Death Record › Birth Record', legacy: '/admin/birthordeath', route: '/admin/birthordeath', size: 'M', fields: 34, grids: 1, maxCols: 11, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The birth register’s writing side: thirty-four fields from the mother’s record to the vitamin K, with the four rules the register enforces as it is typed.' }),
  S({ id: 'front-office', title: 'Front Office', legacy: '/admin/visitors', route: '/admin/visitors', size: 'M', fields: 18, grids: 1, maxCols: 9, dialogs: 2, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The gate: who is in the building, who they came to see, which badge they hold — and the pass that stays open when somebody goes home without signing out.' }),
  S({ id: 'death-record', title: 'Birth & Death Record › Death Record', legacy: '/admin/birthordeath/death', route: '/admin/birthordeath/death', size: 'M', fields: 18, grids: 1, maxCols: 10, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The death register’s writing side, where the certificate, the police referral and the release of the body are three separate questions with three separate answers.' }),
  S({ id: 'multibranch-settings', title: 'Multi Branch › Settings', legacy: '/admin/multibranch/branch', route: '/admin/multibranch/branches', size: 'M', fields: 11, grids: 1, maxCols: 3, dialogs: 2, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'What differs between the branches on purpose: the receipt header, the day-book start, the visiting hours, the services a branch does not have.' }),
  S({ id: 'annual-calendar', title: 'Annual Calendar', legacy: '/admin/holiday/index', route: '/admin/holiday', size: 'M', fields: 13, grids: 1, maxCols: 6, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The year as one calendar: gazetted holidays, the branch’s own closures, and the roster’s plan for both — because a ward that works Victory Day has to be rostered for it.' }),
  S({ id: 'setup-front-office', title: 'Setup › Front Office', legacy: '/admin/visitorspurpose', route: '/admin/setup/visitors', size: 'M', fields: 9, grids: 2, maxCols: 3, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'What a visitor may come for, what they must show, and the visiting hours each ward actually keeps — the two lists the gate reads.' }),
  S({ id: 'setup-human-resource', title: 'Setup › Human Resource', legacy: '/admin/leavetypes', route: '/admin/setup/human-resource', size: 'M', fields: 6, grids: 1, maxCols: 2, dialogs: 2, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The leave types the register grants, what each one costs the payroll, and the tax table the branch pays by.' }),
  S({ id: 'human-resource', title: 'Human Resource', legacy: '/admin/staff', route: '/admin/staff', size: 'M', fields: 7, grids: 1, maxCols: 7, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The staff register: employee number, designation, grade, pay, licence and bank account — the seven fields the roster, the gate and the payroll file all resolve back to.' }),
  S({ id: 'setup-custom-fields', title: 'Setup › Custom Fields', legacy: '/admin/customfield', route: '/admin/setup/custom-fields', size: 'S', fields: 15, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'Extra fields without a software release: where the legacy product let anybody add one to anything, every field here names the entity, the validation and who may see it.' }),
  S({ id: 'setup-zoom', title: 'Setup › Zoom Setting', legacy: '/admin/zoom_conference', route: '/admin/setup/zoom', size: 'S', fields: 13, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'Telemedicine consultations: the account the branch joins with, what is recorded, and what the patient is told before the room opens.' }),
  S({ id: 'setup-appointment', title: 'Setup › Appointment', legacy: '/admin/onlineappointment/index', route: '/admin/setup/appointment', size: 'S', fields: 11, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The rules the online booking page obeys: how far ahead, how close to the slot, how many the same patient may hold, and what happens to a no-show.' }),
  S({ id: 'qr-settings', title: 'QR Code Attendance › Settings', legacy: '/admin/qrattendance/setting/index', route: '/admin/attendance/settings', size: 'S', fields: 11, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The readers: where each one is, which shift it serves, and which check confirms the person — because a QR code on a wall is a shift, not a person.' }),
  S({ id: 'print-header-footer', title: 'Setup › Print Header Footer', legacy: '/admin/printing', route: '/admin/printing', size: 'S', fields: 7, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The head and foot of every printed document, authored once and previewed on a real specimen rather than described.' }),
  S({ id: 'multibranch-report', title: 'Multi Branch › Report', legacy: '/admin/multibranch/branch/report', route: '/admin/multibranch/report', size: 'S', fields: 5, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'The branch console’s own report: one row per branch per period, and where a branch’s figures come from named rather than implied.' }),
  S({ id: 'qr-attendance', title: 'QR Code Attendance › Attendance', legacy: '/admin/qrattendance/attendance/index', route: '/admin/attendance', size: 'S', fields: 5, grids: 0, maxCols: 0, dialogs: 1, kind: 'screen', owner: 'new', phase: 'P7', purpose: 'Today as the readers saw it: who is in, who is late, whose stint is still open, and the correction a shift manager makes with their name against it.' }),
  S({ id: 'staff-attendance-register', title: 'Staff attendance register', legacy: '/admin/qrattendance/attendance', route: '/admin/staff/attendance', size: 'S', fields: 5, grids: 1, maxCols: 32, dialogs: 1, kind: 'sub', owner: 'new', phase: 'P7', purpose: 'The month as a matrix: one row per person, one column per day, every exception named — and the same figures the payroll is computed from.' }),
  S({ id: 'payroll', title: 'Payroll', legacy: '/admin/staff/payroll', route: '/admin/payroll', size: 'M', fields: 7, grids: 1, maxCols: 8, dialogs: 1, kind: 'sub', owner: 'new', phase: 'P7', purpose: 'The month’s salary, line by line and deduction by deduction, run by one person and approved by another.' }),
];

export const ADMIN_SCREEN_COUNT = { screens: 16, subs: 2 };
export const adminScreenById = (id: string): AdminScreen | undefined => ADMIN_SCREENS.find((s) => s.id === id);
export const adminScreenByRoute = (route: string): AdminScreen | undefined => ADMIN_SCREENS.find((s) => s.route === route);

/** The hub's groups: the phase reads as four jobs rather than eighteen links in a row. */
export const ADMIN_GROUPS: Array<{ id: string; title: string; because: string; members: string[] }> = [
  { id: 'people', title: 'People', because: 'The register, the reader and the payroll file work from one employee number, which is why they are one group rather than three.', members: ['human-resource', 'staff-attendance-register', 'payroll', 'qr-attendance', 'qr-settings', 'setup-human-resource'] },
  { id: 'front', title: 'Front office', because: 'The gate is the only place that knows who is in the building, and the register it keeps is the one a security guard is held to.', members: ['front-office', 'setup-front-office', 'birth-record', 'death-record'] },
  { id: 'branches', title: 'Branches', because: 'Two satellites and a main campus disagree about beds, money and services on purpose. The console’s job is to make the disagreement visible rather than to average it away.', members: ['multibranch-overview', 'multibranch-settings', 'multibranch-report'] },
  { id: 'config', title: 'Calendar and configuration', because: 'A holiday, a print header and a custom field are all read by screens somebody else is responsible for, so each one says who reads it and what breaks.', members: ['annual-calendar', 'print-header-footer', 'setup-custom-fields', 'setup-zoom', 'setup-appointment'] },
];

/** What the phase is still waiting for, named on the hub rather than discovered later. */
export const ADMIN_WAITING: string[] = [
  'Server-side aggregates: the branch console and the payroll run read this node’s records. Two branches’ figures added up need the P0-301 API, and the console says which figures are one node’s.',
  'The payroll approval is online-only by contract — and this preview has no cloud to approve against, so the approval is recorded in the outbox and the screen says so.',
  'Biometric and face readers are modelled rather than integrated: the enrolment, the clock and the refusal rules are here; the device SDK arrives with the pilot.',
];

/* =================================================================================================================
 * 2. The settings
 * =============================================================================================================== */

export type SettingKind = 'text' | 'number' | 'select' | 'toggle' | 'time' | 'textarea' | 'money';

export interface SettingField {
  key: string;
  label: string;
  kind: SettingKind;
  value: string | number | boolean;
  options?: string[];
  unit?: string;
  /** The one sentence under the field: what it decides, in the reader's words. */
  hint: string;
  /** Who reads it, and where. A setting no screen reads is a setting nobody should be able to change. */
  readBy: string;
  /** The range the screen refuses outside of, with the sentence it shows. */
  refuse?: { because: string; test: (value: string) => boolean };
}

export interface SettingScreen {
  /** The `platform.setting` key the save is queued under, and the branch override key where it is branch-level. */
  key: string;
  scope: 'hospital-wide' | 'branch';
  title: string;
  subtitle: string;
  /** The admin screen this configuration belongs to, so the hub and the screen agree. */
  screenId: string;
  fields: SettingField[];
  rules: Array<{ title: string; because: string }>;
}

const num = (value: string | number | boolean): number => Number(value);
const refuseRange = (min: number, max: number, because: string) => ({ because, test: (value: string) => !Number.isFinite(num(value)) || num(value) < min || num(value) > max });

export const SETTING_SCREENS: SettingScreen[] = [
  {
    key: 'appointment.online',
    scope: 'hospital-wide',
    title: 'Online appointment rules',
    subtitle: 'What the patient-facing booking page is allowed to do, and what it must refuse.',
    screenId: 'setup-appointment',
    fields: [
      { key: 'slotMinutes', label: 'Slot length', kind: 'number', value: 15, unit: 'minutes', hint: 'The grid every doctor’s day is cut into. Changing it moves every existing appointment, so the screen asks before it saves.', readBy: 'Appointments, the queue and the online booking page.', refuse: refuseRange(5, 60, 'Between five and sixty minutes. Below five the grid is finer than a consultation; above sixty an out-patient list cannot be scheduled around.'), },
      { key: 'daysAhead', label: 'Bookable days ahead', kind: 'number', value: 14, unit: 'days', hint: 'How far into the future the page offers. Longer than the roster is published is a promise the branch cannot keep.', readBy: 'The online booking page.', refuse: refuseRange(1, 90, 'Between one and ninety days: the roster is published a week ahead, and a booking beyond a quarter is a booking nobody can confirm.') },
      { key: 'cutoffMinutes', label: 'Online booking closes before the slot', kind: 'number', value: 120, unit: 'minutes', hint: 'The last minute somebody can book themselves. Inside this window the desk books them, because somebody has to answer the phone.', readBy: 'The online booking page and the front desk.', refuse: refuseRange(0, 1440, 'Between zero and a day: beyond a day the page closes before the patient has woken up.') },
      { key: 'approval', label: 'Requests need desk approval', kind: 'toggle', value: true, hint: 'On, an online request is a request: the desk confirms it and the patient is told. Off, it books itself and the slot is gone.', readBy: 'The queue, and the confirmation the patient receives.' },
      { key: 'perPatient', label: 'Live bookings one patient may hold', kind: 'number', value: 2, unit: 'appointments', hint: 'A cap, not a policy: two live bookings are a follow-up and a test review. Five are somebody holding a week of slots.', readBy: 'The online booking page.', refuse: refuseRange(1, 5, 'Between one and five: a patient with more live bookings than that is holding slots the branch cannot release on its own.') },
      { key: 'cancelWindowHours', label: 'Free cancellation window', kind: 'number', value: 6, unit: 'hours', hint: 'How late a patient may cancel without the no-show flag. The flag exists to make the list honest, not to charge anybody.', readBy: 'The online page and the appointment list.', refuse: refuseRange(0, 72, 'Between zero and three days.') },
      { key: 'noShowFlagAfter', label: 'Flag a no-show after', kind: 'number', value: 15, unit: 'minutes', hint: 'How long the desk waits before marking a patient as not arrived. It frees the slot for the queue rather than leaving it held.', readBy: 'The queue screen.', refuse: refuseRange(5, 60, 'Between five and sixty minutes: under five the patient is marked absent while parking, over an hour the slot is wasted.') },
      { key: 'reminderHours', label: 'Reminder before the appointment', kind: 'number', value: 24, unit: 'hours', hint: 'One reminder per appointment, sent through the route the patient chose. More than one is how a hospital gets muted.', readBy: 'Notifications, once the messaging module is live.', refuse: refuseRange(1, 72, 'Between one and seventy-two hours.') },
      { key: 'requirePhone', label: 'A mobile number is required', kind: 'toggle', value: true, hint: 'Off, an online booking with no number is one the desk cannot call when a surgeon is called away.', readBy: 'The booking form and the confirmation flow.' },
      { key: 'deposit', label: 'Advance payment', kind: 'money', value: 0, unit: '৳', hint: 'Zero means no deposit. A deposit is only worth taking if the branch can refund it without a voucher war.', readBy: 'Billing and the online page.', refuse: refuseRange(0, 5000, 'Up to ৳5,000. Above that the deposit is bigger than the consultation it holds.') },
      { key: 'telemedicine', label: 'Telemedicine slots bookable', kind: 'toggle', value: false, hint: 'Off until the P8 portal exists: an online video slot with no portal is a link sent by hand.', readBy: 'The online booking page and the Zoom setting below.' },
    ],
    rules: [
      { title: 'The page cannot promise more than the roster knows', because: 'Bookable days ahead is bounded by how far the roster is published, so a booking is either confirmable or impossible to offer — never confirmed and then moved.' },
      { title: 'A cap on live bookings is a cap, not a policy', because: 'The number is published to the patient on the page itself, so the refusal is predictable rather than a surprise at the desk.' },
      { title: 'A deposit needs a refund route', because: 'Money taken online with no way to give it back is a complaint the branch creates for itself.' },
    ],
  },
  {
    key: 'zoom.telemedicine',
    scope: 'hospital-wide',
    title: 'Telemedicine rooms',
    subtitle: 'The account the branch joins with, and what the patient is told before the room opens.',
    screenId: 'setup-zoom',
    fields: [
      { key: 'accountId', label: 'Account identifier', kind: 'text', value: 'dizi-main', hint: 'The account the branch’s rooms live under. The secret is not stored here — the setting holds the identifier and the secret lives in the key store.', readBy: 'The consultation workspace and the portal’s join link.' },
      { key: 'hostEmail', label: 'Default host', kind: 'text', value: 'telemedicine@dizihospital.example', hint: 'The room’s host. If the host does not arrive, the patient waits in a lobby with no host, which is why this address is monitored.', readBy: 'The room scheduler.' },
      { key: 'joinBeforeHost', label: 'Patient may join before the doctor', kind: 'toggle', value: false, hint: 'Off is the default on purpose: a patient alone in a waiting room with a clinician’s name on it is a worse experience than a minute waiting.', readBy: 'The join link the patient receives.' },
      { key: 'waitingRoom', label: 'Waiting room', kind: 'toggle', value: true, hint: 'The second patient cannot hear the first. Off, the next appointment hears the previous consultation, which is a confidentiality incident and not a settings problem.', readBy: 'Every telemedicine room.' },
      { key: 'passwordRequired', label: 'Passcode on every room', kind: 'toggle', value: true, hint: 'A link without a passcode is a link that reaches WhatsApp groups.', readBy: 'The join link.' },
      { key: 'autoRecord', label: 'Record automatically', kind: 'select', value: 'Off', options: ['Off', 'With consent recorded', 'Always'], hint: 'Not a technical choice: a recorded consultation needs the patient’s consent on the record next to it.', readBy: 'The room, and the audit ledger — a recording without a consent is an incident.' },
      { key: 'consentLine', label: 'Consent sentence played before the room', kind: 'textarea', value: 'This consultation is not recorded unless you agree. You may ask for it to stop at any time.', hint: 'The words the patient hears or reads before joining. The default is the shortest sentence that is still true.', readBy: 'The room’s pre-join screen.' },
      { key: 'maxMinutes', label: 'Room closes after', kind: 'number', value: 20, unit: 'minutes', hint: 'A telemedicine slot is shorter than a physical one; the room closing is what ends it rather than the next patient knocking.', readBy: 'The room and the schedule.', refuse: refuseRange(5, 60, 'Between five and sixty minutes.') },
      { key: 'maxParticipants', label: 'Participants per room', kind: 'number', value: 3, unit: 'people', hint: 'Patient, interpreter, clinician. More than four is a meeting rather than a consultation.', readBy: 'The room.', refuse: refuseRange(2, 8, 'Between two and eight.') },
      { key: 'muteOnEntry', label: 'Mute on entry', kind: 'toggle', value: true, hint: 'Small thing, large effect: an unmuted join turns a quiet room into a waiting hall.', readBy: 'Every room.' },
      { key: 'chat', label: 'In-room chat', kind: 'toggle', value: true, hint: 'Used for an address, a prescription number or a spelling. Chat is part of the consultation record once it is enabled.', readBy: 'The room and the consultation record.' },
      { key: 'screenShare', label: 'Screen sharing', kind: 'toggle', value: true, hint: 'How a report is shown. It is also how a clinician’s whole desktop is shown by accident, so it is off in the room by default.', readBy: 'The room.' },
      { key: 'interpreterNotes', label: 'Notes for interpreters', kind: 'textarea', value: 'Speak in the first person, and keep the sidebar chat for spellings rather than answers.', hint: 'Where a branch documents how it runs a room with an interpreter, because it happens twice a week and differently in each branch.', readBy: 'Clinicians and the interpreter roster.' },
    ],
    rules: [
      { title: 'The consent sentence is a setting, not a checkbox', because: 'Every recorded room needs a consent beside it in the ledger. Making the sentence editable means a branch can say it in its own words; making it mandatory means it is never empty.' },
      { title: 'A passcode and a waiting room are not conveniences', because: 'Without them the second appointment hears the first. That is a confidentiality failure, and both defaults are the safe ones.' },
      { title: 'A room that never closes holds a clinician', because: 'The closing time is the appointment’s end. Without it a late room runs into the next patient’s slot.' },
    ],
  },
  {
    key: 'attendance.readers',
    scope: 'branch',
    title: 'Attendance readers',
    subtitle: 'Where each reader is, which shift it serves, and what confirms the person standing in front of it.',
    screenId: 'qr-settings',
    fields: [
      { key: 'graceMinutes', label: 'Late grace', kind: 'number', value: 10, unit: 'minutes', hint: 'The minutes after a shift starts that do not count as late. The register records the minutes either way.', readBy: 'The attendance register and the late-marks rule in the payroll.', refuse: refuseRange(0, 60, 'Between zero and sixty minutes: beyond an hour “late” stops distinguishing anybody.') },
      { key: 'confirmBy', label: 'What confirms the person', kind: 'select', value: 'PIN on the reader', options: ['PIN on the reader', 'Fingerprint', 'Face', 'PIN or fingerprint'], hint: 'A QR code is printed and stuck on a wall, so it identifies the shift rather than the person. The confirmation is what makes the punch evidence.', readBy: 'Every punch, and the register’s own note about which check was used.' },
      { key: 'pinLength', label: 'PIN length', kind: 'number', value: 4, unit: 'digits', hint: 'Long enough not to be guessed by the person behind in the queue.', readBy: 'The reader.', refuse: refuseRange(4, 8, 'Four to eight digits: shorter is guessable in a queue of staff, longer is written on the back of a badge.') },
      { key: 'rotatePinDays', label: 'Reissue PINs every', kind: 'number', value: 90, unit: 'days', hint: 'A PIN that never changes is a PIN that ends up in a group chat.', readBy: 'HR’s reader administration.', refuse: refuseRange(30, 365, 'Between a month and a year.') },
      { key: 'offlineQueue', label: 'Readers buffer punches when the link is down', kind: 'toggle', value: true, hint: 'On, the reader holds the punches and sends them in order. Off, a shift is recorded by hand — which is what the legacy register did every week.', readBy: 'The attendance day and the outbox.' },
      { key: 'duplicateWindow', label: 'Ignore a repeat within', kind: 'number', value: 60, unit: 'seconds', hint: 'The same badge at the same reader inside a minute is one punch: people tap twice.', readBy: 'Every punch.', refuse: refuseRange(0, 600, 'Up to ten minutes.') },
      { key: 'halfDayHours', label: 'A day counts as half below', kind: 'number', value: 4, unit: 'hours', hint: 'The line the payroll draws. It is a setting rather than a constant because a branch with a different shift pattern may draw it elsewhere.', readBy: 'The register and the payroll.', refuse: refuseRange(1, 8, 'Between one and eight hours.') },
      { key: 'overtimeMinutes', label: 'Overtime counted in', kind: 'number', value: 30, unit: 'minutes', hint: 'Overtime is rounded down to this step, and it is approved before it is paid.', readBy: 'The register and the payroll.', refuse: refuseRange(15, 120, 'Between fifteen minutes and two hours.') },
      { key: 'maxStintHours', label: 'A stint longer than this is a fault', kind: 'number', value: 16, unit: 'hours', hint: 'Past this the reader is broken or somebody forgot to punch out, and either way the day needs a person rather than arithmetic.', readBy: 'The reader’s refusal and the register’s exceptions.', refuse: refuseRange(8, 24, 'Between eight and twenty-four hours.') },
      { key: 'licenceBlock', label: 'A lapsed clinical licence blocks the duty punch', kind: 'toggle', value: true, hint: 'On, the reader refuses and the roster has to replace the person. Off, the branch is recording a duty it may not legally staff.', readBy: 'The reader, the roster and HR.' },
      { key: 'deviceDownAlert', label: 'Alert when a reader stops reporting for', kind: 'number', value: 2, unit: 'hours', hint: 'A reader that has been down since a shift change looks exactly like an absent shift, so the alert is what tells the difference.', readBy: 'The attendance day screen and the support rota.', refuse: refuseRange(1, 12, 'Between one and twelve hours.') },
    ],
    rules: [
      { title: 'A QR code identifies the shift, not the person', because: 'The code is on a wall. The PIN, the fingerprint or the face is what says who is standing there, and the register records which check was used.' },
      { title: 'The reader holds its punches when the link is down', because: 'The gate does not stop working because the internet did. Punches queue in order at the node, which is the same rule the rest of the platform follows.' },
      { title: 'A reader that stops reporting is an alert, not a silence', because: 'A broken reader and an empty shift look identical on a register — until somebody says which one it is.' },
      { title: 'The payroll’s lines are settings, not constants', because: 'Grace, the half-day line and the overtime step are policy. A branch that changes its shift pattern changes them here, and the payroll follows without a release.' },
    ],
  },
  {
    key: 'print.header',
    scope: 'branch',
    title: 'Print header and footer',
    subtitle: 'The head and foot of every printed document, previewed on a real one rather than described.',
    screenId: 'print-header-footer',
    fields: [
      { key: 'hospitalName', label: 'Hospital name', kind: 'text', value: 'Shaheed Suhrawardy General Hospital', hint: 'Printed at the top of every document. It is also the name on the receipt a family keeps.', readBy: 'All twelve print templates.', refuse: { because: 'A document with no hospital name is not a document anybody can act on later.', test: (value) => value.trim().length < 3 } },
      { key: 'branchLine', label: 'Branch line', kind: 'text', value: 'Main Campus · Mirpur Road, Dhaka 1207', hint: 'The branch and its address, so a receipt printed at Uttara is traceable to Uttara.', readBy: 'All print templates.' },
      { key: 'headerNote', label: 'Second header line', kind: 'text', value: 'Emergency 16263 · Appointment 09612-345678', hint: 'The line that answers “who do I call about this bill”.', readBy: 'All print templates.' },
      { key: 'footerNote', label: 'Footer note', kind: 'text', value: 'This is a computer-generated document. Please bring it with you on your next visit.', hint: 'The sentence under every page, and the one patients read first.', readBy: 'All print templates.' },
      { key: 'showLogo', label: 'Print the logo', kind: 'toggle', value: true, hint: 'Off for the thermal receipt printer, which has no room for it and no ink to spare.', readBy: 'The receipt and the prescription templates.' },
      { key: 'showQr', label: 'Print a verification code', kind: 'toggle', value: true, hint: 'A code that resolves to the document’s own record, so a bill can be checked without a phone call.', readBy: 'Bills, discharge summaries and certificates.' },
      { key: 'paperFooter', label: 'Paper size written on the footer', kind: 'select', value: 'A4', options: ['A4', 'A5', 'Letter', 'Thermal 80 mm'], hint: 'Set per printer rather than per document: the same bill prints on A5 at the discharge desk and on thermal at the counter.', readBy: 'The print service and every template’s layout.' },
    ],
    rules: [
      { title: 'The header is authored once and previewed on a real specimen', because: 'Twelve templates with twelve headers is how a branch ends up with two addresses and one of them wrong.' },
      { title: 'A document carries its own verification', because: 'A bill or a certificate that can only be checked by calling the hospital is a document a family cannot use.' },
      { title: 'Paper size belongs to the printer, not the document', because: 'The same record prints at the counter, the discharge desk and the ward, and each has a different machine.' },
    ],
  },
  {
    key: 'hr.leave-types',
    scope: 'hospital-wide',
    title: 'Leave types and the payroll tables',
    subtitle: 'What the register grants, what it costs, and the tax table the branch pays by.',
    screenId: 'setup-human-resource',
    fields: [
      { key: 'maxConsecutiveDefault', label: 'Longest single absence without a manager’s note', kind: 'number', value: 15, unit: 'days', hint: 'Above this the application needs a second approval, because a fifteen-day absence is a post to fill rather than a day off.', readBy: 'The leave register.', refuse: refuseRange(3, 120, 'Between three and a hundred and twenty days.') },
      { key: 'certificateAfter', label: 'Sick leave needs a certificate after', kind: 'number', value: 2, unit: 'days', hint: 'The document is part of the application, not a follow-up: the payroll file cannot pay an uncertified absence.', readBy: 'The leave register and the payroll.', refuse: refuseRange(0, 14, 'Between zero and fourteen days.') },
      { key: 'earnedLeaveRate', label: 'Earned leave accrual', kind: 'select', value: 'One day for eighteen worked', options: ['One day for eighteen worked', 'One day for twenty-two worked', 'One and a quarter days a month'], hint: 'How the fifteen days are earned. The rate is printed on the payslip so a person can check it.', readBy: 'HR, the leave register and the payslip.' },
      { key: 'maternityWeeks', label: 'Maternity leave', kind: 'number', value: 16, unit: 'weeks', hint: 'Sixteen weeks is the entitlement the register grants. Changing it is a board decision with a budget behind it, which is why the field says so.', readBy: 'The leave register and the roster.', refuse: refuseRange(8, 26, 'Between eight and twenty-six weeks.') },
      { key: 'pfCap', label: 'Provident fund cap on basic', kind: 'money', value: 30_000, unit: '৳', hint: 'Ten per cent of basic up to this figure, matched by the hospital. The cap keeps a consultant’s fund from becoming a pension scheme nobody planned.', readBy: 'The payroll and the payslip.', refuse: refuseRange(10_000, 200_000, 'Between ৳10,000 and ৳200,000.') },
      { key: 'taxTable', label: 'Tax table', kind: 'select', value: 'FY 2026–27 (loaded)', options: ['FY 2026–27 (loaded)', 'FY 2025–26', 'Branch table (editable)'], hint: 'The slabs the payroll applies. The screen prints the thin-tax floor and the investment rebate cap beside it, because a payroll that applies a table without showing it is a payroll nobody can audit.', readBy: 'Every payslip and the year-end certificate.' },
    ],
    rules: [
      { title: 'An entitlement is granted, not negotiated at the desk', because: 'The number is here, the balance is on the person’s record, and the screen refuses the application either way.' },
      { title: 'The tax table belongs to the accountant', because: 'The slabs, the rebate cap and the floor are the branch’s own table. The software applies it and prints it; it does not invent one.' },
      { title: 'A cap on the provident fund is a budget decision', because: 'An uncapped match on a consultant’s basic is a six-figure commitment nobody voted for.' },
    ],
  },
  {
    key: 'front.visitors',
    scope: 'branch',
    title: 'Visiting rules',
    subtitle: 'What a visitor may come for, what they must show, and the hours each ward keeps.',
    screenId: 'setup-front-office',
    fields: [
      { key: 'idRequired', label: 'What the visitor must show', kind: 'select', value: 'National ID or passport', options: ['None', 'National ID', 'National ID or passport', 'National ID or employee card'], hint: 'The gate records the type and the number. “None” is a valid setting for a branch with a different security model, and the register records which branch chose it.', readBy: 'The visitor pass, and the register the security guard is held to.' },
      { key: 'badgeRequired', label: 'Every visitor wears a badge', kind: 'toggle', value: true, hint: 'An unbadged visitor is somebody the guard cannot account for at eight in the evening.', readBy: 'The pass print and the guard’s round.' },
      { key: 'maxStayHours', label: 'A pass expires after', kind: 'number', value: 4, unit: 'hours', hint: 'Past this the pass shows as overdue on the register, and the guard makes a round rather than testing their memory.', readBy: 'The visitor register.', refuse: refuseRange(1, 24, 'Between one and twenty-four hours.') },
      { key: 'purposeRequired', label: 'A purpose is required', kind: 'toggle', value: true, hint: 'A register of names with no purpose is a list of strangers, which is the thing the register exists to avoid being.', readBy: 'The pass and its audit line.' },
      { key: 'hostRequired', label: 'A host is required', kind: 'toggle', value: true, hint: 'Who they came to see, by name. Every hospital enquiry at month end is “who let them in”.', readBy: 'The pass.' },
      { key: 'childPolicy', label: 'Children under twelve', kind: 'select', value: 'Accompanied, not on the ward list', options: ['Accompanied, not on the ward list', 'Not admitted', 'Admitted with a pass'], hint: 'The night-time round needs a count of people on the ward, and children are the ones it cannot account for.', readBy: 'The pass, the ward list and the guard’s round.' },
      { key: 'itemsRecorded', label: 'Record what is carried in', kind: 'toggle', value: true, hint: 'Food, a charger, a change of clothes. Recorded because what goes in and does not come out is how a property dispute starts.', readBy: 'The pass, and the security supervisor’s report.' },
      { key: 'photoArea', label: 'Areas a visitor may not enter', kind: 'textarea', value: 'Theatre suite, HDU, mortuary, and the laboratory bench area', hint: 'Printed on the badge rather than explained at the door, because the door is busy.', readBy: 'The badge print and the guard’s round.' },
      { key: 'afterHours', label: 'After-hours entry', kind: 'select', value: 'Duty manager authorises', options: ['Duty manager authorises', 'Refused', 'Emergency only'], hint: 'Who may open the gate after hours, and the register records their name beside the pass.', readBy: 'The pass and the duty manager’s log.' },
    ],
    rules: [
      { title: 'A pass is a record, not a courtesy', because: 'The register is what answers “who was in the building” — for a security review, for an incident, and for a family asking where their relative went.' },
      { title: 'Every pass names a host', because: 'A visitor register without a host is a list of strangers, and every enquiry about an unauthorised visit starts with who let them in.' },
      { title: 'An open pass is a visible problem', because: 'The register shows passes past their expiry rather than closing them silently at midnight, because somebody may still be in the building.' },
    ],
  },
];

export const settingByKey = (key: string): SettingScreen | undefined => SETTING_SCREENS.find((s) => s.key === key);
export const settingsForScreen = (screenId: string): SettingScreen[] => SETTING_SCREENS.filter((s) => s.screenId === screenId);

export interface SettingCheck {
  ok: boolean;
  problem?: string;
  hint?: string;
}

/** Validate one field of a setting against its own range, with the sentence the screen shows. */
export function checkSetting(field: SettingField, value: string | number | boolean): SettingCheck {
  if (!field.refuse) return { ok: true };
  if (field.refuse.test(String(value))) {
    return { ok: false, problem: `${field.label}: ${field.refuse.because}`, hint: `${field.readBy} The field keeps what you typed so it can be corrected rather than retyped.` };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- custom fields (Setup › Custom Fields) */

export interface CustomFieldRow {
  id: string;
  entity: string;
  key: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'select' | 'toggle' | 'textarea';
  required: boolean;
  options: string[];
  shownIn: string;
  printed: boolean;
  /** Who may see the value: a custom field is how a ward starts recording something it should not. */
  visibleTo: Role[];
  help: string;
  order: number;
  active: boolean;
  lastChange: { at: string; by: string; what: string };
}

export const CUSTOM_ENTITIES = ['Patient', 'Appointment', 'Admission', 'Invoice', 'Staff', 'Visitor pass', 'Birth record', 'Death record'] as const;

export const CUSTOM_FIELDS: CustomFieldRow[] = [
  { id: 'cf-1', entity: 'Patient', key: 'patient.occupation', label: 'Occupation', kind: 'text', required: false, options: [], shownIn: 'Registration, and the patient banner', printed: false, visibleTo: ['receptionist', 'doctor', 'admin'], help: 'Free text. Used by the occupational health clinic, which is the only place in the branch that asks.', order: 1, active: true, lastChange: { at: '2026-09-02 11:40', by: 'Hospital admin', what: 'Added, with the occupational health clinic’s own list of values' } },
  { id: 'cf-2', entity: 'Patient', key: 'patient.guardianPhone', label: 'Guardian’s mobile', kind: 'text', required: true, options: [], shownIn: 'Registration, and the consent form', printed: true, visibleTo: ['receptionist', 'doctor', 'billing', 'admin'], help: 'Required for a patient under sixteen, optional above it. The rule is what makes it required rather than the field.', order: 2, active: true, lastChange: { at: '2026-08-14 09:15', by: 'M. Hoque', what: 'Made required for paediatric registration' } },
  { id: 'cf-3', entity: 'Appointment', key: 'appointment.interpreter', label: 'Interpreter needed', kind: 'select', required: false, options: ['No', 'Bangla', 'Sylheti', 'Sign language'], shownIn: 'Booking, and the queue’s day sheet', printed: true, visibleTo: ['receptionist', 'doctor', 'admin'], help: 'Booked with the appointment so an interpreter is rostered rather than found.', order: 3, active: true, lastChange: { at: '2026-07-30 15:05', by: 'J. Alam', what: 'Added Sylheti after the outreach clinic' } },
  { id: 'cf-4', entity: 'Admission', key: 'admission.referralSource', label: 'Where the patient came from', kind: 'select', required: true, options: ['Home', 'Another hospital', 'Clinic', 'Emergency', 'Police'], shownIn: 'Admission, and the in-patient report', printed: false, visibleTo: ['doctor', 'admin'], help: 'Feeds the in-patient report’s referral column. The legacy system had this as free text, which is why its report had nine spellings of “another hospital”.', order: 4, active: true, lastChange: { at: '2026-06-11 10:20', by: 'Hospital admin', what: 'Converted from free text to a list' } },
  { id: 'cf-5', entity: 'Invoice', key: 'invoice.costCentre', label: 'Cost centre', kind: 'select', required: false, options: ['CC-101', 'CC-102', 'CC-103', 'CC-104', 'CC-601'], shownIn: 'Billing, and the income report', printed: false, visibleTo: ['billing', 'admin'], help: 'Which department carries the cost. Left empty on an out-patient bill on purpose: nobody can attribute it to one department.', order: 5, active: true, lastChange: { at: '2026-05-19 12:00', by: 'A. Chowdhury', what: 'Added the cost-centre list used by Accounts' } },
  { id: 'cf-6', entity: 'Staff', key: 'staff.bloodGroup', label: 'Blood group', kind: 'select', required: false, options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], shownIn: 'HR, and the emergency donor list', printed: false, visibleTo: ['admin'], help: 'Only HR sees it. It is on the staff record because the blood bank keeps an emergency donor list, not because the ward may browse it.', order: 6, active: true, lastChange: { at: '2026-04-08 08:30', by: 'J. Alam', what: 'Added at the blood bank’s request, restricted to HR' } },
  { id: 'cf-7', entity: 'Visitor pass', key: 'visit.vehicle', label: 'Vehicle registration', kind: 'text', required: false, options: [], shownIn: 'Front office', printed: true, visibleTo: ['receptionist', 'admin'], help: 'The barrier at the back gate reads it. Kept on the pass rather than in a notebook beside the barrier.', order: 7, active: true, lastChange: { at: '2026-03-22 17:45', by: 'M. Hoque', what: 'Added for the parked-car count at shift change' } },
  { id: 'cf-8', entity: 'Death record', key: 'death.informantRelation', label: 'Relationship of the informant', kind: 'select', required: true, options: ['Son', 'Daughter', 'Spouse', 'Parent', 'Sibling', 'Other'], shownIn: 'Death record, and the register print', printed: true, visibleTo: ['receptionist', 'admin'], help: 'The register prints it beside the name. “Other” is a value and not a gap: the register keeps what the family said.', order: 8, active: true, lastChange: { at: '2026-02-18 13:10', by: 'Hospital admin', what: 'Added after the city corporation asked for it' } },
  { id: 'cf-9', entity: 'Patient', key: 'patient.legacyCard', label: 'Old card number', kind: 'text', required: false, options: [], shownIn: 'Migration only — no screen shows it', printed: false, visibleTo: ['admin'], help: 'Retired in August: the migration finished and the field is kept so an old record still resolves.', order: 9, active: false, lastChange: { at: '2026-08-01 09:00', by: 'Hospital admin', what: 'Retired — migration complete' } },
];

export const CUSTOM_FIELD_RULES: Array<{ title: string; because: string }> = [
  { title: 'A field names the entity it belongs to', because: 'Free-floating fields are how a patient’s “ward” becomes a text box on an invoice. The entity decides the picker, the validation and the report it can appear in.' },
  { title: 'A field says who may see it', because: 'A custom field is how a ward starts recording something it should not. Visibility is a property of the field, and the default is the narrowest list that works.' },
  { title: 'Required is a rule, not a preference', because: '“Required for a patient under sixteen” is what the ward actually means, and a field marked required for everybody is one a receptionist fills with a dash.' },
  { title: 'A field is retired, never deleted', because: 'Records point at it. Retiring keeps an old registration form readable while removing the field from every new one.' },
];

export function checkCustomField(rows: CustomFieldRow[], draft: { entity: string; key: string; label: string; kind: string; options: string[]; visibleTo: Role[] }): SettingCheck {
  if (!draft.label.trim()) return { ok: false, problem: 'A field needs a label: it is what the person filling it in reads.', hint: 'The key is for the API; the label is for the ward.' };
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(draft.key)) {
    return { ok: false, problem: 'The key must be `entity.field` in lower case — for example `patient.bloodGroup`.', hint: 'The key is written on every record it is stored on, and changing it later means migrating the records. It is the one part of a custom field that is an identity rather than a label.' };
  }
  if (rows.some((r) => r.key === draft.key)) return { ok: false, problem: `${draft.key} already exists.`, hint: 'Two fields with one key is one field, and whoever edits it next will only find one of them.' };
  if ((draft.kind === 'select' || draft.kind === 'toggle') && draft.options.length < 2) {
    return { ok: false, problem: 'A list needs at least two values.', hint: 'A picker with one option is a checkbox that lies about being a choice.' };
  }
  if (draft.visibleTo.length === 0) return { ok: false, problem: 'Choose who may see the value.', hint: 'A field nobody may read is a field that will be filled with anything.' };
  return { ok: true };
}

/* --------------------------------------------------------------------------- print templates (Setup › Print) */

export interface PrintTemplate {
  id: string;
  label: string;
  legacy: string;
  paper: 'A4' | 'A5' | 'Letter' | 'Thermal 80 mm';
  /** Where the template is authored in the new designer. */
  authoredIn: 'designer' | 'code';
  prints: string[];
  note: string;
}

/** The twelve documents the legacy product printed, and where each one is authored now. */
export const PRINT_TEMPLATES: PrintTemplate[] = [
  { id: 'receipt', label: 'Money receipt', legacy: '/admin/bill/receipt', paper: 'Thermal 80 mm', authoredIn: 'designer', prints: ['Invoice', 'Payment', 'Payer share', 'Balance'], note: 'The one document a family keeps. Printed at the counter on thermal paper, with the verification code and no logo.' },
  { id: 'invoice', label: 'Invoice', legacy: '/admin/bill/print', paper: 'A4', authoredIn: 'designer', prints: ['Invoice lines', 'Discount', 'VAT where applicable'], note: 'The A4 bill, with the payer share on it when the patient is insured.' },
  { id: 'opd-slip', label: 'OPD slip', legacy: '/admin/patient/slip', paper: 'A5', authoredIn: 'designer', prints: ['Serial', 'Doctor', 'Chamber', 'Room'], note: 'The slip the patient takes to the queue. It prints the serial the queue screen shows, from one source.' },
  { id: 'prescription', label: 'Prescription', legacy: '/admin/patient/prescription', paper: 'A4', authoredIn: 'designer', prints: ['Diagnosis', 'Medicines', 'Advice', 'Follow-up'], note: 'Drug names come from the pharmacy catalogue, including the strength, so a prescription and a dispense line agree.' },
  { id: 'lab-report', label: 'Laboratory report', legacy: '/admin/lab/report', paper: 'A4', authoredIn: 'designer', prints: ['Result table', 'Reference range', 'Who verified it'], note: 'Carries the verifier’s name and the time the result was released. A lab report without a verifier is a printout, not a report.' },
  { id: 'imaging-report', label: 'Imaging report', legacy: '/admin/radiology/report', paper: 'A4', authoredIn: 'designer', prints: ['Findings', 'Impression', 'Reporting radiologist'], note: 'The impression is on its own line: it is the part clinicians read.' },
  { id: 'discharge', label: 'Discharge summary', legacy: '/admin/patient/discharge', paper: 'A4', authoredIn: 'designer', prints: ['Course', 'Condition at discharge', 'Medicines to continue', 'Follow-up'], note: 'The four things a discharge must state, in the order the ward writes them. A discharge without the follow-up date prints a warning on the ward screen.' },
  { id: 'birth-certificate', label: 'Birth record', legacy: '/admin/birthordeath/print', paper: 'A4', authoredIn: 'designer', prints: ['Register number', 'Attendant', 'Outcome', 'Civil status'], note: 'The hospital’s own record. The civil certificate is issued by the corporation, and this print says so rather than imitating one.' },
  { id: 'death-certificate', label: 'Death record', legacy: '/admin/birthordeath/death/print', paper: 'A4', authoredIn: 'designer', prints: ['Cause', 'Certificate number', 'Who collected the body', 'Civil status'], note: 'Prints the certificate state and the police referral where there is one. It is not the civil death certificate, and it does not pretend to be.' },
  { id: 'payslip', label: 'Payslip', legacy: '/admin/staff/payslip', paper: 'A5', authoredIn: 'designer', prints: ['Earnings', 'Deductions by line', 'Attendance summary', 'Employer cost'], note: 'Every deduction printed with the rule that produced it, because a payslip that cannot be explained line by line is the reason people queue outside HR.' },
  { id: 'attendance-sheet', label: 'Attendance sheet', legacy: '/admin/qrattendance/print', paper: 'A4', authoredIn: 'designer', prints: ['Month matrix', 'Exceptions', 'Late marks', 'Overtime'], note: 'The register as a sheet for a shift manager to sign, printed from the same generator the payroll reads.' },
  { id: 'visitor-badge', label: 'Visitor badge', legacy: '/admin/visitors/badge', paper: 'Thermal 80 mm', authoredIn: 'designer', prints: ['Name', 'Host', 'Pass number', 'Areas not to enter'], note: 'Prints the areas a visitor may not enter on the badge itself, because the door is busy.' },
];

export const PRINT_RULES: Array<{ title: string; because: string }> = [
  { title: 'The header is authored once, here', because: 'Twelve templates with twelve headers is how a branch ends up with two addresses, one of them wrong, and a receipt that cannot be traced back to a site.' },
  { title: 'A template that prints a figure prints where it came from', because: 'The payslip prints the rule behind each deduction and the lab report prints who verified it. A document that shows a number without its source is a document nobody can check.' },
  { title: 'The designer is where a template changes, not the code', because: 'A branch adds a line to its receipt without a release. The preview shows a real specimen rather than describing one.' },
];

/* ----------------------------------------------------------------------------------- what the hub claims */

export interface AdminPhaseStats {
  screens: number;
  subs: number;
  fields: number;
  grids: number;
  dialogs: number;
  migrated: number;
}

export const adminPhaseStats = (): AdminPhaseStats => ({
  screens: ADMIN_SCREENS.filter((s) => s.kind === 'screen').length,
  subs: ADMIN_SCREENS.filter((s) => s.kind === 'sub').length,
  fields: ADMIN_SCREENS.reduce((n, s) => n + s.fields, 0),
  grids: ADMIN_SCREENS.reduce((n, s) => n + s.grids, 0),
  dialogs: ADMIN_SCREENS.reduce((n, s) => n + s.dialogs, 0),
  migrated: ADMIN_SCREENS.length,
});
