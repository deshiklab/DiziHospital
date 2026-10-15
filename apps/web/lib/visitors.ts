/* ----------------------------------------------------------------------------------------------------
 * Front office (P7) — the gate, the pass, and the person who did not sign out.
 *
 * The legacy system's visitor register was a book at the main gate with a name, a signature and, on a good
 * day, a time. What it could not answer is the question a security guard is actually asked: who is still in
 * the building after visiting hours, and who let them in. So the model here is:
 *
 *  1. **A pass is issued against a host by name.** A visitor with nobody to see is a visitor the guard has
 *     no way to place in the building, and "management" is not a host.
 *  2. **The badge kind decides the areas, not the person's confidence.** A contractor with a toolbox does
 *     not walk through a ward during visiting hours, and the pass prints the areas they may not enter.
 *  3. **A pass is open until it is signed out.** An open pass before the grace period is a person in the
 *     building; after it, it is an exception the register names — because a gate register that assumes
 *     everybody left is a register nobody can use in an inquiry.
 *  4. **Identification is recorded as checked, with what was checked.** NID, passport, a hospital ID of the
 *     company they came from, or a decision to accept none of them — which is itself a fact worth keeping.
 *
 * Preview: today's passes are fixed data on the same day the attendance register uses, so the gate screen and
 * the HR screens show the same day of the same branch.
 */

import { WARDS } from './ward';

/* --------------------------------------------------------------------------------------------- the lists */

export type BadgeKind = 'Visitor' | 'Patient attendant' | 'Contractor' | 'Vendor' | 'Delivery';
export const BADGE_KINDS: BadgeKind[] = ['Visitor', 'Patient attendant', 'Contractor', 'Vendor', 'Delivery'];

/** What somebody may come for. The gate asks this because the answer decides the host. */
export const PURPOSES: Array<{ code: string; label: string; needsHost: boolean; areas: string[]; note: string }> = [
  { code: 'VST-WARD', label: 'Visiting a patient', needsHost: true, areas: ['Wards', 'OPD waiting'], note: 'The common one. Visiting hours apply, and the ward is asked whether the patient may have visitors at all.' },
  { code: 'VST-ATTEND', label: 'Attendant staying with a patient', needsHost: true, areas: ['Wards'], note: 'One attendant may stay, the ward names them on the bed, and the pass is valid as long as the admission is.' },
  { code: 'VST-CLINIC', label: 'Attending a clinic', needsHost: false, areas: ['OPD waiting', 'Laboratory', 'Radiology'], note: 'A patient with an appointment rather than a visitor, but the gate still records them: the queue screen and the gate then agree about who is in the building.' },
  { code: 'VST-REPORT', label: 'Collecting a report', needsHost: true, areas: ['OPD waiting', 'Administration'], note: 'Needs the patient’s number: a report handed to whoever asks is a report handed out twice.' },
  { code: 'VST-MEET', label: 'Meeting a member of staff', needsHost: true, areas: ['Administration', 'OPD waiting'], note: 'Interviews, joining formalities, a supplier meeting. The host’s name is on the pass, which is how the meeting is found later.' },
  { code: 'VST-SUPPLY', label: 'Delivering supplies', needsHost: true, areas: ['Store and kitchen', 'Loading bay'], note: 'Store or kitchen only. Nothing is received at a ward: it is received, weighed and entered in the store, from where the wards draw it.' },
  { code: 'VST-SERVICE', label: 'Service or repair', needsHost: true, areas: ['Engineering', 'Store and kitchen'], note: 'Air-conditioning, lift, medical gas, generators. A contractor with tools goes where the job is and nowhere else.' },
  { code: 'VST-VENDOR', label: 'Pharmaceutical or equipment representative', needsHost: true, areas: ['Administration'], note: 'Seen by appointment at administration or the store. Wards are reached by the pharmacy’s own stock, not by a bag carried in at eleven o’clock.' },
  { code: 'VST-MORTUARY', label: 'Mortuary or death formalities', needsHost: true, areas: ['Mortuary', 'Administration'], note: 'The one visit that must not be made to wait at the gate. Recorded, escorted, and the register holds the release of the body the death record has.' },
  { code: 'VST-AMB', label: 'A bystander or ambulance crew', needsHost: false, areas: ['Emergency', 'Wards', 'OPD waiting'], note: 'Arrives with a patient. Recorded after the patient has been taken in, never before: the gate does not delay an emergency to write a name.' },
];

