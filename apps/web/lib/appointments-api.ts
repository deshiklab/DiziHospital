/* ----------------------------------------------------------------------------- the wire, not the screen
 *
 * The appointment screens were written against `lib/appointments.ts` — slot minutes, a status flow, a generator —
 * while the API that owns those numbers did not exist. It does now (`services/api`, P0-401), so this module is the
 * other half of that handover: it speaks the contract and hands the screens the *same shapes they already render*.
 *
 * Three rules it keeps, each of them learned from something in this repository:
 *
 *   1. **The path comes from the contract.** `operations.listAppointments.path` is generated from `openapi.json`, so a
 *      screen cannot call an endpoint nobody documented, and moving a path in the contract moves the call.
 *   2. **A refusal is a value, not a status code.** Every failure here becomes an `ApiProblem` — code, title, the
 *      sentence the desk reads, and the extras the contract puts beside the code (the alternatives a taken slot
 *      offers). A screen that branches on `response.status === 409` breaks the first time a code moves.
 *   3. **Instants cross in UTC and are read in the branch's zone.** The contract says `+00:00`; the desk says nine
 *      o'clock. `localMinutes()` is the one place that converts, and it takes the zone from the contract's own
 *      `x-dizi-scheduling.timezone` rather than from the browser: the branch's clock belongs to the branch, and a
 *      laptop set to another country must not move the day.
 *
 * The transport is the app's own proxy (`/api/dizi/...`), the only thing that knows the API's address. A page that
 * needs the API reachable *from the browser* is a page that works on one machine and breaks on every other.
 */

import { operations, type AppointmentCreate, type AppointmentPatch, type OperationMeta } from '@dizi/contracts/client';
import capabilities from '@dizi/contracts/capabilities.json';
import type { Appointment, AppointmentStatus, AppointmentType, Priority, Source } from './appointments';

/** The booking rules, as the contract publishes them. The screens read them; nothing here invents a number. */
export const SCHEDULING = capabilities.scheduling as unknown as {
  slotMinutes: number;
  window: { from: number; to: number };
  timezone: string;
  horizonDays: number;
  closedOn: string[];
  defaultCapacity: number;
};

/** Where the API is: nowhere. The proxy in front of it is same-origin by design. */
const BASE = '/api/dizi';

/** The header a write is replayed under, read from the contract rather than typed here. The contract publishes it as
    an object (`{name, requiredOn}`), not a bare string — reading it as one put the object itself into the header name
    and every write failed before it left the browser. */
const IDEMPOTENCY_HEADER = (capabilities.idempotencyHeader as unknown as { name: string }).name;

/** A refusal, in the contract's own vocabulary. */
export class ApiProblem extends Error {
  constructor(
    readonly code: string,
    readonly title: string,
    readonly status: number,
    readonly detail: string,
    readonly extras: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = 'ApiProblem';
  }

  /** The conflict the desk has to answer: somebody else took the slot a second ago. */
  get isSlotTaken(): boolean {
    return this.code === 'dizi.slot-taken';
  }

  /** The alternatives a taken slot offered, in the shape the screens render. */
  get alternatives(): Array<{ start: string; day: string; minutes: number }> {
    const offered = this.extras.alternatives;
    return Array.isArray(offered) ? (offered as Array<{ start: string; day: string; minutes: number }>) : [];
  }
}

/** The code at the tail of the problem's `type` URI: `…/problems/dizi.slot-taken` → `dizi.slot-taken`. */
function codeOf(body: Record<string, unknown>, status: number): string {
  const type = typeof body.type === 'string' ? body.type : '';
  const tail = type.split('/').pop() ?? '';
  if (tail.startsWith('dizi.')) return tail;
  return status >= 500 ? 'dizi.unavailable' : 'about:blank';
}

/** A path with its placeholders filled from the contract's own template. */
function fill(operation: OperationMeta, values: string[]): string {
  let path = operation.path;
  for (const value of values) path = path.replace(/\{[^}]+\}/, encodeURIComponent(value));
  return path;
}

