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
import { FlaskConical, Phone, Scan, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  SEARCH_RULES,
  TREND_DAYS,
  compare,
  patientLabel,
  radiologyReports,
  resultPool,
  resultStats,
  searchResults,
  type ResultRow,
  type SearchFilters,
} from '@/lib/diag-search';
import { TESTS, flagLabel } from '@/lib/diagnostics';

/* Pathology and radiology search (legacy screens 014 and 015 — replaced) — the P4 sub-screens.
 *
 * Two legacy screens, one question: “what did this patient’s tests say, and what did they say last time?” The
 * answers that matter are in `lib/diag-search.ts` and are the reason this screen is not a filter box over a table:
 *
 *  - only **verified** results are searchable by default, because a value typed by a technician is not a result;
 *  - a **trend** compares like with like — same analyte, same units, same laboratory;
 *  - a **critical** result is a telephone call, and the list of calls not yet made is on the screen rather than in
 *    a log somewhere;
 *  - a **correction** supersedes, so the value somebody acted on is still visible beside the corrected one.
 *
 * Preview: the results come from the same generator the diagnostics worklist uses, with history seeded behind them
 * so a trend has something to be a trend of. Nothing survives a reload; the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const FLAG_CHIP: Record<string, string> = {
  ok: 'bg-safety-success/10 text-safety-success',
  low: 'bg-safety-warning/10 text-safety-warning',
  high: 'bg-safety-warning/10 text-safety-warning',
  'critical-low': 'bg-safety-critical/10 text-safety-critical',
  'critical-high': 'bg-safety-critical/10 text-safety-critical',
  text: 'bg-surface-sunken text-text-secondary',
};

const shiftDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function DiagnosticSearchPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [tab, setTab] = useState('results');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchFilters['kind']>('all');
  const [status, setStatus] = useState<SearchFilters['status']>('all');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [uncalledOnly, setUncalledOnly] = useState(false);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [from, setFrom] = useState(shiftDays(day, -TREND_DAYS));
  const [to, setTo] = useState(day);
  const [patient, setPatient] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [called, setCalled] = useState<Record<string, { at: string; to: string; by: string }>>({});
  const [callTo, setCallTo] = useState('Ward nurse in charge');
  const [callBy, setCallBy] = useState('Laboratory in-charge');

  const filters: SearchFilters = {
    query,
    kind,
    from,
    to,
    criticalOnly,
    uncalledOnly,
    status,
    includeUnverified,
    ...(patient ? { patient } : {}),
  };

  const all = useMemo(() => resultPool(day), [day]);
  const results = useMemo(() => searchResults(day, filters, all), [day, all, query, kind, from, to, criticalOnly, uncalledOnly, status, includeUnverified, patient]);
  const row = (id: string | null): ResultRow | null => (id ? all.find((r) => `${r.order.id}-${r.test.code}` === id) ?? null : null);
  const stats = resultStats(results);
  const criticals = all.filter((r) => r.critical);
  const uncalled = criticals.filter((r) => !r.called && !called[`${r.order.id}-${r.test.code}`]);
  const reports = useMemo(() => radiologyReports(day), [day]);
  const open = row(openId);

  const recordCall = (r: ResultRow) => {
    const key = `${r.order.id}-${r.test.code}`;
    setCalled((c) => ({ ...c, [key]: { at: `${day}T13:25`, to: callTo, by: callBy } }));
    queueWrite(`Critical result called: ${r.test.code} for ${r.order.patient.name} (${r.order.patient.mrn}) — ${callTo}`);
    push({
      title: 'Call recorded against the result',
      description: `${r.test.name} for ${r.order.patient.name}, told to ${callTo} by ${callBy}. A panic value nobody acted on is the failure this record exists to prevent.`,
      tone: 'success',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <FlaskConical className="size-5 text-brand-600" aria-hidden />
            Result search — pathology and radiology
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — what the tests said, what they said last time, and which critical results are still waiting for a
            telephone call.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Results found" value={String(stats.total)} definition={`Inside the window ${from} to ${to}, ${includeUnverified ? 'including unverified values' : 'verified results only'}.`} asOf={day} footnote={`${stats.patients} patient(s)`} />
        <KpiTile label="Verified" value={String(stats.verified)} definition="Checked by a second person — the only values a doctor should act on." asOf={day} />
        <KpiTile label="In progress" value={String(stats.inProgress)} definition="Collected, in the laboratory, or resulted but not yet verified." asOf={day} />
        <KpiTile label="Critical values" value={String(stats.critical)} definition="Outside the critical limits on the test’s own reference range: a telephone call, not a line on a screen." asOf={day} footnote={`${uncalled.length} still uncalled`} />
        <KpiTile label="Average turnaround" value={`${stats.averageTatHours} h`} definition="From collection to a verified result, across everything in the window. The laboratory’s own performance figure." asOf={day} />
        <KpiTile label="Laboratory / imaging" value={`${stats.labs} / ${stats.imaging}`} definition="Split of the results found. An imaging report is read differently from an analyte panel, which is why the tab below separates them." asOf={day} />
      </div>

      <Panel title="Search" actions={<span className="text-xs text-text-secondary">The window is always visible, because a result search without dates answers a different question</span>}>
        <div className="grid gap-2 lg:grid-cols-4">
          <label className="text-xs text-text-secondary lg:col-span-2">
            Patient, test, code or report text
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, MRN, HbA1c, LAB-CBC, “chest”…"
              className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
            />
          </label>
          <label className="text-xs text-text-secondary">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
          </label>
          <label className="text-xs text-text-secondary">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Segmented
            name="result-kind"
            label="Discipline"
            value={kind}
            onChange={(v) => setKind(v as SearchFilters['kind'])}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'lab', label: `Pathology (${stats.labs})` },
              { value: 'imaging', label: `Radiology (${stats.imaging})` },
            ]}
          />
          <Segmented
            name="result-status"
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as SearchFilters['status'])}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'verified', label: 'Verified' },
              { value: 'inProgress', label: 'In progress' },
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} className="size-4" />
            Critical values only
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={uncalledOnly} onChange={(e) => { setUncalledOnly(e.target.checked); if (e.target.checked) setIncludeUnverified(true); }} className="size-4" />
            Only the calls not yet made
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} className="size-4" />
            Include unverified values
          </label>
          {patient && (
            <button type="button" onClick={() => setPatient('')} className="rounded-md bg-surface-sunken px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
              Clear the patient filter — {patientLabel(patient)}
            </button>
          )}
        </div>
        {!includeUnverified && (
          <p className="mt-2 text-xs text-text-tertiary">
            Unverified values are hidden by default. A value typed by a technician and not yet checked is not a result, and showing it beside
            verified ones is how a number gets treated as one.
          </p>
        )}
      </Panel>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'results', label: 'Results', count: results.length },
          { id: 'criticals', label: 'Critical calls', count: uncalled.length },
          { id: 'imaging', label: 'Imaging reports', count: reports.length },
          { id: 'ranges', label: 'Reference ranges and rules' },
        ]}
      />

      {tab === 'results' && (
        <Panel title={`${results.length} result(s)`} actions={<span className="text-xs text-text-secondary">Open a row for the values, the trend and the verification trail</span>}>
          {results.length === 0 ? (
            <EmptyState
              title="Nothing matches"
              description="Try a wider window, another spelling, or clear the critical and status filters. A search that returns nothing is usually a date range and occasionally a typo — the window is at the top for exactly that reason."
            />
          ) : (
            <ListView
              id="result-search"
              caption="Results matching the search"
              height="30rem"
              rows={results}
              rowId={(r) => `${r.order.id}-${r.test.code}`}
              onRowClick={(r) => setOpenId(`${r.order.id}-${r.test.code}`)}
              columns={[
                { key: 'at', header: 'Resulted', width: '130px', render: (r) => (
                  <span className="tabular-nums">
                    {(r.order.resultedAt ?? r.order.orderedAt).slice(0, 10)}
                    <span className="block text-xs text-text-tertiary">{(r.order.resultedAt ?? r.order.orderedAt).slice(11, 16)}</span>
                  </span>
                ) },
                { key: 'patient', header: 'Patient', render: (r) => (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPatient(r.order.patient.mrn); }}
                    className="text-left hover:underline"
                  >
                    <span className="font-medium text-text-primary">{r.order.patient.name}</span>
                    <span className="ml-2 text-xs text-text-tertiary">{r.order.patient.mrn}</span>
                  </button>
                ) },
                { key: 'test', header: 'Test', render: (r) => (
                  <span>
                    <span className="font-medium text-text-primary">{r.test.name}</span>
                    <span className="ml-2 text-xs text-text-tertiary">{r.test.code} · {r.order.kind === 'imaging' ? r.test.modality ?? 'imaging' : r.test.sample ?? 'sample'}</span>
                  </span>
                ) },
                { key: 'value', header: 'Values', hideBelow: 'lg', render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.values.slice(0, 3).map((v) => (
                      <span key={v.analyte.key} className={cx('rounded-full px-2 py-0.5 text-[10px] tabular-nums', FLAG_CHIP[v.flag])}>
                        {v.analyte.label} {String(v.value)} {v.analyte.unit}
                      </span>
                    ))}
                    {r.values.length === 0 && <span className="text-xs text-text-tertiary">{r.order.report ? 'report only' : 'no numeric values'}</span>}
                  </span>
                ) },
                { key: 'flag', header: 'Flag', width: '150px', render: (r) => (
                  <span className={cx('rounded-full px-2 py-0.5 text-xs', FLAG_CHIP[r.flag])}>
                    {flagLabel[r.flag]}
                    {r.critical ? ' — call' : ''}
                  </span>
                ) },
                { key: 'previous', header: 'Against last time', hideBelow: 'md', width: '230px', render: (r) => {
                  const first = r.values[0];
                  if (!first) return <span className="text-xs text-text-tertiary">—</span>;
                  const cmp = compare(first.analyte, first.value, r.previous?.values?.[first.analyte.key]);
                  return <span className={cx('text-xs', cmp.tone === 'critical' ? TONE_TEXT.critical : cmp.tone === 'warning' ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{cmp.text}</span>;
                } },
                { key: 'status', header: 'Status', width: '120px', render: (r) => (
                  <span className={cx(r.order.status === 'Verified' ? TONE_TEXT.success : TONE_TEXT.warning)}>{r.order.status}</span>
                ) },
                { key: 'called', header: 'Call made', width: '150px', render: (r) => {
                  const c = called[`${r.order.id}-${r.test.code}`];
                  if (!r.critical && !r.called && !c) return <span className="text-xs text-text-tertiary">not a critical</span>;
                  if (c) return <span className={cx('text-xs', TONE_TEXT.success)}>called {c.to} at {c.at.slice(11)}</span>;
                  if (r.called) return <span className={cx('text-xs', TONE_TEXT.neutral)}>called {r.called.to} at {r.called.at.slice(11)}</span>;
                  return <span className={cx('text-xs', TONE_TEXT.critical)}>still to call</span>;
                } },
              ]}
            />
          )}
        </Panel>
      )}

      {tab === 'criticals' && (
        <div className="space-y-3">
          <Panel title={`${uncalled.length} critical result(s) with no call recorded`} actions={<span className="text-xs text-text-secondary">This list is the point of the module</span>}>
            {uncalled.length === 0 ? (
              <EmptyState title="Every critical result has a call against it" description="That is the state this list exists to reach: a panic value that nobody acted on is the failure mode a laboratory information system is bought to prevent." />
            ) : (
              <ul className="space-y-2">
                {uncalled.map((r) => (
                  <li key={`${r.order.id}-${r.test.code}`} className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-text-primary">
                          <TriangleAlert className="size-4 text-safety-critical" aria-hidden />
                          {r.test.name} — {r.order.patient.name} ({r.order.patient.mrn})
                        </span>
                        <span className="block text-xs text-text-secondary">
                          {r.values.filter((v) => v.flag.startsWith('critical')).map((v) => `${v.analyte.label} ${String(v.value)} ${v.analyte.unit} (${flagLabel[v.flag].toLowerCase()})`).join(' · ')}
                        </span>
                        <span className="block text-xs text-text-tertiary">
                          Collected {(r.order.collectedAt ?? r.order.orderedAt).slice(11, 16)} · resulted {(r.order.resultedAt ?? '').slice(11, 16)} · ordered by {r.order.kind === 'imaging' ? 'the referring team' : 'the ward'}
                        </span>
                      </span>
                      <Button variant="ghost" onClick={() => recordCall(r)}>
                        <Phone className="size-4" aria-hidden /> Record the call
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-text-secondary">
                Told to
                <input value={callTo} onChange={(e) => setCallTo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
              </label>
              <label className="text-xs text-text-secondary">
                Called by
                <input value={callBy} onChange={(e) => setCallBy(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
              </label>
            </div>
          </Panel>

          <Panel title="Critical results that were called, and what happened">
            <ul className="space-y-1 text-sm">
              {criticals.filter((r) => r.called || called[`${r.order.id}-${r.test.code}`]).map((r) => {
                const c = called[`${r.order.id}-${r.test.code}`] ?? r.called!;
                return (
                  <li key={`${r.order.id}-${r.test.code}-done`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2">
                    <span>
                      <span className="font-medium text-text-primary">{r.test.name} — {r.order.patient.name}</span>
                      <span className="ml-2 text-xs text-text-tertiary">{r.test.code} · {r.order.patient.mrn}</span>
                    </span>
                    <span className="text-xs text-text-secondary">told {c.to} at {c.at.slice(11)} by {c.by}</span>
                  </li>
                );
              })}
              {criticals.filter((r) => r.called || called[`${r.order.id}-${r.test.code}`]).length === 0 && (
                <li className="text-sm text-text-secondary">Nothing on this day has been called yet — which is why the list above is not empty.</li>
              )}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'imaging' && (
        <Panel title="Radiology reports" actions={<span className="text-xs text-text-secondary">An imaging report is read by the question that was asked, not by the analyte</span>}>
          <ListView
            id="imaging-reports"
            caption="Imaging reports"
            height="28rem"
            rows={reports}
            rowId={(r) => r.order.id}
            onRowClick={(r) => setOpenId(`${r.order.id}-${r.test.code}`)}
            columns={[
              { key: 'at', header: 'Reported', width: '130px', render: (r) => (
                <span className="tabular-nums">
                  {(r.reportedAt ?? r.order.orderedAt).slice(0, 10)}
                  <span className="block text-xs text-text-tertiary">{(r.reportedAt ?? r.order.orderedAt).slice(11, 16)}</span>
                </span>
              ) },
              { key: 'patient', header: 'Patient', render: (r) => (
                <span>
                  <span className="font-medium text-text-primary">{r.order.patient.name}</span>
                  <span className="ml-2 text-xs text-text-tertiary">{r.order.patient.mrn} · {r.order.patient.age} {r.order.patient.sex}</span>
                </span>
              ) },
              { key: 'study', header: 'Study', render: (r) => (
                <span>
                  <span className="font-medium text-text-primary">{r.test.name}</span>
                  <span className="ml-2 text-xs text-text-tertiary">{r.test.modality ?? '—'} · {r.test.code}</span>
                </span>
              ) },
              { key: 'indication', header: 'Clinical indication', hideBelow: 'lg', render: (r) => <span className="text-xs text-text-secondary">{r.indication}</span> },
              { key: 'radiologist', header: 'Reported by', hideBelow: 'md', width: '190px' },
              { key: 'status', header: 'Status', width: '120px', render: (r) => (
                <span className={cx(r.order.status === 'Verified' ? TONE_TEXT.success : TONE_TEXT.warning)}>{r.order.status}</span>
              ) },
            ]}
          />
          <p className="mt-2 text-xs text-text-tertiary">
            The images themselves stay in the PACS and are linked from the report, never copied into the record: a copy is a picture without its
            windowing, and it renders differently on every screen it is opened on.
          </p>
        </Panel>
      )}

      {tab === 'ranges' && (
        <div className="space-y-3">
          <Panel title="Reference ranges, as the laboratory uses them">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Reference ranges by analyte</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Test</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Analyte</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Unit</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Reference</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Critical low</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Critical high</th>
                  </tr>
                </thead>
                <tbody>
                  {TESTS.filter((t) => t.kind === 'lab').slice(0, 14).map((t) => t.analytes.map((a, i) => (
                    <tr key={`${t.code}-${a.key}`} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{i === 0 ? `${t.name} (${t.code})` : ''}</td>
                      <td className="py-1.5 pr-3 text-text-secondary">{a.label}</td>
                      <td className="py-1.5 pr-3 text-text-tertiary">{a.unit || '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{a.low} – {a.high}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-safety-critical">{a.criticalLow ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-safety-critical">{a.criticalHigh ?? '—'}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">
              These ranges are the laboratory’s own and are maintained in <Link href="/setup" className="underline">Setup</Link>, not in the
              search code: a range that differs between the analyser and the software is a range nobody can defend.
            </p>
          </Panel>

          <Panel title="How the search behaves">
            <ul className="space-y-2 text-sm">
              {SEARCH_RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Related screens">
            <p className="text-sm text-text-secondary">
              The worklist, the collection list and the verification queue are on{' '}
              <Link href="/diagnostics" className="underline">diagnostics</Link>; the imaging calendar and the laboratory’s turnaround figures
              on <Link href="/reports" className="underline">reports</Link>; the analyte catalogue on{' '}
              <Link href="/setup" className="underline">Setup › Laboratory tests and Imaging</Link>; and the charges for what was found on{' '}
              <Link href="/billing/modules" className="underline">single-module billing</Link>.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- result sheet */}
      <Sheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open ? `${open.test.name} — ${open.order.patient.name}` : 'Result'}
        description={open ? `${open.test.code} · specimen ${open.order.specimenId} · ordered ${open.order.orderedAt.slice(11, 16)}${open.order.patient.mrn ? ` · ${open.order.patient.mrn}` : ''}` : undefined}
        width="xl"
        footer={
          open && (
            <div className="flex flex-wrap justify-end gap-2">
              {open.critical && !open.called && !called[`${open.order.id}-${open.test.code}`] && (
                <Button onClick={() => recordCall(open)}><Phone className="size-4" aria-hidden /> Record the critical call</Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  queueWrite(`Result opened: ${open.test.code} for ${open.order.patient.name}`);
                  push({ title: 'Opening recorded', description: 'A result that was opened and acted on is a different fact from a result that sat unread — the trail is what a medico-legal review reads first.', tone: 'info' });
                }}
              >
                <Scan className="size-4" aria-hidden /> Record that this was reviewed
              </Button>
            </div>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="text-xs text-text-secondary">
                {open.order.kind === 'imaging'
                  ? `Imaging: ${open.test.modality ?? 'modality on the request'} · ${open.order.priority.toLowerCase()} priority · read by a radiologist`
                  : `Pathology: ${open.test.sample ?? 'sample'} in ${open.test.container ?? 'the standard container'} · ${open.order.priority.toLowerCase()} priority`}
              </p>
              {open.order.report && <p className="mt-1 text-text-secondary">{open.order.report}</p>}
            </div>

            <table className="w-full text-sm">
              <caption className="sr-only">Values, reference ranges and previous result</caption>
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Analyte</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Value</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Reference</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Flag</th>
                  <th scope="col" className="py-1.5 font-medium">Against the previous verified result</th>
                </tr>
              </thead>
              <tbody>
                {open.values.map((v) => {
                  const previous = open.previous?.values?.[v.analyte.key];
                  const cmp = compare(v.analyte, v.value, previous);
                  return (
                    <tr key={v.analyte.key} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{v.analyte.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{String(v.value)} {v.analyte.unit}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-text-secondary">{v.analyte.low} – {v.analyte.high}</td>
                      <td className="py-1.5 pr-3">
                        <span className={cx('rounded-full px-2 py-0.5 text-[10px]', FLAG_CHIP[v.flag])}>{flagLabel[v.flag]}</span>
                      </td>
                      <td className={cx('py-1.5 text-xs', cmp.tone === 'critical' ? TONE_TEXT.critical : cmp.tone === 'warning' ? TONE_TEXT.warning : TONE_TEXT.neutral)}>
                        {cmp.text}
                        {previous !== undefined && <span className="block text-text-tertiary">previous {String(previous)} on {open.previous?.at.slice(0, 10)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {open.trend.length > 1 && (
              <div className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">Trend — {open.test.analytes[0]?.label} ({open.test.analytes[0]?.unit})</p>
                <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                  {open.trend.map((t) => (
                    <li key={t.at} className="flex items-center gap-2">
                      <span className="w-24 tabular-nums text-text-tertiary">{t.at.slice(0, 10)}</span>
                      <span className="tabular-nums">{t.value} {open.test.analytes[0]?.unit}</span>
                      <span className="tabular-nums text-text-tertiary">
                        {t.value < open.test.analytes[0].low ? 'below range' : t.value > open.test.analytes[0].high ? 'above range' : 'in range'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-text-tertiary">
                  Same analyte, same units, same laboratory — a trend that mixes methods is how a stable patient looks like they deteriorated.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Collected</dt><dd className="font-medium tabular-nums">{open.order.collectedAt?.slice(0, 16).replace('T', ' ') ?? 'not collected'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Resulted</dt><dd className="font-medium tabular-nums">{open.order.resultedAt?.slice(0, 16).replace('T', ' ') ?? 'pending'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Verified by</dt><dd className="font-medium">{open.order.verifiedBy ?? 'not yet verified'}</dd></div>
            </div>

            {open.order.rejection && (
              <p className={cx('rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-xs', TONE_TEXT.warning)}>
                Sample rejected: {open.order.rejection.reason}, by {open.order.rejection.by}. The repeat sample is not charged twice — the
                rejection is the laboratory’s own cost, which is why the reason is recorded rather than the sample quietly dropped.
              </p>
            )}

            <p className="text-xs text-text-tertiary">
              Billing for this test is on <Link href="/billing/modules" className="underline">single-module billing</Link>; the collection and
              verification queues on <Link href="/diagnostics" className="underline">diagnostics</Link>; and the reference ranges on{' '}
              <Link href="/setup" className="underline">Setup</Link>.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