export const purposeByCode = (code: string) => PURPOSES.find((p) => p.code === code);

/** The areas a badge kind may reach, and where each one is stopped. */
export const VISIT_AREAS: Array<{ id: string; label: string; allows: BadgeKind[]; note: string }> = [
  { id: 'wards', label: 'Wards', allows: ['Visitor', 'Patient attendant'], note: 'Visiting hours only, except an attendant the ward has named on the bed.' },
  { id: 'opd', label: 'OPD waiting', allows: ['Visitor', 'Patient attendant', 'Vendor', 'Delivery', 'Contractor'], note: 'The waiting area is public: a patient, a relative, a delivery and a repair all pass through it.' },
  { id: 'icu', label: 'ICU and HDU', allows: ['Visitor'], note: 'Immediate family only, one at a time, escorted both ways, and never during a handover or a procedure.' },
  { id: 'maternity', label: 'Maternity', allows: ['Visitor', 'Patient attendant'], note: 'The ward decides. A curtain is not a wall, and the woman next door did not agree to an audience.' },
  { id: 'theatre', label: 'Theatre corridor', allows: [], note: 'Nobody has a standing pass. Theatre is entered on a list that the suite keeps, not on a badge from the gate.' },
  { id: 'lab', label: 'Laboratory and radiology', allows: ['Contractor', 'Vendor'], note: 'Service and calibration only, with the department’s engineer in attendance.' },
  { id: 'store', label: 'Store, kitchen and loading bay', allows: ['Delivery', 'Contractor', 'Vendor'], note: 'Goods are received here. A delivery walked to a ward is stock that never existed.' },
  { id: 'engineering', label: 'Engineering and plant rooms', allows: ['Contractor', 'Vendor'], note: 'A contractor with tools works here and is counted out at the end of the shift by the plant room’s own log.' },
  { id: 'admin', label: 'Administration', allows: ['Visitor', 'Vendor', 'Delivery', 'Contractor'], note: 'Offices. Meetings, joining formalities and representatives are seen here.' },
  { id: 'mortuary', label: 'Mortuary', allows: ['Visitor'], note: 'Escorted, recorded, and the pass is signed out by the person who took the body, matching the death record.' },
];

export const areaById = (id: string) => VISIT_AREAS.find((a) => a.id === id);
export const areasFor = (code: string) => {
  const purpose = purposeByCode(code);
  if (!purpose) return [];
  return purpose.areas;
};

export interface VisitingHour {
  wardId: string;
  ward: string;
  morning: string;
  evening: string;
  note: string;
}

/** Visiting hours as the wards keep them. Printed on the badge, because the door is busy and a sign is not read. */
export const VISITING_HOURS: VisitingHour[] = WARDS.map((ward) => ({
  wardId: ward.id,
  ward: ward.name,
  morning: ward.id === 'hdu' ? '10:00 – 11:00, one at a time, escorted' : '11:00 – 12:30',
  evening: ward.id === 'hdu' ? '17:00 – 17:30, immediate family' : ward.id === 'mat-c' ? '16:00 – 17:00' : '17:00 – 18:30',
  note:
    ward.id === 'hdu'
      ? 'Two windows a day and a nurse at the door. In a unit where every bed is critical, an open visiting hour is a corridor of relatives and no room to move a ventilator.'
      : ward.id === 'mat-c'
        ? 'The new mother’s hour, kept early so it does not collide with the evening feed. One female relative may stay with an attendant pass.'
        : `One attendant may stay with the patient; the ward writes their name on the bed so the guard has something to check.`,
}));

/* --------------------------------------------------------------------------------------------- the pass */

export type PassState = 'In' | 'Out' | 'Overdue';

