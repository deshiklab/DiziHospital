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
import { Gavel, MessageSquare, PhoneCall, Radio, Users, UserX, Video } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { staffDirectory, type HrStaff } from '@/lib/hr';
import { useShell } from '@/lib/shell';
import {
  COMMITTEES,
  MEETING_RULES,
  MEETING_WAITING,
  MINUTE_PROMPTS,
  checkMeeting,
  clockOf,
  meetingDay,
  meetingStats,
  minutesOf,
  nextRoom,
  type Channel,
  type TeleSession,
} from '@/lib/telemedicine';

/* Live Meeting (P8) — the same room, and the rules that make it a meeting.
 *
 * A meeting shares the consultation's record, its waiting list and its lifecycle. What this screen adds is the
 * part a hospital is judged on afterwards: an agenda before the room opens, a host who can end it, a quorum for
 * the committees that take decisions, and minutes that name who decided what. The one rule that is on the screen
 * rather than in a policy document is the guest rule — while an outside guest is in the room, nothing with a
 * patient identifier goes on the shared screen.
 *
 * Cancelling an occurrence and cancelling a series are deliberately two acts: a standing handover happens every
 * morning and cancelling today is normal, while cancelling the series has to be deliberate.
 */

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
  ended: 'Minuted',
  missed: 'Did not run',
};

const PURPOSE_OPTIONS = [
  { value: 'handover', label: 'Handover — the ward passes to the next shift' },
  { value: 'committee', label: 'Committee — a decision that binds other people' },
  { value: 'training', label: 'Training — teaching with an attendance record' },
  { value: 'review', label: 'Case review — no outside guests' },
  { value: 'planning', label: 'Planning — rosters, stock, space' },
];

interface Draft {
  title: string;
  purpose: string;
  committeeId: string;
  hostStaffId: string;
  department: string;
  invitees: string;
  clock: string;
  durationMin: string;
  channel: Channel;
  agenda: string;
  externalGuest: string;
  guestHost: string;
  documentsShown: string;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
}

const agendaLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export default function LiveMeetingPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const directory = useMemo(() => staffDirectory(day), [day]);
  const [extra, setExtra] = useState<TeleSession[]>([]);
  const [view, setView] = useState('Today');
  const [booking, setBooking] = useState(false);
  const [minuting, setMinuting] = useState<TeleSession | null>(null);
  const [decisions, setDecisions] = useState('');
  const [present, setPresent] = useState('');
  const [draft, setDraft] = useState<Draft>({
    title: '',
    purpose: 'handover',
    committeeId: 'ops',
    hostStaffId: '',
    department: 'Medicine',
    invitees: '',
    clock: '',
    durationMin: '30',
    channel: 'video',
    agenda: '',
    externalGuest: '',
    guestHost: '',
    documentsShown: '',
    recurrence: 'once',
  });

  const grid = useMemo(() => meetingDay(day, extra), [day, extra]);
  const stats = useMemo(() => meetingStats(grid.sessions), [grid.sessions]);
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

  const rows = useMemo(() => {
    if (view === 'Live') return grid.live;
    if (view === 'Booked') return grid.upcoming;
    if (view === 'Minuted') return grid.sessions.filter((s) => s.status === 'ended');
    if (view === 'Did not run') return grid.sessions.filter((s) => s.status === 'missed');
    if (view === 'With a guest') return grid.sessions.filter((s) => s.externalGuest.trim());
    return [...grid.sessions].sort((a, b) => a.start - b.start);
  }, [grid, view]);

  const invitees = useMemo(() => draft.invitees.split(',').map((s) => s.trim()).filter(Boolean), [draft.invitees]);

  const check = useMemo(
    () =>
      checkMeeting(
        {
          title: draft.title,
          purpose: draft.purpose as 'handover' | 'committee' | 'training' | 'review' | 'planning',
          committeeId: draft.purpose === 'committee' ? draft.committeeId : '',
          hostStaffId: draft.hostStaffId,
          department: draft.department,
          invitees,
          start: draft.clock ? minutesOf(draft.clock) : (now ?? 0),
          durationMin: Number(draft.durationMin),
          channel: draft.channel,
          agenda: agendaLines(draft.agenda),
          externalGuest: draft.externalGuest,
          guestHost: draft.guestHost,
          documentsShown: draft.documentsShown,
          recurrence: draft.recurrence,
        },
        { nowMinute: now ?? 0, day, sessions: grid.sessions, liveDoctorIds: grid.live.map((s) => s.doctorId), directory, cloudReachable: false },
      ),
    [draft, invitees, now, day, grid.sessions, grid.live, directory],
  );

  const committee = COMMITTEES.find((c) => c.id === draft.committeeId);

  const inviteeOptions = useMemo(
    () => directory.slice(0, 40).map((m: HrStaff) => `${m.code}`),
    [directory],
  );

  /* The clock is waited on here, after the last hook and before the first handler, for the same reason the
   * consultation screen does it: a minute read during render is a hydration failure, and a return cannot sit
   * between two hooks. */
  if (now === null) {
    return (
      <div className="space-y-3">
        <AdminHeader screenId="live-meeting" subtitle={`${day} · reading this node’s clock…`} />
        <Panel title="The meeting clock">
          <p className="text-sm text-text-secondary">
            A meeting is judged on whether the room opened on the booked minute, so this screen reads the clock in
            the browser rather than printing the minute the page was built at. The rooms, the agenda and the
            minutes appear the moment that read lands.
          </p>
        </Panel>
      </div>
    );
  }

  const nameOf = (id: string) => directory.find((m) => m.id === id || m.code === id || m.name === id)?.name ?? id;

  const open = (session: TeleSession) => {
    setExtra((list) => [{ ...session, status: 'live', startedAt: now, version: session.version + 1 }, ...list.filter((s) => s.id !== session.id)]);
    const wrote = queueWrite(`Open ${session.room} — ${session.title}`, {
      id: 'startTeleSession',
      recordId: session.room,
      fields: { room: session.room, kind: 'meeting', host: session.doctorId, channel: session.channel, startedAt: clockOf(now), attendees: session.participants.length },
    });
    push({
      title: `${session.room} is open`,
      description: `${session.participants.length} invited, host ${nameOf(session.doctorId)}.${session.externalGuest ? ` ${session.externalGuest} is in the room — nothing with a patient identifier goes on the shared screen.` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (session.externalGuest ? 'warning' : 'success') : 'warning',
    });
  };

  const keepMinutes = () => {
    if (!minuting) return;
    if (!decisions.trim()) {
      push({ title: 'The minutes need the decisions', description: MINUTE_PROMPTS[0], tone: 'critical' });
      return;
    }
    const attendees = present.split(',').map((s) => s.trim()).filter(Boolean);
    const updated: TeleSession = { ...minuting, status: 'ended', endedAt: now, outcome: decisions.trim(), version: minuting.version + 1 };
    setExtra((list) => [updated, ...list.filter((s) => s.id !== minuting.id)]);
    const wrote = queueWrite(`Minutes for ${minuting.room} — ${minuting.title}`, {
      id: 'endTeleSession',
      recordId: minuting.room,
      fields: { room: minuting.room, kind: 'meeting', endedAt: clockOf(now), present: attendees.join(','), presentCount: attendees.length, decisions: updated.outcome.slice(0, 80) },
    });
    setMinuting(null);
    setDecisions('');
    setPresent('');
    push({
      title: `${minuting.room} minuted`,
      description: `${
        minuting.participants.length >= 4
          ? `Invited ${minuting.participants.length}, ${attendees.length || minuting.participants.length} present — the quorum is recorded from the attendance, not from the invitation.`
          : `Invited ${minuting.participants.length}: below the committee quorum, so the register records this as a discussion rather than a decision.`
      }${wrote.queued ? ' Queued for the cloud.' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const book = () => {
    if (!check.ok) {
      push({ title: `The booking is refused — ${check.reasons[0].code}`, description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const start = draft.clock ? minutesOf(draft.clock) : now;
    const session: TeleSession = {
      id: `mtg-new-${extra.length + 1}`,
      kind: 'meeting',
      title: draft.title.trim(),
      room: nextRoom('meeting', day, grid.sessions),
      channel: draft.channel,
      patientMrn: null,
      patientName: null,
      patientAge: null,
      doctorId: draft.hostStaffId,
      doctorName: nameOf(draft.hostStaffId),
      participants: invitees,
      department: draft.department,
      start,
      durationMin: Number(draft.durationMin),
      status: 'scheduled',
      waitingSince: null,
      startedAt: null,
      endedAt: null,
      outcome: '',
      followUpOn: null,
      recording: 'none',
      consentRef: '',
      attendantName: '',
      reason: agendaLines(draft.agenda)[0] ?? '',
      externalGuest: draft.externalGuest.trim(),
      version: 1,
    };
    setExtra((list) => [session, ...list]);
    setBooking(false);
    const wrote = queueWrite(`Book ${session.room} — ${session.title}`, {
      id: 'bookTeleSession',
      recordId: session.room,
      fields: { room: session.room, kind: 'meeting', host: session.doctorId, invitees: invitees.join(','), start: clockOf(start), duration: session.durationMin, recurrence: draft.recurrence, guest: session.externalGuest || null },
    });
    setDraft((d) => ({ ...d, title: '', hostStaffId: '', invitees: '', agenda: '', clock: '', externalGuest: '', guestHost: '', documentsShown: '' }));
    push({
      title: `${session.room} booked for ${clockOf(start)}${draft.recurrence !== 'once' ? ` (${draft.recurrence})` : ''}`,
      description: `${invitees.length} invited. ${check.warnings.length ? `The register notes: ${check.warnings.map((w) => w.message).join(' ')}` : 'Nothing the register had to note.'}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="live-meeting"
        subtitle={`${day} · ${grid.sessions.length} meetings · ${stats.invitedStaff} staff invited across ${stats.departments} departments · ${grid.live.length} in a room now.`}
        actions={
          <>
            <Link href="/admin/live/consultation">
              <Button variant="ghost">Live consultations</Button>
            </Link>
            <Link href="/admin/messaging">
              <Button variant="ghost">Send a notice</Button>
            </Link>
            <Button variant="primary" onClick={() => setBooking(true)}>
              <Users className="size-4" aria-hidden /> Book a meeting
            </Button>
          </>
        }
        waiting={stats.quorumRisk ? `${stats.quorumRisk} meeting(s) booked for half an hour or more with fewer than a quorum invited. They can still meet — the register will say they could not decide.` : undefined}
      />

      <AdminSiblings screenId="live-meeting" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Meetings today" value={String(grid.sessions.length)} definition="Rooms booked for staff rather than patients: handovers, committees, teaching and planning. A meeting that names a patient is a consultation and belongs on the other screen." asOf={day} />
        <KpiTile label="In a room now" value={String(grid.live.length)} definition="Meetings running. One host can only be in one room, which is checked at booking rather than discovered when the second one opens." asOf={clockOf(now)} />
        <KpiTile label="Staff invited" value={String(stats.invitedStaff)} definition="Distinct staff across the day’s invitations. Two hours of a consultant’s day is a clinic not held, so the register counts the people rather than the rooms." asOf={day} />
        <KpiTile label="Departments" value={String(stats.departments)} definition="Departments represented. A meeting that draws on three departments is the kind that has to have minutes; one department talking to itself is a huddle." asOf={day} />
        <KpiTile label="Minuted" value={String(grid.sessions.filter((s) => s.status === 'ended' && s.outcome.trim()).length)} definition="Rooms closed with the decisions written down. “Discussed” is not an outcome, so this counts the rooms with something a next meeting can start from." asOf={day} />
        <KpiTile label="Quorum at risk" value={String(stats.quorumRisk)} definition="Half an hour or more booked with fewer than the committee quorum invited. The meeting can still be held, and the register will record that it could not decide." asOf={day} footnote={stats.quorumRisk ? 'the register records the decision, or its absence' : undefined} />
        <KpiTile label="Outside guests" value={String(stats.withExternalGuest)} definition="Meetings with somebody from outside the hospital, each of which has a named internal host who is responsible for what is on the shared screen." asOf={day} />
      </div>

      {grid.live.some((s) => s.externalGuest.trim()) && (
        <SafetyBanner severity="warning" title="An outside guest is in a room right now">
          <p>
            {grid.live
              .filter((s) => s.externalGuest.trim())
              .map((s) => `${s.room} — ${s.externalGuest}, hosted by ${nameOf(s.doctorId)}`)
              .join(' · ')}
            . Nothing with a patient identifier goes on the screen in that room: share the room’s documents by sending them to the participants instead, and
            the register keeps what was shown.
          </p>
        </SafetyBanner>
      )}

      <Panel
        title="The meeting register"
        actions={
          <Segmented
            label="Which meetings"
            name="meeting-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Today', label: `All (${grid.sessions.length})` },
              { value: 'Live', label: `Live (${grid.live.length})` },
              { value: 'Booked', label: `Booked (${grid.upcoming.length})` },
              { value: 'Minuted', label: `Minuted (${grid.sessions.filter((s) => s.status === 'ended').length})` },
              { value: 'Did not run', label: `Not run (${grid.sessions.filter((s) => s.status === 'missed').length})` },
              { value: 'With a guest', label: `Guests (${stats.withExternalGuest})` },
            ]}
          />
        }
      >
        <ListView
          id="meeting-register"
          caption={`Meetings and committees for ${day}`}
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => (row.status === 'live' ? setMinuting(row) : row.status === 'scheduled' ? open(row) : undefined)}
          rowActions={(row) => [
            ...(row.status === 'scheduled' ? [{ label: 'Open the room', onSelect: () => open(row) }] : []),
            ...(row.status === 'live' ? [{ label: 'Close and write the minutes', onSelect: () => setMinuting(row) }] : []),
            { label: 'Invite somebody else', onSelect: () => push({ title: `Invitation for ${row.title}`, description: 'Joining staff by their staff record is what lets the room’s membership be audited — the queued invitation carries the employee number.', tone: 'info' }) },
          ]}
          columns={[
            { key: 'room', header: 'Room', width: '9rem', render: (row) => <span className="font-numeric text-xs">{row.room}</span> },
            { key: 'start', header: 'Booked', width: '5.5rem', render: (row) => <span className="font-numeric">{clockOf(row.start)}</span>, sortable: true },
            { key: 'title', header: 'Meeting', render: (row) => row.title },
            { key: 'host', header: 'Host', render: (row) => nameOf(row.doctorId) },
            { key: 'department', header: 'Department', hideBelow: 'lg', render: (row) => row.department },
            { key: 'invited', header: 'Invited', width: '5rem', numeric: true, render: (row) => String(row.participants.length) },
            { key: 'status', header: 'Status', width: '8rem', render: (row) => <span className={cx('font-medium', STATUS_TONE[row.status])}>{STATUS_LABEL[row.status]}</span> },
            { key: 'agenda', header: 'Agenda', hideBelow: 'xl', render: (row) => <span className="line-clamp-1 text-text-secondary">{row.reason}</span> },
            { key: 'guest', header: 'Outside guest', hideBelow: 'xl', render: (row) => (row.externalGuest ? <span className="text-safety-warning-text">{row.externalGuest}</span> : <span className="text-text-tertiary">—</span>) },
            { key: 'decisions', header: 'Decisions', render: (row) => (row.outcome ? <span className="line-clamp-1 text-text-secondary">{row.outcome}</span> : <span className="text-text-tertiary">{row.status === 'ended' ? 'closed without minutes' : 'not yet'}</span>) },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="The committees and their quorums" actions={<span className="text-xs text-text-secondary">{COMMITTEES.length} committees</span>}>
          <ul className="space-y-2">
            {COMMITTEES.map((c) => (
              <li key={c.id} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-center gap-1 text-sm font-medium text-text-primary">
                  <Gavel className="size-3.5" aria-hidden /> {c.name}
                </p>
                <p className="text-xs text-text-secondary">
                  {c.quorum} of {c.members} present to decide · {c.decides}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="What the register enforces">
          <ul className="space-y-2">
            {MEETING_RULES.map((r) => (
              <li key={r.key}>
                <p className="text-sm font-medium text-text-primary">{r.label}</p>
                <p className="text-xs text-text-secondary">{r.because}</p>
                <p className="text-xs text-text-tertiary">On this screen: {r.enforcedBy}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {MEETING_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={booking}
        onClose={() => setBooking(false)}
        title="Book a meeting"
        description="The room and the invitations are allocated here; the join links go out when the queue drains."
        width="xl"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {check.ok
                ? `${nextRoom('meeting', day, grid.sessions)} will be this node’s next meeting room.${check.quorumMet ? '' : ' The quorum is not met on the invitation.'}`
                : `${check.reasons.length} refusal(s) — the room will not open until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => setBooking(false)}>Cancel</Button>
            <Button variant="primary" onClick={book} disabled={!check.ok}>
              <Radio className="size-4" aria-hidden /> Book and invite
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The register refuses this meeting — ${check.reasons[0].code}`}>
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

          <FieldSection title="What the room is for" description="A meeting has an agenda before it opens. One line is enough, and it is what the invitation carries.">
            <TextField label="Meeting title" name="meetingTitle" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} hint="As it appears on the invitation, e.g. “Infection-control committee”." required />
            <SelectField label="Kind of meeting" name="purpose" value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} options={PURPOSE_OPTIONS} hint="The kind decides the rules: a committee needs a quorum, a case review may not have an outside guest." />
            {draft.purpose === 'committee' && (
              <SelectField
                label="Committee"
                name="committeeId"
                value={draft.committeeId}
                onChange={(e) => setDraft((d) => ({ ...d, committeeId: e.target.value }))}
                options={COMMITTEES.map((c) => ({ value: c.id, label: `${c.name} — quorum ${c.quorum} of ${c.members}` }))}
                hint={committee ? `Decides: ${committee.decides}` : undefined}
              />
            )}
            <SelectField label="Department" name="meetingDepartment" value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} options={[...new Set(directory.map((m) => m.departmentId))].map((d) => ({ value: d, label: d }))} />
            <TextField label="Start" name="meetingClock" value={draft.clock} onChange={(e) => setDraft((d) => ({ ...d, clock: e.target.value }))} placeholder={clockOf(now)} hint="24-hour clock. A time that has gone is refused rather than quietly moved." />
            <SelectField label="Length" name="meetingDuration" value={draft.durationMin} onChange={(e) => setDraft((d) => ({ ...d, durationMin: e.target.value }))} options={['15', '20', '30', '45', '60', '90'].map((v) => ({ value: v, label: `${v} minutes` }))} hint="Booked time is other people’s clinical time. The register keeps what was booked and what was used apart." />
            <SelectField
              label="Repeats"
              name="recurrence"
              value={draft.recurrence}
              onChange={(e) => setDraft((d) => ({ ...d, recurrence: e.target.value as Draft['recurrence'] }))}
              options={[
                { value: 'once', label: 'Once' },
                { value: 'daily', label: 'Every morning (a series)' },
                { value: 'weekly', label: 'Weekly (a series)' },
                { value: 'monthly', label: 'Monthly (a series)' },
              ]}
              hint="A series is a series id on the record. Cancelling one occurrence never cancels the series."
            />
            <SelectField label="Channel" name="meetingChannel" value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value as Channel }))} options={[{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }, { value: 'chat', label: 'Chat' }]} />
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField
                label="Agenda"
                name="agenda"
                value={draft.agenda}
                onChange={(e) => setDraft((d) => ({ ...d, agenda: e.target.value }))}
                rows={4}
                hint="One line per item, in the order they will be taken. The first line is what the room shows on the register."
                required
              />
            </div>
          </FieldSection>

          <FieldSection title="Who is in it" description="Invite people by their staff record: it is what makes the quorum and the attendance auditable.">
            <SelectField
              label="Host"
              name="host"
              value={draft.hostStaffId}
              onChange={(e) => setDraft((d) => ({ ...d, hostStaffId: e.target.value }))}
              options={[{ value: '', label: 'Choose the host…' }, ...inviteeOptions.map((code) => ({ value: code, label: `${nameOf(code)} — ${code}` }))]}
              hint="One host, and they are the one who ends the room."
              required
            />
            <TextField
              label="Invitees"
              name="invitees"
              value={draft.invitees}
              onChange={(e) => setDraft((d) => ({ ...d, invitees: e.target.value }))}
              hint={`Staff ids, comma separated. ${committee ? `${committee.name} needs ${committee.quorum}; ` : ''}anybody not on the register is refused.`}
            />
            <TextField
              label="Outside guest"
              name="externalGuest"
              value={draft.externalGuest}
              onChange={(e) => setDraft((d) => ({ ...d, externalGuest: e.target.value }))}
              hint="Leave empty for an internal meeting. Never allowed on a case review or a consultation."
            />
            <TextField label="Guest hosted by" name="guestHost" value={draft.guestHost} onChange={(e) => setDraft((d) => ({ ...d, guestHost: e.target.value }))} hint="Required when a guest is invited: somebody internal is responsible for what is on the screen." />
            <TextField label="Documents that will be shown" name="documentsShown" value={draft.documentsShown} onChange={(e) => setDraft((d) => ({ ...d, documentsShown: e.target.value }))} hint="With a guest in the room, nothing with a patient identifier goes on the shared screen. Say what will be shown." />
          </FieldSection>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(minuting)}
        onClose={() => setMinuting(null)}
        title={minuting ? `Minutes for ${minuting.room}` : 'Minutes'}
        description="The decisions, the people who took them, and what the next meeting starts from."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {minuting ? `${minuting.participants.length} invited · ${minuting.durationMin} min booked · started ${minuting.startedAt ? clockOf(minuting.startedAt) : '—'}` : ''}
            </span>
            <Button variant="ghost" onClick={() => setMinuting(null)}>Cancel</Button>
            <Button variant="primary" onClick={keepMinutes} disabled={!decisions.trim()}>
              <Gavel className="size-4" aria-hidden /> Record the minutes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
            <p className="text-sm font-medium text-text-primary">{minuting?.title}</p>
            <p>{minuting?.reason}</p>
            {minuting?.externalGuest && <p className="text-safety-warning-text">{minuting.externalGuest} was in the room, hosted by {minuting.participants.length ? 'the named host' : 'nobody named'}.</p>}
          </div>

          <FieldSection title="The minutes" description="Minutes that record only who attended are the failure mode: the decisions are the point, and each one names somebody.">
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField
                label="Decisions"
                name="decisions"
                value={decisions}
                onChange={(e) => setDecisions(e.target.value)}
                rows={5}
                hint={MINUTE_PROMPTS.join(' ')}
                required
              />
            </div>
            <TextField label="Present" name="present" value={present} onChange={(e) => setPresent(e.target.value)} hint="Staff ids, comma separated. The quorum is checked against this rather than against the invitation." />
          </FieldSection>

          <SafetyBanner severity="info" title="Two ways to not hold the meeting">
            <p>
              Cancelling today’s occurrence is a normal act and does not touch the series. Cancelling the series is a separate, deliberate act on the same
              record — the standing handover happens every morning, and one cancelled room must not quietly remove the other 364.
            </p>
          </SafetyBanner>
        </div>
      </Sheet>
    </div>
  );
}
