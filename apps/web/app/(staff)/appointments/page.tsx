'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Board,
  Button,
  DataGrid,
  Panel,
  SafetyBanner,
  Segmented,
  Sheet,
  Tabs,
  TextAreaField,
  Tooltip,
  cx,
  useToast,
  type BoardCard,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { BookingSheet } from '@/components/BookingSheet';
import {
  DOCTORS,
  QUEUE_COLUMNS,
  actionsFrom,
  doctorById,
  longDate,
  shiftDays,
  statusTone,
  timeLabel,
  todayIso,
  type Appointment,
  type AppointmentStatus,
} from '@/lib/appointments';
import { SCHEDULING, type SlotDayView } from '@/lib/appointments-api';
import { detectSource, type AppointmentsSource, type BookingInput, type PatchInput } from '@/lib/appointments-source';
import { useShell } from '@/lib/shell';

/* Appointments (legacy screens 002/003 replaced) — the pilot's booking desk.
 *
 * Four views of one day: the calendar (where a clerk books), the queue board (where the nurse moves patients through),
 * the online-request inbox (what the portal took and nobody has answered) and the plain list (for printing and export).
 *
 * **Where the rows come from is a fact the screen states.** It asks whichever source is live — the hospital server
 * (P0-401's five operations) or, when no server answers, the deterministic preview — and the banner at the top says
 * which, in one sentence, because a desk that cannot tell the branch's diary from sample data is a desk that books a
 * patient into a fixture.
 *
 * **Every write is a contract operation.** A booking posts to `POST /appointments`, a move or a cancellation patches
 * `PATCH /appointments/{id}`, an arrival posts to `POST /appointments/{id}/check-in` — and a refusal comes back as the
 * contract's own problem document, so the conflict prompt below is the *service's* sentence with the times the service
 * says are free, not a copy of the rule kept on this side.
 */

/** A move waiting for its reason: the contract refuses a patch without one, and the reason is what the review reads. */
interface PendingMove {
  appointment: Appointment;
  status: AppointmentStatus;
}