export interface VisitorPass {
  id: string;
  /** `VP-2026-0412` — the day’s own series, continued from the book the gate used to keep. */
  passNo: string;
  name: string;
  mobile: string;
  /** Where they came from, for a contractor or a representative: a person with a company behind them. */
  organisation: string;
  purpose: string;
  hostCode: string;
  hostName: string;
  badgeKind: BadgeKind;
  areas: string[];
  issuedAt: string;
  /** When it stops being valid. A pass without an end is a key, not a pass. */
  validUntil: string;
  state: PassState;
  signedOutAt: string | null;
  signedOutBy: string | null;
  idChecked: { kind: 'NID' | 'Passport' | 'Company ID' | 'Hospital ID' | 'Not checked'; number: string; note: string };
  vehicle: string;
  itemsIn: string;
  itemsOut: string;
  escorts: string;
  accompanying: string;
  note: string;
  issuedBy: string;
}

/** The day’s passes. Two are deliberately open: one on its way out, one that has overstayed by hours. */
export const TODAY_PASSES: VisitorPass[] = [
  {
    id: 'vp-1', passNo: 'VP-2026-0402', name: 'Rahima Begum', mobile: '01711-884 210', organisation: '', purpose: 'VST-ATTEND', hostCode: 'EMP-1041', hostName: 'M. Hoque', badgeKind: 'Patient attendant',
    areas: ['wards'], issuedAt: '2026-10-15 07:40', validUntil: '2026-10-18 20:00', state: 'In', signedOutAt: null, signedOutBy: null,
    idChecked: { kind: 'NID', number: '19•••••••••42', note: 'Checked against the admission’s attendant detail' }, vehicle: '', itemsIn: 'Clothes bag', itemsOut: '', escorts: '', accompanying: 'SH-102301', 
    note: 'Named on C-04 as the mother’s attendant. The pass runs as long as the admission does, not as long as the day does.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-2', passNo: 'VP-2026-0403', name: 'Jashim Uddin', mobile: '01819-336 004', organisation: 'Mirpur Cold Chain Ltd.', purpose: 'VST-SERVICE', hostCode: 'EMP-1012', hostName: 'A. Chowdhury', badgeKind: 'Contractor',
    areas: ['engineering', 'store'], issuedAt: '2026-10-15 08:05', validUntil: '2026-10-15 17:00', state: 'In', signedOutAt: null, signedOutBy: null,
    idChecked: { kind: 'Company ID', number: 'MCC-2291', note: 'Company ID and the work order letter' }, vehicle: 'Dhaka Metro-11-4471', itemsIn: 'Toolbox, gas manifold, cylinders ×2', itemsOut: '', escorts: 'Plant room log', accompanying: '',
    note: 'Theatre manifold quarterly service. Tools are logged in; the plant room counts him out rather than the gate.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-3', passNo: 'VP-2026-0404', name: 'Nusrat Jahan', mobile: '01521-770 118', organisation: '', purpose: 'VST-WARD', hostCode: 'EMP-1005', hostName: 'S. Rahman', badgeKind: 'Visitor',
    areas: ['wards', 'opd'], issuedAt: '2026-10-15 11:12', validUntil: '2026-10-15 12:30', state: 'Out', signedOutAt: '2026-10-15 12:24', signedOutBy: 'Gate 1 — R. Howlader',
    idChecked: { kind: 'NID', number: '19•••••••••71', note: 'Photograph compared' }, vehicle: '', itemsIn: 'Fruit basket', itemsOut: 'Fruit basket (taken to the ward)', escorts: '', accompanying: '',
    note: 'Visited bed A-07. In and out inside visiting hours, which is what most of the day looks like.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-4', passNo: 'VP-2026-0405', name: 'Habibur Rahman', mobile: '01911-204 556', organisation: '', purpose: 'VST-REPORT', hostCode: 'EMP-1005', hostName: 'S. Rahman', badgeKind: 'Visitor',
    areas: ['opd', 'admin'], issuedAt: '2026-10-15 12:40', validUntil: '2026-10-15 13:40', state: 'Overdue', signedOutAt: null, signedOutBy: null,
    idChecked: { kind: 'NID', number: '19•••••••••09', note: '' }, vehicle: '', itemsIn: '', itemsOut: '', escorts: '', accompanying: 'SH-102244',
    note: 'Came for the pathology report of SH-102244 and is still open two hours past validity. Open passes are what the gate screen exists to show.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-5', passNo: 'VP-2026-0406', name: 'Sabina Akter', mobile: '01755-641 902', organisation: '', purpose: 'VST-WARD', hostCode: 'EMP-1007', hostName: 'R. Begum', badgeKind: 'Visitor',
    areas: ['wards', 'opd'], issuedAt: '2026-10-15 16:58', validUntil: '2026-10-15 17:00', state: 'In', signedOutAt: null, signedOutBy: null,
    idChecked: { kind: 'NID', number: '19•••••••••33', note: '' }, vehicle: '', itemsIn: '', itemsOut: '', escorts: '', accompanying: '',
    note: 'Arrived a minute before the maternity window closed. The ward took her by phone; the pass records who agreed.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-6', passNo: 'VP-2026-0407', name: 'Delivery rider — Foodpanda', mobile: '01300-118 774', organisation: 'Delivery partner', purpose: 'VST-SUPPLY', hostCode: 'EMP-1020', hostName: 'T. Hossain', badgeKind: 'Delivery',
    areas: ['store'], issuedAt: '2026-10-15 13:20', validUntil: '2026-10-15 13:50', state: 'Out', signedOutAt: '2026-10-15 13:34', signedOutBy: 'Gate 1 — R. Howlader',
    idChecked: { kind: 'Not checked', number: '', note: 'Rider ID not carried; the order was handed at the gate rather than inside' }, vehicle: 'Motorbike', itemsIn: 'Sealed food order ×6', itemsOut: '',
    escorts: '', accompanying: '', note: 'Food for the night shift is left at the gate and collected, which is why this pass never entered the building.', issuedBy: 'Gate 1 — R. Howlader',
  },
  {
    id: 'vp-7', passNo: 'VP-2026-0408', name: 'Dr. Tanvir Ahmed', mobile: '01712-909 331', organisation: 'Square Pharmaceuticals', purpose: 'VST-VENDOR', hostCode: 'EMP-1003', hostName: 'M. Sultana', badgeKind: 'Vendor',
    areas: ['admin'], issuedAt: '2026-10-15 10:00', validUntil: '2026-10-15 12:00', state: 'Out', signedOutAt: '2026-10-15 11:26', signedOutBy: 'Gate 1 — R. Howlader',
    idChecked: { kind: 'Company ID', number: 'SQ-3301', note: 'Appointment confirmed by the pharmacy' }, vehicle: '', itemsIn: 'Laptop bag, samples catalogue', itemsOut: 'Laptop bag, catalogue, no samples', escorts: '',
    accompanying: '', note: 'Seen by appointment. Samples were not carried in and none left: the pharmacy’s stock moves through the pharmacy.', issuedBy: 'Gate 1 — R. Howlader',
  },
];

