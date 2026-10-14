'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Board,
  Button,
  DataGrid,
  Panel,
  Segmented,
  Sheet,
  SafetyBanner,
  Tabs,
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
  STATUS_FLOW,
  availability,
  doctorById,
  generateAppointments,
  longDate,
  onlineRequests,
  shiftDays,
  slotsOf,
  statusTone,
  timeLabel,
  todayIso,
  type Appointment,
  type AppointmentStatus,
  type OnlineRequest,
} from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Appointments (legacy screens 002/003 replaced) — the P1 module.
 *
 * Four views of the same day: the calendar (where a clerk books), the queue (where the nurse moves patients
 * through), the online requests inbox (where the portal lands) and the plain list (for printing and export).
 * The calendar shows only free slots as clickable and taken ones with the patient's name, so double-booking is
 * impossible by construction rather than by validation after the fact.
 */
export default function AppointmentsPage() {
  const { sync, role } = useShell();
  const { push } = useToast();

  const [day, setDay] = useState(todayIso());
  const [tab, setTab] = useState('calendar');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [listView, setListView] = useState<'all' | 'queue'>('all');

  const [appointments, setAppointments] = useState<Appointment[]>(() => generateAppointments(todayIso()));
  const [requests, setRequests] = useState<OnlineRequest[]>(() => onlineRequests(todayIso()));
  const [booking, setBooking] = useState<{ open: boolean; preset?: { doctorId?: string; start?: number } }>({ open: false });
  const [detail, setDetail] = useState<Appointment | null>(null);

  const dayAppointments = useMemo(
    () => appointments.filter((a) => a.createdAt.startsWith(day) || day === todayIso()),
    [appointments, day],
  );
  const shown = doctorFilter === 'all' ? dayAppointments : dayAppointments.filter((a) => a.doctorId === doctorFilter);
  const visibleDoctors = doctorFilter === 'all' ? DOCTORS : DOCTORS.filter((d) => d.id === doctorFilter);

  const pending = requests.filter((r) => r.status === 'Pending');

  const move = (id: string, to: AppointmentStatus) => {
    setAppointments((list) => list.map((a) => (a.id === id ? { ...a, status: to } : a)));
    const appointment = appointments.find((a) => a.id === id);
    const offline = sync !== 'live';
    push({
      title: `${appointment?.patient.name ?? id} → ${to}`,
      description: offline ? 'Saved on this device; the ward display updates when the connection returns.' : 'Queue display updated',
      tone: to === 'Cancelled' ? 'warning' : 'success',
    });
    setDetail(null);
  };

  const book = (appointment: Appointment) => setAppointments((list) => [appointment, ...list]);

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

      {/* Desktop: doctor columns × time rows. Mobile: the same data as a list (below). */}
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
                  <span className="block text-xs text-text-tertiary">{d.room} · {d.department}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(availability(visibleDoctors[0]?.id ?? 'dr-rahman', shown).keys()).map((slot) => (
              <tr key={slot} className="h-10">
                <th scope="row" className="sticky left-0 z-10 border-b border-border-subtle bg-surface-default px-2 font-numeric text-xs font-normal text-text-tertiary">
                  {timeLabel(slot)}
                </th>
                {visibleDoctors.map((d) => {
                  const hit = shown.find((a) => a.doctorId === d.id && slotsOf(a).includes(slot));
                  if (!hit) {
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
                  // Only the first slot of an appointment draws the card; the rest merge into it.
                  if (slotsOf(hit)[0] !== slot) return null;
                  const span = Math.ceil(hit.durationMin / 15);
                  return (
                    <td key={d.id} rowSpan={span} className="border-b border-border-subtle p-0.5 align-top">
                      <button
                        type="button"
                        onClick={() => setDetail(hit)}
                        className={cx(
                          'flex h-full w-full flex-col gap-0.5 rounded-md border p-1.5 text-left',
                          hit.priority === 'Emergency'
                            ? 'border-safety-critical bg-safety-critical/5'
                            : hit.status === 'Completed'
                              ? 'border-border-subtle bg-surface-sunken'
                              : 'border-brand-300 bg-brand-50',
                        )}
                      >
                        <span className="truncate text-xs font-medium">{hit.patient.name}</span>
                        <span className="font-numeric truncate text-[11px] text-text-tertiary">{hit.token} · {hit.type}</span>
                        <span className={cx('mt-auto inline-block w-max rounded-full px-1.5 text-[10px]', hit.status === 'Completed' ? 'bg-surface-default text-text-tertiary' : 'bg-surface-raised text-text-secondary')}>
                          {hit.status}
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
                {a.liveConsultation && ' · live'}
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
      meta: [a.type, a.liveConsultation ? 'live' : 'in person'],
      badge: a.priority === 'Routine' ? { label: a.status, tone: statusTone[a.status] } : { label: a.priority, tone: a.priority === 'Emergency' ? 'critical' : 'warning' },
      onOpen: () => setDetail(a),
      transitions: STATUS_FLOW[a.status].map((to) => ({
        to,
        label: `Move to ${to}`,
        danger: to === 'Cancelled' || to === 'No show',
      })),
    }));

  /* ------------------------------------------------------------------- requests inbox */
  const requestColumns: Array<Column<OnlineRequest>> = [
    { key: 'id', header: 'Request', width: '7.5rem', numeric: true },
    { key: 'patient', header: 'Patient', render: (r) => `${r.patient.name} · ${r.patient.age}${r.patient.sex.slice(0, 1)}` },
    { key: 'patient_phone', header: 'Mobile', width: '9rem', numeric: true, editable: true, render: (r) => r.patient.phone },
    { key: 'department', header: 'Department' },
    { key: 'preferredWindow', header: 'Preferred', width: '8rem', hideBelow: 'md' },
    { key: 'priority', header: 'Priority', width: '7rem', render: (r) => <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{r.priority}</span> },
    { key: 'liveConsultation', header: 'Mode', width: '7rem', hideBelow: 'lg', render: (r) => (r.liveConsultation ? 'Live video' : 'In person'), printable: false },
    { key: 'note', header: 'Note', hideBelow: 'xl' },
    { key: 'status', header: 'Status', width: '8rem', editable: true, editor: 'select', options: ['Pending', 'Approved', 'Declined', 'Rescheduled'].map((s) => ({ value: s, label: s })) },
  ];

  const requestActions = (r: OnlineRequest): RowAction<OnlineRequest>[] => [
    {
      label: 'Approve and assign a slot',
      onSelect: () => {
        setBooking({ open: true, preset: { doctorId: r.doctorId ?? undefined } });
        setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'Approved' } : x)));
        push({ title: `${r.patient.name} approved`, description: 'Choose a slot to finish the booking', tone: 'success' });
      },
    },
    { label: 'Suggest another time', onSelect: () => push({ title: `Alternative times sent to ${r.patient.name}`, description: 'SMS/WhatsApp from the outbox', tone: 'info' }) },
    { label: 'Call the patient', onSelect: () => push({ title: `Dialling ${r.patient.phone}`, tone: 'info' }) },
    { label: 'Decline', danger: true, separated: true, onSelect: () => { setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'Declined' } : x))); push({ title: 'Request declined', description: 'A reason is required and is sent to the patient', tone: 'warning' }); } },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-text-secondary">
            Book, move and print appointments. Slot availability is enforced here, so two staff on two desks cannot
            book the same slot.
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip title="Waiting room display" content="A large-text board for the corridor screen (arrives with the board module)." shortcut="P5">
            <Button onClick={() => push({ title: 'Waiting room display', description: 'Large-text TV mode arrives with the boards module in P5', tone: 'info' })}>TV mode</Button>
          </Tooltip>
          <Button variant="primary" onClick={() => setBooking({ open: true })}>Book appointment</Button>
        </div>
      </div>

      <SafetyBanner severity="info" title="P1 module — preview screens, sample appointments">
        The rules the desk sees here (slot steps, capacity, status flow, sources) are the ones the API will enforce.
        Until the appointment service is cut over, real bookings are still written in the legacy system, so treat
        this as the design review copy of the screen.
      </SafetyBanner>

      {sync === 'queued' && (
        <SafetyBanner severity="warning" title="Booking offline">
          Appointments booked now are stored on this device and sync automatically. Slots already taken by other
          desks may not be visible until the connection returns.
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
        {tab === 'calendar' && calendar}

        {tab === 'queue' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-text-secondary">
                Move patients with the ⋯ menu on each card — no dragging, so it works with a keyboard and on a tablet.
              </p>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => window.open('/print/day-list', '_blank')}>Print queue sheet</Button>
              </div>
            </div>
            <Board
              columns={[
                { id: 'Confirmed', title: 'Confirmed', tone: 'info', hint: 'Booked, not yet arrived' },
                { id: 'Checked in', title: 'Checked in', tone: 'info', hint: 'At the counter, vitals pending' },
                { id: 'Waiting', title: 'Waiting', tone: 'warning', hint: 'Ready for the doctor' },
                { id: 'In consultation', title: 'In consultation', tone: 'success' },
                { id: 'Completed', title: 'Completed', tone: 'neutral' },
              ]}
              cards={boardCards}
              columnOf={(c) => shown.find((a) => a.id === c.id)?.status ?? 'Confirmed'}
              onTransition={(id, to) => move(id, to as AppointmentStatus)}
              emptyLabel="Nobody in this state"
            />
          </div>
        )}

        {tab === 'requests' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-secondary">
              Requests from the patient portal. Approving opens the booking flow with the doctor prefilled; the
              patient is notified from the outbox when the slot is confirmed.
            </p>
            <DataGrid<OnlineRequest>
              id="appointment-requests"
              caption="Online appointment requests"
              columns={requestColumns}
              rows={requests}
              total={requests.length}
              page={1}
              pageSize={25}
              rowId={(r) => r.id}
              height="26rem"
              quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Search patient, mobile or request ID…' }}
              rowActions={requestActions}
              onInlineEdit={(rowId, key, value) => {
                setRequests((list) => list.map((x) => (x.id === rowId ? { ...x, [key]: value } as OnlineRequest : x)));
                push({ title: 'Request updated', description: `${rowId} · ${key} → ${value}`, tone: sync === 'live' ? 'success' : 'warning' });
              }}
              bulkActions={[{ label: 'Approve selected', onSelect: (ids) => push({ title: `${ids.length} requests approved`, description: 'Slots assigned automatically where free', tone: 'success' }) }]}
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
                  tooltip: 'Slot start. Duration is shown in the Type column when it exceeds one slot.',
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
                { key: 'department', header: 'Department', hideBelow: 'xl', render: (a) => doctorById(a.doctorId).department },
                { key: 'type', header: 'Type', width: '9rem', render: (a) => `${a.type}${a.durationMin > 15 ? ` · ${a.durationMin}m` : ''}` },
                {
                  key: 'priority',
                  header: 'Priority',
                  width: '7.5rem',
                  render: (a) => (
                    <span className={cx('rounded-full px-2 py-0.5 text-xs', a.priority === 'Routine' ? 'bg-surface-sunken' : a.priority === 'Emergency' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>
                      {a.priority}
                    </span>
                  ),
                },
                { key: 'source', header: 'Source', width: '8rem', hideBelow: 'xl' },
                {
                  key: 'status',
                  header: 'Status',
                  width: '9rem',
                  editable: true,
                  editor: 'select',
                  options: (['Requested', 'Confirmed', 'Checked in', 'Waiting', 'In consultation', 'Completed', 'No show', 'Cancelled'] as AppointmentStatus[]).map((s) => ({ value: s, label: s })),
                },
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
                { label: 'Reschedule', onSelect: () => setBooking({ open: true, preset: { doctorId: a.doctorId } }) },
                { label: 'Cancel appointment', danger: true, separated: true, onSelect: () => move(a.id, 'Cancelled') },
              ]}
              onInlineEdit={(id, key, value) => move(id, value as AppointmentStatus)}
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
        appointments={appointments}
        preset={booking.preset}
        onBooked={book}
      />

      {/* ------------------------------------------------------------- appointment detail */}
      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.token} · ${detail.patient.name}` : ''}
        description={detail ? `${doctorById(detail.doctorId).name} · ${doctorById(detail.doctorId).room} · ${timeLabel(detail.start)}` : ''}
        width="md"
        footer={
          detail && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.open(`/print/appointment-slip?id=${detail.id}`, '_blank')}>Print slip</Button>
              <Link href={`/patients/${detail.patient.mrn}`}><Button>Open patient</Button></Link>
              <Button variant="ghost" onClick={() => push({ title: 'Reminder queued', description: 'WhatsApp/SMS from the outbox', tone: 'info' })}>Send reminder</Button>
            </div>
          )
        }
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['MRN', detail.patient.mrn],
                ['Age / sex', `${detail.patient.age} · ${detail.patient.sex}`],
                ['Mobile', detail.patient.phone],
                ['Type', detail.type],
                ['Priority', detail.priority],
                ['Source', detail.source],
                ['Mode', detail.liveConsultation ? 'Live consultation' : 'In person'],
                ['Booked at', detail.createdAt.slice(11)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-border-subtle pb-1">
                  <dt className="text-text-secondary">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-sm font-medium text-text-secondary">Reason for visit</p>
              <p className="text-base">{detail.reason}</p>
            </div>

            {detail.patient.allergies && (
              <SafetyBanner severity="warning" title={`Allergy on record: ${detail.patient.allergies}`} />
            )}

            <div>
              <p className="mb-1 text-sm font-medium text-text-secondary">Move this appointment</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_FLOW[detail.status].length === 0 && (
                  <p className="text-sm text-text-tertiary">This appointment is {detail.status.toLowerCase()} — no further moves.</p>
                )}
                {STATUS_FLOW[detail.status].map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === 'Cancelled' || to === 'No show' ? 'danger' : 'secondary'}
                    onClick={() => move(detail.id, to)}
                  >
                    {to}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
