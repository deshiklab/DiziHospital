'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  PatientBanner,
  Segmented,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { ClipboardList, Footprints, Stethoscope } from 'lucide-react';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { WARDS } from '@/lib/ward';
import { ICD10 } from '@/lib/clinical';
import {
  CONSULTANT_REVIEW_HOURS,
  NEW_ADMISSION_HOURS,
  OBS_GAP_HOURS,
  PRIORITY_TONE,
  buildRound,
  type RoundItem,
  type RoundPriority,
} from '@/lib/round';

/* The doctor's round — the screen the ward module was missing.
 *
 * The ward board says where the patients are; this says who is seen, in what order, against which clock, and what
 * the round has to decide. `lib/round.ts` holds the rules: sick first, a new admission seen within four hours by
 * the registrar and twenty-four by the consultant, and every patient leaving the round with the open decisions
 * either closed or named.
 *
 * Preview: the patients are synthetic and nothing survives a reload. The ordering and the clocks are real.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const CHIP: Record<RoundPriority, string> = {
  'Emergency first': 'bg-safety-critical/10 text-safety-critical',
  'New admission': 'bg-safety-warning/10 text-safety-warning',
  'Post-operative': 'bg-brand-50 text-brand-700',
  Routine: 'bg-surface-sunken text-text-secondary',
};

export default function RoundPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [round, setRound] = useState(() => buildRound(day));
  const [wardFilter, setWardFilter] = useState('all');
  const [tab, setTab] = useState('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [plan, setPlan] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [codeStatus, setCodeStatus] = useState<RoundItem['admission']['codeStatus'] | ''>('');
  const [closed, setClosed] = useState<Record<string, string[]>>({});
  const [order, setOrder] = useState({ testName: '', priority: 'Routine' as 'Routine' | 'Urgent' | 'STAT' });

  const visible = useMemo(
    () => (wardFilter === 'all' ? round.items : round.items.filter((i) => i.wardId === wardFilter)),
    [round.items, wardFilter],
  );
  const item = round.items.find((i) => i.admissionId === openId) ?? null;

  const seen = round.items.filter((i) => i.seenAt).length;

  const closeDecision = (id: string, kind: string) => {
    setClosed((c) => ({ ...c, [id]: [...new Set([...(c[id] ?? []), kind])] }));
  };

  const finish = (target: RoundItem, text: string) => {
    if (!text.trim()) {
      push({ title: 'A plan has to be written down — a round that ends in the corridor did not happen.', tone: 'critical' });
      return;
    }
    const closes = closed[target.admissionId] ?? [];
    setRound((r) => ({
      ...r,
      items: r.items.map((i) => (i.admissionId === target.admissionId ? { ...i, seenAt: `${day} 15:35`, plan: text } : i)),
      stats: { ...r.stats, seen: r.stats.seen + (target.seenAt ? 0 : 1), openDecisions: Math.max(0, r.stats.openDecisions - closes.length) },
    }));
    queueWrite(`Round plan recorded for ${target.admission.patient.name} (${target.bedLabel})${closes.length ? ` — closed: ${closes.join(', ')}` : ''}`);
    setPlan('');
    push({
      title: `Plan written to the chart for ${target.admission.patient.name}`,
      description: `Append-only, signed, and it names the ${closes.length || 'no'} decision(s) it closed. The nurse reads the chart, not the corridor.`,
      tone: 'success',
    });
  };

  const codeDiagnosis = (target: RoundItem) => {
    const code = ICD10.find((c) => c.code.toLowerCase() === diagnosis.trim().toLowerCase());
    if (!code) {
      push({ title: 'Pick a code from the list — a free-text diagnosis cannot be counted or reported.', tone: 'critical' });
      return;
    }
    setRound((r) => ({
      ...r,
      items: r.items.map((i) => (i.admissionId === target.admissionId ? { ...i, admission: { ...i.admission, diagnosis: { code: code.code, label: code.label } } } : i)),
      stats: { ...r.stats, uncodedDiagnoses: Math.max(0, r.stats.uncodedDiagnoses - 1) },
    }));
    closeDecision(target.admissionId, 'Diagnosis');
    push({ title: `${code.code} — ${code.label} coded`, description: 'The bed card, the discharge summary and the case-mix report all read this field.', tone: 'success' });
  };

  const recordCeiling = (target: RoundItem, value: NonNullable<RoundItem['admission']['codeStatus']>) => {
    setRound((r) => ({
      ...r,
      items: r.items.map((i) => (i.admissionId === target.admissionId ? { ...i, admission: { ...i.admission, codeStatus: value } } : i)),
      stats: { ...r.stats, codeStatusUndiscussed: Math.max(0, r.stats.codeStatusUndiscussed - 1) },
    }));
    closeDecision(target.admissionId, 'Ceiling of care');
    push({ title: `Ceiling of care documented: ${value}`, description: 'Discussed with the patient or the family, and written down so the night team is not guessing.', tone: 'success' });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Stethoscope className="size-5 text-brand-600" aria-hidden />
            Doctor’s round
          </h1>
          <p className="text-sm text-text-secondary">
            {day} · {round.now} — sick patients first, then new admissions, then the rest. {seen} of {round.items.length} seen.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <Segmented
          name="round-ward"
          label="Ward"
          value={wardFilter}
          onChange={setWardFilter}
          options={[{ value: 'all', label: 'All wards' }, ...WARDS.map((w) => ({ value: w.id, label: w.prefix }))]}
        />
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Patients on the round" value={String(round.stats.patients)} definition="Every occupied bed in the hospital, one line each, ordered by acuity and then by admission time." asOf={`${day} ${round.now}`} />
        <KpiTile label="Seen" value={`${round.stats.seen} / ${round.stats.patients}`} definition="Patients with a plan written to the chart today." asOf={`${day} ${round.now}`} />
        <KpiTile label="Sick first" value={String(round.stats.urgent)} definition="Patients whose early-warning score reached Escalate or Emergency in the last twelve hours." asOf={`${day} ${round.now}`} footnote="These are seen before anybody in a lower band, whatever the bed order" />
        <KpiTile label="New admissions" value={String(round.stats.newAdmissions)} definition={`Admitted less than ${NEW_ADMISSION_HOURS} hours ago — registrar review within ${NEW_ADMISSION_HOURS} h, consultant within ${CONSULTANT_REVIEW_HOURS} h.`} asOf={`${day} ${round.now}`} />
        <KpiTile label="Open decisions" value={String(round.stats.openDecisions)} definition="Decisions the round has to close: uncoded diagnoses, undocumented ceilings of care, overdue observations, unread results." asOf={`${day} ${round.now}`} footnote={`${round.stats.uncodedDiagnoses} uncoded · ${round.stats.codeStatusUndiscussed} without a ceiling of care`} />
        <KpiTile label="Observations overdue" value={String(round.stats.obsOverdue)} definition={`Patients whose last observation is more than ${OBS_GAP_HOURS} hours old.`} asOf={`${day} ${round.now}`} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'list', label: 'The round', count: round.items.length },
          { id: 'rules', label: 'Order and clocks' },
        ]}
      />

      {tab === 'list' && (
        <Panel
          title={`${wardFilter === 'all' ? 'All wards' : WARDS.find((w) => w.id === wardFilter)?.name} — in the order they are seen`}
          actions={<span className="text-xs text-text-secondary">Open a patient to see the overnight pack and close the decisions</span>}
        >
          {visible.length === 0 ? (
            <EmptyState title="No patients in this ward" description="Nothing to round on — the board is empty for this ward." />
          ) : (
            <ol className="space-y-2">
              {visible.map((i, index) => (
                <li
                  key={i.admissionId}
                  className={cx('rounded-md border px-3 py-2', i.seenAt ? 'border-border-subtle bg-surface-sunken' : i.priority === 'Emergency first' ? 'border-safety-critical/40' : 'border-border-subtle')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-5 text-right text-xs text-text-tertiary">{index + 1}</span>
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', CHIP[i.priority])}>{i.priority}</span>
                      <button type="button" onClick={() => { setOpenId(i.admissionId); setPlan(''); setDiagnosis(''); setCodeStatus(''); }} className="font-medium text-text-primary underline">
                        {i.admission.patient.name}
                      </button>
                      <span className="text-xs text-text-tertiary">
                        {i.bedLabel} · {i.wardName} · {i.admission.patient.age} {i.admission.patient.sex.slice(0, 1)} · {i.admission.patient.mrn}
                      </span>
                      {i.seenAt && <span className={cx('rounded-full bg-safety-success/10 px-2 py-0.5 text-[10px]', TONE_TEXT.success)}>seen {i.seenAt.slice(11)}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      {i.worstBand && <span className={cx('rounded-full px-2 py-0.5', i.worstBand === 'Emergency' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>{i.worstBand} {i.worstScore}</span>}
                      {i.decisions.length > 0 && <span className={cx(TONE_TEXT.warning)}>{i.decisions.length - (closed[i.admissionId]?.length ?? 0)} decision(s) open</span>}
                      <Button variant="ghost" size="sm" onClick={() => { setOpenId(i.admissionId); setPlan(''); setDiagnosis(''); setCodeStatus(''); }}>
                        <Footprints className="size-3.5" aria-hidden /> {i.seenAt ? 'Revisit' : 'See'}
                      </Button>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">{i.admission.reason}</p>
                  <p className="text-xs text-text-tertiary">
                    Admitted {i.clock.admittedAt.slice(11)} · registrar by {i.clock.registrarBy.slice(11)} · consultant by {i.clock.consultantBy.slice(11)}
                    {i.clock.lastObsAt ? ` · last observation ${i.clock.lastObsAt.slice(11)}` : ' · no observation recorded'}
                    {i.admission.instructions?.length ? ` · ${i.admission.instructions.join(' · ')}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="Why the list is in this order">
            <ul className="space-y-2 text-sm">
              <li><span className={cx('font-medium', TONE_TEXT.critical)}>Sick first.</span> <span className="text-text-secondary">Any patient whose score reached Escalate or Emergency in the last twelve hours is seen before anybody else, whatever bed they are in. Bed-order rounds are how the deteriorating patient in bed A-07 gets two minutes at the end.</span></li>
              <li><span className={cx('font-medium', TONE_TEXT.warning)}>New admissions next.</span> <span className="text-text-secondary">A patient admitted in the last {NEW_ADMISSION_HOURS} hours carries a clock: the registrar within {NEW_ADMISSION_HOURS} hours, the consultant within {CONSULTANT_REVIEW_HOURS}. An admission at 02:00 is not “seen tomorrow”.</span></li>
              <li><span className={cx('font-medium', TONE_TEXT.info)}>Post-operative patients third.</span> <span className="text-text-secondary">A wound or a drain reviewed on the round is a complication found at 10:00 instead of a night call at 02:00.</span></li>
              <li><span className={cx('font-medium', TONE_TEXT.neutral)}>Then everybody else,</span> <span className="text-text-secondary"> ward by ward and bed by bed, so the round walks a corridor and not the hospital.</span></li>
            </ul>
          </Panel>
          <Panel title="What every patient leaves the round with">
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>· <span className="font-medium text-text-primary">A written plan</span> on the chart, append-only and signed. A plan that was only spoken in the corridor was not a round.</li>
              <li>· <span className="font-medium text-text-primary">A diagnosis code</span>, or a note saying why there is not one yet. Case mix, the reports and the insurance claim all read from it.</li>
              <li>· <span className="font-medium text-text-primary">A ceiling of care decision</span>, for anybody who is not stable. Undiscussed is a decision to leave the night team guessing, and the screen counts it as one.</li>
              <li>· <span className="font-medium text-text-primary">A named reason</span> for every dose that was held, refused or missed overnight — the nurse recorded it, the round reads it.</li>
              <li>· <span className="font-medium text-text-primary">Results read</span>: acted on, or explicitly filed as no action needed.</li>
            </ul>
          </Panel>
          <Panel title="Where this screen gets its patients">
            <p className="text-sm text-text-secondary">
              The same generator as <Link href="/ward" className="underline">the ward board</Link> — one source for the day’s beds, observations, drug round and notes, so the round and the board can never disagree about who is in a bed.
              The drug round is <Link href="/ward" className="underline">the nurse’s screen</Link>; this one decides and documents.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- patient sheet */}
      <Sheet
        open={Boolean(item)}
        onClose={() => setOpenId(null)}
        title={item ? `${item.admission.patient.name} · ${item.bedLabel}` : 'Patient'}
        description={item ? `${item.wardName} · ${item.admission.consultantName} · admitted ${item.clock.admittedAt.slice(11)}` : undefined}
        width="xl"
        footer={
          item && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setOrder({ ...order, testName: order.testName || 'Complete blood count' });
                  const test = order.testName.trim() || 'Complete blood count';
                  queueWrite(`Investigation ordered for ${item.admission.patient.name}: ${test} (${order.priority})`);
                  push({ title: `${test} ordered — ${order.priority}`, description: 'The order reaches the worklist immediately, which is what makes it a round order rather than a promise.', tone: 'success' });
                }}
              >
                <ClipboardList className="size-4" aria-hidden /> Order an investigation
              </Button>
              <Button onClick={() => finish(item, plan)}>Finish this patient</Button>
            </div>
          )
        }
      >
        {item && (
          <div className="space-y-3">
            <PatientBanner
              mrn={item.admission.patient.mrn}
              name={item.admission.patient.name}
              age={item.admission.patient.age}
              sex={item.admission.patient.sex}
              bed={item.bedLabel}
              payer={item.admission.patient.payer}
              allergies={item.admission.patient.allergies ? [item.admission.patient.allergies] : []}
              alerts={[item.admission.isolation ? `Isolation: ${item.admission.isolation}` : '', item.admission.codeStatus ?? 'Ceiling of care not documented'].filter(Boolean)}
              extra={[{ label: 'Consultant', value: item.admission.consultantName }, { label: 'Phone', value: item.admission.patient.phone }]}
            />

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="text-xs text-text-secondary">Admission</p>
                <p className="font-medium">{item.admission.reason}</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  Registrar review due {item.clock.registrarBy.slice(11)}, consultant {item.clock.consultantBy.slice(11)}
                </p>
              </div>
              <div className={cx('rounded-md border px-3 py-2 text-sm', (item.clock.gapHours ?? 0) > OBS_GAP_HOURS ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                <p className="text-xs text-text-secondary">Observations</p>
                <p className="font-medium">{item.clock.lastObsAt ? `last at ${item.clock.lastObsAt.slice(11)}` : 'none recorded'}</p>
                <p className="mt-1 text-xs text-text-tertiary">Worst score {item.worstScore ?? '—'} {item.worstBand ? `(${item.worstBand})` : ''}</p>
              </div>
              <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="text-xs text-text-secondary">Drug round</p>
                <p className="font-medium">{item.overnight.lateDoses.length === 0 ? 'nothing late, held or refused' : `${item.overnight.lateDoses.length} exception(s)`}</p>
                <p className="mt-1 text-xs text-text-tertiary">{item.overnight.notes} nursing note(s) since admission</p>
              </div>
            </div>

            {item.overnight.alerts.length > 0 && (
              <div className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">Overnight escalations</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {item.overnight.alerts.map((a) => <li key={a}>· {a}</li>)}
                </ul>
              </div>
            )}

            {item.overnight.lateDoses.length > 0 && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">Doses that were not given on time</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {item.overnight.lateDoses.map((d) => <li key={d}>· {d}</li>)}
                </ul>
                <p className="mt-1 text-xs text-text-tertiary">Each one carries the nurse’s reason. The round decides whether the prescription or the plan changes — repeating “give on time” is not a plan.</p>
              </div>
            )}

            {item.overnight.results.length > 0 && (
              <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                <p className="font-medium text-text-primary">Results for this patient</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {item.overnight.results.map((r) => (
                    <li key={r.id}>
                      · {r.testName} — {r.status}
                      {r.resultedAt ? ` at ${r.resultedAt.slice(11)}` : ''}
                      {r.report ? ` · ${r.report}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-sm font-semibold text-text-primary">Decisions this round has to close</h3>
              {item.decisions.length === 0 ? (
                <p className="text-sm text-safety-success">Nothing open: coded, reviewed, observed and read. The round is a confirm.</p>
              ) : (
                <ul className="space-y-2">
                  {item.decisions.map((d) => {
                    const isClosed = (closed[item.admissionId] ?? []).includes(d.kind);
                    return (
                      <li key={d.kind} className={cx('rounded-md border px-3 py-2 text-sm', isClosed ? 'border-safety-success/40 bg-safety-success/5' : d.severity === 'critical' ? 'border-safety-critical/40 bg-safety-critical/5' : d.severity === 'warning' ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-text-primary">{d.kind}</span>
                          {isClosed ? (
                            <span className={cx('text-xs', TONE_TEXT.success)}>closed on this round</span>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => closeDecision(item.admissionId, d.kind)}>Record as closed</Button>
                          )}
                        </div>
                        <p className="text-text-secondary">{d.text}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* the two decisions that need a form rather than a sentence */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">Code the diagnosis</p>
                <p className="text-xs text-text-secondary">
                  {item.admission.diagnosis ? `Coded ${item.admission.diagnosis.code} — ${item.admission.diagnosis.label}` : 'Uncoded. Type a code from the ICD-10 list, e.g. F32.'}
                </p>
                <div className="mt-2 flex gap-2">
                  <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="F32" aria-label="ICD-10 code" className="h-9 w-24 rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                  <Button variant="ghost" onClick={() => codeDiagnosis(item)} disabled={Boolean(item.admission.diagnosis)}>Code it</Button>
                </div>
              </div>
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">Ceiling of care</p>
                <p className="text-xs text-text-secondary">
                  {item.admission.codeStatus ? `Documented: ${item.admission.codeStatus}` : 'Never discussed. This is the decision that is hardest at 03:00.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['For full care', 'Limited intervention', 'Not for resuscitation (documented)'] as const).map((v) => (
                    <Button key={v} variant="ghost" size="sm" onClick={() => recordCeiling(item, v)} disabled={Boolean(item.admission.codeStatus)}>{v}</Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">Order an investigation</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input value={order.testName} onChange={(e) => setOrder({ ...order, testName: e.target.value })} placeholder="Complete blood count" aria-label="Investigation" className="h-9 flex-1 rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                  <select value={order.priority} onChange={(e) => setOrder({ ...order, priority: e.target.value as typeof order.priority })} className="h-9 rounded-md border border-border-default bg-surface-default px-2 text-sm">
                    {['Routine', 'Urgent', 'STAT'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">The plan, as it goes on the chart</p>
                <textarea
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  rows={3}
                  placeholder="Continue intravenous antibiotics, repeat the count in the morning, physiotherapy for the chest, review the discharge plan tomorrow."
                  className="mt-2 w-full rounded-md border border-border-default bg-surface-default px-2 py-1 text-sm"
                  aria-label="Plan"
                />
                <p className="mt-1 text-xs text-text-tertiary">
                  Signed by the shell’s role and queued for sync — the note is append-only, so a correction is another note.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => finish(item, plan)}>Finish this patient and write the plan</Button>
            </div>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/ward" className="underline">the ward board</Link>,{' '}
        <Link href="/diagnostics" className="underline">diagnostics</Link> for the result queue, and{' '}
        <Link href="/duty" className="underline">the duty roster</Link> for who is on the floor while this round runs.
      </p>
    </div>
  );
}
