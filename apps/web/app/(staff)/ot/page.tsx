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
import { Scissors, TriangleAlert } from 'lucide-react';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  CANCELLATION_REASONS,
  GATE_CHECKLIST,
  NPO_SOLID_HOURS,
  RECOVERY_DISCHARGE_SCORE,
  RECOVERY_OBS_MIN,
  TURNAROUND_FLOOR_MIN,
  addMinutes,
  countVerdict,
  readiness,
  recoveryVerdict,
  theatreAvailable,
  theatreDay,
  type CaseState,
  type SurgicalCase,
} from '@/lib/theatre';

/* Operating theatre (legacy screens 014 / 039 — the theatre list and the paper checklist — replaced) — the P5
 * sub-screen.
 *
 * `lib/theatre.ts` holds the rules; this screen refuses on them, in public:
 *  - a case cannot sign in with consent unrecorded, an unmarked site or an anaesthetist who has not seen the
 *    patient — and the refusal says which of the three is missing;
 *  - counts are confirmed before closure, and a discrepancy stops the screen with the resolution field open;
 *  - a recovering patient is not sent to the ward below the discharge score;
 *  - the theatre that is not free says when it will be, after its own turn-around.
 *
 * Preview: the list is synthetic and nothing survives a reload. The rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const STATE_CHIP: Record<CaseState, string> = {
  Scheduled: 'bg-surface-sunken text-text-secondary',
  'In theatre': 'bg-brand-50 text-brand-700',
  'In recovery': 'bg-safety-warning/10 text-safety-warning',
  Completed: 'bg-safety-success/10 text-safety-success',
  Cancelled: 'bg-safety-critical/10 text-safety-critical',
  Bumped: 'bg-surface-sunken text-text-tertiary',
};

const GATE_LABEL: Record<string, string> = {
  consent: 'Consent',
  site: 'Site marking',
  anaesthesia: 'Anaesthetic review',
  checklist: 'WHO checklist',
  counts: 'Counts',
  ready: 'Ready',
};

export default function TheatrePage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [suite, setSuite] = useState(() => theatreDay(day));
  const [tab, setTab] = useState('list');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [counts, setCounts] = useState({ swabs: 10, instruments: 42, needles: 6 });
  const [resolution, setResolution] = useState('');
  const [cancelReason, setCancelReason] = useState(CANCELLATION_REASONS[0]);
  const [team, setTeam] = useState({ by: 'Dr S. Islam (surgeon)' });
  const [bumpTo, setBumpTo] = useState('');

  const surgicalCase = suite.cases.find((c) => c.id === caseId) ?? null;
  const theatreBoard = useMemo(
    () => suite.theatres.map((t) => ({ theatre: t, availability: theatreAvailable(t, suite.cases) })),
    [suite],
  );

  const patch = (id: string, updater: (c: SurgicalCase) => SurgicalCase) =>
    setSuite((s) => ({ ...s, cases: s.cases.map((c) => (c.id === id ? updater(c) : c)) }));

  const patchTheatre = (id: string, state: 'In use' | 'Available' | 'Cleaning' | 'Out of service', note?: string) =>
    setSuite((s) => ({ ...s, theatres: s.theatres.map((t) => (t.id === id ? { ...t, state, ...(note ? { note } : {}) } : t)) }));

  /* ---------------------------------------------------------------- the checklist */

  const recordStage = (target: SurgicalCase, stage: 'signIn' | 'timeOut' | 'signOut') => {
    const check = readiness(target, day);
    if (stage === 'signIn' && !check.ready) {
      setRefusal(`Refused — sign in is read aloud before anaesthesia, and ${check.blockers.length} gate(s) are open: ${check.blockers.join(' ')}`);
      push({ title: 'Sign in refused: close the gates first.', tone: 'critical' });
      return;
    }
    if (stage === 'signOut' && !target.counts) {
      setRefusal('Refused — the sign-out stage confirms the counts, and no count is recorded yet. Counts come before closure, not after the patient leaves.');
      push({ title: 'Sign out refused: counts are not recorded.', tone: 'critical' });
      return;
    }
    const at = `${day}T${stage === 'signIn' ? '12:02' : stage === 'timeOut' ? '12:10' : '13:25'}`;
    const confirmed = GATE_CHECKLIST[stage];
    patch(target.id, (c) => ({
      ...c,
      state: stage === 'signIn' ? 'In theatre' : stage === 'timeOut' ? 'In theatre' : 'In recovery',
      ...(stage === 'timeOut' ? { actualStart: at } : {}),
      ...(stage === 'signOut' ? { actualEnd: at, outOfTheatreAt: at } : {}),
      checklist: { ...c.checklist, [stage]: { at, by: team.by, confirmed } },
    }));
    setRefusal(null);
    queueWrite(`${stage === 'signIn' ? 'Sign in' : stage === 'timeOut' ? 'Time out' : 'Sign out'} recorded for ${target.patientName} (${target.procedure}) by ${team.by}`);
    push({
      title: stage === 'signIn' ? 'Sign in read aloud' : stage === 'timeOut' ? 'Time out read aloud — the incision may proceed' : 'Sign out read aloud',
      description: `${confirmed.length} items confirmed by ${team.by}. The record keeps who read it, because the checklist works when it is read out, not when it is ticked.`,
      tone: 'success',
    });
  };

  const saveCounts = (target: SurgicalCase) => {
    const expected = target.counts ?? { swabs: 10, instruments: 42, needles: 6 };
    const verdict = countVerdict(target, counts, expected);
    if (!verdict.ok && !resolution.trim()) {
      setRefusal(verdict.text);
      push({ title: 'Counts do not agree — the closure waits.', tone: 'critical' });
      return;
    }
    patch(target.id, (c) => ({ ...c, counts: { ...counts, correct: verdict.ok, checkedBy: 'Staff nurse R. Akter', at: `${day}T13:20`, ...(verdict.ok ? {} : { resolution: resolution.trim() }) } }));
    setRefusal(verdict.ok ? null : `Recorded with a resolution: ${verdict.text} Resolution: ${resolution.trim()}`);
    push({ title: verdict.ok ? 'Counts agree' : 'Counts recorded with a resolution', description: verdict.ok ? 'The wound may be closed.' : resolution.trim(), tone: verdict.ok ? 'success' : 'warning' });
  };

  const dischargeRecovery = (target: SurgicalCase) => {
    const verdict = recoveryVerdict(target.recovery);
    if (!verdict.ok) {
      setRefusal(`Refused — ${verdict.text}`);
      push({ title: 'Refused: the recovery score is not there yet.', tone: 'critical' });
      return;
    }
    patch(target.id, (c) => ({ ...c, state: 'Completed', recovery: c.recovery ? { ...c.recovery, outAt: `${day}T13:40`, toWard: 'Surgery Ward B' } : undefined }));
    push({ title: `${target.patientName} to the ward`, description: `${verdict.text} The ward gets the operation note, the anaesthetic record and the observation plan with the patient.`, tone: 'success' });
  };

  const lowerSegment = (target: SurgicalCase) => {
    patch(target.id, (c) => ({ ...c, actualStart: `${day}T13:02`, state: 'In theatre' }));
    patchTheatre(target.theatreId, 'In use', `In ${target.id} since 13:02`);
    push({ title: `${target.id} started`, description: 'The turn-around clock has stopped; the case clock has started. Anaesthetic time is recorded from here.', tone: 'success' });
  };

  const cancel = (target: SurgicalCase) => {
    patch(target.id, (c) => ({ ...c, state: 'Cancelled', cancelled: { reason: cancelReason, at: `${day}T12:50`, by: 'Theatre in-charge', rebookedTo: addMinutes(`${day}T12:50`, 60 * 48).slice(0, 10) } }));
    patchTheatre(target.theatreId, 'Available');
    setSuite((s) => ({ ...s, stats: { ...s.stats, cancelled: s.stats.cancelled + 1 } }));
    push({
      title: `${target.id} cancelled`,
      description: `${cancelReason}. The reason is recorded against the case and the patient is told — a cancelled list without a reason is how a family ends up shouting at the front desk.`,
      tone: 'warning',
    });
  };

  const bump = (target: SurgicalCase) => {
    if (!bumpTo.trim()) {
      push({ title: 'Say where the case moves to, or the bump is just a cancellation with a nicer word.', tone: 'critical' });
      return;
    }
    patch(target.id, (c) => ({ ...c, state: 'Bumped', bumped: { by: 'an emergency case', reason: `Moved to ${bumpTo} to make room for an emergency`, at: `${day}T12:45` } }));
    push({ title: `${target.id} moved to ${bumpTo}`, description: 'The bumped case keeps its place in the queue and the reason is on the record, because a patient who waits all day fasting deserves to know why.', tone: 'warning' });
  };

  const gated = suite.cases.filter((c) => c.state === 'Scheduled');

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Scissors className="size-5 text-brand-600" aria-hidden />
            Operating theatre
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — the list, the checklist, the counts and the recovery room.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Cases listed" value={String(suite.stats.listed)} definition="Every case on the board today, including the ones that were cancelled or moved." asOf={day} />
        <KpiTile label="In theatre" value={String(suite.stats.inTheatre)} definition="Cases that have signed in and not yet signed out." asOf={day} />
        <KpiTile label="In recovery" value={String(suite.stats.inRecovery)} definition={`Patients who have left the table and are not yet at the discharge score of ${RECOVERY_DISCHARGE_SCORE}.`} asOf={day} />
        <KpiTile label="Cancelled or moved" value={String(suite.stats.cancelled + suite.stats.bumped)} definition="Cases that did not go ahead as listed, each with a reason recorded against it." asOf={day} footnote={`${suite.stats.emergencies} emergency case(s) in the list`} />
        <KpiTile label="Started on time" value={`${suite.stats.onTimeStarts} / ${suite.stats.onTimeStarts + suite.stats.lateStarts}`} definition="Within ten minutes of the listed time. A theatre that starts when it says it starts is a theatre where nobody fasts for nothing." asOf={day} />
        <KpiTile label="List ends" value={suite.stats.lastCaseEndsAt.slice(11)} definition="Expected end of the last case with its turn-around — the figure the ward and the recovery room plan against." asOf={day} footnote={suite.stats.listOverrunMin > 0 ? `${suite.stats.listOverrunMin} min past the 14:00 session` : 'inside the session'} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'list', label: 'The list', count: suite.cases.length },
          { id: 'rooms', label: 'Theatres', count: suite.theatres.filter((t) => t.state === 'Available').length },
          { id: 'recovery', label: 'Recovery', count: suite.stats.inRecovery || undefined },
          { id: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'list' && (
        <div className="space-y-3">
          {gated.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm">
              <TriangleAlert className="size-4 text-safety-warning" aria-hidden />
              <span>
                {gated.length} case(s) are waiting to start, and each is waiting on a named gate rather than a queue. Open a case to see
                which one: the list shows the first open gate beside the time.
              </span>
            </div>
          )}
          <Panel title="The list" actions={<span className="text-xs text-text-secondary">One row per case, in the order the theatre will run them</span>}>
            <ul className="space-y-2">
              {[...suite.cases].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)).map((c) => {
                const check = readiness(c, day);
                const theatre = suite.theatres.find((t) => t.id === c.theatreId);
                return (
                  <li key={c.id} className={cx('rounded-md border px-3 py-2', c.state === 'Cancelled' ? 'border-safety-critical/40 bg-safety-critical/5' : c.state === 'Bumped' ? 'border-border-subtle bg-surface-sunken' : 'border-border-subtle')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-14 tabular-nums text-text-secondary">{c.scheduledStart.slice(11)}</span>
                        <span className={cx('rounded-full px-2 py-0.5 text-xs', STATE_CHIP[c.state])}>{c.state}</span>
                        {c.urgency !== 'Elective' && <span className={cx('rounded-full px-2 py-0.5 text-xs', c.urgency === 'Emergency' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>{c.urgency}</span>}
                        <button type="button" onClick={() => { setCaseId(c.id); setRefusal(null); setResolution(''); }} className="font-medium text-text-primary underline">
                          {c.procedure}
                        </button>
                        <span className="text-xs text-text-tertiary">
                          {c.side ? `${c.side} · ` : ''}{c.patientName} · {c.patientMrn} · {theatre?.code}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-text-secondary">{c.surgeon} · {c.anaesthetist}</span>
                        {c.state === 'Scheduled' && <span className={cx(TONE_TEXT.warning)}>waiting on {GATE_LABEL[check.nextGate]}</span>}
                        {c.state === 'Scheduled' && <Button variant="ghost" size="sm" onClick={() => lowerSegment(c)}>Start</Button>}
                        <Button variant="ghost" size="sm" onClick={() => { setCaseId(c.id); setRefusal(null); setResolution(''); }}>Open</Button>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">
                      {c.expectedMin} min expected · {c.anaesthesia} · {c.gates.npoSince ? `fasting since ${c.gates.npoSince.slice(11)}` : 'fasting not recorded'}
                      {c.counts ? ` · counts: ${c.counts.correct ? 'agreed' : 'discrepancy resolved'}` : ' · counts not yet recorded'}
                      {c.implants?.length ? ` · implant ${c.implants[0].item} (lot ${c.implants[0].lot})` : ''}
                      {c.cancelled ? ` · cancelled: ${c.cancelled.reason}` : ''}
                      {c.bumped ? ` · ${c.bumped.reason}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'rooms' && (
        <Panel title="Theatres" actions={<span className="text-xs text-text-secondary">Free, in use, cleaning or out of service — and when the next one is free</span>}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {theatreBoard.map(({ theatre, availability }) => (
              <li key={theatre.id} className={cx('rounded-md border px-3 py-2 text-sm', availability.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-border-subtle')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text-primary">{theatre.code} — {theatre.name}</span>
                  <span className={cx('rounded-full px-2 py-0.5 text-xs', theatre.state === 'Available' ? 'bg-safety-success/10 text-safety-success' : theatre.state === 'Out of service' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>{theatre.state}</span>
                </div>
                <p className="mt-1 text-text-secondary">{availability.because}</p>
                <p className="text-xs text-text-tertiary">
                  {theatre.specialties.join(' · ')} · turn-around {theatre.turnaroundMin} min (floor {TURNAROUND_FLOOR_MIN}) · {theatre.equipment.join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === 'recovery' && (
        <Panel title="Recovery room" actions={<span className="text-xs text-text-secondary">Observations every {RECOVERY_OBS_MIN} minutes until the score reaches {RECOVERY_DISCHARGE_SCORE}</span>}>
          {suite.cases.filter((c) => c.recovery).length === 0 ? (
            <EmptyState title="Recovery is empty" description="No patient has left the table today." />
          ) : (
            <ul className="space-y-2">
              {suite.cases.filter((c) => c.recovery).map((c) => {
                const verdict = recoveryVerdict(c.recovery);
                const last = c.recovery?.observations.at(-1);
                return (
                  <li key={c.id} className={cx('rounded-md border px-3 py-2 text-sm', verdict.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-warning/40 bg-safety-warning/5')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium text-text-primary">{c.patientName}</span>
                        <span className="ml-2 text-xs text-text-tertiary">{c.procedure} · in recovery {c.recovery?.inAt.slice(11)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cx('text-xs', TONE_TEXT.neutral)}>{c.recovery?.observations.length ?? 0} observation(s)</span>
                        {c.state === 'In recovery' && <Button variant="ghost" size="sm" onClick={() => dischargeRecovery(c)}>Send to the ward</Button>}
                      </span>
                    </div>
                    <p className="mt-1 text-text-secondary">{verdict.text}</p>
                    {last && (
                      <p className="text-xs text-text-tertiary">
                        Latest: score {last.score} · BP {last.systolic} · pulse {last.pulse} · SpO₂ {last.spo2}% · pain {last.pain}/10
                        {c.recovery?.nausea ? ' · nausea treated' : ''}{c.recovery?.shivering ? ' · shivering' : ''}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="The three stages of the checklist">
            <div className="grid gap-3 sm:grid-cols-3">
              {(['signIn', 'timeOut', 'signOut'] as const).map((stage) => (
                <div key={stage} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">{stage === 'signIn' ? 'Sign in' : stage === 'timeOut' ? 'Time out' : 'Sign out'}</p>
                  <p className="text-xs text-text-secondary">{stage === 'signIn' ? 'Before anaesthesia' : stage === 'timeOut' ? 'Before the incision' : 'Before the patient leaves the room'}</p>
                  <ul className="mt-1 space-y-1 text-text-secondary">
                    {GATE_CHECKLIST[stage].map((c) => <li key={c}>· {c}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="What stops a theatre">
            <ul className="space-y-2 text-sm">
              <li><span className="font-medium text-text-primary">An open gate.</span> <span className="text-text-secondary">Consent, site marking and the anaesthetic review are closed before sign in, and the screen names the one that is not. A patient who has been anaesthetised before the site is marked is the wrong-side operation waiting to happen.</span></li>
              <li><span className="font-medium text-text-primary">Fasting under {NPO_SOLID_HOURS} hours for solids.</span> <span className="text-text-secondary">The screen computes it from the recorded time rather than asking a person to do arithmetic at 07:40.</span></li>
              <li><span className="font-medium text-text-primary">Counts that do not agree.</span> <span className="text-text-secondary">The closure waits, and the resolution is recorded. A retained swab is found on a radiograph six weeks later and it is always the same story.</span></li>
              <li><span className="font-medium text-text-primary">A recovery score under {RECOVERY_DISCHARGE_SCORE}.</span> <span className="text-text-secondary">The ward is not a recovery room, and an unplanned night call is what the extra twenty minutes avoids.</span></li>
              <li><span className="font-medium text-text-primary">A turn-around that has not finished.</span> <span className="text-text-secondary">{TURNAROUND_FLOOR_MIN} minutes minimum, {suite.theatres[0].turnaroundMin} on a major theatre: cleaning, linen and the next instrument set.</span></li>
            </ul>
          </Panel>
          <Panel title="Cancellations, named">
            <ul className="grid gap-1 sm:grid-cols-2">
              {CANCELLATION_REASONS.map((r) => <li key={r} className="text-sm text-text-secondary">· {r}</li>)}
            </ul>
            <p className="mt-2 text-sm text-text-secondary">
              A cancellation is a reason, a person and a rebooking date. Today:{' '}
              {suite.stats.cancellationsReasons.map((r) => `${r.caseId} — ${r.reason}`).join('; ') || 'none'}.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- case sheet */}
      <Sheet
        open={Boolean(surgicalCase)}
        onClose={() => { setCaseId(null); setRefusal(null); }}
        title={surgicalCase ? `${surgicalCase.procedure}${surgicalCase.side ? ` — ${surgicalCase.side.toLowerCase()}` : ''}` : 'Case'}
        description={surgicalCase ? `${surgicalCase.patientName} · ${surgicalCase.patientMrn} · ${surgicalCase.age} · ${suite.theatres.find((t) => t.id === surgicalCase.theatreId)?.code} · ${surgicalCase.scheduledStart.slice(11)}` : undefined}
        width="xl"
      >
        {surgicalCase && (() => {
          const check = readiness(surgicalCase, day);
          const verdict = recoveryVerdict(surgicalCase.recovery);
          return (
            <div className="space-y-3">
              <ol className="grid gap-2 sm:grid-cols-5">
                {(['consent', 'site', 'anaesthesia', 'checklist', 'counts'] as const).map((gate) => {
                  const done = gate === 'consent' ? Boolean(surgicalCase.gates.consentVerifiedAt)
                    : gate === 'site' ? Boolean(surgicalCase.gates.siteMarked)
                      : gate === 'anaesthesia' ? Boolean(surgicalCase.gates.anaestheticReviewAt)
                        : gate === 'checklist' ? Boolean(surgicalCase.checklist.signIn)
                          : Boolean(surgicalCase.counts);
                  return (
                    <li key={gate} className={cx('rounded-md border px-3 py-2 text-sm', done ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-warning/40 bg-safety-warning/5')}>
                      <p className="text-xs text-text-secondary">{GATE_LABEL[gate]}</p>
                      <p className={cx('font-medium', done ? TONE_TEXT.success : TONE_TEXT.warning)}>{done ? 'closed' : 'open'}</p>
                    </li>
                  );
                })}
              </ol>

              {check.blockers.length > 0 && (
                <div className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">This case cannot sign in yet</p>
                  <ul className="mt-1 space-y-1 text-text-secondary">{check.blockers.map((b) => <li key={b}>· {b}</li>)}</ul>
                </div>
              )}
              {check.warnings.length > 0 && (
                <ul className="space-y-1 text-xs text-safety-warning">{check.warnings.map((w) => <li key={w}>· {w}</li>)}</ul>
              )}

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="text-xs text-text-secondary">Surgeon · anaesthetist</p>
                  <p className="font-medium">{surgicalCase.surgeon}</p>
                  <p className="text-text-secondary">{surgicalCase.anaesthetist} · {surgicalCase.anaesthesia}</p>
                </div>
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="text-xs text-text-secondary">Who reads the checklist aloud</p>
                  <input value={team.by} onChange={(e) => setTeam({ by: e.target.value })} aria-label="Checklist reader" className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </div>
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="text-xs text-text-secondary">Blood</p>
                  <p className="font-medium">{surgicalCase.gates.bloodReserved ?? 'group and save only'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => recordStage(surgicalCase, 'signIn')} disabled={Boolean(surgicalCase.checklist.signIn)}>Read sign in aloud</Button>
                <Button variant="ghost" onClick={() => recordStage(surgicalCase, 'timeOut')} disabled={!surgicalCase.checklist.signIn || Boolean(surgicalCase.checklist.timeOut)}>Read time out aloud</Button>
                <Button variant="ghost" onClick={() => recordStage(surgicalCase, 'signOut')} disabled={!surgicalCase.checklist.timeOut || Boolean(surgicalCase.checklist.signOut)}>Read sign out aloud</Button>
              </div>

              {(['signIn', 'timeOut', 'signOut'] as const).filter((s) => surgicalCase.checklist[s]).map((stage) => {
                const record = surgicalCase.checklist[stage]!;
                return (
                  <div key={stage} className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                    <p className="font-medium text-text-primary">{stage === 'signIn' ? 'Sign in' : stage === 'timeOut' ? 'Time out' : 'Sign out'} — {record.at.slice(11)} by {record.by}</p>
                    <ul className="mt-1 grid gap-1 text-text-secondary sm:grid-cols-2">{record.confirmed.map((c) => <li key={c}>· {c}</li>)}</ul>
                  </div>
                );
              })}

              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">Counts, before closure</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {(['swabs', 'instruments', 'needles'] as const).map((k) => (
                    <label key={k} className="text-xs text-text-secondary">
                      {k}
                      <input
                        type="number"
                        value={counts[k]}
                        onChange={(e) => setCounts({ ...counts, [k]: Number(e.target.value) })}
                        className="mt-1 block h-9 w-24 rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                      />
                    </label>
                  ))}
                  <Button variant="ghost" onClick={() => saveCounts(surgicalCase)}>Record the count</Button>
                </div>
                {surgicalCase.counts && (
                  <p className={cx('mt-2 text-sm', surgicalCase.counts.correct ? TONE_TEXT.success : TONE_TEXT.warning)}>
                    {surgicalCase.counts.correct
                      ? `Agreed at ${surgicalCase.counts.at.slice(11)} by ${surgicalCase.counts.checkedBy}: ${surgicalCase.counts.swabs} swabs, ${surgicalCase.counts.instruments} instruments, ${surgicalCase.counts.needles} needles.`
                      : `Recorded at ${surgicalCase.counts.at.slice(11)} with a discrepancy. Resolution: ${surgicalCase.counts.resolution}`}
                  </p>
                )}
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={2}
                  placeholder="If the count does not agree, say what was found and where — this is the field that gets filled at 03:00 or never."
                  aria-label="Count resolution"
                  className="mt-2 w-full rounded-md border border-border-default bg-surface-default px-2 py-1 text-sm"
                />
              </div>

              {surgicalCase.implants?.length && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">Implants and lots</p>
                  <ul className="mt-1 space-y-1 text-text-secondary">
                    {surgicalCase.implants.map((i) => <li key={i.lot}>· {i.item} · lot {i.lot} · expires {i.expiry} — recorded at the case, because a recall without the lot number is a letter to everybody.</li>)}
                  </ul>
                </div>
              )}

              {surgicalCase.specimen && (
                <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-text-primary">Specimen</p>
                  <p className="text-text-secondary">
                    {surgicalCase.specimen.label} → {surgicalCase.specimen.destination}
                    {surgicalCase.specimen.loggedAt ? ` · booked in at ${surgicalCase.specimen.loggedAt.slice(11)}` : ' · not yet logged at the desk'}
                  </p>
                </div>
              )}

              {surgicalCase.recovery && (
                <div className={cx('rounded-md border px-3 py-2 text-sm', verdict.ok ? 'border-safety-success/40 bg-safety-success/5' : 'border-safety-warning/40 bg-safety-warning/5')}>
                  <p className="font-medium text-text-primary">Recovery</p>
                  <p className="text-text-secondary">{verdict.text}</p>
                  <ul className="mt-1 space-y-1 text-text-secondary">
                    {surgicalCase.recovery.observations.map((o) => (
                      <li key={o.at}>· {o.at.slice(11)} — score {o.score}, BP {o.systolic}, pulse {o.pulse}, SpO₂ {o.spo2}%, pain {o.pain}/10{o.note ? ` — ${o.note}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              {surgicalCase.state === 'Scheduled' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-border-subtle px-3 py-2">
                    <p className="text-sm font-medium text-text-primary">Cancel the case</p>
                    <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} aria-label="Cancellation reason" className="mt-2 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                      {CANCELLATION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => cancel(surgicalCase)}>Cancel with this reason</Button>
                  </div>
                  <div className="rounded-md border border-border-subtle px-3 py-2">
                    <p className="text-sm font-medium text-text-primary">Move it down the list</p>
                    <p className="text-xs text-text-secondary">An emergency takes the theatre; the case behind it moves and is told.</p>
                    <input value={bumpTo} onChange={(e) => setBumpTo(e.target.value)} placeholder="14:30 today" aria-label="Move to" className="mt-2 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                    <Button variant="ghost" size="sm" onClick={() => bump(surgicalCase)}>Move it</Button>
                  </div>
                </div>
              )}

              {refusal && (
                <div className={cx('rounded-md border px-3 py-2 text-sm', refusal.startsWith('Refused') ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-safety-warning/40 bg-safety-warning/5')} role="status">
                  {refusal}
                </div>
              )}

              <p className="text-xs text-text-tertiary">
                Theatre charges, the surgeon’s share and the implant cost reach{' '}
                <Link href="/billing" className="underline">billing</Link> from this record; the ward this patient returns to is on{' '}
                <Link href="/ward" className="underline">the board</Link>; the facility and surgeon fees are priced in{' '}
                <Link href="/setup" className="underline">Setup</Link>.
              </p>
            </div>
          );
        })()}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/ward" className="underline">the ward board</Link> sends and receives these patients,{' '}
        <Link href="/duty" className="underline">the duty roster</Link> holds the theatre nurses, and{' '}
        <Link href="/setup" className="underline">Setup › Operating theatres</Link> holds this suite.
      </p>
    </div>
  );
}
