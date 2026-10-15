/* ----------------------------------------------------------------------------------------------------
 * The patient portal (P8) — the patient's own record, on their own phone.
 *
 * Three rules decide everything in this module, and they are not the same rules as the staff application:
 *
 *  1. **It is written for a patient, not for a member of staff.** Every sentence is plain, short and free of codes
 *     an outsider cannot read. Bangla comes first and the English is the switch, because the person holding the
 *     phone in the queue at the records desk reads Bangla.
 *  2. **The patient sees their own record and nothing else.** Every read is scoped to one MRN by the server, and
 *     the portal never shows a diagnosis the doctor has not released — a result is `pending`, `released` or
 *     `withheld`, and `withheld` is shown as withheld with the reason, rather than hidden. A silence the patient
 *     cannot interpret is worse than a status they can ask about.
 *  3. **Nothing clinical is answered by the portal.** It books, cancels, shows results, takes money and carries
 *     feedback. A symptom in the feedback box is refused with the telephone number, and anything that reads like an
 *     emergency stops being a form and becomes a sentence telling the patient to come in or telephone.
 *
 * Sign-in is the honest stub: the browser cannot verify a patient without Keycloak (#24), so this build signs in
 * with a one-time code that is displayed instead of sent, and the screen says so in the patient's own language.
 */

export type PortalLocale = 'bn' | 'en';

/** Every string the portal shows, in both languages. Bangla first: it is the language of the person reading it. */
export interface PortalText {
  bn: string;
  en: string;
}

export const t = (text: PortalText, locale: PortalLocale): string => (locale === 'bn' ? text.bn : text.en);

export interface PortalPatient {
  mrn: string;
  name: string;
  nameBn: string;
  age: number;
  sex: 'female' | 'male';
  phone: string;
  bloodGroup: string;
  branch: string;
  /** Who agreed to the portal, when the patient is not the one holding the phone. */
  guardian?: { name: string; relation: string; agreedOn: string };
  consentedOn: string;
  /** Nothing is shown until the patient has agreed — the tick is a record, not a dialog. */
  consents: Array<{ what: string; agreedOn: string; withdrawnOn?: string }>;
}

export const PATIENT: PortalPatient = {
  mrn: 'SH-102355',
  name: 'Fatema Begum',
  nameBn: 'ফাতেমা বেগম',
  age: 29,
  sex: 'female',
  phone: '01711-884 210',
  bloodGroup: 'B+',
  branch: 'Main Campus',
  consentedOn: '2026-03-02',
  consents: [
    { what: 'SMS reminders to 01711-884 210', agreedOn: '2026-03-02' },
    { what: 'Results in the portal', agreedOn: '2026-03-02' },
    { what: 'Email copies', agreedOn: '2026-03-02', withdrawnOn: '2026-07-18' },
  ],
};

/* ------------------------------------------------------------------ appointments */

export type AppointmentState = 'booked' | 'attended' | 'cancelled' | 'missed';

export interface PortalAppointment {
  id: string;
  on: string;
  time: string;
  department: string;
  departmentBn: string;
  doctor: string;
  room: string;
  branch: string;
  token: string;
  state: AppointmentState;
  /** Set when the patient is being told what to bring — the sentence the desk would say on the telephone. */
  bring?: string;
  cancelledReason?: string;
  canCancelUntil: string;
  /** The fee the counter will ask for, from the billing master list rather than typed here. */
  fee: number;
}

export const APPOINTMENTS: PortalAppointment[] = [
  { id: 'ap-1', on: '2026-10-22', time: '11:00', department: 'Antenatal (obstetrics)', departmentBn: 'প্রসূতি (এএনসি)', doctor: 'Dr. R. Akter', room: 'OPD-4', branch: 'Main Campus', token: 'A-14', state: 'booked', bring: 'Bring your card and the previous ultrasound report. Come 15 minutes early for the blood pressure check.', canCancelUntil: '2026-10-22 09:00', fee: 800 },
  { id: 'ap-2', on: '2026-11-19', time: '11:00', department: 'Antenatal (obstetrics)', departmentBn: 'প্রসূতি (এএনসি)', doctor: 'Dr. R. Akter', room: 'OPD-4', branch: 'Main Campus', token: '—', state: 'booked', bring: 'Next routine visit. No test is due before it.', canCancelUntil: '2026-11-19 09:00', fee: 800 },
  { id: 'ap-3', on: '2026-09-12', time: '11:00', department: 'Antenatal (obstetrics)', departmentBn: 'প্রসূতি (এএনসি)', doctor: 'Dr. R. Akter', room: 'OPD-4', branch: 'Main Campus', token: 'A-08', state: 'attended', canCancelUntil: '2026-09-12 09:00', fee: 800 },
  { id: 'ap-4', on: '2026-08-14', time: '09:30', department: 'Antenatal (obstetrics)', departmentBn: 'প্রসূতি (এএনসি)', doctor: 'Dr. R. Akter', room: 'OPD-4', branch: 'Main Campus', token: 'A-03', state: 'attended', canCancelUntil: '2026-08-14 07:30', fee: 800 },
  { id: 'ap-5', on: '2026-07-02', time: '10:15', department: 'Medicine', departmentBn: 'মেডিসিন', doctor: 'Dr. S. Rahman', room: 'OPD-1', branch: 'Main Campus', token: 'M-21', state: 'attended', canCancelUntil: '2026-07-02 08:15', fee: 800 },
  { id: 'ap-6', on: '2026-06-18', time: '10:15', department: 'Medicine', departmentBn: 'মেডিসিন', doctor: 'Dr. S. Rahman', room: 'OPD-1', branch: 'Main Campus', token: 'M-11', state: 'missed', canCancelUntil: '2026-06-18 08:15', fee: 800 },
];