interface CallOptions {
  /** Values for the operation's `{placeholders}`, in the order they appear in the contract's path. */
  at?: string[];
  query?: Record<string, string | undefined>;
  body?: unknown;
  key?: string;
}

async function call<T>(operation: OperationMeta, options: CallOptions = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') query.set(name, value);
  }

  const path = fill(operation, options.at ?? []);
  const url = `${BASE}${path}${query.size > 0 ? `?${query}` : ''}`;

  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  /* The key goes on the writes the contract says it goes on (`requiresIdempotencyKey`), not on everything write-shaped:
     it is the operation's own metadata that decides, so a new operation cannot be forgotten here. */
  if (operation.requiresIdempotencyKey && options.key !== undefined) headers.set(IDEMPOTENCY_HEADER, options.key);

  const answer = await fetch(url, {
    method: operation.method.toUpperCase(),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const text = await answer.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    /* A proxy answered with HTML — a 502 page, a login wall. That is not a refusal in the contract's vocabulary, so
       it is reported as what it is rather than parsed into a problem it never was. */
    parsed = { title: 'The hospital server answered with something this app cannot read', detail: text.slice(0, 200) };
  }

  if (!answer.ok) {
    throw new ApiProblem(
      codeOf(parsed, answer.status),
      typeof parsed.title === 'string' ? parsed.title : 'The hospital server refused that',
      answer.status,
      typeof parsed.detail === 'string' ? parsed.detail : 'The server refused the request and did not say why.',
      parsed,
    );
  }

  return parsed as T;
}

/**
 * A key for one write, minted once and reused for that write's retries.
 *
 * The contract accepts `nodeId:seq` for a queued write and a UUID for one made online. What matters is not which of
 * the two: it is that a retry after a dropped connection carries the *same* key, so a booking retried once is one
 * booking. The caller mints one key per attempt and passes it back in on the retry.
 */
export function attemptKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------------------------ instants and the day */

/** How far the zone is east of UTC at that instant, in minutes. The one bit of date arithmetic this app does itself. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));

  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The branch's minutes-past-midnight for an instant. The zone is the contract's, not the browser's. */
export function localMinutes(iso: string, timeZone: string = SCHEDULING.timezone): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));

  return (Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}

