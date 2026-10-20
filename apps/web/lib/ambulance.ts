/* -----------------------------------------------------------------------------
 * Ambulance.
 *
 * The legacy screen (`admin/vehicle/getcallambulance`) was a log: who called, which van went, when it came back.
 * A log cannot answer the two questions that matter — *is a vehicle actually available in the next ten minutes*
 * and *why did the response take twenty-eight minutes* — so this module keeps the same records and adds the
 * rules that make them answerable:
 *
 *  - **A vehicle is in exactly one state.** Free, on a call, returning, or out of service with a reason and an
 *    expected return. Dispatching a vehicle that is already out is refused, not queued silently.
 *  - **Response time is measured at four points**: call received, vehicle dispatched, on scene, handover done.
 *    The number on the dashboard is the difference between real timestamps, never a remembered average.
 *  - **Emergency beats booked transfer.** A booked transfer that is dispatched ahead of a waiting emergency is a
 *    decision, and it is recorded as one.
 *  - **Every vehicle is checked before it leaves**, not after it fails: oxygen level, stretcher, suction, and the
 *    expiry on the drugs in the bag. A vehicle with a low cylinder is out of service for the next run.
 *  - **An infectious patient changes the state of the vehicle.** It is disinfected before the next patient, and
 *    the disinfection is recorded with a name and a time.
 *  - **A trip is billable**, so the fare lands on the patient's invoice with the trip id beside it.
 *
 * Preview: the log is synthetic and nothing survives a reload. The rules do.
 */

export type VehicleKind = 'ALS' | 'BLS' | 'Patient transport' | 'Mortuary van';
export type VehicleState = 'Free' | 'On a call' | 'Returning' | 'Under maintenance' | 'Decontamination';

export interface Vehicle {
  id: string;
  plate: string;
  kind: VehicleKind;
  model: string;
  /** The base it is parked at; a call is dispatched from the nearest free vehicle. */
  base: string;
  state: VehicleState;
  /** Odometer at the last fuelling, so fuel is a figure and not a guess. */
  odometer: number;
  /** What the cylinder reads, 0–100 %. Below 40 % the vehicle does not take a long transfer. */
  oxygenPct: number;
  stretcher: 'ok' | 'faulty';
  suction: 'ok' | 'faulty';
  /** The next service, by date or by kilometres, whichever comes first. */
  nextService: string;
  insuranceTo: string;
  fitnessTo: string;
  note?: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  licence: string;
  licenceTo: string;
  /** Hours driving today, which decides whether the next long run is legal and safe. */
  hoursToday: number;
  /** Training that changes what the crew may do. */
  firstAid: boolean;
  acls: boolean;
  onShift: boolean;
  /** Vehicles this driver may drive — an ALS van needs a driver trained on it. */
  kinds: VehicleKind[];
}

export type CallKind = 'Emergency' | 'Booked transfer' | 'Discharge drop' | 'Sample run' | 'Mortuary';
export type CallPriority = 'P1 — immediate' | 'P2 — within the hour' | 'P3 — booked time';

export interface AmbulanceCall {
  id: string;
  kind: CallKind;
  priority: CallPriority;
  /** Received, dispatched, on scene, handover — all four, or the response time is not comparable. */
  receivedAt: string;
  dispatchedAt?: string;
  onSceneAt?: string;
  handoverAt?: string;
  returnedAt?: string;
  from: string;
  to: string;
  patientMrn?: string;
  patientName?: string;
  /** The bedside picture: what the crew must be ready for. */
  complaint?: string;
  crew: { driverId: string; attendant: string };
  vehicleId?: string;
  state: 'Waiting' | 'Dispatched' | 'On scene' | 'Conveying' | 'Completed' | 'Cancelled';
  /** Recorded before departure, and the reason a vehicle may be refused. */
  checks?: { oxygenPct: number; stretcher: boolean; suction: boolean; bagSealedTo: string; at: string };
  infectious?: boolean;
  decontaminatedAt?: string;
  /** The fare as charged, and the tariff line it belongs to. */
  fare?: { base: number; perKm: number; km: number; waiting: number; total: number };
  note?: string;
}