/** The clinics a patient may book into, with the days they run. From the OPD timetable, not typed. */
export const PORTAL_CLINICS = [
  { id: 'anc', department: 'Antenatal (obstetrics)', departmentBn: 'প্রসূতি (এএনসি)', doctor: 'Dr. R. Akter', days: 'Every day', times: ['09:00', '10:00', '11:00'], room: 'OPD-4', fee: 800 },
  { id: 'med', department: 'Medicine', departmentBn: 'মেডিসিন', doctor: 'Dr. S. Rahman', days: 'Sunday, Tuesday, Thursday', times: ['09:00', '09:30', '10:15'], room: 'OPD-1', fee: 800 },
  { id: 'paed', department: 'Child health', departmentBn: 'শিশু স্বাস্থ্য', doctor: 'Dr. T. Hossain', days: 'Saturday to Wednesday', times: ['09:30', '10:30'], room: 'OPD-3', fee: 500 },
  { id: 'diab', department: 'Diabetes and foot clinic', departmentBn: 'ডায়াবেটিস ও ফুট ক্লিনিক', doctor: 'Dr. N. Islam', days: 'Tuesday', times: ['14:00', '15:00'], room: 'OPD-2', fee: 800 },
  { id: 'eye', department: 'Eye clinic', departmentBn: 'চোখের ক্লিনিক', doctor: 'Dr. K. Barua', days: 'Monday', times: ['10:00'], room: 'OPD-5', fee: 800 },
];

/** Slots already gone, so the refusal can offer the ones that are not. */
export const TAKEN_SLOTS = ['2026-10-22 11:00', '2026-10-23 10:00', '2026-10-23 09:00', '2026-10-27 09:00'];

/** How far ahead the portal may book, and how close to the appointment it may cancel. */
export const BOOKING_WINDOW_DAYS = 30;
export const CANCEL_CUTOFF_HOURS = 2;
export const MAX_OPEN_APPOINTMENTS = 3;

/* ------------------------------------------------------------------ prescriptions */

export interface PortalPrescription {
  id: string;
  issuedAt: string;
  doctor: string;
  diagnosisShown: string;
  items: Array<{ name: string; strength: string; how: string; forHowLong: string; whatFor: string; collected: 'collected' | 'waiting' | 'not needed' }>;
  /** Plain-language instruction the doctor added to the sheet, in the patient's own words. */
  note: string;
}

export const PRESCRIPTIONS: PortalPrescription[] = [
  {
    id: 'rx-1',
    issuedAt: '2026-09-12',
    doctor: 'Dr. R. Akter',
    diagnosisShown: 'Antenatal care — 20 weeks',
    items: [
      { name: 'Ferrous sulphate + folic acid', strength: '200 mg + 0.4 mg', how: 'One tablet after dinner', forHowLong: 'Until the next visit', whatFor: 'To build up your blood and to help the baby grow. It can make the stool dark; that is normal.', collected: 'collected' },
      { name: 'Calcium carbonate', strength: '500 mg', how: 'One tablet after breakfast', forHowLong: 'Until the next visit', whatFor: 'For your bones and the baby’s. Do not take it at the same time as the iron tablet.', collected: 'collected' },
    ],
    note: 'Take the iron with a little lemon water if it upsets your stomach, and telephone the desk if the vomiting does not settle.',
  },
  {
    id: 'rx-2',
    issuedAt: '2026-08-14',
    doctor: 'Dr. R. Akter',
    diagnosisShown: 'Antenatal care — 16 weeks, nausea',
    items: [
      { name: 'Doxylamine + pyridoxine', strength: '10 mg + 10 mg', how: 'One tablet at night, and one in the morning if needed', forHowLong: 'Two weeks, then as needed', whatFor: 'For the sickness in the morning. It makes some people sleepy, so do not drive after the first dose.', collected: 'collected' },
      { name: 'Ferrous sulphate + folic acid', strength: '200 mg + 0.4 mg', how: 'One tablet after dinner', forHowLong: 'Start on 20 August', whatFor: 'To build up your blood for the later months of the pregnancy.', collected: 'collected' },
    ],
    note: 'The sickness usually settles after the fourth month. If you cannot keep water down for a whole day, come in rather than waiting for the appointment.',
  },
  {
    id: 'rx-3',
    issuedAt: '2026-07-02',
    doctor: 'Dr. S. Rahman',
    diagnosisShown: 'Fever — treated as viral, no antibiotics',
    items: [
      { name: 'Paracetamol', strength: '500 mg', how: 'One tablet, up to four times a day, only if there is fever', forHowLong: 'Five days', whatFor: 'For the fever and the body ache. It is not an antibiotic, and it will not treat a bacterial infection — come back if the fever lasts more than three days.', collected: 'collected' },
      { name: 'Oral saline', strength: '—', how: 'One sachet in a litre of water, sipped through the day', forHowLong: 'While the fever lasts', whatFor: 'To replace what you lose with the sweating.', collected: 'not needed' },
    ],
    note: 'Come back if the fever is still there on the fourth day, or at once if there is bleeding from the gums or nose.',
  },
];

/* ------------------------------------------------------------------ results */