/** The branch's calendar day for an instant. */
export function localDay(iso: string, timeZone: string = SCHEDULING.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The instant a branch day and a minute-of-day name, for the API. The zone's offset is read, not assumed. */
export function instantFor(day: string, minutes: number, timeZone: string = SCHEDULING.timezone): string {
  const [year, month, date] = day.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const offset = offsetMinutes(new Date(naive), timeZone);

  return new Date(naive - offset * 60_000).toISOString().replace('Z', '+00:00');
}

/* ------------------------------------------------------------------------------ the wire → the screen */

/**
 * One appointment as the screens render it.
 *
 * The two shapes differ in exactly one place that matters: the wire carries an instant, and every screen in this app
 * draws a *minute of the day* — the calendar's rows, the board's order, the slot arithmetic. The conversion happens
 * here, once, with the branch's zone, and `day` keeps the branch's day the row came from so a screen never has to
 * re-derive it from the browser's clock.
 */
export function toScreenAppointment(row: Record<string, unknown>): Appointment {
  const start = String(row.start ?? '');
  const patient = (row.patient ?? {}) as Record<string, unknown>;

  return {
    id: String(row.id ?? ''),
    token: String(row.token ?? ''),
    doctorId: String(row.doctorId ?? ''),
    start: localMinutes(start),
    day: localDay(start),
    durationMin: Number(row.durationMin ?? SCHEDULING.slotMinutes),
    patient: {
      mrn: String(patient.mrn ?? row.mrn ?? ''),
      name: String(patient.name ?? 'Not on this node’s register'),
      nameBn: typeof patient.nameBn === 'string' ? patient.nameBn : '',
      age: typeof patient.age === 'number' ? patient.age : null,
      sex: (typeof patient.sex === 'string' ? patient.sex : 'Other') as Appointment['patient']['sex'],
      phone: typeof patient.phone === 'string' ? patient.phone : '',
      allergies: typeof patient.allergies === 'string' ? patient.allergies : null,
    },
    type: (row.type ?? 'New') as AppointmentType,
    status: (row.status ?? 'Confirmed') as AppointmentStatus,
    priority: (row.priority ?? 'Routine') as Priority,
    source: (row.source ?? 'Walk-in') as Source,
    reason: typeof row.reason === 'string' ? row.reason : '',
    room: typeof row.room === 'string' ? row.room : '',
    steps: typeof row.steps === 'number' ? row.steps : undefined,
    /* Telemedicine media is a stated gap in this build and the API does not carry the flag: an appointment read back
       from the server is in person until the media service exists. */
    liveConsultation: false,
    /* The wire does not carry when the booking was taken — the ledger does — so the sheet says where to look rather
       than showing a plausible time. */
    createdAt: undefined,
    queued: row.queued === true,
  };
}

/* --------------------------------------------------------------------------------- the API, one function each */

/** The day's diary. `status` and `source` are the two filters the inbox and the board ask with. */
export async function apiDay(query: {
  day: string;
  doctorId?: string;
  status?: AppointmentStatus;
  source?: Source;
}): Promise<{ rows: Appointment[]; asOf?: string }> {
  const page = await call<{ rows: Array<Record<string, unknown>>; asOf?: string }>(operations.listAppointments, {
    query: { day: query.day, doctorId: query.doctorId, status: query.status, source: query.source },
  });

  return { rows: page.rows.map(toScreenAppointment), asOf: page.asOf };
}

export interface SlotView {
  start: string;
  minutes: number;
  state: 'free' | 'booked';
  appointmentId?: string;
  token?: string;
  durationMin?: number;
}

export interface SlotDayView {
  day: string;
  doctorId: string;
  room: string;
  slotMinutes: number;
  /** How many consecutive slots a consultation at this sitting claims. The sheet draws the block it will get. */
  claimStarts: number;
  open: boolean;
  closedBecause: string | null;
  window: { from: number; to: number };
  slots: SlotView[];
  asOf?: string;
}

/** One doctor's grid for one day, with what holds each slot. */
export async function apiSlots(day: string, doctorId: string, excludeAppointmentId?: string): Promise<SlotDayView> {
  const answer = await call<{
    day: string;
    doctorId: string;
    room: string;
    slotMinutes: number;
    claimStarts: number;
    open: boolean;
    closedBecause?: string | null;
    window: { from: number; to: number };
    slots: SlotView[];
    asOf?: string;
  }>(operations.listAppointmentSlots, { query: { day, doctorId, excludeAppointmentId } });

  return { ...answer, closedBecause: answer.closedBecause ?? null };
}

export async function apiBook(input: AppointmentCreate, key: string): Promise<Appointment> {
  return toScreenAppointment(await call<Record<string, unknown>>(operations.createAppointment, { body: input, key }));
}

export async function apiPatch(id: string, patch: AppointmentPatch, key: string): Promise<Appointment> {
  return toScreenAppointment(await call<Record<string, unknown>>(operations.updateAppointment, { at: [id], body: patch, key }));
}

export async function apiCheckIn(id: string, key: string): Promise<Appointment> {
  return toScreenAppointment(await call<Record<string, unknown>>(operations.checkInAppointment, { at: [id], key }));
}

/** Whether the app can reach the hospital server at all, and the sentence to show when it cannot. */
export async function probeApi(): Promise<{ reachable: boolean; because: string }> {
  try {
    await call<Record<string, unknown>>(operations.health);

    return { reachable: true, because: 'The hospital server answered.' };
  } catch (error) {
    const problem = error instanceof ApiProblem ? error : null;

    return {
      reachable: false,
      because:
        problem === null
          ? 'The hospital server could not be reached from this app.'
          : problem.status === 502 || problem.status === 503
            ? problem.detail
            : `${problem.title}. ${problem.detail}`,
    };
  }
}