/** Below this the vehicle is taken off long transfers until it is refilled. */
export const OXYGEN_FLOOR_PCT = 40;
/** Response targets in minutes, by priority: measured for the day and reported against them. */
export const RESPONSE_TARGET_MIN: Record<CallPriority, number> = {
  'P1 — immediate': 8,
  'P2 — within the hour': 30,
  'P3 — booked time': 0,
};
/** Turn-around between two patients: cleaning plus the check sheet. */
export const TURNAROUND_MIN = 12;
/** After an infectious patient the vehicle is decontaminated, which is why it leaves the pool. */
export const DECONTAMINATION_MIN = 45;
/** A driver's permitted driving in a day, after which a second driver is required. */
export const MAX_DRIVE_HOURS = 10;

export const FARE_TABLE: Array<{ kind: VehicleKind; base: number; perKm: number; note: string }> = [
  { kind: 'ALS', base: 2500, perKm: 65, note: 'With oxygen, monitor and a paramedic attendant.' },
  { kind: 'BLS', base: 1500, perKm: 45, note: 'With oxygen and a trained attendant.' },
  { kind: 'Patient transport', base: 800, perKm: 35, note: 'Non-acute transport, no monitoring.' },
  { kind: 'Mortuary van', base: 1200, perKm: 40, note: 'Charged to the family, never counted as an emergency response.' },
];

export const addMinutes = (iso: string, minutes: number): string => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 16);
};

export const minutesBetween = (a?: string, b?: string): number | null => {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
};

/** Where the response time stands: received → on scene for an emergency, received → dispatched for a booked run. */
export function responseMinutes(call: AmbulanceCall): number | null {
  const end = call.priority === 'P1 — immediate' ? call.onSceneAt : call.dispatchedAt ?? call.onSceneAt;
  return minutesBetween(call.receivedAt, end);
}

export interface ResponseVerdict {
  measured: number | null;
  target: number;
  verdict: 'met' | 'missed' | 'pending' | 'not measured';
  text: string;
}

export function responseVerdict(call: AmbulanceCall): ResponseVerdict {
  const measured = responseMinutes(call);
  if (call.priority === 'P3 — booked time') {
    return { measured, target: 0, verdict: 'not measured', text: 'A booked run is measured against the time that was promised, not a target.' };
  }
  const target = RESPONSE_TARGET_MIN[call.priority];
  if (measured === null) {
    return { measured: null, target, verdict: 'pending', text: `Nothing is measured until the vehicle is on scene. The target is ${target} minutes.` };
  }
  return measured <= target
    ? { measured, target, verdict: 'met', text: `${measured} minutes against a target of ${target}.`, }
    : { measured, target, verdict: 'missed', text: `${measured} minutes against a target of ${target} — ${measured - target} minutes late, and the reason belongs in the record.` };
}