export type ResultState = 'pending' | 'released' | 'withheld';

export interface PortalResult {
  id: string;
  panel: string;
  panelBn: string;
  category: 'laboratory' | 'imaging' | 'cardiology' | 'other';
  takenOn: string;
  state: ResultState;
  releasedOn?: string;
  /** The one line the patient actually wants, written by the doctor who released it. */
  headline?: string;
  summary?: string;
  reportRef?: string;
  /** A report the patient may open is only openable while the share is live. */
  downloadExpiresOn?: string;
  withheldReason?: string;
  /** Where to ask, when the result is withheld or out of the ordinary. */
  ask: string;
}

export const RESULTS: PortalResult[] = [
  { id: 'rs-1', panel: 'Ultrasound — pregnancy, 22 weeks', panelBn: 'আল্ট্রাসাউন্ড — গর্ভাবস্থা, ২২ সপ্তাহ', category: 'imaging', takenOn: '2026-10-14', state: 'released', releasedOn: '2026-10-16 15:00', headline: 'Everything is normal for 22 weeks.', summary: 'The baby’s size and the water are as expected, and the placenta is in a good position. Your next scan is at 32 weeks.', reportRef: 'usg-obstetric-SH102355.pdf', downloadExpiresOn: '2027-04-16', ask: 'The antenatal desk, 02 9876 540, between 08:00 and 20:00.' },
  { id: 'rs-2', panel: 'Blood count and iron', panelBn: 'রক্তের গণনা ও আয়রন', category: 'laboratory', takenOn: '2026-09-12', state: 'released', releasedOn: '2026-09-12 18:20', headline: 'Your blood count is a little low, which is common at this stage.', summary: 'The haemoglobin is 10.4. That is why the iron tablet was started. It will be checked again at the next visit.', reportRef: 'lab-cbc-SH102355.pdf', downloadExpiresOn: '2027-03-12', ask: 'The antenatal desk, 02 9876 540.' },
  { id: 'rs-3', panel: 'Blood sugar after the drink (GTT)', panelBn: 'ড্রিংকের পর রক্তের সুগার (জিটিটি)', category: 'laboratory', takenOn: '2026-10-16', state: 'pending', ask: 'Results usually take two working days. Nothing is wrong — this one is simply still in the laboratory.' },
  { id: 'rs-4', panel: 'Blood group and antibody screen', panelBn: 'রক্তের গ্রুপ ও অ্যান্টিবডি', category: 'laboratory', takenOn: '2026-08-14', state: 'released', releasedOn: '2026-08-15 10:05', headline: 'Blood group B positive, and nothing that needs treatment.', summary: 'Your group is B positive. The antibody screen is negative, which is what the delivery team needs to know.', reportRef: 'lab-group-SH102355.pdf', downloadExpiresOn: '2027-02-15', ask: 'The antenatal desk, 02 9876 540.' },
  { id: 'rs-5', panel: 'Genetic screening — first trimester', panelBn: 'জেনেটিক স্ক্রিনিং — প্রথম ত্রৈমাসিক', category: 'laboratory', takenOn: '2026-09-05', state: 'withheld', withheldReason: 'The doctor wants to explain this one in person rather than let you read it on a phone. The result itself is ready. Nothing here says you must come in urgently.', ask: 'Telephone the antenatal desk, 02 9876 540, any time between 08:00 and 20:00, and ask for Dr. R. Akter’s chamber. You do not need an appointment to ask.' },
];

/* ------------------------------------------------------------------ bills and payments */

export type BillState = 'due' | 'partial' | 'settled';

export interface PortalBillLine {
  what: string;
  whatBn: string;
  qty: number;
  rate: number;
}

export interface PortalBill {
  id: string;
  no: string;
  on: string;
  forVisit: string;
  lines: PortalBillLine[];
  state: BillState;
  paid: number;
  /** Shown only when something is due: the patient should not have to subtract. */
  ask?: string;
}

export const BILLS: PortalBill[] = [
  {
    id: 'bl-1', no: 'INV-2026-04188', on: '2026-10-14', forVisit: 'Ultrasound — pregnancy, 22 weeks', state: 'due', paid: 0,
    lines: [
      { what: 'Obstetric ultrasound', whatBn: 'প্রসূতি আল্ট্রাসাউন্ড', qty: 1, rate: 1_500 },
      { what: 'Outdoor ticket — consultant', whatBn: 'বহির্বিভাগের টিকিট — কনসালট্যান্ট', qty: 1, rate: 800 },
    ],
    ask: 'If the amount looks wrong, telephone the billing desk before paying rather than after. Nothing is lost by asking: 02 9876 560.',
  },
  {
    id: 'bl-2', no: 'INV-2026-03912', on: '2026-09-12', forVisit: 'Antenatal visit, 20 weeks', state: 'settled', paid: 1_600,
    lines: [
      { what: 'Outdoor ticket — consultant', whatBn: 'বহির্বিভাগের টিকিট — কনসালট্যান্ট', qty: 1, rate: 800 },
      { what: 'Blood count (CBC) and iron', whatBn: 'রক্তের গণনা (সিবিসি) ও আয়রন', qty: 1, rate: 800 },
    ],
  },
  {
    id: 'bl-3', no: 'INV-2026-03404', on: '2026-08-14', forVisit: 'Antenatal visit, 16 weeks', state: 'settled', paid: 2_300,
    lines: [
      { what: 'Outdoor ticket — consultant', whatBn: 'বহির্বিভাগের টিকিট — কনসালট্যান্ট', qty: 1, rate: 800 },
      { what: 'Blood group and antibody screen', whatBn: 'রক্তের গ্রুপ ও অ্যান্টিবডি', qty: 1, rate: 1_500 },
    ],
  },
];

