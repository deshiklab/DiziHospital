/* -----------------------------------------------------------------------------
 * Blood bank.
 *
 * Rules this file takes seriously, because in this corner of the hospital they are not preferences:
 *  - **Compatibility is a matrix, not a ranking.** O negative gives red cells to everybody; AB positive takes
 *    everybody's. Plasma is the other way round. Getting one of those backwards is a transfusion reaction.
 *  - **A unit has an identity.** Bag number, group, component, collection date, expiry and the donor it came
 *    from travel with it from the donor chair to the bedside, and afterwards the unit must still be traceable
 *    back from the patient to the donor. Look-back is impossible without it.
 *  - **Once it leaves the bank it is out of the chain.** A unit that has been out for more than 30 minutes
 *    cannot come back into issue stock, whatever its temperature log says. It is quarantined, not restocked.
 *  - **Nothing is thrown away silently.** Every discarded unit has a reason and a person who recorded it, and
 *    wastage is reported, because a discarded unit is a donor's afternoon.
 */

export type BloodGroup = 'O−' | 'O+' | 'A−' | 'A+' | 'B−' | 'B+' | 'AB−' | 'AB+';
export type Component = 'WB' | 'PRBC' | 'FFP' | 'PLT' | 'CRYO';
export type UnitState = 'available' | 'reserved' | 'issued' | 'quarantined' | 'discarded' | 'transfused';

export const BLOOD_GROUPS: BloodGroup[] = ['O−', 'O+', 'A−', 'A+', 'B−', 'B+', 'AB−', 'AB+'];

/** Which components are transfused for compatibility purposes: red cells behave one way, plasma the other. */
export const COMPONENT_LABEL: Record<Component, string> = {
  WB: 'Whole blood',
  PRBC: 'Packed red cells',
  FFP: 'Fresh frozen plasma',
  PLT: 'Platelet concentrate',
  CRYO: 'Cryoprecipitate',
};

/** ABO antigens and antibodies, which is what the matrix below is derived from. */
const ANTIGENS: Record<BloodGroup, string[]> = {
  'O−': [], 'O+': [], 'A−': ['A'], 'A+': ['A'], 'B−': ['B'], 'B+': ['B'], 'AB−': ['A', 'B'], 'AB+': ['A', 'B'],
};
const ANTIBODIES: Record<BloodGroup, string[]> = {
  'O−': ['anti-A', 'anti-B'], 'O+': ['anti-A', 'anti-B'],
  'A−': ['anti-B'], 'A+': ['anti-B'],
  'B−': ['anti-A'], 'B+': ['anti-A'],
  'AB−': [], 'AB+': [],
};

const groupBase = (g: BloodGroup) => g.replace(/[+−]$/, '');
const isRhNegative = (g: BloodGroup) => g.endsWith('−');

/** A plasma donor may not carry antibodies against the recipient's antigens. */
function plasmaCompatible(donor: BloodGroup, recipient: BloodGroup): boolean {
  return ANTIBODIES[donor].every((ab) => {
    const against = ab.replace('anti-', '');
    return !ANTIGENS[recipient].includes(against);
  });
}

export interface Compatibility {
  compatible: boolean;
  /** Why it works, or precisely what would clash. Shown on the request, not in a log. */
  because: string;
  /** The same group, either Rhesus: the option a counter prefers when it is available. */
  preferred: boolean;
}

/**
 * Can a unit of `donor` be given to `recipient` for this component?
 * Red cells: the donor's antigens must not meet the patient's antibodies, and Rh− patients get Rh− units.
 * Plasma and cryo: the reverse — the donor's antibodies must not meet the patient's antigens.
 */