export interface DispatchCheck {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

/** Everything that decides whether this vehicle and this driver may take this call. */
export function dispatchCheck(call: AmbulanceCall, vehicle: Vehicle | undefined, driver: Driver | undefined, dayIso: string): DispatchCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!vehicle) blockers.push('No vehicle is assigned.');
  else {
    if (vehicle.state !== 'Free') {
      blockers.push(`${vehicle.plate} is ${vehicle.state.toLowerCase()}${vehicle.note ? ` — ${vehicle.note}` : ''}. A vehicle is in one state at a time, so this call needs another one.`);
    }
    if (vehicle.oxygenPct < OXYGEN_FLOOR_PCT) {
      if (call.kind === 'Booked transfer' || call.kind === 'Emergency') blockers.push(`${vehicle.plate} is at ${vehicle.oxygenPct} % oxygen: below ${OXYGEN_FLOOR_PCT} % it does not take a patient who may need oxygen. Refill first.`);
      else warnings.push(`${vehicle.plate} is at ${vehicle.oxygenPct} % oxygen — take a spare cylinder.`);
    }
    if (vehicle.stretcher === 'faulty') blockers.push(`${vehicle.plate} has a faulty stretcher recorded. Nobody is conveyed on it.`);
    if (vehicle.suction === 'faulty' && (call.kind === 'Emergency' || call.kind === 'Booked transfer')) {
      blockers.push(`${vehicle.plate} has no working suction. For a patient who may aspirate, that is a refusal, not a risk to note.`);
    }
    if (vehicle.fitnessTo < dayIso) blockers.push(`${vehicle.plate} fitness certificate expired on ${vehicle.fitnessTo}.`);
    if (vehicle.insuranceTo < dayIso) warnings.push(`Insurance on ${vehicle.plate} expired ${vehicle.insuranceTo}; the vehicle is legal to move but the claim would not be.`);
  }

  if (!driver) blockers.push('No driver is assigned.');
  else {
    if (!driver.onShift) blockers.push(`${driver.name} is off shift.`);
    if (!driver.kinds.includes(vehicle?.kind ?? 'BLS')) blockers.push(`${driver.name} is not cleared for a ${vehicle?.kind ?? 'this'} vehicle.`);
    if (driver.hoursToday + 2 > MAX_DRIVE_HOURS) blockers.push(`${driver.name} has driven ${driver.hoursToday} h today; a run longer than ${MAX_DRIVE_HOURS - driver.hoursToday} h needs the second driver.`);
    if (driver.licenceTo < dayIso) blockers.push(`${driver.name}'s licence expired on ${driver.licenceTo}.`);
    if (call.kind === 'Emergency' && !driver.firstAid) warnings.push(`${driver.name} has no current first-aid certificate; the attendant carries the clinical work.`);
  }

  if (call.kind === 'Emergency' && vehicle && vehicle.kind === 'Patient transport') {
    warnings.push('A transport van answers an emergency only when nothing else is free — say so in the log.');
  }
  return { ok: blockers.length === 0, blockers, warnings };
}

/** Travel time for the fare and the arrival estimate: the local roads, not a motorway average. */
export function estimateMinutes(from: string, to: string): number {
  const seed = [...`${from}${to}`].reduce((a, c) => a + c.charCodeAt(0), 11);
  const km = 2 + (seed % 23);
  // 22 km/h in Dhaka traffic is optimistic on a good day; the estimate says what it assumed.
  return Math.max(6, Math.round((km / 22) * 60));
}

export interface AmbulanceDay {
  dayIso: string;
  vehicles: Vehicle[];
  drivers: Driver[];
  calls: AmbulanceCall[];
  stats: {
    callsToday: number;
    emergencies: number;
    running: number;
    waiting: number;
    completed: number;
    freeVehicles: number;
    outOfService: number;
    averageResponse: number | null;
    worstResponse: number | null;
    targetsMet: number;
    targetsMissed: number;
    missedReasons: Array<{ callId: string; text: string }>;
    fareToday: number;
    unbilled: number;
    lowOxygen: number;
    diversions: number;
  };
  reasonLog: Array<{ callId: string; text: string }>;
}

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const CREW = ['M. Rahman', 'S. Ahmed', 'N. Hossain', 'A. Islam', 'J. Uddin'];
const ATTENDANTS = ['Staff nurse R. Akter', 'Staff nurse T. Begum', 'Paramedic K. Das', 'Intern A. Haque'];
const AREAS = ['Mirpur 10', 'Kazipara', 'Shewrapara', 'Agargaon', 'Uttara Sector 7', 'Banani', 'Mohakhali', 'Gabtoli', 'Savar', 'Dhanmondi 27'];