export interface PortalPayment {
  id: string;
  receipt: string;
  on: string;
  billNo: string;
  amount: number;
  how: string;
  /** `handed over` until the gateway or the counter answers, never `paid` on the patient's word. */
  state: 'settled' | 'handed over' | 'refused';
  because?: string;
}

export const PAYMENTS: PortalPayment[] = [
  { id: 'pm-1', receipt: 'RCPT-2026-03122', on: '2026-09-12', billNo: 'INV-2026-03912', amount: 1_600, how: 'Counter — cash', state: 'settled' },
  { id: 'pm-2', receipt: 'RCPT-2026-02711', on: '2026-08-14', billNo: 'INV-2026-03404', amount: 2_300, how: 'Counter — card', state: 'settled' },
  /* The refusal the screen demonstrates: the gateway is not configured in this build, and the receipt says so. */
  { id: 'pm-3', receipt: '—', on: '2026-10-15', billNo: 'INV-2026-04188', amount: 2_300, how: 'bKash', state: 'refused', because: 'There is no payment gateway connected in this build. Nothing was charged, and nothing was reserved: the bill is still there to pay at the counter or by card over the desk. When the gateway is connected the same screen pays it, and the receipt is written only when the gateway answers.' },
];

export const money = (n: number): string => `৳ ${n.toLocaleString('en-IN')}`;
export const billTotal = (bill: PortalBill): number => bill.lines.reduce((sum, line) => sum + line.qty * line.rate, 0);
export const billDue = (bill: PortalBill): number => Math.max(0, billTotal(bill) - bill.paid);
export const outstanding = (bills: PortalBill[] = BILLS): number => bills.reduce((sum, b) => sum + billDue(b), 0);

/* ------------------------------------------------------------------ feedback */

export type FeedbackState = 'received' | 'acknowledged' | 'closed';

export interface PortalFeedback {
  id: string;
  reference: string;
  sentAt: string;
  subject: string;
  about: string;
  whatINoticed: string;
  state: FeedbackState;
  answeredBy?: string;
  answeredOn?: string;
  answer?: string;
}

export const FEEDBACK: PortalFeedback[] = [
  {
    id: 'fb-1', reference: 'FB-2026-0311', sentAt: '2026-09-20', subject: 'Waiting time', about: 'Outdoor clinic',
    whatINoticed: 'I waited for more than two hours after the time on the ticket and nobody said how long it would be.',
    state: 'closed', answeredBy: 'M. Hoque, front office', answeredOn: '2026-09-24',
    answer: 'Thank you for saying so. Two doctors were on leave that day and we did not tell the people waiting, which is the part we can fix: from October the desk writes the expected waiting time on the board and puts it in the portal. Your appointment on 12 September was seen by Dr. Akter at 12:48, and the token system has been changed so the numbers are called in order.',
  },
  {
    id: 'fb-2', reference: 'FB-2026-0344', sentAt: '2026-10-15', subject: 'The ultrasound room was cold', about: 'Ultrasound room, OPD-4',
    whatINoticed: 'The room was very cold and I had to wait with my back bare for a long time before the scan started.',
    state: 'acknowledged', answeredBy: 'S. Nahar, front office', answeredOn: '2026-10-16',
    answer: 'We are sorry. The air conditioning in that room is being looked at this week, and the technologists have been asked to start the scan within five minutes of the patient being called in. You do not have to answer this.',
  },
];

export const FEEDBACK_SUBJECTS = ['Waiting time', 'A member of staff', 'Cleanliness', 'The bill', 'The pharmacy', 'Something else'];

/** The hospital’s answer-time promise, which is what makes the list worth opening. */
export const FEEDBACK_PROMISE = 'The front office answers within three working days. The answer comes here, and you can see who wrote it.';

/* ------------------------------------------------------------------ the rules */

export interface PortalIssue {
  code: string;
  message: string;
  /** In Bangla, because the person reading the refusal is the patient. */
  messageBn: string;
}

export interface PortalCheck {
  ok: boolean;
  reasons: PortalIssue[];
  warnings: PortalIssue[];
}

export interface PortalContext {
  today: string;
  nowMinute: number;
  appointments: PortalAppointment[];
  bills: PortalBill[];
  gatewayConnected: boolean;
}