export function compatibility(component: Component, donor: BloodGroup, recipient: BloodGroup): Compatibility {
  if (component === 'FFP' || component === 'CRYO' || component === 'PLT') {
    const ok = plasmaCompatible(donor, recipient);
    return {
      compatible: ok,
      preferred: groupBase(donor) === groupBase(recipient) && isRhNegative(donor) === isRhNegative(recipient),
      because: ok
        ? `${COMPONENT_LABEL[component]} carries ${donor}'s antibodies (${ANTIBODIES[donor].join(', ') || 'none'}), which do not react with ${recipient} cells (antigens ${ANTIGENS[recipient].join(', ') || 'none'}).`
        : `${donor} plasma carries ${ANTIBODIES[donor].join(' and ')}, which would react with the patient's ${recipient} red cells.`,
    };
  }

  const antigenClash = ANTIGENS[donor].find((a) => ANTIBODIES[recipient].includes(`anti-${a}`));
  if (antigenClash) {
    return {
      compatible: false,
      preferred: false,
      because: `${donor} red cells carry the ${antigenClash} antigen; a ${recipient} patient has anti-${antigenClash}, so this unit would be destroyed on transfusion.`,
    };
  }
  if (isRhNegative(recipient) && !isRhNegative(donor)) {
    return {
      compatible: false,
      preferred: false,
      because: `${recipient} patients receive Rh negative red cells — an Rh positive unit risks sensitisation, and for a woman of child-bearing age it risks the next pregnancy.`,
    };
  }
  return {
    compatible: true,
    preferred: groupBase(donor) === groupBase(recipient) && isRhNegative(donor) === isRhNegative(recipient),
    because: `${donor} red cells carry no antigen the ${recipient} patient has antibodies against (${ANTIBODIES[recipient].join(', ') || 'none'}).`,
  };
}

/** Which donor groups may give red cells to this patient, in the order a blood bank would look. */
export function acceptableDonors(component: Component, recipient: BloodGroup): BloodGroup[] {
  const all = BLOOD_GROUPS.filter((g) => compatibility(component, g, recipient).compatible);
  return all.sort((a, b) => {
    const pa = compatibility(component, a, recipient).preferred ? 0 : 1;
    const pb = compatibility(component, b, recipient).preferred ? 0 : 1;
    return pa - pb || a.localeCompare(b);
  });
}

/* ------------------------------------------------------------------ shelf life */

export const SHELF_LIFE_DAYS: Record<Component, number> = { WB: 35, PRBC: 42, FFP: 365, PLT: 5, CRYO: 365 };
/** Plasma that has been thawed must be used or discarded: it cannot be refrozen. */
export const THAWED_HOURS = 24;
/** Minutes between a unit leaving the fridge and the transfusion starting. */
export const OUT_OF_FRIDGE_MINUTES = 30;
/** A transfusion runs for at most this long once started. */
export const TRANSFUSION_MAX_HOURS = 4;

export const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const minutesBetween = (a: string, b: string): number => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

/** Below this, the board says the group is short before somebody walks in looking for it. */
export const LOW_STOCK_UNITS: Record<Component, number> = { WB: 2, PRBC: 4, FFP: 3, PLT: 2, CRYO: 2 };
/** Within this many days of expiry a unit is offered first and flagged. */
export const EXPIRY_WARN_DAYS = 7;

/* ------------------------------------------------------------------ records */

export interface Donor {
  id: string;
  /** Voluntary, replacement or camp: the reason the register exists and the reason a recall can happen. */
  kind: 'Voluntary' | 'Replacement' | 'Camp';
  age: number;
  sex: 'M' | 'F';
  group: BloodGroup;
  lastDonation?: string;
  donations: number;
  phone: string;
  /** Non-null when the donor was turned away, with the reason — safe deferrals are part of the record. */
  deferred?: { because: string; until?: string };
}

export interface BloodUnit {
  id: string;
  bag: string;
  component: Component;
  group: BloodGroup;
  donorId: string;
  collectedOn: string;
  expiresOn: string;
  state: UnitState;
  /** Set when the unit is reserved or issued, so a bag is never in two places. */
  forPatient?: string;
  requestId?: string;
  issuedAt?: string;
  /** The cold chain, as recorded by whoever handled it. */
  temperature: string;
  note?: string;
  discardedBecause?: string;
  reaction?: { at: string; kind: string; action: string };
}