export const OVERDUE_GRACE_MIN = 30;
/** One person at a bed at a time; more than three in a bay at once is a corridor, not a visit. */
export const MAX_VISITORS_PER_PATIENT = 3;

export const VISITOR_RULES: Array<{ title: string; because: string }> = [
  { title: 'A pass names a host, and the host is a person', because: 'The guard’s question is “who are you seeing”, and the register has to answer it later. “Management” or “doctor” is not an answer anybody can check.' },
  { title: 'The badge kind decides the areas', because: 'A contractor with a toolbox, a delivery, and a relative are three different risks. The pass prints where each may not go, so the guard is not deciding it at the door under pressure.' },
  { title: 'A pass stays open until it is signed out', because: 'The one thing a gate register is for is the question asked after an incident: who was in the building. Assuming everybody left is how that question gets answered wrongly.' },
  { title: 'Identification is recorded with what was checked', because: '“Checked” is not a fact; “NID 19•••••42, photograph compared” is. Where nothing was checked, the register says that too, and says what was done instead.' },
  { title: 'Items in and items out are both recorded', because: 'The gate is where a hospital’s stock leaves. A toolbox in and a toolbox out is a sentence the store can rely on; a toolbox in and nothing out is a question.' },
];

/* --------------------------------------------------------------------------------------------- the day */

export interface VisitorDay {
  day: string;
  passes: VisitorPass[];
  stats: {
    issued: number;
    inBuilding: number;
    overdue: number;
    signedOut: number;
    contractors: number;
    deliveries: number;
    attendants: number;
    notChecked: number;
    vehicles: number;
  };
}