export default function AppointmentsPage() {
  const { push } = useToast();
  const { role } = useShell();

  const [day, setDay] = useState(todayIso());
  const [tab, setTab] = useState('calendar');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [listView, setListView] = useState<'all' | 'queue'>('all');

  const [source, setSource] = useState<AppointmentsSource | null>(null);
  const [sourceNote, setSourceNote] = useState<string>('Looking for the hospital server…');
  const [rows, setRows] = useState<Appointment[]>([]);
  const [requests, setRequests] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const [booking, setBooking] = useState<{ open: boolean; preset?: { doctorId?: string; start?: number; patientMrn?: string } }>({ open: false });
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [moveReason, setMoveReason] = useState('');

  /* Which source is live is asked once, by the seam, and the answer is a fact rather than a preference. */
  useEffect(() => {
    let live = true;
    detectSource().then((answer) => {
      if (!live) return;
      setSource(answer.source);
      setSourceNote(answer.note);
    });

    return () => {
      live = false;
    };
  }, []);

  const read = useCallback(
    async (chosen: AppointmentsSource) => {
      setLoading(true);
      setError(null);
      try {
        /* Two questions, asked of the source: the day's diary, and the portal requests nobody has answered. The
           inbox filter travels to the server rather than sieving a morning in the browser. */
        const [page, inbox] = await Promise.all([
          chosen.day({ day, doctorId: doctorFilter === 'all' ? undefined : doctorFilter }),
          chosen.day({ day, status: 'Requested', source: 'Online portal' }),
        ]);
        setRows(page.rows);
        setRequests(inbox.rows);
        setAsOf(page.asOf ?? null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'That day could not be read.');
      } finally {
        setLoading(false);
      }
    },
    [day, doctorFilter],
  );

  useEffect(() => {
    if (source === null) return;
    void read(source);
  }, [source, read]);

  const shown = rows;
  const pending = requests;
  /* Memoised on the *filter*, not on the array it builds: a list rebuilt every render would re-run the grids effect
     every render, and the screen would ask the service for the same four grids forever. */
  const doctorIds = useMemo(() => (doctorFilter === 'all' ? DOCTORS : DOCTORS.filter((d) => d.id === doctorFilter)).map((d) => d.id), [doctorFilter]);
  const visibleDoctors = useMemo(() => DOCTORS.filter((d) => doctorIds.includes(d.id)), [doctorIds]);

  /* The calendar draws the *service's* grid, one call per visible doctor: a slot the screen offers and the service
     refuses can then only be a race, which is the one case the conflict prompt exists for. */
  const [grids, setGrids] = useState<Record<string, SlotDayView | null>>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (source === null) return;
    let live = true;
    setGrids((current) => (doctorIds.every((id) => current[id] !== undefined) ? current : { ...current, ...Object.fromEntries(doctorIds.map((id) => [id, null])) }));

    Promise.all(doctorIds.map((id) => source.slots(day, id).then((grid) => [id, grid] as const)))
      .then((answers) => {
        if (live) setGrids(Object.fromEntries(answers));
      })
      .catch(() => {
        if (live) setGrids({});
      });

    return () => {
      live = false;
    };
  }, [source, day, doctorIds, reloadToken]);

  /** After a write: read the day again, and the grids with it. The server owns both. */
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const book = async (input: BookingInput): Promise<Appointment> => {
    if (source === null) throw new Error('No source is live yet.');
    const appointment = await source.book(input);
    void read(source);
    refresh();

    return appointment;
  };

  const applyMove = async (target: Appointment, status: AppointmentStatus, because: string) => {
    if (source === null) return;
    setMove(null);
    setMoveReason('');
    setDetail(null);

    try {
      /* Check-in is its own operation — an arrival is a fact about the room, not a status the desk sets. */
      const written = status === 'Checked in' ? await source.checkIn(target.id) : await source.patch(target.id, { status, because });
      push({ title: `${target.token} → ${written.status}`, description: because === '' ? 'Recorded on the branch’s diary' : because, tone: status === 'Cancelled' || status === 'No show' ? 'warning' : 'success' });
      void read(source);
      refresh();
    } catch (failure) {
      const problem = failure as { code?: string; detail?: string; message?: string; extras?: Record<string, unknown> };
      push({ title: 'That move was refused', description: problem.detail ?? problem.message ?? 'The service refused the change.', tone: 'warning' });
      void read(source);
      refresh();
    }
  };

  const moveTo = (target: Appointment, status: AppointmentStatus) => {
    if (status === 'Checked in') {
      void applyMove(target, status, 'Patient arrived at the desk');
      return;
    }
    setMove({ appointment: target, status });
    setMoveReason('');
  };

  /* ------------------------------------------------------------------ calendar grid */
  const calendar = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setDay(shiftDays(day, -1))} aria-label="Previous day">‹</Button>
          <Button size="sm" onClick={() => setDay(todayIso())}>Today</Button>
          <Button size="sm" onClick={() => setDay(shiftDays(day, 1))} aria-label="Next day">›</Button>
        </div>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Appointment date"
          className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
        />
        <p className="text-sm text-text-secondary">{longDate(day)}</p>
        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          aria-label="Filter by doctor"
          className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
        >
          <option value="all">All doctors</option>
          {DOCTORS.map((d) => (
            <option key={d.id} value={d.id}>{d.name} — {d.department}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.open('/print/day-list', '_blank')}>Print day list</Button>
          <Button size="sm" variant="primary" onClick={() => setBooking({ open: true })}>Book appointment</Button>
        </div>
      </div>

      {/* Desktop: doctor columns × time rows, drawn from the service's own slot list. Mobile: a list (below). */}
      <div className="hidden overflow-x-auto rounded-lg border border-border-subtle lg:block">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="sr-only">Appointment calendar for {longDate(day)}</caption>
          <thead className="sticky top-0 z-10">
            <tr>
              <th scope="col" className="sticky left-0 z-20 w-20 border-b border-border-subtle bg-surface-sunken px-2 py-2 text-xs text-text-secondary">
                Time
              </th>
              {visibleDoctors.map((d) => (
                <th key={d.id} scope="col" className="border-b border-border-subtle bg-surface-sunken px-2 py-2">
                  <span className="block text-sm font-semibold text-text-primary">{d.name}</span>
                  <span className="block text-xs text-text-tertiary">{grids[d.id]?.room ?? d.room} · {d.department}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {minuteRows(visibleDoctors, grids).map((slot) => (
              <tr key={slot} className="h-10">
                <th scope="row" className="font-numeric sticky left-0 z-10 border-b border-border-subtle bg-surface-default px-2 text-xs font-normal text-text-tertiary">
                  {timeLabel(slot)}
                </th>
                {visibleDoctors.map((d) => {
                  const grid = grids[d.id] ?? null;
                  if (grid === null) {
                    return (
                      <td key={d.id} className="border-b border-border-subtle p-0.5 text-center text-xs text-text-tertiary">
                        …
                      </td>
                    );
                  }
                  if (!grid.open) {
                    return (
                      <td key={d.id} className="border-b border-border-subtle p-0.5 text-center text-xs text-text-tertiary">
                        closed
                      </td>
                    );
                  }

                  const cell = grid.slots.find((s) => s.minutes === slot);
                  if (cell === undefined) return <td key={d.id} className="border-b border-border-subtle" />;

                  if (cell.state === 'free') {
                    /* Only the first slot of a free block is offered; the block's size is the sitting's claim, which
                       the grid carries, so the desk cannot start a booking that will not fit. */
                    const starts = grid.slots.filter((s) => s.state === 'free').map((s) => s.minutes);
                    const isStart = starts.includes(slot) && (grid.slots.find((s) => s.minutes === slot - grid.slotMinutes)?.state !== 'free');
                    if (!isStart) return <td key={d.id} className="border-b border-border-subtle" />;

                    return (
                      <td key={d.id} className="border-b border-border-subtle p-0.5">
                        <button
                          type="button"
                          onClick={() => setBooking({ open: true, preset: { doctorId: d.id, start: slot } })}
                          className="h-full w-full rounded-sm border border-dashed border-transparent text-xs text-transparent hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
                        >
                          Book {timeLabel(slot)} with {d.name}
                        </button>
                      </td>
                    );
                  }

                  /* A booked slot: only the appointment's first slot draws the card, and it spans its claim. */
                  const appointment = shown.find((a) => a.id === cell.appointmentId);
                  const first = shown.find((a) => a.id === cell.appointmentId)?.start;
                  if (appointment === undefined || first === undefined || first !== slot) {
                    /* A booked slot whose appointment is not in this page — another doctor's filter, or a row the
                       grid knows and the day list did not return. It still draws as taken, because it is. */
                    if (appointment === undefined) {
                      return <td key={d.id} className="border-b border-border-subtle p-0.5 text-center text-xs text-text-tertiary">taken</td>;
                    }
                    return null;
                  }
                  const span = Math.max(1, Math.ceil((cell.durationMin ?? grid.slotMinutes) / grid.slotMinutes));

                  return (
                    <td key={d.id} rowSpan={span} className="border-b border-border-subtle p-0.5 align-top">
                      <button
                        type="button"
                        onClick={() => setDetail(appointment)}
                        className={cx(
                          'flex h-full w-full flex-col gap-0.5 rounded-md border p-1.5 text-left',
                          appointment.priority === 'Emergency'
                            ? 'border-safety-critical bg-safety-critical/5'
                            : appointment.status === 'Completed'
                              ? 'border-border-subtle bg-surface-sunken'
                              : 'border-brand-300 bg-brand-50',
                        )}
                      >
                        <span className="truncate text-xs font-medium">{appointment.patient.name}</span>
                        <span className="font-numeric truncate text-[11px] text-text-tertiary">{appointment.token} · {appointment.type}</span>
                        <span className={cx('mt-auto inline-block w-max rounded-full px-1.5 text-[10px]', appointment.status === 'Completed' ? 'bg-surface-default text-text-tertiary' : 'bg-surface-raised text-text-secondary')}>
                          {appointment.status}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: chronological list, tap to open, tap the empty-state button to book. */}
      <div className="flex flex-col gap-2 lg:hidden">
        {shown.length === 0 && (
          <Panel>
            <p className="text-sm text-text-secondary">No appointments for {longDate(day)} on this filter.</p>
            <Button className="mt-2" variant="primary" onClick={() => setBooking({ open: true })}>Book the first one</Button>
          </Panel>
        )}
        {shown.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setDetail(a)}
            className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-default p-3 text-left"
          >
            <span className="font-numeric w-16 shrink-0 text-sm font-medium">{timeLabel(a.start)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base">{a.patient.name}</span>
              <span className="block truncate text-xs text-text-secondary">
                {doctorById(a.doctorId).name} · {a.type}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{a.status}</span>
          </button>
        ))}
      </div>
    </>
  );

  /* ---------------------------------------------------------------------- queue board */
  const boardCards: BoardCard[] = shown
    .filter((a) => (QUEUE_COLUMNS as readonly string[]).includes(a.status))
    .map((a) => ({
      id: a.id,
      title: `${a.token} · ${a.patient.name}`,
      subtitle: `${timeLabel(a.start)} · ${doctorById(a.doctorId).name}`,
      meta: [a.type, a.room ?? doctorById(a.doctorId).room],
      badge: a.priority === 'Routine' ? { label: a.status, tone: statusTone[a.status] } : { label: a.priority, tone: a.priority === 'Emergency' ? 'critical' : 'warning' },
      onOpen: () => setDetail(a),
      transitions: actionsFrom(a.status).map((to) => ({
        to,
        label: to === 'Checked in' ? 'Check in' : `Move to ${to}`,
        danger: to === 'Cancelled' || to === 'No show',
      })),
    }));

  /* ------------------------------------------------------------------- requests inbox */
  const requestColumns: Array<Column<Appointment>> = [
    { key: 'token', header: 'Token', width: '7.5rem', numeric: true },
    { key: 'patient', header: 'Patient', render: (r) => `${r.patient.name} · ${r.patient.age ?? '—'}${String(r.patient.sex).slice(0, 1)}` },
    { key: 'patient_phone', header: 'Mobile', width: '9rem', numeric: true, render: (r) => r.patient.phone },
    { key: 'doctor', header: 'Doctor', render: (r) => doctorById(r.doctorId).name },
    { key: 'start', header: 'Asked for', width: '8rem', numeric: true, render: (r) => timeLabel(r.start) },
    { key: 'priority', header: 'Priority', width: '7rem', render: (r) => <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{r.priority}</span> },
    { key: 'reason', header: 'Reason', hideBelow: 'xl' },
    { key: 'source', header: 'Source', width: '8rem', hideBelow: 'lg' },
  ];

  const requestActions = (r: Appointment): RowAction<Appointment>[] => [
    {
      label: 'Approve — choose a slot',
      onSelect: () => {
        setBooking({ open: true, preset: { doctorId: r.doctorId, patientMrn: r.patient.mrn } });
        push({ title: `${r.patient.name} approved`, description: 'Choose a slot to finish the booking, or move them to another time.', tone: 'info' });
      },
    },
    {
      label: 'Decline with a reason',
      danger: true,
      separated: true,
      onSelect: () => moveTo(r, 'Cancelled'),
    },
    { label: 'Call the patient', onSelect: () => push({ title: `Dialling ${r.patient.phone}`, tone: 'info' }) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-text-secondary">
            Book, move and print appointments. Slot availability is the service&rsquo;s: two desks on two counters cannot
            book the same slot, and the second one is told who took it.
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip title="Waiting room display" content="A large-text board for the corridor screen (arrives with the board module)." shortcut="P5">
            <Button onClick={() => push({ title: 'Waiting room display', description: 'Large-text TV mode arrives with the boards module in P5', tone: 'info' })}>TV mode</Button>
          </Tooltip>
          <Button variant="primary" onClick={() => setBooking({ open: true })}>Book appointment</Button>
        </div>
      </div>

      <SafetyBanner severity={source?.kind === 'api' ? 'success' : 'info'} title={source === null ? 'Looking for the hospital server' : source.label}>
        {sourceNote}
        {asOf !== null && source?.kind === 'api' && <span className="ml-1 text-text-tertiary">(as of {asOf.slice(11, 19)} UTC)</span>}
      </SafetyBanner>

      {error !== null && (
        <SafetyBanner
          severity="warning"
          title="That day could not be read"
          action={<Button size="sm" onClick={() => source !== null && void read(source)}>Try again</Button>}
        >
          {error}
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'calendar', label: 'Calendar', count: shown.length },
          { id: 'queue', label: 'Queue', count: shown.filter((a) => (QUEUE_COLUMNS as readonly string[]).includes(a.status)).length },
          { id: 'requests', label: 'Online requests', count: pending.length },
          { id: 'list', label: 'List' },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'calendar' && (loading && shown.length === 0 ? <p className="p-3 text-sm text-text-secondary">Reading the diary…</p> : calendar)}

        {tab === 'queue' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-text-secondary">
                Move patients with the ⋯ menu on each card — no dragging, so it works with a keyboard and on a tablet.
                Every move is recorded on the branch&rsquo;s diary with the reason the desk typed.
              </p>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => window.open('/print/day-list', '_blank')}>Print queue sheet</Button>
              </div>
            </div>
            <Board
              columns={[
                { id: 'Confirmed', title: 'Confirmed', tone: 'info', hint: 'Booked, not yet arrived' },
                { id: 'Checked in', title: 'Checked in', tone: 'info', hint: 'At the counter' },
                { id: 'Waiting', title: 'Waiting', tone: 'warning', hint: 'Ready for the doctor' },
                { id: 'In consultation', title: 'In consultation', tone: 'success' },
                { id: 'Completed', title: 'Completed', tone: 'neutral' },
              ]}
              cards={boardCards}
              columnOf={(c) => shown.find((a) => a.id === c.id)?.status ?? 'Confirmed'}
              onTransition={(id, to) => {
                const target = shown.find((a) => a.id === id);
                if (target !== undefined) moveTo(target, to as AppointmentStatus);
              }}
              emptyLabel="Nobody in this state"
            />
          </div>
        )}

        {tab === 'requests' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-secondary">
              What the patient portal took and nobody has answered. Approving opens the booking flow with the patient and
              doctor prefilled — the request becomes a real slot through the same operation the desk uses; declining
              records the reason the patient is told.
            </p>
            {source?.kind === 'api' && pending.length === 0 && (
              <SafetyBanner severity="info" title="No portal requests waiting">
                A request is an appointment in the contract&rsquo;s <span className="font-numeric">Requested</span> state with
                the portal as its source, and the operation that creates one (<span className="font-numeric">POST
                /portal/appointments</span>) is the cloud&rsquo;s, not this branch&rsquo;s — it arrives with the portal&rsquo;s own
                slice. Until then this inbox is the query, waiting for its first row.
              </SafetyBanner>
            )}
            <DataGrid<Appointment>
              id="appointment-requests"
              caption="Online appointment requests"
              columns={requestColumns}
              rows={pending}
              total={pending.length}
              page={1}
              pageSize={25}
              rowId={(r) => r.id}
              height="26rem"
              rowActions={requestActions}
              exportFileName="online-requests"
              printMeta={`Requests as of ${new Date().toLocaleString()}`}
              emptyLabel="No pending requests."
            />
          </div>
        )}

        {tab === 'list' && (
          <div className="flex flex-col gap-2">
            <Segmented
              name="list-view"
              label="Show"
              value={listView}
              onChange={setListView}
              options={[
                { value: 'all', label: `All appointments (${shown.length})` },
                { value: 'queue', label: `Queue only (${boardCards.length})` },
              ]}
            />
            <DataGrid<Appointment>
              id="appointments-list"
              caption={`Appointments — ${longDate(day)}`}
              columns={[
                { key: 'token', header: 'Token', width: '6.5rem', numeric: true },
                {
                  key: 'start',
                  header: 'Time',
                  width: '7rem',
                  numeric: true,
                  render: (a) => timeLabel(a.start),
                  tooltip: 'Slot start. The consultation claims the sitting’s own number of steps, shown as duration.',
                },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (a) => (
                    <Link href={`/patients/${a.patient.mrn}`} className="text-brand-600 hover:underline">
                      {a.patient.name}
                    </Link>
                  ),
                },
                { key: 'mrn', header: 'MRN', width: '9rem', numeric: true, hideBelow: 'lg', render: (a) => a.patient.mrn },
                { key: 'doctor', header: 'Doctor', render: (a) => doctorById(a.doctorId).name, hideBelow: 'md' },
                { key: 'room', header: 'Room', width: '6.5rem', hideBelow: 'lg', render: (a) => a.room ?? doctorById(a.doctorId).room },
                { key: 'type', header: 'Type', width: '9rem', render: (a) => `${a.type}${a.durationMin > SCHEDULING.slotMinutes ? ` · ${a.durationMin}m` : ''}` },
                {
                  key: 'priority',
                  header: 'Priority',
                  width: '7.5rem',
                  render: (a) => (
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-xs',
                        a.priority === 'Routine' ? 'bg-surface-sunken' : a.priority === 'Emergency' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning',
                      )}
                    >
                      {a.priority}
                    </span>
                  ),
                },
                { key: 'source', header: 'Source', width: '8rem', hideBelow: 'xl' },
                { key: 'status', header: 'Status', width: '9rem', render: (a) => <span className={cx('rounded-full px-2 py-0.5 text-xs', a.status === 'Cancelled' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-surface-sunken')}>{a.status}</span> },
              ]}
              rows={listView === 'queue' ? shown.filter((a) => (QUEUE_COLUMNS as readonly string[]).includes(a.status)) : shown}
              total={listView === 'queue' ? boardCards.length : shown.length}
              page={1}
              pageSize={50}
              rowId={(a) => a.id}
              height="30rem"
              rowActions={(a) => [
                { label: 'Open', onSelect: () => setDetail(a) },
                { label: 'Print slip', onSelect: () => window.open(`/print/appointment-slip?id=${a.id}`, '_blank') },
                { label: 'Reschedule', onSelect: () => setBooking({ open: true, preset: { doctorId: a.doctorId, patientMrn: a.patient.mrn } }) },
                { label: 'Check in', onSelect: () => moveTo(a, 'Checked in') },
                { label: 'Cancel appointment', danger: true, separated: true, onSelect: () => moveTo(a, 'Cancelled') },
              ]}
              exportFileName={`appointments-${day}`}
              printMeta={`${longDate(day)} · ${doctorFilter === 'all' ? 'all doctors' : doctorById(doctorFilter).name} · ${shown.length} appointments`}
              emptyLabel="No appointments in this view."
            />
          </div>
        )}
      </Tabs>

      {/* ------------------------------------------------------------------ booking */}
      <BookingSheet
        open={booking.open}
        onClose={() => setBooking({ open: false })}
        day={day}
        preset={booking.preset}
        loadSlots={(d, doctorId) => (source ?? null) === null ? Promise.reject(new Error('No source is live yet.')) : source!.slots(d, doctorId)}
        onSubmit={book}
        onBooked={() => undefined}
        note={sourceNote}
      />

      {/* ---------------------------------------------------------------- reason for a move */}
      <Sheet
        open={move !== null}
        onClose={() => setMove(null)}
        title={move === null ? '' : `Move ${move.appointment.token} to ${move.status}`}
        description="The contract refuses a change without a reason, and the reason is what a review reads."
        width="md"
        footer={
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={moveReason.trim().length < 3}
              onClick={() => move !== null && void applyMove(move.appointment, move.status, moveReason.trim())}
            >
              Record {move?.status}
            </Button>
            <Button onClick={() => setMove(null)}>Cancel</Button>
          </div>
        }
      >
        {move !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              {move.appointment.patient.name} · {timeLabel(move.appointment.start)} · {doctorById(move.appointment.doctorId).name}
            </p>
            <TextAreaField
              label="Why"
              name="move-reason"
              value={moveReason}
              onChange={(e) => setMoveReason(e.target.value)}
              rows={3}
              placeholder={move.status === 'No show' ? 'Called three times, no answer' : 'The patient telephoned to say she cannot come'}
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {['The patient telephoned', 'The doctor is in theatre', 'The patient did not come', 'Booked by mistake'].map((quick) => (
                <Button key={quick} size="sm" onClick={() => setMoveReason(quick)}>
                  {quick}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------- appointment detail */}
      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.token} · ${detail.patient.name}` : ''}
        description={detail ? `${doctorById(detail.doctorId).name} · ${detail.room ?? doctorById(detail.doctorId).room} · ${timeLabel(detail.start)}` : ''}
        width="md"
        footer={
          detail && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.open(`/print/appointment-slip?id=${detail.id}`, '_blank')}>Print slip</Button>
              <Link href="/clinical"><Button>Open consultation</Button></Link>
              <Link href={`/patients/${detail.patient.mrn}`}><Button>Open patient</Button></Link>
              {detail.status !== 'Cancelled' && detail.status !== 'No show' && (
                <Button variant="ghost" onClick={() => moveTo(detail, 'Cancelled')}>Cancel appointment</Button>
              )}
            </div>
          )
        }
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ['MRN', detail.patient.mrn],
                  ['Age / sex', `${detail.patient.age ?? '—'} · ${detail.patient.sex}`],
                  ['Mobile', detail.patient.phone],
                  ['Room', detail.room ?? doctorById(detail.doctorId).room],
                  ['Type', detail.type],
                  ['Priority', detail.priority],
                  ['Source', detail.source],
                  /* The API keeps when a booking was taken in the ledger rather than on the row, so this says where the
                     answer is instead of inventing a plausible time. */
                  ['Booked', detail.createdAt === undefined ? 'in the ledger, by token and actor' : detail.createdAt],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-border-subtle pb-1">
                  <dt className="text-text-secondary">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            {detail.reason !== '' && (
              <div>
                <p className="text-sm font-medium text-text-secondary">Reason for visit</p>
                <p className="text-base">{detail.reason}</p>
              </div>
            )}

            {detail.patient.allergies && (
              <SafetyBanner severity="warning" title={`Allergy on record: ${detail.patient.allergies}`} />
            )}

            <div>
              <p className="mb-1 text-sm font-medium text-text-secondary">Move this appointment</p>
              <div className="flex flex-wrap gap-2">
                {actionsFrom(detail.status).length === 0 && (
                  <p className="text-sm text-text-tertiary">
                    This appointment is {detail.status.toLowerCase()} — no further moves. A patient who comes back is a new
                    booking.
                  </p>
                )}
                {actionsFrom(detail.status).map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === 'Cancelled' || to === 'No show' ? 'danger' : 'secondary'}
                    onClick={() => moveTo(detail, to)}
                  >
                    {to}
                  </Button>
                ))}
              </div>
            </div>

            {role === 'receptionist' && detail.status === 'Requested' && (
              <p className="text-xs text-text-tertiary">
                This one came from the patient portal. Confirming it takes the slot shown; the patient is told from the
                outbox when notifications land (P0-403).
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** The rows a calendar needs: every step from the contract's window, whatever any one doctor offers. */
function minuteRows(doctors: typeof DOCTORS, grids: Record<string, SlotDayView | null>): number[] {
  const open = doctors.map((d) => grids[d.id]).filter((grid): grid is SlotDayView => grid !== null && grid !== undefined && grid.open);
  const step = open[0]?.slotMinutes ?? SCHEDULING.slotMinutes;
  const window_ = open[0]?.window ?? SCHEDULING.window;
  const rows: number[] = [];

  for (let minute = window_.from; minute + step <= window_.to; minute += step) rows.push(minute);

  return rows;
}