export interface CrossMatchRequest {
  id: string;
  patientMrn: string;
  patientName: string;
  group: BloodGroup;
  component: Component;
  units: number;
  ward: string;
  requestedBy: string;
  at: string;
  indication: string;
  /** Haematology in numbers and words: the reason a transfusion is justified, recorded before it happens. */
  hb?: number;
  platelets?: number;
  inr?: number;
  /** When the sample was taken. A cross-match on a stale sample is repeated, not carried forward. */
  sampleTakenOn: string;
  antibodyScreen: 'negative' | 'positive' | 'pending';
  urgency: 'Routine' | 'Urgent' | 'Emergency (uncrossmatched)';
  state: 'Requested' | 'Cross-matched' | 'Issued' | 'Transfused' | 'Cancelled';
  units_issued: string[];
}

/** Sample viability: three days, and it resets with every transfusion or pregnancy. */
export const SAMPLE_VALID_DAYS = 3;

export interface SampleCheck {
  ok: boolean;
  problem?: string;
}

export function checkSample(req: CrossMatchRequest, dayIso: string): SampleCheck {
  const age = daysBetween(req.sampleTakenOn, dayIso);
  if (age < 0) return { ok: false, problem: 'The sample is dated in the future — a typo at the bedside, not a valid cross-match.' };
  if (age > SAMPLE_VALID_DAYS) {
    return {
      ok: false,
      problem: `The sample is ${age} days old. A sample is good for ${SAMPLE_VALID_DAYS} days, because antibodies can appear after a previous transfusion or pregnancy — collect a fresh one.`,
    };
  }
  if (req.antibodyScreen === 'positive') {
    return { ok: false, problem: 'The antibody screen is positive: this needs the reference laboratory and antigen-negative units, not a routine cross-match.' };
  }
  if (req.antibodyScreen === 'pending') {
    return { ok: false, problem: 'The antibody screen has not come back. Issue waits for it — this is the step that prevents a delayed reaction.' };
  }
  return { ok: true };
}

/** Whether the numbers justify the request. Recorded as advice: a bleeding patient is transfused. */
export function transfusionThreshold(req: CrossMatchRequest): { meets: boolean; note: string } {
  if (req.component === 'PRBC' || req.component === 'WB') {
    const hb = req.hb;
    if (hb === undefined) return { meets: true, note: 'No haemoglobin recorded — the indication field carries the justification.' };
    if (hb < 7) return { meets: true, note: `Haemoglobin ${hb} g/dL is below the restrictive threshold of 7 — red cells are indicated.` };
    if (hb < 10) return { meets: true, note: `Haemoglobin ${hb} g/dL is above the restrictive threshold: indicated if the patient is symptomatic, bleeding or has cardiac disease, and worth a second look if not.` };
    return { meets: false, note: `Haemoglobin ${hb} g/dL does not usually need red cells; a single-unit transfusion above 10 g/dL is the classic avoidable one.` };
  }
  if (req.component === 'PLT') {
    const p = req.platelets;
    if (p === undefined) return { meets: true, note: 'No platelet count recorded — the indication field carries the justification.' };
    if (p < 10) return { meets: true, note: `Platelets ${p} ×10⁹/L — prophylactic platelets are indicated.` };
    if (p < 50) return { meets: true, note: `Platelets ${p} ×10⁹/L — indicated before a procedure or if bleeding.` };
    return { meets: false, note: `Platelets ${p} ×10⁹/L do not usually need a transfusion; check whether a procedure is planned.` };
  }
  if (req.component === 'FFP' || req.component === 'CRYO') {
    const inr = req.inr;
    if (inr === undefined) return { meets: true, note: 'No coagulation result recorded — the indication field carries the justification.' };
    if (inr >= 1.5) return { meets: true, note: `INR ${inr} with bleeding or a planned procedure — plasma is indicated.` };
    return { meets: false, note: `INR ${inr} does not need plasma on the number alone; give it for bleeding, not for a number.` };
  }
  return { meets: true, note: 'Whole blood is used where components are not available; red cells are the modern equivalent.' };
}

