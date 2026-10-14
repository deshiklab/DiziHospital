'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Segmented,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { FileText, PhoneCall, Printer, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import {
  PENDING_RESULT_FOLLOW_UP_HOURS,
  READMISSION_WINDOW_DAYS,
  buildAftercare,
  type DischargedPatient,
  type FollowUpState,
} from '@/lib/aftercare';

/* Discharged patients (legacy screen 004 — the discharge register — replaced) — the P1 sub-screen.
 *
 * The legacy register was a date-sorted list of names. This one answers the three questions the discharge desk
 * actually has: is the summary a document yet, is anything still owed or pending on this patient, and has anybody
 * booked the follow-up? `lib/aftercare.ts` holds the rules — a summary without its parts is incomplete, a result
 * pending at discharge is a telephone call to the patient rather than a note to the bed, take-home medicines are
 * counted against what was dispensed, and a readmission inside thirty days is counted against the discharge that
 * preceded it.
 *
 * Preview: the register is synthetic, derived from the same ward generator the board uses. Nothing survives a
 * reload; the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const FOLLOW_UP_CHIP: Record<FollowUpState, string> = {
  Booked: 'bg-safety-success/10 text-safety-success',
  'Due today': 'bg-brand-50 text-brand-700',
  Overdue: 'bg-safety-critical/10 text-safety-critical',
  'Not booked': 'bg-safety-warning/10 text-safety-warning',
  'Not needed': 'bg-surface-sunken text-text-secondary',
};

export default function DischargedPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const aftercare = useMemo(() => buildAftercare(day), [day]);
  const [tab, setTab] = useState('register');
  const [period, setPeriod] = useState<'today' | 'week' | 'all'>('week');
  const [openId, setOpenId] = useState<string | null>(null);
  const [called, setCalled] = useState<Record<string, string>>({});
  const [settled, setSettled] = useState<Record<string, string>>({});

  const patient = aftercare.discharged.find((p) => p.record.id === openId) ?? null;

  const rows = useMemo(() => {
    const all = aftercare.discharged.map((p) => ({
      ...p,
      dues: settled[p.record.id] ? { amount: 0, settledAt: settled[p.record.id], note: 'Settled from this screen' } : p.dues,
    }));
    if (period === 'today') return all.filter((p) => p.day === day);
    if (period === 'week') return all.filter((p) => p.day >= shiftDays(day, -7));
    return all;
  }, [aftercare.discharged, period, day, settled]);

  const row = patient
    ? {
        ...patient,
        dues: settled[patient.record.id] ? { amount: 0, settledAt: settled[patient.record.id], note: 'Settled from this screen' } : patient.dues,
      }
    : null;

  const stats = aftercare.stats;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <FileText className="size-5 text-brand-600" aria-hidden />
            Discharged patients
          </h1>
          <p className="text-sm text-text-secondary">
            The register after the bed is empty: summaries, results still owed to the patient, follow-ups and dues —
            {` ${day}`}.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <Segmented
          name="discharged-window"
          label="Period"
          value={period}
          onChange={(v) => setPeriod(v as typeof period)}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
            { value: 'all', label: 'All' },
          ]}
        />
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Discharged today" value={String(stats.today)} definition="Patients who left a bed today, from the ward board’s own records." asOf={day} />
        <KpiTile label="Summaries incomplete" value={String(stats.summariesIncomplete)} definition="Discharges whose summary is missing a part: course, treatment, condition on discharge, advice in Bangla, or a coded diagnosis." asOf={day} />
        <KpiTile label="Results still owed" value={String(stats.recallsToMake)} definition={`Patients with a result pending at discharge. A result is followed to the patient, not to the bed — the window is ${PENDING_RESULT_FOLLOW_UP_HOURS} hours.`} asOf={day} />
        <KpiTile label="Follow-ups overdue" value={String(stats.followUpOverdue)} definition="A follow-up date that has passed with nobody booked against it." asOf={day} footnote={`${stats.followUpsNotBooked} never booked`} />
        <KpiTile label={`Readmitted in ${READMISSION_WINDOW_DAYS} days`} value={String(stats.readmitted30)} definition="Patients back in a bed inside the window — counted against the discharge that preceded it, which is the number that says whether the discharge was good." asOf={day} />
        <KpiTile label="Dues outstanding" value={money(stats.duesOutstanding)} definition="Money owed by discharged patients. A ward bill that follows a patient out of the building is a debt nobody can reconstruct a month later." asOf={day} footnote={`${stats.duesPatients} patient(s)`} />
      </div>

      {stats.summariesIncomplete > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm">
          <TriangleAlert className="size-4 text-safety-warning" aria-hidden />
          <span>
            {stats.summariesIncomplete} summar{stats.summariesIncomplete === 1 ? 'y is' : 'ies are'} incomplete. A discharge summary is a
            document the patient carries elsewhere: a missing part is not a formatting problem, it is the next doctor not knowing what happened.
          </span>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'register', label: 'Register', count: rows.length },
          { id: 'tochase', label: 'To chase', count: stats.recallsToMake + stats.followUpOverdue + stats.followUpsNotBooked },
          { id: 'rules', label: 'What a discharge owes' },
        ]}
      />

      {tab === 'register' && (
        <Panel title={`Discharged patients — ${period === 'today' ? 'today' : period === 'week' ? 'last 7 days' : 'all recorded'}`} actions={<span className="text-xs text-text-secondary">Open a patient for the summary, the results owed and the money</span>}>
          {rows.length === 0 ? (
            <EmptyState title="Nothing discharged in this period" description="Nothing has left a bed in the selected window." />
          ) : (
            <ListView
              id="discharged-register"
              caption="Discharged patients"
              height="32rem"
              rows={rows}
              rowId={(p) => p.record.id}
              onRowClick={(p) => setOpenId(p.record.id)}
              emptyLabel="Nothing in this period."
              columns={[
                { key: 'day', header: 'Left', width: '110px' },
                { key: 'name', header: 'Patient', render: (p) => (
                  <span>
                    {p.record.name}
                    <span className="ml-2 text-xs text-text-tertiary">{p.record.mrn}</span>
                  </span>
                ) },
                { key: 'type', header: 'Type', width: '210px' },
                { key: 'diagnosis', header: 'Diagnosis', hideBelow: 'lg', render: (p) => `${p.record.diagnosis.code} — ${p.record.diagnosis.label}` },
                { key: 'stayedDays', header: 'Nights', numeric: true, align: 'right', width: '90px' },
                { key: 'summary', header: 'Summary', width: '150px', render: (p) => (
                  p.summaryGaps.length === 0
                    ? <span className={cx(TONE_TEXT.success)}>complete</span>
                    : <span className={cx('font-medium', TONE_TEXT.critical)}>missing {p.summaryGaps.length}</span>
                ) },
                { key: 'results', header: 'Results owed', hideBelow: 'xl', width: '130px', render: (p) => p.pendingResults.length ? <span className={cx(TONE_TEXT.warning)}>{p.pendingResults.length} to ring</span> : <span className="text-text-tertiary">—</span> },
                { key: 'followUp', header: 'Follow-up', width: '180px', render: (p) => (
                  <span className={cx('rounded-full px-2 py-0.5 text-xs', FOLLOW_UP_CHIP[p.followUp.state])}>
                    {p.followUp.state}{p.followUp.on ? ` · ${p.followUp.on}` : ''}
                  </span>
                ) },
                { key: 'dues', header: 'Dues', numeric: true, align: 'right', width: '120px', render: (p) => (
                  p.dues.amount > 0 ? <span className={cx('font-medium', TONE_TEXT.warning)}>{money(p.dues.amount)}</span> : <span className={cx(TONE_TEXT.success)}>settled</span>
                ) },
              ]}
            />
          )}
        </Panel>
      )}

      {tab === 'tochase' && (
        <div className="space-y-3">
          <Panel title="Results to ring about" actions={<span className="text-xs text-text-secondary">Pending at discharge — the patient, not the bed, gets the call</span>}>
            {aftercare.discharged.filter((p) => p.pendingResults.length > 0).length === 0 ? (
              <p className="text-sm text-safety-success">Nothing pending: every result was verified before the patient left.</p>
            ) : (
              <ul className="space-y-2">
                {aftercare.discharged.filter((p) => p.pendingResults.length > 0).map((p) => (
                  <li key={p.record.id} className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium text-text-primary">{p.record.name}</span>
                        <span className="ml-2 text-xs text-text-tertiary">{p.record.mrn} · left {p.day} · {p.record.consultantName}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {called[p.record.id]
                          ? <span className={cx('text-xs', TONE_TEXT.success)}>rung at {called[p.record.id]}</span>
                          : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCalled((c) => ({ ...c, [p.record.id]: 'today 15:50' }));
                                queueWrite(`Follow-up call recorded for ${p.record.name}: pending result ring-through`);
                                push({ title: `Call recorded for ${p.record.name}`, description: 'A call that is not recorded did not happen, and the next shift would ring them again.', tone: 'success' });
                              }}
                            >
                              <PhoneCall className="size-3.5" aria-hidden /> Record the call
                            </Button>
                          )}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-text-secondary">
                      {p.pendingResults.map((r) => <li key={r.testName}>· {r.testName} due {r.dueAt.slice(11)} — {r.recall}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Follow-ups that have not happened" actions={<span className="text-xs text-text-secondary">Overdue or never booked</span>}>
            <ul className="space-y-2">
              {aftercare.discharged.filter((p) => p.followUp.state === 'Overdue' || p.followUp.state === 'Not booked').map((p) => (
                <li key={p.record.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-text-primary">{p.record.name}</span>
                    <span className="ml-2 text-xs text-text-tertiary">{p.record.mrn} · {p.followUp.department} · was due {p.followUp.on ?? 'unscheduled'}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      queueWrite(`Follow-up booked for ${p.record.name} in ${p.followUp.department}`, {
                        id: 'createAppointment',
                        recordId: p.record.mrn,
                        fields: { mrn: p.record.mrn, type: 'Follow-up', department: p.followUp.department },
                      });
                      push({ title: `Follow-up booked for ${p.record.name}`, description: `The appointment is in ${p.followUp.department} and the summary is reprinted with the date on it, because a date the family has to remember is a date nobody keeps.`, tone: 'success' });
                    }}
                  >
                    Book it
                  </Button>
                </li>
              ))}
              {aftercare.discharged.every((p) => p.followUp.state !== 'Overdue' && p.followUp.state !== 'Not booked') && (
                <li className="text-sm text-safety-success">Every follow-up is either booked, due today, or not needed by the discharge type.</li>
              )}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="What a discharge owes the patient">
            <ul className="space-y-2 text-sm">
              <li><span className="font-medium text-text-primary">A complete summary.</span> <span className="text-text-secondary">Diagnosis, course, treatment, condition on discharge and advice in Bangla — the five parts this screen counts. The patient carries it to the next doctor, who does not have this system.</span></li>
              <li><span className="font-medium text-text-primary">The results that were still cooking.</span> <span className="text-text-secondary">A culture that grows something after the patient has gone home is a telephone call within {PENDING_RESULT_FOLLOW_UP_HOURS} hours, recorded as made — otherwise the next shift rings the same patient again.</span></li>
              <li><span className="font-medium text-text-primary">The medicines in the patient’s hand.</span> <span className="text-text-secondary">Written on the summary, dispensed at the counter, and the difference shown here. An antibiotic course that stops on day two is a readmission waiting for a date.</span></li>
              <li><span className="font-medium text-text-primary">A follow-up date on the paper.</span> <span className="text-text-secondary">Seven days for a recovered or improved patient, three for somebody who left against advice, none when the patient was referred or transferred (the receiving team owns it).</span></li>
              <li><span className="font-medium text-text-primary">The money, either settled or recorded.</span> <span className="text-text-secondary">A discharge with an unrecorded balance is a debt the accounts office has to reconstruct a month later from a pile of paper.</span></li>
              <li><span className="font-medium text-text-primary">A readmission counted, not forgotten.</span> <span className="text-text-secondary">Back in a bed inside {READMISSION_WINDOW_DAYS} days is flagged against the discharge that preceded it. It is the most useful single number this register produces, and it is only useful if it is counted.</span></li>
            </ul>
          </Panel>
          <Panel title="Types of discharge this register understands">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Discharge types and their follow-up</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Type</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Follow-up</th>
                    <th scope="col" className="py-1.5 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Recovered', '7 days', 'A short review catches the complication that appears after the ward stops watching.'],
                    ['Improved, follow-up in OPD', '7 days', 'The condition is improving, not finished — the OPD visit is part of the treatment.'],
                    ['Referred to a higher centre', 'none here', 'The receiving team owns the follow-up; the referral letter says who and where.'],
                    ['Discharged on request', '3 days', 'A short, early call: the patient chose to leave, which makes the first week the risky one.'],
                    ['Left against medical advice', '3 days', 'Called as well as booked — the risk is what happens at home, not the paperwork.'],
                    ['Transferred to another branch', 'none here', 'One patient, two sites: the branch that receives them continues the care.'],
                    ['Died', 'none', 'The register keeps the record; the family needs the paperwork and the belongings, not a follow-up call.'],
                  ].map(([type, gap, why]) => (
                    <tr key={type} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{type}</td>
                      <td className="py-1.5 pr-3">{gap}</td>
                      <td className="py-1.5 text-text-secondary">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- discharge sheet */}
      <Sheet
        open={Boolean(row)}
        onClose={() => setOpenId(null)}
        title={row ? `${row.record.name} · ${row.record.mrn}` : 'Discharge'}
        description={row ? `${row.record.type} · left ${row.day} after ${row.record.stayedDays} night(s) · ${row.record.consultantName}` : undefined}
        width="xl"
        footer={
          row && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => push({ title: 'Summary sent to the print queue', description: 'The printed summary carries the diagnosis, the medicines and the follow-up date — the three things a patient carries out of the building.', tone: 'info' })}
              >
                <Printer className="size-4" aria-hidden /> Print the summary
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSettled((s) => ({ ...s, [row.record.id]: 'today 15:52' }));
                  queueWrite(`Dues settled for ${row.record.name}: ${row.dues.amount}`, {
                    id: 'recordPayment',
                    recordId: row.record.mrn,
                    fields: { amount: row.dues.amount, method: 'Cash' },
                  });
                  push({ title: `${money(row.dues.amount)} settled`, description: 'Recorded against the discharge with the time and the cashier, so the receipt can be matched later.', tone: 'success' });
                }}
                disabled={row.dues.amount === 0}
              >
                Record the payment
              </Button>
              <Link href={`/print/discharge-summary?dsc=${row.record.id}&mrn=${row.record.mrn}`} className="inline-flex">
                <Button>Open the print template</Button>
              </Link>
            </div>
          )
        }
      >
        {row && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Diagnosis</dt><dd className="font-medium">{row.record.diagnosis.code} — {row.record.diagnosis.label}</dd></div>
              <div><dt className="text-xs text-text-secondary">Stayed</dt><dd className="font-medium">{row.record.stayedDays} night(s), admitted {row.record.admittedAt.slice(0, 16).replace('T', ' ')}</dd></div>
              <div><dt className="text-xs text-text-secondary">Discharge type</dt><dd className="font-medium">{row.record.type}</dd></div>
              <div><dt className="text-xs text-text-secondary">Dues</dt><dd className={cx('font-medium', row.dues.amount > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{row.dues.amount > 0 ? `${money(row.dues.amount)} outstanding` : `settled ${row.dues.settledAt ?? ''}`}</dd></div>
            </dl>

            <div className={cx('rounded-md border px-3 py-2', row.summaryGaps.length ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-safety-success/40 bg-safety-success/5')}>
              <p className="font-medium text-text-primary">{row.summaryGaps.length ? 'Summary incomplete' : 'Summary complete'}</p>
              <p className="text-text-secondary">
                {row.summaryGaps.length
                  ? `Missing: ${row.summaryGaps.join(', ')}. The summary prints with the gap visible rather than quietly leaving it out.`
                  : 'Course, findings, treatment, condition on discharge, advice in Bangla and a coded diagnosis are all present.'}
              </p>
            </div>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">What the summary says</p>
              <dl className="mt-1 space-y-1 text-text-secondary">
                <div><dt className="inline font-medium">Course: </dt><dd className="inline">{row.record.summary.course}</dd></div>
                <div><dt className="inline font-medium">Findings: </dt><dd className="inline">{row.record.summary.findings}</dd></div>
                <div><dt className="inline font-medium">Treatment: </dt><dd className="inline">{row.record.summary.treatment}</dd></div>
                <div><dt className="inline font-medium">Condition: </dt><dd className="inline">{row.record.summary.condition}</dd></div>
                <div><dt className="inline font-medium">পরামর্শ: </dt><dd className="inline">{row.record.summary.adviceBn}</dd></div>
              </dl>
            </div>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Medicines written against dispensed</p>
              <ul className="mt-1 space-y-1">
                {row.medicines.map((m) => (
                  <li key={m.name} className="flex items-center justify-between">
                    <span>{m.name}</span>
                    <span className={cx('tabular-nums', m.dispensed < m.written ? TONE_TEXT.warning : TONE_TEXT.success)}>
                      {m.dispensed} of {m.written} dispensed
                    </span>
                  </li>
                ))}
              </ul>
              {row.medicines.some((m) => m.dispensed < m.written) && (
                <p className="mt-1 text-xs text-text-tertiary">
                  The difference is a course that stops early. Either it is dispensed before the patient leaves, or the summary says where
                  to buy it — “the family will manage” is how resistance starts.
                </p>
              )}
            </div>

            {row.pendingResults.length > 0 && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="font-medium text-text-primary">Results pending at discharge</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {row.pendingResults.map((r) => <li key={r.testName}>· {r.testName}, due {r.dueAt.replace('T', ' ')} — {r.recall}</li>)}
                </ul>
                {called[row.record.id] && <p className={cx('mt-1 text-xs', TONE_TEXT.success)}>Rung at {called[row.record.id]} and recorded.</p>}
              </div>
            )}

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">Follow-up</p>
              <p className="text-text-secondary">
                {row.followUp.state}{row.followUp.on ? ` · ${row.followUp.on}` : ''} · {row.followUp.department} — {row.followUp.note}
              </p>
            </div>

            {row.readmittedInDays !== undefined && (
              <div className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2">
                <p className="font-medium text-text-primary">Back in a bed after {row.readmittedInDays} days</p>
                <p className="text-text-secondary">
                  Inside the {READMISSION_WINDOW_DAYS}-day window, so it counts against this discharge. The register keeps the pair together,
                  because a readmission rate computed without its denominators is a number nobody can act on.
                </p>
              </div>
            )}

            {row.flags.length > 0 && (
              <ul className="space-y-1">
                {row.flags.map((f) => (
                  <li key={f.text} className={cx('rounded-md border px-3 py-2', f.kind === 'critical' ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-safety-warning/40 bg-safety-warning/5')}>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-text-tertiary">
              The ward board this patient left is on <Link href="/ward" className="underline">the ward screen</Link>; the printed summary
              comes from <Link href="/print/discharge-summary" className="underline">the discharge-summary template</Link>; the bill behind
              the dues is in <Link href="/billing" className="underline">billing</Link>.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** A date N days back, for the period filter. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