/** Can this appointment be booked? The refusals are the ones a patient meets, in the patient's words. */
export function checkBooking(choice: { clinicId: string; on: string; time: string }, ctx: PortalContext): PortalCheck {
  const reasons: PortalIssue[] = [];
  const warnings: PortalIssue[] = [];
  const clinic = PORTAL_CLINICS.find((c) => c.id === choice.clinicId);

  if (!clinic) {
    reasons.push({ code: 'no-clinic', message: 'Choose the clinic you want.', messageBn: 'আপনি কোন ক্লিনিকে আসতে চান, সেটি বেছে নিন।' });
    return { ok: false, reasons, warnings };
  }
  if (!choice.on || !choice.time) {
    reasons.push({ code: 'no-slot', message: 'Choose a day and a time.', messageBn: 'দিন ও সময় বেছে নিন।' });
    return { ok: false, reasons, warnings };
  }
  const days = Math.round((Date.parse(`${choice.on}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) reasons.push({ code: 'in-the-past', message: 'That day has passed. Choose a day from today onwards.', messageBn: 'সেই দিনটি চলে গেছে। আজ বা তার পরের কোনো দিন বেছে নিন।' });
  if (days > BOOKING_WINDOW_DAYS) {
    reasons.push({
      code: 'too-far',
      message: `The portal books up to ${BOOKING_WINDOW_DAYS} days ahead. For something further away, telephone the desk: they hold the diary for far dates.`,
      messageBn: `অনলাইনে ${BOOKING_WINDOW_DAYS} দিন পর্যন্ত সময় নেওয়া যায়। এর চেয়ে দূরের তারিখের জন্য ডেস্কে ফোন করুন।`,
    });
  }
  if (TAKEN_SLOTS.includes(`${choice.on} ${choice.time}`)) {
    const alternatives = PORTAL_CLINICS.flatMap((c) => c.times.map((time) => ({ c, time })))
      .map(({ c, time }) => ({ clinic: c, time, on: choice.on }))
      .filter((s) => !TAKEN_SLOTS.includes(`${s.on} ${s.time}`) && s.clinic.id === clinic.id)
      .slice(0, 3);
    reasons.push({
      code: 'dizi.slot-taken',
      message: `That time went while you were choosing. ${alternatives.length ? `The next free times on ${choice.on} are ${alternatives.map((a) => a.time).join(', ')}.` : 'There is nothing free that day — choose another day and the free times will be shown.'} Nothing has been booked.`,
      messageBn: `সময়টি নেওয়া হয়ে গেছে। ${alternatives.length ? `${choice.on} তারিখে খালি সময়: ${alternatives.map((a) => a.time).join(', ')}।` : 'সেই দিনে খালি সময় নেই — অন্য দিন বেছে নিন।'} কিছুই বুক হয়নি।`,
    });
  }
  const already = ctx.appointments.filter((a) => a.state === 'booked');
  if (already.length >= MAX_OPEN_APPOINTMENTS) {
    reasons.push({
      code: 'too-many-open',
      message: `You already have ${already.length} appointments waiting. Come to one of those, or cancel one first: a diary full of bookings nobody attends is how a clinic loses its slots.`,
      messageBn: `আপনার অপেক্ষমাণ অ্যাপয়েন্টমেন্ট ${already.length}টি। সেগুলোর একটিতে আসুন, অথবা একটি বাতিল করে তারপর নতুন নিন।`,
    });
  }
  if (already.some((a) => a.on === choice.on && a.department === clinic.department)) {
    reasons.push({ code: 'same-day-same-clinic', message: 'You already have an appointment in this clinic that day.', messageBn: 'সেই দিনে এই ক্লিনিকে আপনার আরেকটি অ্যাপয়েন্টমেন্ট আছে।' });
  }
  if (days === 0) {
    warnings.push({ code: 'today', message: 'Booking for today? Come to the desk instead if it is already past 12:00 — the token for today may be gone.', messageBn: 'আজকের জন্য নিচ্ছেন? দুপুর ১২টার পর হলে সরাসরি ডেস্কে আসুন — আজকের টোকেন শেষ হয়ে থাকতে পারে।' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

export function checkCancellation(appointment: PortalAppointment, ctx: PortalContext): PortalCheck {
  const reasons: PortalIssue[] = [];
  const warnings: PortalIssue[] = [];
  if (appointment.state === 'cancelled') {
    reasons.push({ code: 'dizi.duplicate-operation', message: 'This appointment is already cancelled.', messageBn: 'এই অ্যাপয়েন্টমেন্টটি আগেই বাতিল করা হয়েছে।' });
  }
  if (appointment.state === 'attended' || appointment.state === 'missed') {
    reasons.push({ code: 'already-seen', message: 'That visit is in the past and cannot be cancelled.', messageBn: 'সেই ভিজিট অতীতের — বাতিল করা যাবে না।' });
  }
  const minutesUntil = Math.round((Date.parse(`${appointment.on}T${appointment.time}:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 60_000) - ctx.nowMinute;
  if (minutesUntil >= 0 && minutesUntil < CANCEL_CUTOFF_HOURS * 60) {
    reasons.push({
      code: 'inside-cutoff',
      message: `It is less than ${CANCEL_CUTOFF_HOURS} hours to the appointment. Please telephone the desk on 02 9876 540 instead: your token can still go to somebody waiting, and the desk has to know.`,
      messageBn: `অ্যাপয়েন্টমেন্টের ${CANCEL_CUTOFF_HOURS} ঘণ্টার কম বাকি। অনুগ্রহ করে ডেস্কে ফোন করুন: ০২ ৯৮৭৬ ৫৪০।`,
    });
  }
  if (appointment.fee > 0 && minutesUntil < 24 * 60 && minutesUntil > CANCEL_CUTOFF_HOURS * 60) {
    warnings.push({ code: 'short-notice', message: 'This is short notice. The desk is told, and the slot is offered to the people waiting — that is why saying so matters even at short notice.', messageBn: 'সময় কম। ডেস্ককে জানানো হবে এবং অপেক্ষমাণ রোগীদের সময়টি দেওয়া হবে।' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

export function checkPayment(bill: PortalBill, amount: number, ctx: PortalContext): PortalCheck {
  const reasons: PortalIssue[] = [];
  const warnings: PortalIssue[] = [];
  const due = billDue(bill);
  if (due === 0) reasons.push({ code: 'dizi.duplicate-operation', message: 'This bill is already settled. Nothing more is due.', messageBn: 'এই বিলটি পরিশোধ হয়ে গেছে। আর কিছু দিতে হবে না।' });
  if (amount <= 0) reasons.push({ code: 'no-amount', message: 'Enter the amount you want to pay.', messageBn: 'যত টাকা দিতে চান, সেটি লিখুন।' });
  if (amount > due) {
    reasons.push({ code: 'over-balance', message: `${money(amount)} is more than the ${money(due)} due on this bill. Pay the due amount here, or pay the rest at the counter where it can be receipted against the patient’s name.`, messageBn: `${money(amount)} টাকা বিলের বাকি ${money(due)} টাকার চেয়ে বেশি। এখানে বাকি টাকাটা দিন, বাকিটা কাউন্টারে দিন।` });
  }
  if (!ctx.gatewayConnected) {
    reasons.push({
      code: 'dizi.offline-not-allowed',
      message: 'There is no payment gateway connected here, so this button cannot take your money. Nothing has been charged. You can pay at the counter, at the desk by card, or from the hospital’s own app once it is connected — in a few seconds, at the desk, rather than waiting for the money to appear twice.',
      messageBn: 'এখানে অনলাইন পেমেন্ট চালু নেই, তাই এই বোতাম টাকা নিতে পারবে না। কিছুই কাটা হয়নি। কাউন্টারে, অথবা ডেস্কে কার্ডে টাকা দিতে পারেন।',
    });
  }
  if (bill.state === 'partial') {
    warnings.push({ code: 'part-paid', message: `${money(bill.paid)} of ${money(billTotal(bill))} has already been paid. What is left is ${money(due)}.`, messageBn: `${money(billTotal(bill))} টাকার মধ্যে ${money(bill.paid)} দেওয়া হয়েছে। বাকি ${money(due)} টাকা।` });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/** Language that means “this is not a form, this is an emergency”, and a short list of clinical asks. */
export const EMERGENCY_LANGUAGE = /\b(bleeding|blood coming|cannot breathe|can’t breathe|chest pain|unconscious|fainted|no movement|baby is not moving|not moving|high fever with|very high fever|water broke|waters broke|labour|labor pain|suicid|took tablets|poison)\b/i;
export const CLINICAL_QUESTION = /\b(what is wrong with|do i have|is it normal|should i take|dose|dosage|mg|antibiotic|report says|test result|am i pregnant|my result)\b/i;
/** A title is written by a patient as often as not with a capital: “Nurse Fatima” is a name, not a common noun. */
export const NAMES_A_PERSON = /\b(?:Dr\.|Mr\.|Mrs\.|Ms\.|[Dd]octor|[Nn]urse|[Aa]yah|[Gg]uard)\s?[A-Z][a-zA-Z.]+/;

export function checkFeedback(draft: { subject: string; about: string; whatINoticed: string; mayTelephone: boolean }, ctx: PortalContext): PortalCheck {
  const reasons: PortalIssue[] = [];
  const warnings: PortalIssue[] = [];
  if (!draft.subject.trim()) reasons.push({ code: 'no-subject', message: 'What is this about?', messageBn: 'এটি কী সম্পর্কে?' });
  if ((draft.whatINoticed ?? '').trim().length < 20) {
    reasons.push({
      code: 'too-short',
      message: 'Write what happened, in your own words. A sentence with the day and what you saw is what somebody can act on.',
      messageBn: 'কী হয়েছে, নিজের ভাষায় লিখুন। কোন দিন কী দেখেছেন — এটুকুই যথেষ্ট।',
    });
  }
  if (EMERGENCY_LANGUAGE.test(`${draft.subject} ${draft.whatINoticed}`)) {
    reasons.push({
      code: 'emergency',
      message: `This sounds like something that needs to be seen today, and a form is not the way. Come to the emergency department, or telephone 02 9876 500 now. The form is read in office hours.`,
      messageBn: `এটি আজই দেখানো দরকার — ফর্ম নয়। এখনই জরুরি বিভাগে আসুন, অথবা ০২ ৯৮৭৬ ৫০০ নম্বরে ফোন করুন।`,
    });
  }
  if (CLINICAL_QUESTION.test(`${draft.subject} ${draft.whatINoticed}`)) {
    reasons.push({
      code: 'clinical-question',
      message: 'The portal cannot answer questions about your treatment or your results, and it will not try. Your doctor can, and so can the desk on 02 9876 540 — if a result is worth explaining, the hospital telephones you rather than writing it here.',
      messageBn: 'চিকিৎসা বা রিপোর্ট নিয়ে প্রশ্নের উত্তর পোর্টাল দিতে পারে না। আপনার ডাক্তার দিতে পারেন — ডেস্কে ফোন করুন ০২ ৯৮৭৬ ৫৪০।',
    });
  }
  if (NAMES_A_PERSON.test(draft.whatINoticed)) {
    warnings.push({
      code: 'names-a-person',
      message: 'You have named a member of staff. The complaint is read by the person responsible for that department, and the person named is shown what was written and given the chance to answer — that is how a complaint leads to a change rather than to a grudge.',
      messageBn: 'আপনি একজন কর্মীর নাম লিখেছেন। অভিযোগটি সংশ্লিষ্ট বিভাগের দায়িত্বপ্রাপ্ত ব্যক্তি পড়বেন, এবং নামটি যাঁর, তাঁকেও লেখাটি দেখানো হবে ও উত্তর দেওয়ার সুযোগ দেওয়া হবে।',
    });
  }
  if (!draft.mayTelephone) {
    warnings.push({ code: 'no-call-back', message: 'You have asked not to be telephoned. The answer will come here in writing, which is slower but is your choice.', messageBn: 'আপনি ফোনে উত্তর চাননি, তাই লিখিত উত্তরই এখানে আসবে।' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

/* ------------------------------------------------------------------ the digest */

export interface PortalDigest {
  nextAppointment?: PortalAppointment;
  openAppointments: number;
  resultsReady: number;
  resultsWaiting: number;
  withheld: number;
  due: number;
  billsOpen: number;
  feedbackWaiting: number;
}

export function portalDigest(ctx: { today: string; appointments: PortalAppointment[]; results?: PortalResult[]; bills: PortalBill[]; feedback?: PortalFeedback[] }): PortalDigest {
  const results = ctx.results ?? [];
  const feedback = ctx.feedback ?? [];
  const upcoming = ctx.appointments.filter((a) => a.state === 'booked').sort((a, b) => `${a.on}${a.time}`.localeCompare(`${b.on}${b.time}`));
  return {
    nextAppointment: upcoming[0],
    openAppointments: upcoming.length,
    resultsReady: results.filter((r) => r.state === 'released').length,
    resultsWaiting: results.filter((r) => r.state === 'pending').length,
    withheld: results.filter((r) => r.state === 'withheld').length,
    due: outstanding(ctx.bills),
    billsOpen: ctx.bills.filter((b) => billDue(b) > 0).length,
    feedbackWaiting: feedback.filter((f) => f.state !== 'closed').length,
  };
}

/* ------------------------------------------------------------------ sign-in, honestly */

/**
 * The sign-in the browser can actually do today.
 *
 * Keycloak (#24) is not built, so the portal cannot verify who is holding the phone: the one-time code is shown on
 * the screen instead of sent to the number on the record, and the screen says exactly that in both languages. Being
 * honest about a stub on a patient-facing screen matters more than on a staff one — a patient who believes they are
 * signed in to a verified record will read somebody else's results without questioning them.
 */
export const PORTAL_AUTH: { built: boolean; what: string; whatBn: string; waits: string } = {
  built: false,
  what: 'This is a demonstration sign-in. The code appears on the screen instead of arriving by SMS, because the hospital’s identity service is not connected yet. In the finished portal the code is sent to the number on your record and to nowhere else.',
  whatBn: 'এটি একটি প্রদর্শনী লগইন। হাসপাতালের পরিচয় যাচাইয়ের সেবা এখনো চালু না হওয়ায় কোডটি এসএমএস-এ না গিয়ে পর্দায় দেখা যাচ্ছে। চালু হলে কোড শুধু আপনার নথিতে থাকা নম্বরে যাবে।',
  waits: 'Keycloak with one-time codes (#24). Until it exists, the portal is a preview with the real screens and the real rules, and it says so before anybody signs in.',
};

export const PORTAL_WAITING: string[] = [
  'Sign-in is a stub: the one-time code is displayed rather than sent, so the preview works without the identity service (#24).',
  'Paying from the phone needs a payment gateway (bKash, Nagad or card acquiring). The screen refuses the payment and says nothing was charged, which is the honest version of “coming soon”.',
  'Results arrive from the laboratory and radiology systems as they are released. Until that connection exists, a result is released by a person, which is why the withheld one says a doctor wants to explain it.',
  'The portal is served from the cloud and reads the cloud’s own records, so what a patient sees and what the cashier sees are the same rows.',
];

/* ------------------------------------------------------------------ dates, money and the words */

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BN_WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const bnDigits = (input: string | number): string => String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

/** `2026-10-22` → `২২ অক্টোবর, বৃহস্পতিবার` in Bangla and `22 October, Thursday` in English. */
export function niceDate(dayIso: string, locale: PortalLocale): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayIso;
  const day = d.getUTCDate();
  const weekday = d.getUTCDay();
  return locale === 'bn'
    ? `${bnDigits(day)} ${BN_MONTHS[d.getUTCMonth()]}, ${BN_WEEKDAYS[weekday]}`
    : `${day} ${EN_MONTHS[d.getUTCMonth()]}, ${EN_WEEKDAYS[weekday]}`;
}

/** A clock time is written the way a patient reads it: `সকাল ১১:০০` rather than `11:00`. */
export function niceTime(hhmm: string, locale: PortalLocale): string {
  const hour = Number(hhmm.slice(0, 2));
  if (locale === 'bn') {
    const part = hour < 6 ? 'ভোর' : hour < 12 ? 'সকাল' : hour < 16 ? 'দুপুর' : hour < 19 ? 'বিকাল' : 'রাত';
    return `${part} ${bnDigits(hhmm)}`;
  }
  const part = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}.${hhmm.slice(3)} ${part}`;
}

export const moneyIn = (n: number, locale: PortalLocale): string => (locale === 'bn' ? `৳ ${bnDigits(n.toLocaleString('en-IN'))}` : `৳ ${n.toLocaleString('en-IN')}`);
export const tr = (text: PortalText, locale: PortalLocale): string => (locale === 'bn' ? text.bn : text.en);

/** Every label the portal shows. Bangla is the default, so a missing English string is a smaller failure than a missing Bangla one. */
export const STR = {
  nextVisit: { bn: 'পরের ভিজিট', en: 'Next visit' },
  nothingBooked: { bn: 'এখন কোনো ভিজিট ঠিক নেই', en: 'No visit is booked' },
  token: { bn: 'টোকেন', en: 'Token' },
  whatToBring: { bn: 'কী সঙ্গে আনবেন', en: 'What to bring' },
  bookVisit: { bn: 'নতুন ভিজিট নিন', en: 'Book a visit' },
  callDesk: { bn: 'ডেস্কে ফোন করুন', en: 'Telephone the desk' },
  myVisits: { bn: 'আমার ভিজিট', en: 'My visits' },
  upcoming: { bn: 'যেগুলো আসছে', en: 'Coming up' },
  past: { bn: 'যেগুলো হয়ে গেছে', en: 'Earlier visits' },
  cancelVisit: { bn: 'ভিজিট বাতিল করুন', en: 'Cancel this visit' },
  confirmed: { bn: 'ঠিক আছে', en: 'Booked' },
  attended: { bn: 'হয়ে গেছে', en: 'Seen' },
  cancelled: { bn: 'বাতিল', en: 'Cancelled' },
  missed: { bn: 'আসা হয়নি', en: 'Not attended' },
  chooseClinic: { bn: 'ক্লিনিক বেছে নিন', en: 'Which clinic' },
  chooseDay: { bn: 'দিন বেছে নিন', en: 'Which day' },
  chooseTime: { bn: 'সময় বেছে নিন', en: 'Which time' },
  bookThis: { bn: 'এই সময়ে ভিজিট নিন', en: 'Book this time' },
  clinic: { bn: 'ক্লিনিক', en: 'Clinic' },
  day: { bn: 'দিন', en: 'Day' },
  time: { bn: 'সময়', en: 'Time' },
  room: { bn: 'রুম', en: 'Room' },
  myReports: { bn: 'আমার রিপোর্ট', en: 'My reports' },
  ready: { bn: 'দেখা যাবে', en: 'Ready to see' },
  waitingResult: { bn: 'এখনো আসেনি', en: 'Still in the laboratory' },
  withheld: { bn: 'ডাক্তার নিজে বলবেন', en: 'Your doctor will explain it' },
  releaseOn: { bn: 'কখন দেখা যাবে', en: 'Ready since' },
  downloadReport: { bn: 'রিপোর্ট নামিয়ে নিন', en: 'Download the report' },
  downloaded: { bn: 'নামানো হয়েছে', en: 'Downloaded' },
  reportReady1: { bn: 'রিপোর্টটি তৈরি', en: 'The report is ready' },
  medicines: { bn: 'ঔষধ', en: 'Medicines' },
  prescribedOn: { bn: 'যেদিন দেওয়া হয়েছে', en: 'Prescribed on' },
  whatItIsFor: { bn: 'কী জন্য', en: 'What it is for' },
  howToTake: { bn: 'কীভাবে খাবেন', en: 'How to take it' },
  collected: { bn: 'ফার্মেসি থেকে নেওয়া হয়েছে', en: 'Collected from the pharmacy' },
  notCollected: { bn: 'ফার্মেসি থেকে নিতে হবে', en: 'To collect from the pharmacy' },
  copyList: { bn: 'ঔষধের তালিকা কপি করুন', en: 'Copy the medicine list' },
  myBills: { bn: 'আমার বিল', en: 'My bills' },
  due: { bn: 'বাকি', en: 'To pay' },
  paid: { bn: 'পরিশোধিত', en: 'Paid' },
  total: { bn: 'মোট', en: 'Total' },
  payNow: { bn: 'এই বিলটি শোধ করুন', en: 'Pay this bill' },
  amount: { bn: 'কত টাকা', en: 'Amount' },
  howPay: { bn: 'কীভাবে দিতে চান', en: 'How you want to pay' },
  pay: { bn: 'টাকা দিন', en: 'Pay' },
  myPayments: { bn: 'আমার রসিদ', en: 'My receipts' },
  receipt: { bn: 'রসিদ নম্বর', en: 'Receipt' },
  sendFeedback: { bn: 'আমরা জানতে চাই', en: 'Tell us what you think' },
  whatAbout: { bn: 'কিসের ব্যাপারে', en: 'What is it about' },
  tellUs: { bn: 'কী হয়েছে লিখুন', en: 'What happened' },
  mayTelephone: { bn: 'প্রয়োজনে আপনাকে ফোন করতে পারি', en: 'We may telephone you if we need to' },
  send: { bn: 'পাঠান', en: 'Send' },
  ourAnswer: { bn: 'আমাদের উত্তর', en: 'Our answer' },
  waitingAnswer: { bn: 'উত্তরের অপেক্ষায়', en: 'Waiting for an answer' },
  answered: { bn: 'উত্তর দেওয়া হয়েছে', en: 'Answered' },
  reference: { bn: 'রেফারেন্স নম্বর', en: 'Reference' },
  heldOnPhone: { bn: 'ফোনে রাখা হয়েছে — এখনো হাসপাতালে পৌঁছায়নি।', en: 'Held on this phone — not yet at the hospital.' },
  sentToHospital: { bn: 'হাসপাতালে পাঠানো হয়েছে।', en: 'Sent to the hospital.' },
  status: { bn: 'অবস্থা', en: 'Status' },
  everything: { bn: 'সব', en: 'Everything' },
} as const satisfies Record<string, PortalText>;