/* ------------------------------------------------------------------ the day's register */

export interface StockLine {
  group: BloodGroup;
  component: Component;
  units: number;
  /** The soonest expiry in the group/component, so the board shows what to use first. */
  nextExpiry?: string;
  /** Units inside the warning window. */
  expiring: number;
  low: boolean;
}

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const DONOR_PHONES = ['01711', '01812', '01913', '01614', '01515'];
const NAMES = [
  'A. Karim', 'N. Sultana', 'M. Hossain', 'R. Akter', 'S. Islam', 'T. Chowdhury', 'J. Begum', 'K. Mia',
  'F. Rahman', 'D. Barua', 'P. Das', 'H. Uddin', 'L. Khatun', 'B. Alam', 'G. Sen', 'W. Molla',
];

export interface BloodBankDay {
  dayIso: string;
  donors: Donor[];
  /** Units in the bank right now: available, reserved, issued, quarantined — everything not yet finished. */
  units: BloodUnit[];
  /** Today's cross-match requests, oldest first. */
  requests: CrossMatchRequest[];
  /** Units transfused today, and any reaction. */
  transfused: BloodUnit[];
  discarded: BloodUnit[];
  stock: StockLine[];
  stats: {
    unitsOnShelf: number;
    available: number;
    reserved: number;
    issued: number;
    expiring: number;
    donorsToday: number;
    donationsToday: number;
    requestsOpen: number;
    unitsIssuedToday: number;
    unitsTransfusedToday: number;
    discardRate: number;
    groupsBelow: number;
    reactions: number;
    crossmatchToIssueMinutes: number;
  };
}

const SEED = 20261_014;
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length];

/**
 * A working day in the blood bank, computed from the date so two people looking at the same day see the same
 * numbers. The shortages are deliberate: one group is at zero, one unit expires tomorrow, one request is
 * two days on a sample that has gone stale, and one unit came back from theatre and cannot be restocked.
 */
