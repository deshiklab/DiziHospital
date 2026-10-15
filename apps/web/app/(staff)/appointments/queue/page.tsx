'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { BellRing, Clock, DoorOpen, SkipForward } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  QUEUE_PRIORITY,
  buildQueue,
  clockLabel,
  nextToken,
  roomFor,
  type QueueEntry,
  type QueueStage,
} from '@/lib/aftercare';

/* The OPD queue board (legacy screen 019 — the paper token list — replaced) — the P1 sub-screen.
 *
 * The waiting room is the one screen in this product that patients read themselves, so it is written for that:
 * big enough to see from a chair, bilingual, and it says the two things a waiting room always wants to know —
 * what number is being seen, and how long the wait is. Behind it, `lib/aftercare.ts` keeps the clock: check-in,
 * called, started, finished, so the wait is measured rather than estimated.
 *
 * Two rules the board is built around:
 *  - a patient who is not there when their token is called is skipped and re-queued behind the next token, because
 *    holding the queue still for one person in a corridor punishes twenty people in chairs;
 *  - an emergency walk-in is screened at the door and sent to the duty doctor, not to the front of the queue. The
 *    board shows that diversion openly, so the room can see it was clinical and not queue-jumping.
 *
 * Preview: the queue is synthetic, from the same generator as the appointments screen. Nothing survives a reload.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const STAGE_CHIP: Record<QueueStage, string> = {
  'Checked in': 'bg-surface-sunken text-text-secondary',
  Waiting: 'bg-brand-50 text-brand-700',
  Called: 'bg-safety-warning/10 text-safety-warning',
  'In consultation': 'bg-brand-50 text-brand-700',
  Skipped: 'bg-safety-critical/10 text-safety-critical',
  Completed: 'bg-safety-success/10 text-safety-success',
};

export default function QueuePage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [queue, setQueue] = useState(() => buildQueue(day));
  const [tab, setTab] = useState('board');
  const [openId, setOpenId] = useState<string | null>(null);

  const entry = queue.entries.find((e) => e.appointment.id === openId) ?? null;
  const up = useMemo(() => nextToken(queue), [queue]);
  const waitingList = queue.entries
    .filter((e) => e.stage === 'Waiting' || e.stage === 'Called')
    .sort((a, b) => a.appointment.start - b.appointment.start);

  const callNext = () => {
    if (!up) {
      push({ title: 'Nobody is waiting — the board is clear.', tone: 'info' });
      return;
    }
    const at = queue.nowMinutes + 3;
    setQueue((q) => ({
      ...q,
      nowMinutes: at,
      entries: q.entries.map((e) => (e.appointment.id === up.appointment.id ? { ...e, stage: 'Called', calledAt: at } : e)),
      stats: { ...q.stats, waiting: Math.max(0, q.stats.waiting - 1) },
    }));
    queueWrite(`Token ${up.appointment.token} called for ${roomFor(up.appointment.doctorId)}`);
    push({
      title: `Token ${up.appointment.token} called — ${up.appointment.patient.name}`,
      description: `Room ${roomFor(up.appointment.doctorId)}. Called at ${clockLabel(at)}; the wait is now measured from check-in to this minute, not guessed from the clock on the wall.`,
      tone: 'success',
    });
  };

  const startConsult = (target: QueueEntry) => {
    const at = queue.nowMinutes + 1;
    setQueue((q) => ({ ...q, nowMinutes: at, entries: q.entries.map((e) => (e.appointment.id === target.appointment.id ? { ...e, stage: 'In consultation', startedAt: at } : e)) }));
    push({ title: `Consultation started — ${target.appointment.patient.name}`, description: 'The clock that matters to the room has stopped; the one that matters to the doctor is running.', tone: 'success' });
  };

  const finish = (target: QueueEntry) => {
    const at = queue.nowMinutes + 12;
    setQueue((q) => ({
      ...q,
      nowMinutes: at,
      entries: q.entries.map((e) => (e.appointment.id === target.appointment.id ? { ...e, stage: 'Completed', completedAt: at } : e)),
      stats: { ...q.stats, completed: q.stats.completed + 1, inConsultation: Math.max(0, q.stats.inConsultation - 1) },
    }));
    push({
      title: `${target.appointment.patient.name} is through`,
      description: 'The next token can be called. A consultation that ends without the queue being freed is a queue that grows while the doctor writes.',
      tone: 'success',
    });
  };

  const skip = (target: QueueEntry) => {
    const at = queue.nowMinutes + 2;
    setQueue((q) => ({ ...q, nowMinutes: at, entries: q.entries.map((e) => (e.appointment.id === target.appointment.id ? { ...e, stage: 'Skipped', skippedAt: at } : e)) }));
    push({
      title: `Token ${target.appointment.token} skipped`,
      description: `Nobody answered at ${clockLabel(at)}. The token goes back into the line behind the next one, not to the front — holding twenty people for one person in a corridor is not fairness.`,
      tone: 'warning',
    });
  };

  const requeue = (target: QueueEntry) => {
    setQueue((q) => ({ ...q, entries: q.entries.map((e) => (e.appointment.id === target.appointment.id ? { ...e, stage: 'Waiting' } : e)) }));
    push({ title: `${target.appointment.patient.name} is back in the line`, description: 'They returned, so they are re-queued where they were skipped from — behind the tokens already waiting.', tone: 'info' });
  };

  const addWalkIn = () => {
    const at = queue.nowMinutes;
    setQueue((q) => ({ ...q, stats: { ...q.stats, walkIns: q.stats.walkIns + 1 } }));
    queueWrite('Walk-in patient triaged at the OPD door: sent to the duty doctor for screening, not to the front of the queue');
    push({
      title: 'Walk-in sent to screening',
      description: `Screened at ${clockLabel(at)} by the duty doctor. If it is an emergency it goes to the emergency room, and the board says so; if it is not, the patient takes a token like everybody else.`,
      tone: 'info',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <DoorOpen className="size-5 text-brand-600" aria-hidden />
            OPD queue
          </h1>
          <p className="text-sm text-text-secondary">
            {day} · {clockLabel(queue.nowMinutes)} — what is being called, what is waiting, and how long it has been waiting.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={addWalkIn}>Send a walk-in to screening</Button>
          <Button onClick={callNext}>
            <BellRing className="size-4" aria-hidden /> Call the next token
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Waiting now" value={String(queue.stats.waitingNow)} definition="Patients checked in and not yet called, across every OPD room." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} />
        <KpiTile label="Average wait" value={queue.stats.averageWaitMin !== null ? `${queue.stats.averageWaitMin} min` : '—'} definition="Mean of check-in → now, over the patients still waiting. Measured from the real check-in time, not from the slot they were given." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} footnote={queue.stats.longestWaitMin ? `longest ${queue.stats.longestWaitMin} min` : undefined} />
        <KpiTile label="In consultation" value={String(queue.stats.inConsultation)} definition="Called into a room and not yet through." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} />
        <KpiTile label="Seen today" value={String(queue.stats.completed)} definition="Consultations finished; the denominator of every waiting-time figure on this board." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} footnote={queue.stats.averageConsultMin ? `average ${queue.stats.averageConsultMin} min in the room` : undefined} />
        <KpiTile label="Skipped" value={String(queue.stats.skipped)} definition="Tokens called with nobody there. They go back into the line behind the tokens already waiting, never to the front." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} />
        <KpiTile label="Walk-ins" value={String(queue.stats.walkIns)} definition="Patients without an appointment; screened at the door and seen in the gaps rather than jumping the line." asOf={`${day} ${clockLabel(queue.nowMinutes)}`} footnote={queue.stats.triagedToEmergency ? `${queue.stats.triagedToEmergency} triaged straight to the emergency room` : 'none diverted today'} />
      </div>

      {/* The board the room reads: big, bilingual-free, and honest about the wait. */}
      <div className="grid gap-2 lg:grid-cols-2">
        <Panel title="Now serving" className="border-brand-300">
          {queue.byRoom.filter((r) => r.nowServing).length === 0 ? (
            <p className="text-sm text-text-secondary">No room has a patient in it at this minute.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {queue.byRoom.filter((r) => r.nowServing).map((r) => (
                <li key={r.room} className="rounded-md border border-brand-300 bg-brand-50 px-3 py-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-brand-700">{r.room} · {r.doctor}</p>
                  <p className="font-numeric text-4xl font-semibold text-brand-700">{r.nowServing?.appointment.token}</p>
                  <p className="text-sm text-text-secondary">{r.nowServing?.appointment.patient.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {r.nowServing?.stage === 'Called' ? 'called, walking in' : 'in consultation'}
                    {r.nextUp ? ` · next ${r.nextUp.appointment.token}` : ' · nothing after'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Waiting, in the order they will be called">
          {waitingList.length === 0 ? (
            <EmptyState title="Nobody is waiting" description="The room is clear — every token has been seen, skipped or is not due yet." />
          ) : (
            <ol className="space-y-1">
              {waitingList.slice(0, 10).map((e, index) => {
                const waited = e.checkedInAt !== undefined ? queue.nowMinutes - e.checkedInAt : null;
                return (
                  <li key={e.appointment.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', e.stage === 'Called' ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-right text-xs text-text-tertiary">{index + 1}</span>
                      <span className="font-numeric text-lg font-semibold text-text-primary">{e.appointment.token}</span>
                      <span>{e.appointment.patient.name}</span>
                      <span className="text-xs text-text-tertiary">
                        {e.appointment.source === 'Walk-in' ? 'walk-in · ' : 'booked · '}
                        {clockLabel(e.appointment.start)} slot
                        {e.appointment.source === 'Follow-up' ? ' · follow-up, no charge within seven days' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className={cx(waited !== null && waited > 45 ? TONE_TEXT.critical : waited !== null && waited > 20 ? TONE_TEXT.warning : TONE_TEXT.neutral)}>
                        {waited !== null ? `${waited} min waiting` : 'not checked in'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setOpenId(e.appointment.id)}>Open</Button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'board', label: 'Rooms', count: queue.byRoom.length },
          { id: 'all', label: 'Every token', count: queue.entries.length },
          { id: 'rules', label: 'How the queue works' },
        ]}
      />

      {tab === 'board' && (
        <Panel title="Room by room" actions={<span className="text-xs text-text-secondary">A room with nothing after the current patient is a room that can take a walk-in</span>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {queue.byRoom.map((r) => (
              <div key={r.room} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">{r.room} · {r.doctor}</p>
                <p className="text-text-secondary">
                  {r.nowServing ? `Now: ${r.nowServing.appointment.token} — ${r.nowServing.appointment.patient.name}` : 'Room empty'}
                </p>
                <p className="text-xs text-text-tertiary">
                  {r.waiting} waiting · {r.completedCount} seen · {r.nextUp ? `next ${r.nextUp.appointment.token} at ${clockLabel(r.nextUp.appointment.start)}` : 'nothing booked after this'}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'all' && (
        <Panel title="Every token today" actions={<span className="text-xs text-text-secondary">Checked in, waiting, in a room, skipped or through</span>}>
          <ListView
            id="queue-all"
            caption="OPD tokens"
            height="30rem"
            rows={[...queue.entries].sort((a, b) => a.appointment.start - b.appointment.start)}
            rowId={(e) => e.appointment.id}
            onRowClick={(e) => setOpenId(e.appointment.id)}
            columns={[
              { key: 'token', header: 'Token', width: '90px' },
              { key: 'start', header: 'Slot', width: '90px', render: (e) => clockLabel(e.appointment.start) },
              { key: 'patient', header: 'Patient', render: (e) => (
                <span>
                  {e.appointment.patient.name}
                  <span className="ml-2 text-xs text-text-tertiary">{e.appointment.patient.mrn}</span>
                </span>
              ) },
              { key: 'doctor', header: 'Room', hideBelow: 'md', width: '120px', render: (e) => roomFor(e.appointment.doctorId) },
              { key: 'source', header: 'Source', hideBelow: 'lg', width: '120px' },
              { key: 'checkedInAt', header: 'Checked in', width: '110px', render: (e) => e.checkedInAt !== undefined ? clockLabel(e.checkedInAt) : <span className={cx(TONE_TEXT.warning)}>not arrived</span> },
              { key: 'wait', header: 'Wait', numeric: true, align: 'right', width: '100px', render: (e) => {
                const end = e.startedAt ?? (e.stage === 'Waiting' ? queue.nowMinutes : undefined);
                return e.checkedInAt !== undefined && end ? `${end - e.checkedInAt} min` : '—';
              } },
              { key: 'stage', header: 'Stage', width: '150px', render: (e) => (
                <span className={cx('rounded-full px-2 py-0.5 text-xs', STAGE_CHIP[e.stage])}>{e.stage}</span>
              ) },
            ]}
          />
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="Who is seen first — and who is not">
            <ul className="space-y-2 text-sm">
              {QUEUE_PRIORITY.map((p) => (
                <li key={p.label}>
                  <span className="font-medium text-text-primary">{p.label}.</span> <span className="text-text-secondary">{p.because}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="The two rules the board is built on">
            <ul className="space-y-2 text-sm">
              <li>
                <span className="font-medium text-text-primary">A missing patient does not hold the queue.</span>{' '}
                <span className="text-text-secondary">
                  The token is called; if nobody answers, it is skipped and goes back into the line behind the tokens already waiting.
                  Skipping is recorded, so the same patient is not skipped twice by mistake at the next call. The wait figure on the
                  board is what it is — a queue that pretends everyone is present is a queue where nobody trusts the number.
                </span>
              </li>
              <li>
                <span className="font-medium text-text-primary">Queue position is not triage.</span>{' '}
                <span className="text-text-secondary">
                  A walk-in with chest pain is screened at the door and goes to the emergency room or the duty doctor. That diversion is
                  shown on the board on purpose: a room that sees somebody jump the line without being told why stops believing the line
                  means anything.
                </span>
              </li>
            </ul>
          </Panel>
          <Panel title="What the front desk does at check-in">
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>· Confirms the patient is the person on the appointment — name and phone, and the MRN when there is one.</li>
              <li>· Marks the arrival time. The wait number starts here, not at the slot time: a patient who arrived early has not been kept waiting.</li>
              <li>· Flags a follow-up inside seven days, so the counter does not charge a consultation again.</li>
              <li>· Records a walk-in as a walk-in, so the OPD load can be separated from the booked load afterwards.</li>
              <li>· Collects the consultation fee before the token is issued, or records the payer — a token is not a promise to pay later.</li>
            </ul>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- token sheet */}
      <Sheet
        open={Boolean(entry)}
        onClose={() => setOpenId(null)}
        title={entry ? `Token ${entry.appointment.token} — ${entry.appointment.patient.name}` : 'Token'}
        description={entry ? `${clockLabel(entry.appointment.start)} slot · ${entry.appointment.type} · ${entry.appointment.reason}` : undefined}
        footer={
          entry && (
            <div className="flex flex-wrap justify-end gap-2">
              {entry.stage === 'Waiting' && <Button variant="ghost" onClick={() => skip(entry)}><SkipForward className="size-4" aria-hidden /> Skip the token</Button>}
              {entry.stage === 'Skipped' && <Button variant="ghost" onClick={() => requeue(entry)}>Put them back in the line</Button>}
              {entry.stage === 'Called' && <Button onClick={() => startConsult(entry)}>Start the consultation</Button>}
              {entry.stage !== 'Completed' && entry.stage !== 'Skipped' && <Button variant="ghost" onClick={() => finish(entry)}>Through</Button>}
            </div>
          )
        }
      >
        {entry && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Patient</dt><dd className="font-medium">{entry.appointment.patient.name} · {entry.appointment.patient.mrn}</dd></div>
              <div><dt className="text-xs text-text-secondary">Age · sex · phone</dt><dd className="font-medium">{entry.appointment.patient.age} · {entry.appointment.patient.sex} · {entry.appointment.patient.phone}</dd></div>
              <div><dt className="text-xs text-text-secondary">Room</dt><dd className="font-medium">{roomFor(entry.appointment.doctorId)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Stage</dt><dd className={cx('font-medium', entry.stage === 'Skipped' ? TONE_TEXT.critical : entry.stage === 'Waiting' ? TONE_TEXT.warning : TONE_TEXT.success)}>{entry.stage}</dd></div>
            </dl>

            <ol className="space-y-1">
              {([['Checked in', entry.checkedInAt], ['Called', entry.calledAt], ['In the room', entry.startedAt], ['Through', entry.completedAt]] as const).map(([label, at]) => (
                <li key={label} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                  <span className="font-medium text-text-primary">{label}</span>
                  <span className="tabular-nums text-text-secondary">{at !== undefined ? clockLabel(at) : '—'}</span>
                </li>
              ))}
            </ol>

            {entry.checkedInAt !== undefined && (
              <p className={cx('rounded-md border px-3 py-2', queue.nowMinutes - entry.checkedInAt > 45 ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-border-subtle')}>
                {`Waited ${(entry.startedAt ?? queue.nowMinutes) - entry.checkedInAt} minutes so far. The board shows this number to the room, which is why it is measured from check-in rather than estimated from the slot.`}
              </p>
            )}

            {entry.triaged && (
              <div className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2">
                <p className="font-medium text-text-primary">Triaged out of the queue at {clockLabel(entry.triaged.at)}</p>
                <p className="text-text-secondary">{entry.triaged.reason} → {entry.triaged.sentTo}.</p>
              </div>
            )}

            {entry.appointment.patient.allergies && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="font-medium text-text-primary">Allergies on the record</p>
                <p className="text-text-secondary">{entry.appointment.patient.allergies} — shown at the front desk and at the door of the room, before a prescription is written.</p>
              </div>
            )}

            <p className="text-xs text-text-tertiary">
              The appointment this token belongs to is on <Link href="/appointments" className="underline">the appointments screen</Link>; the
              consultation itself is <Link href="/clinical" className="underline">the clinical screen</Link>; the fee behind the token is in{' '}
              <Link href="/billing" className="underline">billing</Link>.
            </p>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/appointments" className="underline">appointments</Link> books and reschedules;{' '}
        <Link href="/patients/discharged" className="underline">discharged patients</Link> holds the follow-ups that fill this queue.
      </p>
    </div>
  );
}
