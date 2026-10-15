'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  FieldSection,
  KpiTile,
  Panel,
  SafetyBanner,
  Segmented,
  SelectField,
  Sheet,
  TextAreaField,
  TextField,
  cx,
  useToast,
} from '@dizi/ui';
import { BadgeCheck, Camera, Clock, DoorOpen, MessageSquare, PhoneCall, Radio, ShieldAlert, Video } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { staffDirectory } from '@/lib/hr';
import { useShell } from '@/lib/shell';
import {
  CHANNEL_QUALITY,
  DEVICE_CHECKS,
  OUTCOME_PROMPTS,
  PATIENT_BRIEFING,
  ROOM_ROLES,
  TELE_RULES,
  TELE_WAITING,
  checkSession,
  clockOf,
  consultDay,
  lateRooms,
  minutesOf,
  nextRoom,
  teleDoctors,
  waitingMinutes,
  type Channel,
  type Recording,
  type TeleSession,
} from '@/lib/telemedicine';

/* Live Consultation (P8) — the room, the queue and the outcome.
 *
 * The screen is built around the one thing that makes telemedicine different from a clinic: nobody is in the same
 * building, so a mistake is not visible until the patient has already travelled to a phone. Four decisions follow
 * from that, and they are the four things this screen does that a list of rooms would not:
 *
 *  1. **The waiting list is ordered by arrival**, and says how long each patient has been sitting there. That is
 *     the queue the patient can see from the corridor, and the one the desk is judged on.
 *  2. **The room is tested before the doctor joins.** The pre-call checks are on the sheet, with the fallback for
 *     each one — a consultation lost to a muted microphone cannot be given back to the patient.
 *  3. **Consent is taken, not assumed.** Recording is a question the patient answers; the register keeps the
 *     answer, and "refused" is a normal state rather than an error.
 *  4. **Ending a room asks for the outcome**, because "ended" alone tells the next clinician nothing.
 *
 * The room is allocated at this node and the booking is queued (`bookTeleSession`), which is what lets the desk
 * book a consultation with the uplink down. The slot itself belongs to the branch that took the booking: if
 * another branch has it, the refusal arrives when the queue drains, with the alternatives, and never as a silent
 * move of the patient.
 */

const CHANNEL_ICON: Record<Channel, React.ReactNode> = {
  video: <Video className="size-3.5" aria-hidden />,
  audio: <PhoneCall className="size-3.5" aria-hidden />,
  chat: <MessageSquare className="size-3.5" aria-hidden />,
};

const STATUS_TONE: Record<TeleSession['status'], string> = {
  scheduled: 'text-text-secondary',
  waiting: 'text-brand-700',
  live: 'text-safety-success',
  ended: 'text-text-tertiary',
  missed: 'text-safety-critical-text',
};

const STATUS_LABEL: Record<TeleSession['status'], string> = {
  scheduled: 'Booked',
  waiting: 'Waiting',
  live: 'In the room',
  ended: 'Ended',
  missed: 'Did not join',
};

interface Draft {
  title: string;
  channel: Channel;
  patientMrn: string;
  patientName: string;
  patientAge: string;
  doctorId: string;
  attendants: string;
  department: string;
  clock: string;
  durationMin: string;
  recording: Recording;
  consentRef: string;
  reason: string;
  followUpOn: string;
}