export function bloodBankDay(dayIso: string): BloodBankDay {
  const r = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), SEED) * 7919);
  const groups = BLOOD_GROUPS;
  const components: Component[] = ['PRBC', 'PRBC', 'PRBC', 'FFP', 'PLT', 'WB', 'CRYO'];

  const donors: Donor[] = [];
  const units: BloodUnit[] = [];
  let bagSeq = 4100;

  // 9 donors today, 7 accepted, 2 deferred — and the deferrals matter as much as the donations.
  for (let i = 0; i < 9; i += 1) {
    const group = pick(r, groups);
    const isMale = r() > 0.35;
    const donor: Donor = {
      id: `dn-${dayIso.replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`,
      kind: r() > 0.75 ? 'Replacement' : r() > 0.85 ? 'Camp' : 'Voluntary',
      age: 20 + Math.floor(r() * 25),
      sex: isMale ? 'M' : 'F',
      group,
      donations: 1 + Math.floor(r() * 14),
      phone: `${pick(r, DONOR_PHONES)}-${String(100000 + Math.floor(r() * 899999))}`,
      lastDonation: r() > 0.5 ? addDays(dayIso, -(95 + Math.floor(r() * 300))) : undefined,
    };
    if (i === 7) {
      donor.deferred = { because: 'Haemoglobin 11.4 g/dL — below the 12.5 g/dL donation threshold', until: addDays(dayIso, 60) };
    } else if (i === 8) {
      donor.deferred = { because: 'Donated 62 days ago; the interval is 90 days', until: addDays(dayIso, 28) };
    }
    donors.push(donor);
    if (donor.deferred) continue;

    // One donation splits into components; the donor is traceable from every bag.
    const parts: Component[] = r() > 0.5 ? ['PRBC', 'FFP', 'PLT'] : ['PRBC', 'FFP'];
    parts.forEach((component, k) => {
      bagSeq += 1;
      const expiresOn = addDays(dayIso, SHELF_LIFE_DAYS[component]);
      units.push({
        id: `bu-${bagSeq}`,
        bag: `BB-${dayIso.slice(2, 4)}${dayIso.slice(5, 7)}-${bagSeq}`,
        component,
        group,
        donorId: donor.id,
        collectedOn: dayIso,
        expiresOn,
        state: 'available',
        temperature: component === 'PLT' ? '22 °C · agitated' : component === 'FFP' ? '−32 °C' : '4 °C',
      });
      void k;
    });
  }

  // Older stock already on the shelf, with expiries spread across the fortnight — and two on the edge.
  const existing: Array<[BloodGroup, Component, string]> = [
    ['O−', 'PRBC', addDays(dayIso, -39)], ['O−', 'PRBC', addDays(dayIso, -1)], ['O+', 'PRBC', addDays(dayIso, -20)],
    ['O+', 'PRBC', addDays(dayIso, -12)], ['A+', 'PRBC', addDays(dayIso, -30)], ['A+', 'PRBC', addDays(dayIso, -8)],
    ['A−', 'PRBC', addDays(dayIso, -25)], ['B+', 'PRBC', addDays(dayIso, -14)], ['B−', 'PRBC', addDays(dayIso, -6)],
    ['AB+', 'PRBC', addDays(dayIso, -33)], ['O+', 'FFP', addDays(dayIso, -330)], ['A+', 'FFP', addDays(dayIso, -300)],
    ['B+', 'FFP', addDays(dayIso, -340)], ['AB+', 'FFP', addDays(dayIso, -310)], ['O+', 'PLT', addDays(dayIso, -3)],
    ['A+', 'PLT', addDays(dayIso, -2)], ['O−', 'WB', addDays(dayIso, -20)], ['B+', 'CRYO', addDays(dayIso, -200)],
    ['A+', 'CRYO', addDays(dayIso, -180)],
  ];
  existing.forEach(([group, component, collectedOn]) => {
    bagSeq += 1;
    units.push({
      id: `bu-${bagSeq}`,
      bag: `BB-${collectedOn.slice(2, 4)}${collectedOn.slice(5, 7)}-${bagSeq}`,
      component,
      group,
      donorId: `dn-${collectedOn.replace(/-/g, '')}-01`,
      collectedOn,
      expiresOn: addDays(collectedOn, SHELF_LIFE_DAYS[component]),
      state: 'available',
      temperature: component === 'PLT' ? '22 °C · agitated' : component === 'FFP' || component === 'CRYO' ? '−32 °C' : '4 °C',
    });
  });

  /* ---------------------------------------------------------------- the day's requests */

  const requests: CrossMatchRequest[] = [
    {
      id: 'XR-2681', patientMrn: 'SH-102311', patientName: 'Rahima Begum', group: 'B+', component: 'PRBC', units: 2,
      ward: 'Medicine Ward A · bed A-07', requestedBy: 'Dr T. Chowdhury', at: `${dayIso}T08:20`, urgency: 'Routine',
      indication: 'Symptomatic anaemia, Hb 6.4 g/dL on the ward round', hb: 6.4, sampleTakenOn: dayIso, antibodyScreen: 'negative',
      state: 'Cross-matched', units_issued: [],
    },
    {
      id: 'XR-2682', patientMrn: 'SH-104088', patientName: 'Abdul Malek', group: 'O+', component: 'PRBC', units: 1,
      ward: 'Surgery Ward B · bed B-03', requestedBy: 'Dr S. Islam', at: `${dayIso}T09:05`, urgency: 'Urgent',
      indication: 'Post-operative drop in haemoglobin, Hb 7.2 g/dL', hb: 7.2, sampleTakenOn: dayIso, antibodyScreen: 'negative',
      state: 'Requested', units_issued: [],
    },
    {
      id: 'XR-2683', patientMrn: 'SH-100902', patientName: 'Salma Khatun', group: 'A+', component: 'FFP', units: 2,
      ward: 'High Dependency Unit · bed H-02', requestedBy: 'Dr N. Sultana', at: `${dayIso}T09:40`, urgency: 'Urgent',
      indication: 'Coagulopathy with active bleeding, INR 2.1', inr: 2.1, sampleTakenOn: dayIso, antibodyScreen: 'negative',
      state: 'Requested', units_issued: [],
    },
    {
      id: 'XR-2684', patientMrn: 'SH-101177', patientName: 'Nazma Akter', group: 'O−', component: 'PRBC', units: 2,
      ward: 'Maternity Ward C · bed C-04', requestedBy: 'Dr R. Begum', at: `${dayIso}T07:15`, urgency: 'Emergency (uncrossmatched)',
      indication: 'Post-partum haemorrhage, unstable — O negative issued while cross-match runs', hb: 5.8, sampleTakenOn: dayIso, antibodyScreen: 'pending',
      state: 'Issued', units_issued: [],
    },
    {
      id: 'XR-2685', patientMrn: 'SH-103455', patientName: 'Jamal Uddin', group: 'AB+', component: 'PLT', units: 1,
      ward: 'Medicine Ward A · bed A-12', requestedBy: 'Dr K. Mia', at: `${dayIso}T10:30`, urgency: 'Routine',
      indication: 'Platelet count 8 ×10⁹/L after chemotherapy', platelets: 8, sampleTakenOn: addDays(dayIso, -4), antibodyScreen: 'negative',
      state: 'Requested', units_issued: [],
    },
    {
      id: 'XR-2686', patientMrn: 'SH-102311', patientName: 'Rahima Begum', group: 'B+', component: 'PRBC', units: 1,
      ward: 'Medicine Ward A · bed A-07', requestedBy: 'Dr T. Chowdhury', at: `${dayIso}T11:10`, urgency: 'Routine',
      indication: 'Second unit after the post-transfusion count', hb: 8.1, sampleTakenOn: dayIso, antibodyScreen: 'positive',
      state: 'Requested', units_issued: [],
    },
  ];

  /* ---------------------------------------------------------------- allocations and the day's traffic */

  // XR-2684: emergency O negative, issued at 07:40. Two units out of the fridge, one started.
  const oNeg = units.filter((u) => u.group === 'O−' && u.component === 'PRBC');
  const issuedUnits: BloodUnit[] = [];
  if (oNeg[0]) {
    oNeg[0].state = 'issued';
    oNeg[0].forPatient = 'SH-101177';
    oNeg[0].requestId = 'XR-2684';
    oNeg[0].issuedAt = `${dayIso}T07:40`;
    oNeg[0].note = 'Emergency release, uncrossmatched; cross-match completed afterwards';
    issuedUnits.push(oNeg[0]);
    requests[3].units_issued = [oNeg[0].id];
  }
  if (oNeg[1]) {
    oNeg[1].state = 'reserved';
    oNeg[1].forPatient = 'SH-101177';
    oNeg[1].requestId = 'XR-2684';
    oNeg[1].note = 'Held for the second unit';
  }

  // XR-2681: cross-matched and compatible units reserved, tagged for the patient.
  const forRahima = units.filter((u) => u.component === 'PRBC' && u.state === 'available' && compatibility('PRBC', u.group, 'B+').compatible);
  forRahima.slice(0, 2).forEach((u) => {
    u.state = 'reserved';
    u.forPatient = 'SH-102311';
    u.requestId = 'XR-2681';
    u.note = `Cross-matched for ${'Rahima Begum'} · compatible (${u.group})`;
    requests[0].units_issued.push(u.id);
  });

  // One unit already transfused this morning, with its temperature and time recorded.
  const early = units.find((u) => u.state === 'available' && u.group === 'A+' && u.component === 'PRBC');
  let transfused: BloodUnit[] = [];
  if (early) {
    early.state = 'transfused';
    early.forPatient = 'SH-103455';
    early.requestId = 'XR-2679';
    early.issuedAt = `${dayIso}T06:55`;
    early.note = 'Transfused 07:10–08:25, no reaction; vitals at 15-minute intervals';
    transfused = [early];
  }

  // A unit came back from theatre after 50 minutes out: quarantined, never restocked.
  const back = units.find((u) => u.state === 'available' && u.component === 'PRBC' && u.group === 'A+');
  if (back) {
    back.state = 'quarantined';
    back.note = `Returned from theatre after ${'58'} minutes out of the bank — the cold chain is broken, so it is quarantined pending the in-charge's decision.`;
  }

  // And one unit in a previous month was discarded, with the reason recorded.
  const discarded: BloodUnit[] = [{
    id: 'bu-3901', bag: 'BB-2608-3901', component: 'PLT', group: 'B+', donorId: 'dn-20260812-04',
    collectedOn: addDays(dayIso, -12), expiresOn: addDays(dayIso, -7), state: 'discarded', temperature: '22 °C · agitated',
    discardedBecause: 'Expired on the shelf — no platelet request in the last four days', note: 'Recorded by the blood bank in-charge; donor notified per the standing procedure',
  }];

  /* ---------------------------------------------------------------- the board */

  const live = [...units, ...discarded];
  const stock: StockLine[] = [];
  groups.forEach((group) => {
    (['PRBC', 'FFP', 'PLT', 'WB', 'CRYO'] as Component[]).forEach((component) => {
      const mine = live.filter((u) => u.group === group && u.component === component && (u.state === 'available' || u.state === 'reserved'));
      if (!mine.length) return;
      const nextExpiry = mine.map((u) => u.expiresOn).sort()[0];
      const expiring = mine.filter((u) => daysBetween(dayIso, u.expiresOn) <= EXPIRY_WARN_DAYS).length;
      stock.push({
        group,
        component,
        units: mine.length,
        nextExpiry,
        expiring,
        low: mine.filter((u) => u.state === 'available').length < LOW_STOCK_UNITS[component],
      });
    });
  });

  const available = units.filter((u) => u.state === 'available');
  const reserved = units.filter((u) => u.state === 'reserved');
  const issued = units.filter((u) => u.state === 'issued');
  const expiring = units.filter((u) => daysBetween(dayIso, u.expiresOn) <= EXPIRY_WARN_DAYS).length;
  const unitsIssuedToday = issued.length + transfused.length;
  const openRequests = requests.filter((q) => q.state === 'Requested' || q.state === 'Cross-matched').length;

  return {
    dayIso,
    donors,
    units,
    requests,
    transfused,
    discarded,
    stock,
    stats: {
      unitsOnShelf: available.length + reserved.length,
      available: available.length,
      reserved: reserved.length,
      issued: issued.length,
      expiring,
      donorsToday: donors.length,
      donationsToday: donors.filter((d) => !d.deferred).length,
      requestsOpen: openRequests,
      unitsIssuedToday,
      unitsTransfusedToday: transfused.length,
      discardRate: Math.round((discarded.length / (discarded.length + unitsIssuedToday + transfused.length || 1)) * 1000) / 10,
      groupsBelow: stock.filter((s) => s.low).length,
      reactions: units.filter((u) => u.reaction).length,
      crossmatchToIssueMinutes: 42,
    },
  };
}