export function ambulanceDay(dayIso: string): AmbulanceDay {
  const r = rng([...dayIso].reduce((a, c) => a + c.charCodeAt(0), 2026_1014) * 4871);

  const vehicles: Vehicle[] = [
    { id: 'vh-1', plate: 'DM-KHA-11-4402', kind: 'ALS', model: 'Toyota Hiace — ALS fit', base: 'Main gate', state: 'Free', odometer: 168_420, oxygenPct: 92, stretcher: 'ok', suction: 'ok', nextService: '2026-11-20', insuranceTo: '2027-03-31', fitnessTo: '2027-01-15' },
    { id: 'vh-2', plate: 'DM-KHA-11-4403', kind: 'BLS', model: 'Toyota Hiace — BLS fit', base: 'Emergency ramp', state: 'On a call', odometer: 132_905, oxygenPct: 68, stretcher: 'ok', suction: 'ok', nextService: '2026-11-02', insuranceTo: '2026-12-31', fitnessTo: '2026-12-01', note: 'On the emergency run B-2, out since 09:12' },
    { id: 'vh-3', plate: 'DM-KHA-11-4404', kind: 'BLS', model: 'Toyota Noah', base: 'Main gate', state: 'Returning', odometer: 98_113, oxygenPct: 24, stretcher: 'ok', suction: 'ok', nextService: '2026-10-28', insuranceTo: '2027-04-30', fitnessTo: '2027-02-20', note: 'Returning from a transfer; oxygen low' },
    { id: 'vh-4', plate: 'DM-KHA-11-4405', kind: 'Patient transport', model: 'Suzuki Every', base: 'OPD porch', state: 'Free', odometer: 64_880, oxygenPct: 76, stretcher: 'ok', suction: 'ok', nextService: '2026-12-05', insuranceTo: '2027-05-31', fitnessTo: '2027-03-10' },
    { id: 'vh-5', plate: 'DM-KHA-11-4406', kind: 'BLS', model: 'Toyota Hiace', base: 'Main gate', state: 'Under maintenance', odometer: 210_640, oxygenPct: 55, stretcher: 'faulty', suction: 'ok', nextService: '2026-10-14', insuranceTo: '2027-02-28', fitnessTo: '2026-11-30', note: 'Stretcher lock broken; workshop booked, back tomorrow' },
    { id: 'vh-6', plate: 'DM-KHA-11-4407', kind: 'Mortuary van', model: 'Suzuki Carry', base: 'Service lane', state: 'Free', odometer: 41_220, oxygenPct: 0, stretcher: 'ok', suction: 'ok', nextService: '2026-12-20', insuranceTo: '2027-06-30', fitnessTo: '2027-04-01' },
  ];

  const drivers: Driver[] = [
    { id: 'dr-1', name: 'M. Rahman', phone: '01711-220-101', licence: 'DK-4410-2231', licenceTo: '2028-04-30', hoursToday: 3.5, firstAid: true, acls: true, onShift: true, kinds: ['ALS', 'BLS'] },
    { id: 'dr-2', name: 'S. Ahmed', phone: '01812-330-204', licence: 'DK-4412-8890', licenceTo: '2027-09-30', hoursToday: 4.25, firstAid: true, acls: false, onShift: true, kinds: ['ALS', 'BLS', 'Patient transport'] },
    { id: 'dr-3', name: 'N. Hossain', phone: '01913-440-318', licence: 'DK-4415-1120', licenceTo: '2027-12-31', hoursToday: 9.5, firstAid: true, acls: false, onShift: true, kinds: ['BLS', 'Patient transport'] },
    { id: 'dr-4', name: 'A. Islam', phone: '01614-550-422', licence: 'DK-4419-7755', licenceTo: '2026-11-15', hoursToday: 1, firstAid: false, acls: false, onShift: true, kinds: ['Patient transport', 'BLS'] },
    { id: 'dr-5', name: 'J. Uddin', phone: '01515-660-539', licence: 'DK-4421-3344', licenceTo: '2027-06-30', hoursToday: 0, firstAid: true, acls: true, onShift: false, kinds: ['ALS', 'BLS', 'Patient transport'] },
  ];

  const calls: AmbulanceCall[] = [
    {
      id: 'AMB-4417', kind: 'Emergency', priority: 'P1 — immediate', receivedAt: `${dayIso}T07:52`, dispatchedAt: `${dayIso}T07:54`, onSceneAt: `${dayIso}T08:04`, handoverAt: `${dayIso}T08:31`, returnedAt: `${dayIso}T08:52`,
      from: 'Shewrapara, main road', to: 'Emergency department', patientMrn: 'SH-101177', patientName: 'Nazma Akter', complaint: 'Collapse with bleeding — obstetric',
      crew: { driverId: 'dr-1', attendant: ATTENDANTS[0] }, vehicleId: 'vh-1', state: 'Completed', infectious: false,
      checks: { oxygenPct: 92, stretcher: true, suction: true, bagSealedTo: '2027-01-31', at: `${dayIso}T07:54` },
      fare: { base: 2500, perKm: 65, km: 6, waiting: 0, total: 2890 },
      note: 'Response 12 minutes against a target of 8: the van was at the service lane fuelling when the call came.',
    },
    {
      id: 'AMB-4418', kind: 'Emergency', priority: 'P1 — immediate', receivedAt: `${dayIso}T09:12`, dispatchedAt: `${dayIso}T09:13`, onSceneAt: `${dayIso}T09:22`,
      from: 'Mohakhali bus terminal', to: 'Emergency department', patientMrn: 'SH-104088', patientName: 'Abdul Malek', complaint: 'Road traffic accident, head injury',
      crew: { driverId: 'dr-2', attendant: ATTENDANTS[2] }, vehicleId: 'vh-2', state: 'Conveying',
      checks: { oxygenPct: 68, stretcher: true, suction: true, bagSealedTo: '2026-11-30', at: `${dayIso}T09:13` },
      note: 'Running now; the ICU has been told an intubated patient is coming.',
    },
    {
      id: 'AMB-4419', kind: 'Booked transfer', priority: 'P3 — booked time', receivedAt: `${dayIso}T07:30`, dispatchedAt: `${dayIso}T08:05`, onSceneAt: `${dayIso}T08:05`, handoverAt: `${dayIso}T09:05`, returnedAt: `${dayIso}T10:02`,
      from: 'High Dependency Unit', to: 'National Institute of Cardiovascular Diseases', patientMrn: 'SH-100902', patientName: 'Salma Khatun', complaint: 'Transfer for angiography — stable on oxygen',
      crew: { driverId: 'dr-3', attendant: ATTENDANTS[1] }, vehicleId: 'vh-3', state: 'Completed',
      checks: { oxygenPct: 58, stretcher: true, suction: true, bagSealedTo: '2027-02-28', at: `${dayIso}T08:05` },
      fare: { base: 1500, perKm: 45, km: 9, waiting: 60, total: 2305 },
      note: 'Booked run: measured against the time promised (08:00), and it left five minutes late waiting for the referral note.',
    },
    {
      id: 'AMB-4420', kind: 'Booked transfer', priority: 'P2 — within the hour', receivedAt: `${dayIso}T10:20`, from: 'Medicine Ward A · bed A-12', to: 'Dhaka Medical College — oncology', patientMrn: 'SH-103455', patientName: 'Jamal Uddin', complaint: 'Febrile neutropenia, needs isolation on arrival',
      crew: { driverId: 'dr-5', attendant: ATTENDANTS[3] }, state: 'Waiting', infectious: true,
      note: 'Waiting for a vehicle: the only free van is at 24 % oxygen and the ALS van is cleaning after an infectious patient.',
    },
    {
      id: 'AMB-4421', kind: 'Discharge drop', priority: 'P3 — booked time', receivedAt: `${dayIso}T10:40`, from: 'Surgery Ward B', to: 'Kazipara, home', patientMrn: 'SH-102345', patientName: 'Rokeya Sultana',
      crew: { driverId: 'dr-4', attendant: ATTENDANTS[2] }, vehicleId: 'vh-4', state: 'Waiting',
      note: 'Booked for 11:30; the discharge summary must travel with the patient, not after them.',
    },
  ];

  const completed = calls.filter((c) => c.state === 'Completed');
  const responses = completed.map((c) => responseMinutes(c)).filter((n): n is number => n !== null);
  const emergencies = calls.filter((c) => c.kind === 'Emergency');
  const fareToday = calls.reduce((sum, c) => sum + (c.fare?.total ?? 0), 0);
  const unbilled = calls.filter((c) => c.state === 'Completed' && !c.fare).length;
  const lowOxygen = vehicles.filter((v) => v.oxygenPct > 0 && v.oxygenPct < OXYGEN_FLOOR_PCT).length;

  const reasonLog = [
    { callId: 'AMB-4417', text: 'Fuelling at the service lane when the call came — 12 minutes against a target of 8.' },
    { callId: 'AMB-4419', text: 'Left five minutes late waiting for the referral note to be signed.' },
    { callId: 'AMB-4420', text: 'Still waiting: the only free van is below the oxygen floor for a transfer, and the ALS van is decontaminating.' },
  ];

  return {
    dayIso,
    vehicles,
    drivers,
    calls,
    stats: {
      callsToday: calls.length,
      emergencies: emergencies.length,
      running: calls.filter((c) => c.state === 'Dispatched' || c.state === 'On scene' || c.state === 'Conveying').length,
      waiting: calls.filter((c) => c.state === 'Waiting').length,
      completed: completed.length,
      freeVehicles: vehicles.filter((v) => v.state === 'Free').length,
      outOfService: vehicles.filter((v) => v.state === 'Under maintenance' || v.state === 'Decontamination').length,
      averageResponse: responses.length ? Math.round((responses.reduce((a, b) => a + b, 0) / responses.length) * 10) / 10 : null,
      worstResponse: responses.length ? Math.max(...responses) : null,
      targetsMet: emergencies.filter((c) => responseVerdict(c).verdict === 'met').length,
      targetsMissed: emergencies.filter((c) => responseVerdict(c).verdict === 'missed').length,
      missedReasons: reasonLog,
      fareToday,
      unbilled,
      lowOxygen,
      diversions: vehicles.filter((v) => v.note?.toLowerCase().includes('service lane')).length,
    },
    reasonLog,
  };
}

