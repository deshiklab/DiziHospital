'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Segmented, Tabs, cx, useToast } from '@dizi/ui';
import { CalendarClock, Printer } from 'lucide-react';
import {
  RANGES,
  SCHEDULED_REPORTS,
  SCHEDULING_NEEDS_SERVER,
  buildSnapshot,
  overviewMetrics,
  type DataQualityFinding,
  type Metric,
  type Named,
  type RangeId,
} from '@/lib/reports';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { PLANNED_REPORTS, REPORT_GROUPS, REPORT_SUITE_TOTAL, reportsInGroup } from '@/lib/report-suite';

/* Reports and dashboards (legacy report screens replaced) — the P6 read side.
 *
 * The module's rules live at the top of lib/reports.ts. What matters on the screen: every figure shows what it
 * means and when it was taken, stock says it is point-in-time, cash is never mixed into "collected", and the
 * data-quality tab is a first-class report rather than a footnote.
 */

const money = (n: number) => `৳${Math.round(n).toLocaleString('en-US')}`;

const TONE_DOT: Record<NonNullable<Metric['tone']>, string> = {
  neutral: 'bg-border-strong',
  success: 'bg-safety-success',
  warning: 'bg-safety-warning',
  critical: 'bg-safety-critical',
};

const SEVERITY: Record<DataQualityFinding['severity'], { tone: 'critical' | 'warning' | 'info'; label: string }> = {
  critical: { tone: 'critical', label: 'Act today' },
  warning: { tone: 'warning', label: 'This week' },
  info: { tone: 'info', label: 'Watch' },
};

const chip = (tone: 'critical' | 'warning' | 'success' | 'info' | 'neutral', text: string) => (
  <span
    className={cx(
      'rounded-full px-2 py-0.5 text-xs',
      tone === 'critical' && 'bg-safety-critical/10 text-safety-critical',
      tone === 'warning' && 'bg-safety-warning/10 text-safety-warning',
      tone === 'success' && 'bg-safety-success/10 text-safety-success',
      tone === 'info' && 'bg-brand-50 text-brand-700',
      tone === 'neutral' && 'bg-surface-sunken text-text-secondary',
    )}
  >
    {text}
  </span>
);