/** Look-back: from a patient back to the donors, and from a donor forward to every patient. */
export function trace(day: BloodBankDay, key: { mrn?: string; unitId?: string; donorId?: string }): {
  units: BloodUnit[];
  patients: string[];
  donors: string[];
  notes: string[];
} {
  const units = key.unitId
    ? day.units.filter((u) => u.id === key.unitId || u.bag === key.unitId)
    : key.donorId
      ? day.units.filter((u) => u.donorId === key.donorId)
      : day.units.filter((u) => u.forPatient === key.mrn);
  const donors = [...new Set(units.map((u) => u.donorId))];
  const patients = [...new Set(units.map((u) => u.forPatient).filter(Boolean) as string[])];
  const notes = [
    'Every unit keeps the donor it came from, so a positive screen on a donor recalls the bags and finds the patients they reached.',
    'Every unit keeps the patient it went to, so a reaction in a patient finds the donors behind it.',
    ...(units.some((u) => u.reaction) ? ['A unit in this chain recorded a reaction: the lot is looked at as a group, not unit by unit.'] : []),
  ];
  return { units, patients, donors, notes };
}

/* ------------------------------------------------------------------ the day's rules, written down */

export const BLOOD_RULES: Array<{ title: string; because: string }> = [
  {
    title: 'Two people, two numbers',
    because: 'The bag number, the group on the bag and the group on the patient’s wristband are read aloud by the nurse and repeated by a second person before the cannula is connected. Wrong-patient transfusion is the error that kills people who were only mildly anaemic.',
  },
  {
    title: 'A sample is good for three days',
    because: 'Antibodies from a previous transfusion or pregnancy can appear days later; yesterday’s cross-match on last week’s sample is not a cross-match.',
  },
  {
    title: 'Start within 30 minutes',
    because: 'A unit out of the fridge warms up, and bacteria that were dormant in it are not. If the transfusion has not started within 30 minutes, the unit goes back to the bank for a decision — and if it has been out longer, it is quarantined.',
  },
  {
    title: 'Four hours, then stop',
    because: 'A transfusion that has been running for more than four hours is both a bacterial risk and a sign that the patient was not monitored. The remainder is discarded, not paused and resumed.',
  },
  {
    title: 'Observe at 15 minutes',
    because: 'A haemolytic reaction shows itself early — fever, chills, loin pain, a fall in blood pressure. The first 15 minutes are the ones that decide the outcome.',
  },
  {
    title: 'No unit comes back into stock',
    because: 'Once a unit is out of the bank it may not be reissued, whatever its temperature chart says. Quarantine with a decision recorded is the honest path.',
  },
  {
    title: 'Nothing discarded without a reason',
    because: 'Wastage is reported and explained: each discarded unit is a donor’s afternoon and somebody’s money, and the trend tells the bank whether it is collecting the wrong components.',
  },
];