/** Today as the gate saw it. `extra` carries the passes the screen has just issued. */
export function visitorDay(dayIso: string, extra: VisitorPass[] = []): VisitorDay {
  const passes = [...extra, ...TODAY_PASSES]
    .filter((p) => p.issuedAt.slice(0, 10) === dayIso)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return {
    day: dayIso,
    passes,
    stats: {
      issued: passes.length,
      inBuilding: passes.filter((p) => p.state === 'In').length,
      overdue: passes.filter((p) => p.state === 'Overdue').length,
      signedOut: passes.filter((p) => p.state === 'Out').length,
      contractors: passes.filter((p) => p.badgeKind === 'Contractor').length,
      deliveries: passes.filter((p) => p.badgeKind === 'Delivery').length,
      attendants: passes.filter((p) => p.badgeKind === 'Patient attendant').length,
      notChecked: passes.filter((p) => p.idChecked.kind === 'Not checked').length,
      vehicles: passes.filter((p) => p.vehicle.trim().length > 0).length,
    },
  };
}

/** Passes the hour has overtaken: issued, valid, and not signed out. This is the gate screen's top line. */
export function overduePasses(passes: VisitorPass[], nowIso: string): VisitorPass[] {
  return passes.filter((p) => p.state !== 'Out' && validUntilPassed(p, nowIso));
}

const validUntilPassed = (pass: VisitorPass, nowIso: string): boolean => pass.validUntil < nowIso || pass.state === 'Overdue';

export const nextPassNo = (dayIso: string, existing: VisitorPass[]): string => {
  const year = dayIso.slice(0, 4);
  const highest = existing
    .map((p) => Number(p.passNo.split('-')[2] ?? 0))
    .reduce((max, n) => (Number.isFinite(n) && n > max ? n : max), 0);
  return `VP-${year}-${String(highest + 1).padStart(4, '0')}`;
};

/* --------------------------------------------------------------------------------------------- the checks */

export interface VisitorCheck {
  ok: boolean;
  reasons: Array<{ code: string; message: string }>;
  warnings: string[];
}

export interface VisitorDraft {
  name: string;
  mobile: string;
  organisation: string;
  purpose: string;
  hostCode: string;
  badgeKind: BadgeKind;
  idKind: string;
  idNumber: string;
  vehicle: string;
  itemsIn: string;
  escorts: string;
  accompanying: string;
  note: string;
  validUntil: string;
  nowIso: string;
  /** Passes already issued today, so the day can be checked as a whole and not one pass at a time. */
  day: VisitorPass[];
}

/**
 * What the gate refuses, in the order a guard meets it: who are you here to see, can you be found again, and
 * may you go where you are asking to go. Nothing here is about the visitor's right to be at a hospital.
 */