export default function LiveConsultationPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const directory = useMemo(() => staffDirectory(day), [day]);
  const doctors = useMemo(() => teleDoctors(directory), [directory]);
  const [extra, setExtra] = useState<TeleSession[]>([]);
  const [view, setView] = useState('Today');
  const [booking, setBooking] = useState(false);
  const [ending, setEnding] = useState<TeleSession | null>(null);
  const [outcome, setOutcome] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [recording, setRecording] = useState<Recording>('none');
  const [consentTaken, setConsentTaken] = useState('');
  const [draft, setDraft] = useState<Draft>({
    title: '',
    channel: 'video',
    patientMrn: '',
    patientName: '',
    patientAge: '',
    doctorId: doctors[0]?.id ?? 'dr-rahman',
    attendants: '',
    department: doctors[0]?.department ?? 'Medicine',
    clock: '',
    durationMin: '15',
    recording: 'none',
    consentRef: '',
    reason: '',
    followUpOn: '',
  });

  const grid = useMemo(() => consultDay(day, extra), [day, extra]);
  /* The room clock, read after mount rather than while rendering.
   *
   * A minute read during render is the one value on this page the server and the browser can disagree about: the
   * HTML arrives carrying the minute the page was built at, the browser renders the minute it was opened at, and
   * React reports the difference as a hydration failure — on the screen a nurse is reading while a patient waits.
   * So `now` starts unknown on both sides, the screen below says what it is waiting for, and the rooms and the
   * queue appear the moment the browser has read the time. It is re-read every half minute while the page is open,
   * because a waiting list that stops counting is worse than one that never started.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    read();
    const every = setInterval(read, 30_000);
    return () => clearInterval(every);
  }, []);
  const liveDoctors = useMemo(() => grid.live.map((s) => s.doctorId), [grid.live]);

  const rows = useMemo(() => {
    const q = view;
    if (q === 'Waiting') return grid.waiting;
    if (q === 'In the room') return grid.live;
    if (q === 'Ended') return grid.sessions.filter((s) => s.status === 'ended');
    if (q === 'Did not join') return grid.sessions.filter((s) => s.status === 'missed');
    if (q === 'Recorded') return grid.sessions.filter((s) => s.recording !== 'none');
    return [...grid.sessions].sort((a, b) => a.start - b.start);
  }, [grid, view]);

  const check = useMemo(
    () =>
      checkSession(
        {
          kind: 'consultation',
          title: draft.title,
          channel: draft.channel,
          patientMrn: draft.patientMrn,
          patientAge: draft.patientAge.trim() === '' ? null : Number(draft.patientAge),
          doctorId: draft.doctorId,
          participants: draft.attendants.split(',').map((s) => s.trim()).filter(Boolean),
          department: draft.department,
          start: draft.clock ? minutesOf(draft.clock) : (now ?? 0),
          durationMin: Number(draft.durationMin),
          recording: draft.recording,
          consentRef: draft.consentRef,
          attendantName: draft.attendants.split(',')[0]?.trim() ?? '',
          reason: draft.reason,
          externalGuest: '',
          followUpOn: draft.followUpOn,
        },
        { nowMinute: now ?? 0, day, sessions: grid.sessions, liveDoctorIds: liveDoctors, directory, cloudReachable: false },
      ),
    [draft, now, day, grid.sessions, liveDoctors, directory],
  );

  const doctor = doctors.find((d) => d.id === draft.doctorId) ?? doctors[0];
  const late = useMemo(() => lateRooms(grid.sessions), [grid.sessions]);

  /* Every hook is above this line, so it is the earliest point the clock may be waited on — and the only one: the
   * handlers and the room cards below all read `now`, and the one thing that must not happen is a hook running
   * after a return. The minute the form was opened is not needed to draw a room list. */
  if (now === null) {
    return (
      <div className="space-y-3">
        <AdminHeader screenId="live-consultation" subtitle={`${day} · reading this node’s clock…`} />
        <Panel title="The room clock">
          <p className="text-sm text-text-secondary">
            The waiting list is ordered by the minute each patient arrived and every room card is read against the
            current minute, so this screen reads the clock in the browser rather than printing the minute the page
            was built at. The rooms, the queue and the registers appear the moment that read lands.
          </p>
        </Panel>
      </div>
    );
  }

  const longestWait = grid.waiting.length ? Math.max(...grid.waiting.map((s) => waitingMinutes(s, now))) : 0;

  const open = (session: TeleSession) => {
    const fresh = checkSession(
      {
        kind: 'consultation',
        title: session.title,
        channel: session.channel,
        patientMrn: session.patientMrn ?? '',
        patientAge: session.patientAge,
        doctorId: session.doctorId,
        participants: session.participants,
        department: session.department,
        start: session.start,
        durationMin: session.durationMin,
        recording: session.recording,
        consentRef: session.consentRef,
        attendantName: session.attendantName,
        reason: session.reason,
        externalGuest: '',
        followUpOn: session.followUpOn ?? '',
      },
      { nowMinute: now, day, sessions: grid.sessions, liveDoctorIds: liveDoctors.filter((id) => id !== session.doctorId), directory, cloudReachable: false },
    );
    if (!fresh.ok) {
      push({ title: `The room does not open — ${fresh.reasons[0].code}`, description: fresh.reasons[0].message, tone: 'critical' });
      return;
    }
    setExtra((list) => [
      { ...session, status: 'live', startedAt: now, waitingSince: session.waitingSince ?? now, version: session.version + 1 },
      ...list.filter((s) => s.id !== session.id),
    ]);
    const wrote = queueWrite(`Open ${session.room} — ${session.patientName ?? session.title}`, {
      id: 'startTeleSession',
      recordId: session.room,
      fields: { room: session.room, kind: 'consultation', doctor: session.doctorId, channel: session.channel, startedAt: clockOf(now), recording: session.recording },
    });
    push({
      title: `${session.room} is open`,
      description: `Started at ${clockOf(now)}, booked for ${clockOf(session.start)} — the register keeps both times.${wrote.queued ? ' Queued for the cloud; the room itself is this node’s.' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const end = () => {
    if (!ending) return;
    if (!outcome.trim()) {
      push({ title: 'The room needs an outcome', description: OUTCOME_PROMPTS[0], tone: 'critical' });
      return;
    }
    if (recording !== 'none' && !consentTaken.trim()) {
      push({ title: 'Recording needs consent on the record', description: 'Name the person who took the consent, and the reference it is filed under. A recording without that is a recording the hospital cannot justify.', tone: 'critical' });
      return;
    }
    const updated: TeleSession = {
      ...ending,
      status: 'ended',
      endedAt: now,
      outcome: outcome.trim(),
      followUpOn: followUpOn.trim() || null,
      recording,
      consentRef: recording === 'none' ? ending.consentRef : consentTaken.trim(),
      version: ending.version + 1,
    };
    setExtra((list) => [updated, ...list.filter((s) => s.id !== ending.id)]);
    setEnding(null);
    setOutcome('');
    setFollowUpOn('');
    setConsentTaken('');
    setRecording('none');
    const wrote = queueWrite(`End ${ending.room} — ${ending.patientName ?? ending.title}`, {
      id: 'endTeleSession',
      recordId: ending.room,
      fields: { room: ending.room, endedAt: clockOf(now), duration: `${Math.max(1, now - (ending.startedAt ?? ending.start))} min`, outcome: updated.outcome.slice(0, 80), followUpOn: updated.followUpOn, recording },
    });
    push({
      title: `${ending.room} ended`,
      description: `${Math.max(1, now - (ending.startedAt ?? ending.start))} minutes in the room against ${ending.durationMin} booked.${updated.followUpOn ? ` Follow-up ${updated.followUpOn} goes on the patient’s next-visit list.` : ' No follow-up date — the outcome text carries what happens next.'}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const book = () => {
    const fresh = checkSession(
      {
        kind: 'consultation',
        title: draft.title,
        channel: draft.channel,
        patientMrn: draft.patientMrn,
        patientAge: draft.patientAge.trim() === '' ? null : Number(draft.patientAge),
        doctorId: draft.doctorId,
        participants: draft.attendants.split(',').map((s) => s.trim()).filter(Boolean),
        department: draft.department,
        start: draft.clock ? minutesOf(draft.clock) : now,
        durationMin: Number(draft.durationMin),
        recording: draft.recording,
        consentRef: draft.consentRef,
        attendantName: draft.attendants.split(',')[0]?.trim() ?? '',
        reason: draft.reason,
        externalGuest: '',
        followUpOn: draft.followUpOn,
      },
      { nowMinute: now, day, sessions: grid.sessions, liveDoctorIds: liveDoctors, directory, cloudReachable: false },
    );
    if (!fresh.ok) {
      push({ title: `The booking is refused — ${fresh.reasons[0].code}`, description: fresh.reasons[0].message, tone: 'critical' });
      return;
    }
    const start = draft.clock ? minutesOf(draft.clock) : now;
    const session: TeleSession = {
      id: `tele-new-${extra.length + 1}`,
      kind: 'consultation',
      title: draft.title.trim(),
      room: nextRoom('consultation', day, grid.sessions),
      channel: draft.channel,
      patientMrn: draft.patientMrn.trim(),
      patientName: draft.patientName.trim() || 'Registered patient',
      patientAge: draft.patientAge.trim() === '' ? null : Number(draft.patientAge),
      doctorId: draft.doctorId,
      doctorName: doctor.name,
      participants: draft.attendants.split(',').map((s) => s.trim()).filter(Boolean),
      department: draft.department,
      start,
      durationMin: Number(draft.durationMin),
      status: 'scheduled',
      waitingSince: null,
      startedAt: null,
      endedAt: null,
      outcome: '',
      followUpOn: draft.followUpOn.trim() || null,
      recording: draft.recording,
      consentRef: draft.consentRef.trim(),
      attendantName: draft.attendants.split(',')[0]?.trim() ?? '',
      reason: draft.reason.trim(),
      externalGuest: '',
      version: 1,
    };
    setExtra((list) => [session, ...list]);
    setBooking(false);
    const wrote = queueWrite(`Book ${session.room} — ${session.patientName} with ${doctor.name}`, {
      id: 'bookTeleSession',
      recordId: session.room,
      fields: { room: session.room, kind: 'consultation', patientMrn: session.patientMrn, patientName: session.patientName, doctor: session.doctorId, channel: session.channel, start: clockOf(start), duration: session.durationMin, reason: session.reason },
    });
    setDraft((d) => ({ ...d, title: '', patientMrn: '', patientName: '', patientAge: '', reason: '', clock: '', consentRef: '', attendants: '' }));
    push({
      title: `${session.room} booked for ${clockOf(start)}`,
      description: `The join link goes to the patient through the portal, and the desk has the room number for the telephone call that follows a bad connection. ${fresh.warnings.length ? `${fresh.warnings.length} thing(s) the register notes: ${fresh.warnings.map((w) => w.message).join(' ')}` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (fresh.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="live-consultation"
        subtitle={`${day} · ${grid.stats.total} rooms · ${grid.stats.live} live · ${grid.waiting.length} waiting, longest ${longestWait} min.`}
        actions={
          <>
            <Link href="/admin/setup/zoom">
              <Button variant="ghost">Telemedicine settings</Button>
            </Link>
            <Link href="/admin/live/meeting">
              <Button variant="ghost">Live meetings</Button>
            </Link>
            <Button variant="primary" onClick={() => setBooking(true)}>
              <DoorOpen className="size-4" aria-hidden /> Book a consultation
            </Button>
          </>
        }
        waiting={grid.stats.missed ? `${grid.stats.missed} patient(s) did not join a booked room today. The desk telephones each one before the day closes — a missed video consultation is a patient who still has the problem.` : undefined}
      />

      <AdminSiblings screenId="live-consultation" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Rooms booked" value={String(grid.stats.total)} definition="Consultations with a room allocated by this node. The room number exists before the cloud is asked about the slot, which is what lets the desk book with the uplink down." asOf={day} />
        <KpiTile label="Waiting now" value={String(grid.waiting.length)} definition="Patients in the room and not yet seen. The queue is ordered by the time they arrived, not the time they were booked." asOf={clockOf(now)} footnote={grid.waiting.length ? `longest wait ${longestWait} min` : undefined} />
        <KpiTile label="In the room" value={String(grid.stats.live)} definition="Live consultations. One room at a time per doctor — the second patient in front of a camera is the failure this count exists to prevent." asOf={clockOf(now)} />
        <KpiTile label="Ended with an outcome" value={String(grid.sessions.filter((s) => s.status === 'ended' && s.outcome.trim()).length)} definition="Rooms closed with something written down. An end time on its own tells the next clinician nothing, so the register counts the outcomes rather than the endings." asOf={day} />
        <KpiTile label="Average wait" value={`${grid.stats.avgWaitMin} min`} definition="Arrival to the doctor joining, over the rooms that ran. This is the number the clinic argues about, so it is computed from the same fields the register stores." asOf={day} />
        <KpiTile label="Did not join" value={`${grid.stats.missed}`} definition="Booked, reminded, and nobody in the room. The screen keeps the reminder that was sent and the call that was made, because “no-show” on its own blames the patient." asOf={day} footnote={grid.stats.missed ? 'telephone each one before the day closes' : undefined} />
        <KpiTile label="Recordings" value={String(grid.stats.consentedRecording)} definition="Rooms where the patient agreed to be recorded. Consent is a field on the session with a reference, not a tick in a settings screen." asOf={day} />
      </div>

      {grid.waiting.length > 0 && (
        <Panel
          title="The waiting list"
          actions={<span className="text-xs text-text-secondary">ordered by arrival · {grid.waiting.length} in the room</span>}
        >
          <ul className="space-y-1">
            {grid.waiting.map((session) => {
              const waited = waitingMinutes(session, now);
              return (
                <li key={session.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2', waited > 15 ? 'border-safety-warning' : 'border-border-subtle')}>
                  <span className="font-numeric text-xs text-text-tertiary">{session.room}</span>
                  <span className="font-medium text-text-primary">{session.patientName}</span>
                  <span className="text-xs text-text-secondary">{session.patientAge !== null ? `${session.patientAge} y · ` : ''}{session.reason}</span>
                  <span className={cx('text-xs', waited > 15 ? 'text-safety-warning-text' : 'text-text-secondary')}>waiting {waited} min</span>
                  <span className="text-xs text-text-tertiary">{session.doctorName} · booked {clockOf(session.start)} · {session.channel}</span>
                  {session.attendantName && <span className="text-xs text-text-tertiary">with {session.attendantName}</span>}
                  <span className="ml-auto">
                    <Button variant="secondary" onClick={() => open(session)} disabled={liveDoctors.includes(session.doctorId)}>
                      <Radio className="size-3.5" aria-hidden /> {liveDoctors.includes(session.doctorId) ? 'Doctor in another room' : 'Open the room'}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {late.length > 0 && (
        <SafetyBanner severity="warning" title={`${late[0].minutes} minutes late on the first room of the day`}>
          <p>
            {late.map((l) => `${l.session.room} started ${l.minutes} min after ${clockOf(l.session.start)}`).join(' · ')}. A late start is
            kept as a late start: the register holds the booked time and the started time apart instead of rewriting one into the other, because
            the clinic reads this figure next month and the patients in this queue are the ones it was taken from.
          </p>
        </SafetyBanner>
      )}

      <Panel
        title="The room register"
        actions={
          <Segmented
            label="Which rooms"
            name="consult-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Today', label: `All (${grid.sessions.length})` },
              { value: 'Waiting', label: `Waiting (${grid.waiting.length})` },
              { value: 'In the room', label: `Live (${grid.stats.live})` },
              { value: 'Ended', label: `Ended (${grid.stats.ended})` },
              { value: 'Did not join', label: `Missed (${grid.stats.missed})` },
              { value: 'Recorded', label: `Recorded (${grid.stats.consentedRecording})` },
            ]}
          />
        }
      >
        <ListView
          id="consult-room-register"
          caption={`Telemedicine consultations for ${day}`}
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => (row.status === 'waiting' ? open(row) : row.status === 'live' ? setEnding(row) : undefined)}
          rowActions={(row) => [
            ...(row.status === 'waiting' || row.status === 'scheduled'
              ? [{ label: 'Open', onSelect: () => open(row) }]
              : []),
            ...(row.status === 'live'
              ? [{ label: 'End and record outcome', onSelect: () => { setEnding(row); setOutcome(row.outcome); setRecording(row.recording); } }]
              : []),
            { label: 'Patient record', onSelect: () => push({ title: `${row.patientName} · ${row.patientMrn}`, description: 'The consultation register carries the MRN; the record itself is the patient screen’s.', tone: 'info' }) },
          ]}
          quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Searching is server-side in production — the register pages from the branch replica.' }}
          columns={[
            { key: 'room', header: 'Room', width: '9rem', render: (row) => <span className="font-numeric text-xs">{row.room}</span> },
            { key: 'start', header: 'Booked', width: '5.5rem', render: (row) => <span className="font-numeric">{clockOf(row.start)}</span>, sortable: true },
            { key: 'patient', header: 'Patient', render: (row) => row.patientName ?? row.title },
            { key: 'age', header: 'Age', width: '4rem', numeric: true, hideBelow: 'lg', render: (row) => (row.patientAge === null ? '—' : String(row.patientAge)) },
            { key: 'attendant', header: 'In the room with them', hideBelow: 'xl', render: (row) => row.attendantName || <span className="text-text-tertiary">nobody named</span> },
            { key: 'doctor', header: 'Doctor', render: (row) => row.doctorName },
            { key: 'channel', header: 'Channel', width: '6rem', render: (row) => <span className="flex items-center gap-1">{CHANNEL_ICON[row.channel]}{row.channel}</span> },
            { key: 'status', header: 'Status', width: '8rem', render: (row) => <span className={cx('font-medium', STATUS_TONE[row.status])}>{STATUS_LABEL[row.status]}</span> },
            { key: 'wait', header: 'Wait', width: '4.5rem', numeric: true, render: (row) => (row.waitingSince !== null && row.startedAt !== null ? `${row.startedAt - row.waitingSince} min` : row.status === 'waiting' ? `${waitingMinutes(row, now)} min` : '—') },
            { key: 'outcome', header: 'Outcome', render: (row) => (row.outcome ? <span className="line-clamp-1 text-text-secondary">{row.outcome}</span> : <span className="text-text-tertiary">{row.status === 'missed' ? 'see the note' : 'not written yet'}</span>) },
            { key: 'recording', header: 'Recording', width: '7rem', hideBelow: 'lg', render: (row) => (row.recording === 'none' ? <span className="text-text-tertiary">not recorded</span> : row.recording === 'consented' ? <span className="text-safety-success">consented</span> : <span className="text-text-secondary">refused</span>) },
          ]}
        />
      </Panel>

      <Panel title="What the register enforces" actions={<span className="text-xs text-text-secondary">{TELE_RULES.length} rules · {ROOM_ROLES.length} roles</span>}>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {TELE_RULES.map((rule) => (
            <div key={rule.key} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="text-sm font-medium text-text-primary">{rule.label}</p>
              <p className="mt-0.5 text-xs text-text-secondary">{rule.because}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="rounded-md border border-border-subtle px-3 py-2">
            <p className="text-xs font-medium text-text-primary">Who may be in the room</p>
            <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
              {ROOM_ROLES.map((r) => (
                <li key={r.role}>
                  <span className="font-medium text-text-primary">{r.role}</span> — {r.may}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-border-subtle px-3 py-2">
            <p className="text-xs font-medium text-text-primary">What the patient is told before the room opens</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
              {PATIENT_BRIEFING.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-tertiary">
              The wording lives in the branch’s telemedicine setting (<Link className="underline" href="/admin/setup/zoom">Setup › Zoom Setting</Link>), so the
              screen and the message the patient gets cannot drift apart.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {TELE_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={booking}
        onClose={() => setBooking(false)}
        title="Book a telemedicine consultation"
        description="The room is allocated by this node now; the appointment slot is confirmed when the queue drains."
        width="xl"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {check.ok ? `${nextRoom('consultation', day, grid.sessions)} will be this node’s next room.` : `${check.reasons.length} refusal(s) — the screen will not save until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => setBooking(false)}>Cancel</Button>
            <Button variant="primary" onClick={book} disabled={!check.ok}>
              <BadgeCheck className="size-4" aria-hidden /> Book and allocate the room
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The register refuses this booking — ${check.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {check.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {check.ok && check.warnings.length > 0 && (
            <SafetyBanner severity="warning" title="Booked, with something the register notes">
              <ul className="list-disc space-y-1 pl-5">
                {check.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="Who and why" description="A consultation names a patient. The reason is what the doctor reads before joining.">
            <TextField label="Room title" name="title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} hint="Shown on the waiting list and the register, e.g. “Follow-up — hypertension”." required />
            <TextField label="Patient MRN" name="patientMrn" value={draft.patientMrn} onChange={(e) => setDraft((d) => ({ ...d, patientMrn: e.target.value }))} hint="The register refuses a consultation without one — a room with no MRN is a meeting." required />
            <TextField label="Patient name" name="patientName" value={draft.patientName} onChange={(e) => setDraft((d) => ({ ...d, patientName: e.target.value }))} hint="What the doctor sees on the join screen." />
            <TextField label="Patient age" name="patientAge" value={draft.patientAge} onChange={(e) => setDraft((d) => ({ ...d, patientAge: e.target.value }))} inputMode="numeric" hint="Under 18 needs an adult named in the room before the room will open." />
            <TextField label="Reason for the consultation" name="reason" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} hint="One line, in the patient’s words where possible." required />
            <SelectField
              label="Department"
              name="department"
              value={draft.department}
              onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
              options={[...new Set(doctors.map((d) => d.department))].map((dep) => ({ value: dep, label: dep }))}
            />
          </FieldSection>

          <FieldSection title="The room" description="This node allocates the room name and the doctor; the slot belongs to the branch that took the booking.">
            <SelectField
              label="Doctor"
              name="doctorId"
              value={draft.doctorId}
              onChange={(e) => setDraft((d) => ({ ...d, doctorId: e.target.value }))}
              options={doctors.map((d) => ({ value: d.id, label: `${d.name} — ${d.department}` }))}
              hint="A doctor already live in another room cannot be picked, and the sheet says so rather than letting the booking fail later."
            />
            <TextField label="Start" name="clock" value={draft.clock} onChange={(e) => setDraft((d) => ({ ...d, clock: e.target.value }))} placeholder={clockOf(now)} hint="24-hour clock. A time more than fifteen minutes ago is refused: the register will not pretend a room was booked before it was." />
            <SelectField label="Length" name="durationMin" value={draft.durationMin} onChange={(e) => setDraft((d) => ({ ...d, durationMin: e.target.value }))} options={['10', '15', '20', '30', '45', '60'].map((v) => ({ value: v, label: `${v} minutes` }))} hint="Ten minutes is a report review; an hour is a clinic session, not one consultation." />
            <SelectField
              label="Channel"
              name="channel"
              value={draft.channel}
              onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value as Channel }))}
              options={CHANNEL_QUALITY.map((c) => ({ value: c.channel, label: c.channel }))}
              hint={CHANNEL_QUALITY.find((c) => c.channel === draft.channel)?.needs}
            />
            <TextField label="In the room with the patient" name="attendants" value={draft.attendants} onChange={(e) => setDraft((d) => ({ ...d, attendants: e.target.value }))} hint="Nurse, attendant or interpreter, comma separated. A paediatric or assisted consultation needs the first one named." />
          </FieldSection>

          <FieldSection title="Consent" description="What the patient agreed to before the room opens. Recording is a question, and “refused” is an answer.">
            <SelectField
              label="Recording"
              name="recording"
              value={draft.recording}
              onChange={(e) => setDraft((d) => ({ ...d, recording: e.target.value as Recording }))}
              options={[
                { value: 'none', label: 'Not recorded' },
                { value: 'consented', label: 'Recorded, with consent' },
                { value: 'refused', label: 'Recording offered and refused' },
              ]}
              hint="The register keeps the answer either way: a refusal is a fact about the consultation."
            />
            <TextField label="Consent reference" name="consentRef" value={draft.consentRef} onChange={(e) => setDraft((d) => ({ ...d, consentRef: e.target.value }))} hint="Required when recording. The consultation cannot be recorded without it, and the sheet will not save." />
            <TextField label="Next contact" name="followUpOn" value={draft.followUpOn} onChange={(e) => setDraft((d) => ({ ...d, followUpOn: e.target.value }))} placeholder="YYYY-MM-DD" hint="Optional now, asked for again when the room ends — the outcome is where it is usually decided." />
          </FieldSection>

          <FieldSection title="Before the doctor joins" description="Five checks, each with the thing to do when it fails. A consultation lost to a muted microphone cannot be given back to the patient.">
            {DEVICE_CHECKS.map((c) => (
              <div key={c.key} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-center gap-1 text-sm font-medium text-text-primary">
                  {c.key === 'consent' ? <ShieldAlert className="size-3.5" aria-hidden /> : <Camera className="size-3.5" aria-hidden />}
                  {c.label}
                </p>
                <p className="text-xs text-safety-success">{c.passes}</p>
                <p className="text-xs text-text-tertiary">{c.fails}</p>
              </div>
            ))}
          </FieldSection>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(ending)}
        onClose={() => setEnding(null)}
        title={ending ? `End ${ending.room}` : 'End the room'}
        description="The outcome is what the follow-up list is built from, and it is written while the doctor still remembers the consultation."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {ending ? `Booked ${clockOf(ending.start)} · started ${ending.startedAt ? clockOf(ending.startedAt) : '—'} · ${ending.durationMin} min booked` : ''}
            </span>
            <Button variant="ghost" onClick={() => setEnding(null)}>Cancel</Button>
            <Button variant="primary" onClick={end} disabled={!outcome.trim()}>
              <Clock className="size-4" aria-hidden /> End and record the outcome
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
            <p className="text-sm font-medium text-text-primary">{ending?.patientName} · {ending?.patientMrn}</p>
            <p>{ending?.reason}</p>
            {ending?.attendantName && <p className="text-text-tertiary">With {ending.attendantName} in the room.</p>}
          </div>

          <FieldSection title="The outcome" description="Three sentences is enough; three prompts are on the sheet because the third one is the one that gets forgotten.">
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField
                label="What was decided"
                name="outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                rows={5}
                hint={OUTCOME_PROMPTS.join(' ')}
                required
              />
            </div>
            <TextField label="Next contact" name="outcomeFollowUp" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} placeholder="YYYY-MM-DD" hint="Leave empty when the outcome text already carries what happens next." />
            <SelectField
              label="Recording"
              name="endRecording"
              value={recording}
              onChange={(e) => setRecording(e.target.value as Recording)}
              options={[
                { value: 'none', label: 'Not recorded' },
                { value: 'consented', label: 'Recorded, with consent' },
                { value: 'refused', label: 'Recording offered and refused' },
              ]}
            />
            <TextField label="Who took the consent" name="consentTaken" value={consentTaken} onChange={(e) => setConsentTaken(e.target.value)} hint="Required when recording: a name and the reference it is filed under." />
          </FieldSection>

          <SafetyBanner severity="info" title="Ending the room does not end the patient’s problem">
            <p>
              A patient who needs to be seen in person needs an appointment before this room closes, not a note saying so. The follow-up date goes on
              the patient’s next-visit list, which is the same list the physical clinic uses — one list, whether the consultation was on a screen or in
              a chamber.
            </p>
          </SafetyBanner>
        </div>
      </Sheet>
    </div>
  );
}