/** Deferral rules the donor chair applies, as the screening form reads them. */
export const DONOR_CRITERIA: Array<{ rule: string; value: string; because: string }> = [
  { rule: 'Age', value: '18–60 years', because: 'Outside this the donation is referred to a physician.' },
  { rule: 'Weight', value: '≥ 50 kg', because: 'A donor below this carries a real risk of a reaction from the volume taken.' },
  { rule: 'Haemoglobin', value: '≥ 12.5 g/dL', because: 'Donating below this harms the donor and gives a unit that is not much use.' },
  { rule: 'Interval', value: '90 days', because: 'Iron stores take about three months to recover.' },
  { rule: 'Blood pressure', value: '100/60 – 180/100', because: 'Outside this the donor is deferred for the day, not forever.' },
  { rule: 'Pulse', value: '60–100 /min', because: 'Fever or an arrhythmia shows up here before the donation.' },
  { rule: 'Recent tattoo or piercing', value: '6 months', because: 'Hepatitis B and C window period.' },
  { rule: 'Pregnancy or breastfeeding', value: 'deferred', because: 'The donor’s own iron demand comes first.' },
];

/** Groups a replacement-donor request should chase: nobody in the bank carries this component for this group. */
export function shortGroups(day: BloodBankDay, component: Component): BloodGroup[] {
  return BLOOD_GROUPS.filter((g) => {
    const line = day.stock.find((s) => s.group === g && s.component === component);
    return !line || line.units - line.expiring < LOW_STOCK_UNITS[component];
  });
}