/** A column chart that is also a readable list: the label and the number are text, the bar is decoration. */
function BarSeries({ items, format = String, caption }: { items: Named[]; format?: (n: number) => string; caption: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex items-end gap-1" aria-label={caption}>
      {items.map((i) => (
        <li key={i.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="font-numeric text-[11px] text-text-secondary">{format(i.value)}</span>
          <span
            aria-hidden
            className="w-full rounded-t-sm bg-brand-500/80"
            style={{ height: `${Math.max(2, Math.round((i.value / max) * 90))}px` }}
          />
          <span className="text-[10px] text-text-tertiary">{i.label}</span>
          {i.extra && <span className="text-[10px] text-text-tertiary">{i.extra}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A rank list with proportional bars — volumes, not just totals, so one big row cannot hide the rest. */
function RankList({ title, items, format = String, empty = 'Nothing to rank in this range.' }: { title: string; items: Named[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-text-tertiary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.label} className="flex flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{i.label}</span>
                <span className="font-numeric shrink-0 text-text-secondary">{format(i.value)}{i.extra ? ` · ${i.extra}` : ''}</span>
              </span>
              <span aria-hidden className="h-1.5 w-full rounded-full bg-surface-sunken">
                <span className="block h-1.5 rounded-full bg-brand-500/70" style={{ width: `${Math.max(3, Math.round((i.value / max) * 100))}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function ReportsPage() {
  const { sync } = useShell();
  const { push } = useToast();
  const today = todayIso();
  const [range, setRange] = useState<RangeId>('week');
  const [tab, setTab] = useState('overview');
  /* When this render was built. Set from an effect, never during render: a clock read while rendering is one
     value in the server HTML and another in the browser, and React discards the tree when the two disagree. */
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  useEffect(() => setGeneratedAt(new Date().toLocaleTimeString()), []);

  const snapshot = useMemo(() => buildSnapshot(range, today), [range, today]);
  const metrics = useMemo(() => overviewMetrics(snapshot), [snapshot]);
  const rangeNote = RANGES.find((r) => r.id === range)?.note ?? '';

  const revenueKpis: Metric[] = [
    { label: 'Gross billed', value: money(snapshot.revenue.gross), definition: 'Every line at the tariff price, before any discount.', asOf: snapshot.asOf },
    { label: 'Discounts given', value: money(snapshot.revenue.discount), definition: 'Line-level discounts, including the ones that needed an approver.', asOf: snapshot.asOf, footnote: `${snapshot.revenue.discountAboveLimit} line(s) above the ${15} % limit` },
    { label: 'Net billed', value: money(snapshot.revenue.net), definition: 'Gross less discounts: what the patients and payers actually owe.', asOf: snapshot.asOf },
    { label: 'Collected', value: money(snapshot.revenue.collected), definition: 'Payments received against live invoices. Cancelled invoices are excluded, not netted off.', asOf: snapshot.asOf },
    { label: 'Outstanding', value: money(snapshot.revenue.due), definition: 'Patient share of live invoices not yet paid.', asOf: snapshot.asOf, tone: snapshot.revenue.due > 0 ? 'warning' : 'neutral' },
    { label: 'Cash expected in the drawer', value: money(snapshot.revenue.cashExpected), definition: 'Cash payments only. This is the one figure that has to agree with a physical count.', asOf: snapshot.asOf, tone: 'warning' },
  ];

  const qualityKpis: Metric[] = [
    { label: 'Findings', value: String(snapshot.dataQuality.length), definition: 'Checks this report runs on its own data.', asOf: snapshot.asOf },
    { label: 'Act today', value: String(snapshot.dataQuality.filter((f) => f.severity === 'critical').length), definition: 'Findings that affect patient care right now.', asOf: snapshot.asOf, tone: snapshot.dataQuality.some((f) => f.severity === 'critical') ? 'critical' : 'success' },
    { label: 'This week', value: String(snapshot.dataQuality.filter((f) => f.severity === 'warning').length), definition: 'Findings that cost money or time if left alone.', asOf: snapshot.asOf, tone: 'warning' },
  ];

  /** The phase's own count, read from the suite rather than kept here: what is built, out of what was promised. */
  const builtCount = REPORT_GROUPS.reduce((n, g) => n + reportsInGroup(g).length, 0);

  const tile = (m: Metric, i: number) => (
    <div key={i} className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cx('size-2 rounded-full', TONE_DOT[m.tone ?? 'neutral'])} />
        <span className="text-xs text-text-secondary">{m.label}</span>
      </span>
      <KpiTile label={m.label} value={m.value} definition={m.definition} asOf={m.asOf} footnote={m.footnote} />
    </div>
  );

  const overviewTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">{metrics.map((m, i) => tile(m, i))}</div>
      <Panel title={`Patients seen per day — ${snapshot.rangeLabel.toLowerCase()}`}>
        <BarSeries items={snapshot.visits.perDay} caption="Patients seen per day" />
        <p className="mt-2 text-xs text-text-tertiary">
          The bar is patients who reached check-in or beyond; the small line under it is everything booked that
          day, so a rise in bookings with a flat bar is a no-show problem, not a demand problem.
        </p>
      </Panel>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <RankList title="How patients booked" items={snapshot.visits.bySource} />
        <RankList title="Consultations per doctor" items={snapshot.clinical.byDoctor} />
      </div>

      <Panel title={`Reports › … — ${builtCount} of ${REPORT_SUITE_TOTAL} built${builtCount === REPORT_SUITE_TOTAL ? ', the phase’s seventeen complete' : ''}`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {REPORT_GROUPS.map((group) => {
            const built = reportsInGroup(group);
            const planned = PLANNED_REPORTS.filter((p) => p.group === group);
            if (built.length === 0 && planned.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{group}</p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {built.map((def) => (
                    <li key={def.topic}>
                      <Link href={`/reports/${def.topic}`} className="block rounded-md px-2 py-1 hover:bg-surface-sunken">
                        <span className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">{def.title}</span>
                        <span className="block text-xs text-text-secondary">{def.question}</span>
                        <span className="block text-[11px] text-text-tertiary">
                          Legacy {def.legacy} · {def.owner} · {def.schedule.split(';')[0].toLowerCase()}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {planned.map((p2) => (
                    <li key={p2.legacy} className="px-2 py-1" title={p2.blockedBy}>
                      <span className="text-sm text-text-tertiary">{p2.name} — not built yet</span>
                      <span className="block text-xs text-text-tertiary">{p2.blockedBy}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          Each built report opens on its own route, reads the same generators the operational screens use, and prints the days it actually read, the
          control total its figures have to agree with, and how the consolidated column was arrived at. Most carry saved views — the same queue or
          the same exceptions a reader opens them for every morning — so the morning’s question is a chip rather than a search somebody has to
          remember how to type. This list is kept in the module the reports themselves are written in, so the phase cannot be called finished with a
          screen missing.
        </p>
      </Panel>
    </div>
  );

  const clinicalTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Consultations" value={String(snapshot.clinical.encounters)} definition="Every OPD encounter started in the range." asOf={snapshot.asOf} />
        <KpiTile label="Signed" value={String(snapshot.clinical.signed)} definition="Notes signed by the clinician. A signed note takes addenda, never edits." asOf={snapshot.asOf} />
        <KpiTile label="Waiting or in the room" value={String(snapshot.clinical.waiting)} definition="Started but not signed." asOf={snapshot.asOf} />
        <KpiTile label="Coded diagnosis" value={String(snapshot.clinical.withDiagnosis)} definition="Signed notes carrying at least one ICD-10 code." asOf={snapshot.asOf} />
        <KpiTile label="With a prescription" value={String(snapshot.clinical.prescriptions)} definition="Signed consultations with at least one medicine line." asOf={snapshot.asOf} />
        <KpiTile label="Medicine lines" value={String(snapshot.clinical.rxLines)} definition="Total prescribed lines, before dispensing." asOf={snapshot.asOf} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <RankList title="Case mix — the ten commonest diagnoses" items={snapshot.clinical.topDiagnoses} />
        <RankList title="Consultations per doctor" items={snapshot.clinical.byDoctor} />
      </div>
      <SafetyBanner severity="info" title="What this tab does not claim">
        Case mix is built from coded diagnoses only. A signed note with no code is counted in the totals above but
        not in the case mix — the data-quality tab says how many, and the honest answer is that an uncoded note is
        a gap in the record, not an absence of illness.
      </SafetyBanner>
    </div>
  );

  const diagnosticsTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label="Tests ordered" value={String(snapshot.diagnostics.ordered)} definition="Laboratory and imaging orders raised in the range." asOf={snapshot.asOf} />
        <KpiTile label="Collected" value={`${snapshot.diagnostics.collectionRate} %`} definition="Orders that reached collection — the specimen exists." asOf={snapshot.asOf} />
        <KpiTile label="Resulted" value={String(snapshot.diagnostics.resulted)} definition="Orders with a recorded result." asOf={snapshot.asOf} />
        <KpiTile label="Within turnaround" value={snapshot.diagnostics.resulted > 0 ? `${Math.round((snapshot.diagnostics.withinTarget / snapshot.diagnostics.resulted) * 100)} %` : '—'} definition="Resulted inside the test's own target, measured order to result." asOf={snapshot.asOf} footnote={snapshot.diagnostics.avgTurnaroundHours !== null ? `Average ${snapshot.diagnostics.avgTurnaroundHours} h` : undefined} />
        <KpiTile label="Overdue and open" value={String(snapshot.diagnostics.overdueOpen)} definition="Past target with no result: the clinician is waiting and does not know it." asOf={snapshot.asOf} />
        <KpiTile label="Critical values" value={String(snapshot.diagnostics.criticals)} definition="Results inside the critical limits, where a call-back is mandatory." asOf={snapshot.asOf} />
        <KpiTile label="Call-backs recorded" value={`${snapshot.diagnostics.callbacksRecorded}/${snapshot.diagnostics.criticals}`} definition="Critical values with a name, a time and a read-back on the record." asOf={snapshot.asOf} />
        <KpiTile label="Quality control" value={snapshot.diagnostics.qcRuns > 0 ? `${snapshot.diagnostics.qcPassed}/${snapshot.diagnostics.qcRuns}` : '—'} definition="Analyser control runs inside their allowed deviation this range." asOf={snapshot.asOf} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <RankList title="Volume by test" items={snapshot.diagnostics.byTest} />
        <RankList title="Rejected specimens" items={snapshot.diagnostics.rejections} empty="No specimens were rejected in this range." />
        <Panel title="Rejection rate">
          <p className="text-sm text-text-secondary">
            {snapshot.diagnostics.ordered > 0
              ? `${snapshot.diagnostics.rejected} of ${snapshot.diagnostics.ordered} specimens rejected (${((snapshot.diagnostics.rejected / snapshot.diagnostics.ordered) * 100).toFixed(1)} %).`
              : 'Nothing ordered in this range.'}
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            Each rejection is a second needle for the patient and a second cost for the hospital, which is why the
            reasons are counted rather than the number alone: haemolysed samples point at technique, unlabelled
            tubes point at the ward.
          </p>
        </Panel>
      </div>
    </div>
  );

  const pharmacyTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label="Prescriptions dispensed" value={String(snapshot.pharmacy.dispenses)} definition="Dispensary jobs started in the range." asOf={snapshot.asOf} footnote={`${snapshot.pharmacy.partial} part-dispensed · ${snapshot.pharmacy.returned} returned`} />
        <KpiTile label="Substituted lines" value={String(snapshot.pharmacy.substitutedLines)} definition="Lines where a different brand was given, with both names kept on the record." asOf={snapshot.asOf} />
        <KpiTile label="Controlled entries" value={String(snapshot.pharmacy.controlledEntries)} definition="Controlled-drug lines in the register, each with a witness." asOf={snapshot.asOf} />
        <KpiTile label="Stock value" value={money(snapshot.pharmacy.stockValue)} definition="Point-in-time value of every batch on the shelves at the last purchase price." asOf={snapshot.stockAsOf} />
        <KpiTile label="Expiring within 90 days" value={String(snapshot.pharmacy.expiringBatches)} definition="Batches still in date but inside the warning window." asOf={snapshot.stockAsOf} footnote={`${money(snapshot.pharmacy.expiringValue)} at risk`} />
        <KpiTile label="Below reorder level" value={String(snapshot.pharmacy.belowReorder)} definition="Items that should be on the replenishment list today." asOf={snapshot.stockAsOf} />
        <KpiTile label="Write-offs" value={String(snapshot.pharmacy.writeOffs.reduce((s, w) => s + w.value, 0))} definition="Units written off in the range, expired or damaged, each with a reason." asOf={snapshot.asOf} footnote={snapshot.pharmacy.writeOffs.map((w) => `${w.label}: ${w.value}`).join(' · ') || 'Nothing written off'} />
        <KpiTile label="Items stocked" value={String(snapshot.pharmacy.byStore.reduce((s, x) => s + 1, 0))} definition="Stores holding stock, with the value each one carries." asOf={snapshot.stockAsOf} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <RankList title="Stock value by store" items={snapshot.pharmacy.byStore} format={money} />
        <RankList title="Write-offs by kind" items={snapshot.pharmacy.writeOffs} empty="Nothing was written off in this range." />
      </div>
    </div>
  );

  const revenueTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">{revenueKpis.map((m, i) => tile(m, i))}</div>
      <Panel title={`Collected per day — ${snapshot.rangeLabel.toLowerCase()}`}>
        <BarSeries items={snapshot.revenue.perDay} format={(n) => `${Math.round(n / 1000)}k`} caption="Collected per day" />
        <p className="mt-2 text-xs text-text-tertiary">
          Cash expected in the drawer is printed under each day: digital payments reconcile themselves, cash has to
          be counted by a person with the sheet in front of them.
        </p>
      </Panel>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <RankList title="Collected by method" items={snapshot.revenue.byMethod} format={money} />
        <RankList title="Billed by payer" items={snapshot.revenue.byPayer} format={money} />
        <RankList title="Billed by service" items={snapshot.revenue.byCategory} format={money} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <RankList title="Discounts above the limit — who approved them" items={snapshot.revenue.approvals} empty="No discount above the limit in this range." />
        <RankList title="Cancelled invoices — why" items={snapshot.revenue.cancellationReasons} empty="No invoices were cancelled in this range." />
      </div>
    </div>
  );

  const qualityTab = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{qualityKpis.map((m, i) => tile(m, i))}</div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Data quality findings</caption>
          <thead className="bg-surface-sunken text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-2 py-1.5">Area</th>
              <th scope="col" className="px-2 py-1.5">Finding</th>
              <th scope="col" className="px-2 py-1.5 text-right">Count</th>
              <th scope="col" className="px-2 py-1.5">When</th>
              <th scope="col" className="px-2 py-1.5">Why it matters</th>
              <th scope="col" className="px-2 py-1.5">Who fixes it</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.dataQuality.map((f) => (
              <tr key={f.id} className="border-t border-border-subtle align-top">
                <td className="px-2 py-1.5 text-xs">{f.area}</td>
                <td className="px-2 py-1.5">{f.finding}</td>
                <td className={cx('font-numeric px-2 py-1.5 text-right', f.severity === 'critical' ? 'text-safety-critical' : f.severity === 'warning' ? 'text-safety-warning' : '')}>
                  {f.count}
                </td>
                <td className="px-2 py-1.5">{chip(SEVERITY[f.severity].tone, SEVERITY[f.severity].label)}</td>
                <td className="px-2 py-1.5 text-xs text-text-secondary">{f.impact}</td>
                <td className="px-2 py-1.5 text-xs">{f.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SafetyBanner severity="info" title="Why this tab exists">
        A report that hides its own gaps is a report that gets quoted selectively. These checks are counted from
        the same data the other tabs use, and each one names the person who can close it — a finding with no owner
        is a finding that stays open.
      </SafetyBanner>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-text-secondary">
            {snapshot.rangeLabel} · {rangeNote} · {snapshot.days.length} day(s) ·{' '}
            {snapshot.days.length > 1 ? `${snapshot.days[0]} → ${snapshot.days[snapshot.days.length - 1]}` : snapshot.days[0]}
            {generatedAt && <span className="font-numeric"> · generated {generatedAt}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            name="report-range"
            label="Reporting period"
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
          />
          <Button
            variant="ghost"
            className="gap-1.5"
            onClick={() => {
              window.print();
              push({ title: 'Printing this view', description: 'The shell is stripped at print time; the tabs print as they are on screen.', tone: 'info' });
            }}
          >
            <Printer className="size-3.5" aria-hidden />
            Print this view
          </Button>
          <Link href="/billing">
            <Button variant="ghost">Billing counter</Button>
          </Link>
        </div>
      </div>

      <SafetyBanner severity="info" title="P6 module — preview reports, synthetic data">
        Every figure states what it means and when it was taken, and stock says it is point-in-time rather than
        pretending to be a trend. The numbers come from the same deterministic generators the ward, the laboratory,
        the dispensary and the store screens use, so they cannot drift apart: the data is synthetic.
      </SafetyBanner>

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="Reading reports while the uplink is down">
          Everything on this page is computed on the hospital server from local data, so the figures are as current
          as the last write on this site. Scheduled delivery to an outside mailbox waits for the connection — the
          report itself does not.
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'clinical', label: 'Clinical', count: snapshot.clinical.encounters },
          { id: 'diagnostics', label: 'Diagnostics', count: snapshot.diagnostics.ordered },
          { id: 'pharmacy', label: 'Pharmacy & stores', count: snapshot.pharmacy.dispenses },
          { id: 'revenue', label: 'Revenue', count: snapshot.revenue.invoices },
          { id: 'quality', label: 'Data quality', count: snapshot.dataQuality.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'overview' && overviewTab}
        {tab === 'clinical' && clinicalTab}
        {tab === 'diagnostics' && diagnosticsTab}
        {tab === 'pharmacy' && pharmacyTab}
        {tab === 'revenue' && revenueTab}
        {tab === 'quality' && qualityTab}
      </Tabs>

      <Panel
        title="Scheduled reports"
        actions={
          <Link href="/reports/schedules">
            <Button variant="secondary" size="sm">
              <CalendarClock className="size-4" aria-hidden /> Open the schedules
            </Button>
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Which report goes out, to whom and when — the schedules this branch runs</caption>
            <thead className="bg-surface-sunken text-xs text-text-secondary">
              <tr>
                <th scope="col" className="px-2 py-1.5">Report</th>
                <th scope="col" className="px-2 py-1.5">Cadence</th>
                <th scope="col" className="px-2 py-1.5">Goes to</th>
                <th scope="col" className="px-2 py-1.5">Channel</th>
                <th scope="col" className="px-2 py-1.5">What the receiver does with it</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULED_REPORTS.map((r) => (
                <tr key={r.id} className="border-t border-border-subtle align-top">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5 text-xs">{r.cadence}</td>
                  <td className="px-2 py-1.5 text-xs">{r.goesTo}</td>
                  <td className="px-2 py-1.5 text-xs">{r.channel}</td>
                  <td className="px-2 py-1.5 text-xs text-text-secondary">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-secondary">
          These rows are the schedules themselves, not a description of them: the register, the recipients, the cadence
          and the refusals live in <span className="font-numeric">lib/report-schedules.ts</span>, and the schedule
          screen edits the same objects this table is built from.
        </p>
        <p className="mt-1 text-xs text-text-tertiary">{SCHEDULING_NEEDS_SERVER}</p>
      </Panel>
    </div>
  );
}