/** Which free vehicle is the best answer to a call, and what the alternatives would cost in minutes. */
export function bestVehicle(call: AmbulanceCall, vehicles: Vehicle[]): { vehicle: Vehicle; minutes: number; because: string }[] {
  return vehicles
    .filter((v) => v.kind !== 'Mortuary van' || call.kind === 'Mortuary')
    .map((v) => {
      const minutes = estimateMinutes(call.from, v.base);
      const fits = (call.kind === 'Emergency' && (v.kind === 'ALS' || v.kind === 'BLS')) || (call.kind !== 'Emergency' && v.kind !== 'Mortuary van');
      const oxygenOk = v.oxygenPct >= OXYGEN_FLOOR_PCT;
      return {
        vehicle: v,
        minutes,
        because: [
          v.state === 'Free' ? `free at ${v.base}` : v.state.toLowerCase(),
          `${v.oxygenPct} % oxygen${oxygenOk ? '' : ` — below the ${OXYGEN_FLOOR_PCT} % floor`}`,
          fits ? `appropriate for a ${call.kind.toLowerCase()}` : `not the right vehicle for a ${call.kind.toLowerCase()}`,
        ].join(' · '),
      };
    })
    .sort((a, b) => {
      const score = (r: { vehicle: Vehicle; minutes: number; because: string }) =>
        (r.vehicle.state === 'Free' ? 0 : 100) + (r.vehicle.oxygenPct >= OXYGEN_FLOOR_PCT ? 0 : 10) + r.minutes;
      return score(a) - score(b);
    });
}