export function checkVisitor(draft: VisitorDraft): VisitorCheck {
  const reasons: VisitorCheck['reasons'] = [];
  const warnings: string[] = [];
  const purpose = purposeByCode(draft.purpose);

  if (!draft.name.trim()) reasons.push({ code: 'no-name', message: 'A pass carries a name. An unnamed badge is a person the building cannot account for, which defeats the only thing the register is for.' });
  if (!draft.mobile.trim()) {
    reasons.push({ code: 'no-mobile', message: 'A mobile number goes on every pass: it is how a visitor is reached when the ward they came to see has been closed to visitors, and how a contact is traced afterwards.' });
  } else if (!/^01\d{3}[- ]?\d{3}[- ]?\d{3}$/.test(draft.mobile.trim()) && !/^\+?8801\d{9}$/.test(draft.mobile.replace(/[- ]/g, ''))) {
    warnings.push('The mobile number is not in the 01XXXXXXXXX form the hospital’s messages expect. It will be printed as typed and the ward will ring it by hand.');
  }
  if (!draft.hostCode.trim()) reasons.push({ code: 'no-host', message: 'A pass names the person being seen, or the department that asked for the visit. A visitor with no host cannot be announced, and nobody can be asked whether they arrived.' });
  if (!purpose) reasons.push({ code: 'no-purpose', message: 'The purpose decides the areas and the host. A pass without one is a badge that opens whatever the guard feels it should.' });

  const needsId = draft.badgeKind === 'Contractor' || draft.badgeKind === 'Vendor';
  if (needsId && draft.idKind === 'Not checked') {
    reasons.push({ code: 'contractor-no-id', message: 'A contractor or a representative is identified by their company and their own ID, and the work order or the appointment is recorded with it. This is the person who will be in the plant room.' });
  }
  if (draft.badgeKind === 'Delivery' && draft.idKind === 'Not checked' && !draft.note.trim()) {
    reasons.push({ code: 'delivery-no-note', message: 'A delivery with nothing recorded about who came is a delivery nobody can trace. Either take the rider’s ID or write what was accepted at the gate and by whom.' });
  }
  if (purpose?.code === 'VST-REPORT' && !draft.accompanying.trim()) {
    reasons.push({ code: 'report-without-patient', message: 'Collecting a report needs the patient’s number on the pass. A report handed to whoever asks is a report handed out twice, and the second time it is not a mistake, it is a disclosure.' });
  }
  if (purpose?.code === 'VST-CLINIC' && !draft.accompanying.trim()) {
    warnings.push('No patient number recorded: if this is a patient attending an appointment, the gate and the queue should be able to agree about who is in the building.');
  }

  const areas = purpose ? purpose.areas : [];
  if (!purpose?.needsHost && !draft.hostCode.trim()) {
    // A patient walking in with an appointment has no host by definition; the gate records the desk instead.
    warnings.push('A walk-in purpose with no host: the pass is signed by the gate and the desk it was sent to is written into the note.');
  }
  for (const area of areas) {
    const rule = VISIT_AREAS.find((a) => a.id === area);
    if (rule && rule.allows.length > 0 && !rule.allows.includes(draft.badgeKind)) {
      reasons.push({ code: 'area-not-allowed', message: `A ${draft.badgeKind.toLowerCase()} pass does not reach ${rule.label}. ${rule.note}` });
    }
  }

  if (draft.validUntil && draft.validUntil <= draft.nowIso) {
    reasons.push({ code: 'already-expired', message: 'The pass would expire before it is issued. A pass that is invalid on the way in is a badge the guard has to argue about at the door.' });
  }
  const hours = Number(draft.validUntil.slice(11, 13)) - Number(draft.nowIso.slice(11, 13));
  if (hours > 12) warnings.push('The pass is valid for more than twelve hours. An attendant’s pass is the only one that runs into days, and it is named on the bed rather than at the gate.');

  if (purpose?.code === 'VST-WARD' || purpose?.code === 'VST-ATTEND') {
    const hour = Number(draft.nowIso.slice(11, 13)) * 60 + Number(draft.nowIso.slice(14, 16));
    const inMorning = hour >= 10 * 60 && hour <= 12 * 60 + 30;
    const inEvening = hour >= 16 * 60 && hour <= 18 * 60 + 30;
    if (!inMorning && !inEvening) {
      warnings.push(
        'Outside the ward visiting hours (11:00–12:30 and 17:00–18:30). The ward can still accept the visit — a patient going home, a family arriving from another district — and the pass records that the ward was asked.',
      );
    }
  }

  const samePatient = draft.accompanying.trim() ? draft.day.filter((p) => p.accompanying === draft.accompanying.trim() && p.state !== 'Out').length : 0;
  if (samePatient >= MAX_VISITORS_PER_PATIENT) {
    warnings.push(`${samePatient} people are already with patient ${draft.accompanying.trim()}. Beyond ${MAX_VISITORS_PER_PATIENT} the bay becomes a corridor, and the ward will send one of them back down.`);
  }
  if (draft.vehicle.trim()) warnings.push(`Vehicle ${draft.vehicle.trim()} recorded: the back gate keeps the vehicle count at shift change, and the pass is what it reads.`);
  if (draft.itemsIn.trim() && !draft.note.trim()) warnings.push('Items are recorded coming in but the pass says nothing about coming out. The gate is where a hospital’s stock leaves.');
  if (draft.escorts.trim()) warnings.push(`An escort is recorded: ${draft.escorts.trim()}. The pass is valid while somebody from the hospital is walking with them.`);

  return { ok: reasons.length === 0, reasons, warnings };
}
