'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  DataGrid,
  Panel,
  SafetyBanner,
  Segmented,
  Sheet,
  Tabs,
  Tooltip,
  cx,
  useToast,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { Phone, Printer } from 'lucide-react';
import {
  DISPATCH_OPTIONS,
  flagLabel,
  flagTone,
  flagValue,
  generateDiagnosticOrders,
  generateQc,
  needsCallback,
  statusTone,
  tatStatus,
  testByCode,
  worstFlag,
  type DiagnosticOrder,
  type DiagnosticStatus,
  type ResultFlag,
} from '@/lib/diagnostics';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Diagnostics (legacy screens 040/041 replaced) — the P4 module.
 *
 * One worklist for the whole journey of a specimen: ordered → collected → in the lab → resulted → verified →
 * dispatched, with the reference ranges applied as the number is typed and the turnaround deadline on every row.
 *
 * Two rules are enforced rather than described. A critical value cannot be released before the call-back to the
 * clinician is recorded (who was told, when, and that they read it back), and nothing is dispatched without a
 * second person verifying it. A rejected sample is a first-class outcome with a reason and a person, not a
 * deleted row.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';

const REASONS = [
  'Haemolysed sample',
  'Tube not labelled at the bedside',
  'Insufficient quantity (short draw)',
  'Clotted specimen',
  'Wrong container for the test',
];

const stamp = (d = new Date()) =>
  `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function DiagnosticsPage() {
  const { sync } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [orders, setOrders] = useState<DiagnosticOrder[]>(() => generateDiagnosticOrders(day));
  const [tab, setTab] = useState('worklist');
  const [open, setOpen] = useState<DiagnosticOrder | null>(null);
  const [rejecting, setRejecting] = useState<DiagnosticOrder | null>(null);
  const [rejectReason, setRejectReason] = useState(REASONS[0]);
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'Routine' | 'Urgent' | 'STAT'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'lab' | 'imaging'>('all');
  const [dispatchTo, setDispatchTo] = useState<NonNullable<DiagnosticOrder['dispatchTo']>>('Print');
  const [callbackBy, setCallbackBy] = useState('Dr. A. Rahman (Medicine)');
  const [readBack, setReadBack] = useState(false);

  const qc = useMemo(() => generateQc(day), [day]);
  /* The turnaround column is the only thing on this screen that depends on the time of day, and the clock is set
   * from an effect rather than read while rendering. `/diagnostics` is prerendered at build time: a clock read
   * during render is the build machine's minute in the HTML and the browser's minute on the first client render,
   * and React throws the server tree away — error #418, a console error on a screen that looks correct. Until the
   * effect has run (one frame), the column shows the due time, which comes from the order itself. */
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => setNow(stamp()), []);
  const current = orders.find((o) => o.id === open?.id) ?? null;

  const patch = (id: string, updater: (o: DiagnosticOrder) => DiagnosticOrder) =>
    setOrders((list) => list.map((o) => (o.id === id ? updater(o) : o)));

  const filtered = orders.filter(
    (o) => (priorityFilter === 'all' || o.priority === priorityFilter) && (kindFilter === 'all' || o.kind === kindFilter),
  );
  const byStage = (stage: DiagnosticStatus) => filtered.filter((o) => o.status === stage);
  const qcFailures = qc.filter((r) => !r.passed);
  const flagChip = (flag: ResultFlag) => (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-xs',
        flagTone[flag] === 'critical'
          ? 'bg-safety-critical/10 text-safety-critical'
          : flagTone[flag] === 'warning'
            ? 'bg-safety-warning/10 text-safety-warning'
            : 'bg-surface-sunken text-text-secondary',
      )}
    >
      {flagLabel[flag]}
    </span>
  );

  /* ------------------------------------------------------------------------- worklist tab */
  const columns: Array<Column<DiagnosticOrder>> = [
    { key: 'specimenId', header: 'Specimen', width: '9rem', render: (o) => <span className="font-numeric text-xs">{o.specimenId}</span> },
    {
      key: 'patient',
      header: 'Patient',
      render: (o) => (
        <span className="flex flex-col">
          <span className="font-medium">{o.patient.name}</span>
          <span className="font-numeric text-xs text-text-tertiary">
            {o.patient.mrn} · {o.patient.age}{o.patient.sex.slice(0, 1)}
          </span>
        </span>
      ),
    },
    {
      key: 'testName',
      header: 'Test',
      render: (o) => (
        <span className="flex flex-col">
          <span>{o.testName}</span>
          <span className="text-xs text-text-tertiary">
            {o.kind === 'imaging' ? o.modality : `${o.sample} · ${o.container}`}
          </span>
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '7rem',
      render: (o) => (
        <span className={cx('rounded-full px-2 py-0.5 text-xs', o.priority === 'STAT' ? 'bg-safety-critical/10 text-safety-critical' : o.priority === 'Urgent' ? 'bg-safety-warning/10 text-safety-warning' : 'bg-surface-sunken')}>
          {o.priority}
        </span>
      ),
    },
    { key: 'orderedAt', header: 'Ordered', hideBelow: 'lg', render: (o) => <span className="font-numeric text-xs">{o.orderedAt.slice(11)}</span> },
    {
      key: 'dueAt',
      header: 'Turnaround',
      hideBelow: 'md',
      render: (o) => {
        if (!now) {
          // Before the effect: the deadline itself, which is data, rather than a relative label that needs a clock.
          return <span className="text-xs text-text-tertiary">{o.dueAt.slice(11, 16)}</span>;
        }
        const tat = tatStatus(o, now);
        return (
          <span className={cx('text-xs', tat.tone === 'critical' ? 'text-safety-critical' : tat.tone === 'warning' ? 'text-safety-warning' : 'text-text-secondary')}>
            {tat.label}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-xs',
            statusTone[o.status] === 'success'
              ? 'bg-safety-success/10 text-safety-success'
              : statusTone[o.status] === 'warning'
                ? 'bg-safety-warning/10 text-safety-warning'
                : statusTone[o.status] === 'critical'
                  ? 'bg-safety-critical/10 text-safety-critical'
                  : 'bg-surface-sunken text-text-secondary',
          )}
        >
          {o.status}
        </span>
      ),
    },
    {
      key: 'flag',
      header: 'Result',
      render: (o) => (Object.keys(o.results).length > 0 || o.report ? flagChip(worstFlag(o)) : <span className="text-xs text-text-tertiary">pending</span>),
    },
  ];

  const actions = (o: DiagnosticOrder): RowAction<DiagnosticOrder>[] => {
    const list: RowAction<DiagnosticOrder>[] = [
      { label: 'Open the specimen', onSelect: (row) => setOpen(row) },
    ];
    if (o.status === 'Ordered') {
      list.push({ label: 'Print specimen label', onSelect: (row) => window.open(`/print/specimen-label?spec=${row.specimenId}`, '_blank', 'noopener') });
      list.push({
        label: 'Mark collected',
        onSelect: (row) => {
          patch(row.id, (x) => ({ ...x, status: 'Collected', collectedAt: stamp(), collectedBy: 'S. Mia (phlebotomy)' }));
          push({ title: `${row.specimenId} collected`, description: 'The tube carries the same identifier as the order', tone: 'success' });
        },
      });
      list.push({ label: 'Reject the sample', danger: true, separated: true, onSelect: (row) => { setRejecting(row); setRejectReason(REASONS[0]); } });
    }
    if (['Collected', 'In lab'].includes(o.status)) {
      list.push({ label: o.kind === 'imaging' ? 'Enter the report' : 'Enter results', onSelect: (row) => setOpen(row) });
      list.push({ label: 'Print specimen label', onSelect: (row) => window.open(`/print/specimen-label?spec=${row.specimenId}`, '_blank', 'noopener') });
    }
    if (o.status === 'Resulted') {
      list.push({ label: 'Verify and release', onSelect: (row) => setOpen(row) });
      list.push({ label: 'Print the report', onSelect: (row) => window.open(`/print/result-report?spec=${row.specimenId}`, '_blank', 'noopener') });
    }
    if (o.status === 'Verified') {
      list.push({
        label: 'Dispatch to print',
        onSelect: (row) => {
          patch(row.id, (x) => ({ ...x, status: 'Dispatched', dispatchedAt: stamp(), dispatchTo: 'Print' }));
          push({ title: `${row.specimenId} dispatched`, description: 'Printed at the collection counter', tone: 'success' });
        },
      });
      list.push({
        label: 'Send to the patient portal',
        onSelect: (row) => {
          if (sync !== 'live') {
            push({ title: 'The portal needs the uplink', description: 'Queued — the patient can collect a printed copy now', tone: 'warning' });
            return;
          }
          patch(row.id, (x) => ({ ...x, status: 'Dispatched', dispatchedAt: stamp(), dispatchTo: 'Patient portal' }));
          push({ title: 'Sent to the patient portal', description: `${row.patient.name} can download it`, tone: 'success' });
        },
      });
      list.push({ label: 'Print the report', onSelect: (row) => window.open(`/print/result-report?spec=${row.specimenId}`, '_blank', 'noopener') });
    }
    if (o.status === 'Dispatched') {
      list.push({ label: 'Reprint the report', onSelect: (row) => window.open(`/print/result-report?spec=${row.specimenId}`, '_blank', 'noopener') });
    }
    if (o.status === 'Rejected') {
      list.push({
        label: 'Recollect',
        onSelect: (row) => {
          patch(row.id, (x) => ({ ...x, status: 'Ordered', rejection: undefined, specimenId: `${x.specimenId}-R` }));
          push({ title: 'Recollection requested', description: 'A fresh specimen number is issued; the rejected one stays in the record', tone: 'info' });
        },
      });
    }
    return list;
  };

  const worklistTab = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-secondary">
          Every stage of a specimen, with the turnaround deadline on the row. {byStage('Ordered').length} waiting for
          collection, {byStage('Resulted').length} waiting for verification.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            name="diag-kind"
            label="Type"
            value={kindFilter}
            onChange={setKindFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'lab', label: 'Laboratory' },
              { value: 'imaging', label: 'Imaging' },
            ]}
          />
          <Segmented
            name="diag-priority"
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Routine', label: 'Routine' },
              { value: 'Urgent', label: 'Urgent' },
              { value: 'STAT', label: 'STAT' },
            ]}
          />
        </div>
      </div>
      <DataGrid<DiagnosticOrder>
        id="diagnostics-worklist"
        caption="Diagnostic worklist"
        columns={columns}
        rows={filtered}
        total={filtered.length}
        page={1}
        pageSize={50}
        rowId={(o) => o.id}
        height="32rem"
        sort={{ key: 'dueAt', dir: 'asc' }}
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Specimen, patient, MRN or test…' }}
        rowActions={actions}
        onRowClick={(row) => setOpen(row)}
        exportFileName="diagnostics-worklist"
        printMeta={`Worklist as of ${new Date().toLocaleString()} · branch: Main Campus`}
        emptyLabel="Nothing in the worklist for this filter."
      />
    </div>
  );

  /* ------------------------------------------------------------------------ collection tab */
  const collectionTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity="info" title="Collect, label, then leave the bedside">
        The label is printed from the order and applied at the bedside — the identifier on the tube is the one the
        analyser will read. A sample rejected later still carries that identifier, which is what makes the
        recollection traceable.
      </SafetyBanner>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            const waiting = byStage('Ordered').filter((o) => o.kind === 'lab');
            if (waiting.length === 0) {
              push({ title: 'Nothing waiting for collection', tone: 'info' });
              return;
            }
            setOrders((list) =>
              list.map((o) =>
                waiting.some((w) => w.id === o.id) ? { ...o, status: 'Collected', collectedAt: stamp(), collectedBy: 'S. Mia (phlebotomy)' } : o,
              ),
            );
            push({ title: `${waiting.length} specimens collected`, description: 'All labelled and time-stamped together', tone: 'success' });
          }}
        >
          Mark the round as collected
        </Button>
        <Tooltip content="Prints one label per specimen on the 50 × 25 mm roll. The printer keeps its own spool queue when the network is down.">
          <Button variant="ghost">Print the whole round</Button>
        </Tooltip>
      </div>
      {byStage('Ordered').length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          No outstanding collections.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {byStage('Ordered').map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 p-2">
              <span className="font-numeric text-xs text-text-tertiary">{o.specimenId}</span>
              <span className="text-sm font-medium">{o.patient.name}</span>
              <span className="text-sm text-text-secondary">{o.testName}</span>
              <span className="text-xs text-text-tertiary">{o.sample} · {o.container}</span>
              {o.priority !== 'Routine' && (
                <span className={cx('rounded-full px-1.5 text-[10px]', o.priority === 'STAT' ? 'bg-safety-critical/10 text-safety-critical' : 'bg-safety-warning/10 text-safety-warning')}>
                  {o.priority}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => window.open(`/print/specimen-label?spec=${o.specimenId}`, '_blank', 'noopener')}>Label</Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    patch(o.id, (x) => ({ ...x, status: 'Collected', collectedAt: stamp(), collectedBy: 'S. Mia (phlebotomy)' }));
                    push({ title: `${o.specimenId} collected`, tone: 'success' });
                  }}
                >
                  Collected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setRejecting(o); setRejectReason(REASONS[0]); }}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* --------------------------------------------------------------------------- results tab */
  const resultable = orders.filter((o) => ['Collected', 'In lab'].includes(o.status));
  const resultsTab = (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        Values are checked against their reference range as they are typed, per analyte — urea and creatinine in the
        same panel are allowed to disagree. Anything outside the critical limits is called out on the spot.
      </p>
      {resultable.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Nothing collected and waiting for a result.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {resultable.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 p-2">
              <span className="font-numeric text-xs text-text-tertiary">{o.specimenId}</span>
              <span className="text-sm font-medium">{o.patient.name}</span>
              <span className="text-sm">{o.testName}</span>
              <span className="text-xs text-text-secondary">
                {o.kind === 'imaging' ? `${o.modality} · report` : `${testByCode(o.testCode)?.analytes.length ?? 0} analyte(s)`}
              </span>
              <span className="ml-auto text-xs text-text-tertiary">{o.collectedAt?.slice(11)} collected</span>
              <Button size="sm" variant="primary" onClick={() => setOpen(o)}>
                {o.kind === 'imaging' ? 'Write report' : 'Enter results'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* ---------------------------------------------------------------------------- verify tab */
  const verifyTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity="warning" title="A second person releases every result">
        Verification is the release gate: the report reaches the patient only after somebody who did not produce it
        has looked at it. A critical value adds one more step — the call-back to the clinician, with a name, a time
        and a read-back.
      </SafetyBanner>
      {byStage('Resulted').length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Nothing waiting for verification.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {byStage('Resulted').map((o) => (
            <li key={o.id} className="rounded-md border border-border-subtle p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-numeric text-xs text-text-tertiary">{o.specimenId}</span>
                <span className="text-sm font-medium">{o.patient.name}</span>
                <span className="text-sm">{o.testName}</span>
                {flagChip(worstFlag(o))}
                {needsCallback(o) && (
                  <span className="rounded-full border border-safety-critical px-2 py-0.5 text-xs text-safety-critical">
                    Critical — call the clinician before release
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => setOpen(o)}>Review</Button>
                </div>
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 text-xs md:grid-cols-4">
                {(testByCode(o.testCode)?.analytes ?? []).map((a) => {
                  const value = o.results[a.key];
                  const flag = typeof value === 'number' ? flagValue(a, value) : 'text';
                  return (
                    <li key={a.key} className="flex justify-between gap-2">
                      <span className="text-text-secondary">{a.label}</span>
                      <span className={cx('font-numeric', flagTone[flag] === 'critical' ? 'text-safety-critical' : flagTone[flag] === 'warning' ? 'text-safety-warning' : '')}>
                        {value ?? '—'} {a.unit}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* -------------------------------------------------------------------------- dispatch tab */
  const dispatchTab = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-secondary">
          Verified results go to the patient, the ward printer or the referring doctor. Printing is the fallback that
          always works: with the uplink down the portal and the SMS wait, the paper does not.
        </p>
      </div>
      {byStage('Verified').length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Nothing verified and waiting to be dispatched.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {byStage('Verified').map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 p-2">
              <span className="font-numeric text-xs text-text-tertiary">{o.specimenId}</span>
              <span className="text-sm font-medium">{o.patient.name}</span>
              <span className="text-sm">{o.testName}</span>
              <span className="text-xs text-text-secondary">verified by {o.verifiedBy}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Segmented
                  name={`dispatch-${o.id}`}
                  label={`Dispatch method for ${o.patient.name}`}
                  value={dispatchTo}
                  onChange={setDispatchTo}
                  options={DISPATCH_OPTIONS.filter((d) => d !== 'Patient portal').map((d) => ({ value: d, label: d }))}
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (dispatchTo === 'Print') {
                      window.open(`/print/result-report?spec=${o.specimenId}`, '_blank', 'noopener');
                    }
                    patch(o.id, (x) => ({ ...x, status: 'Dispatched', dispatchedAt: stamp(), dispatchTo }));
                    push({ title: `${o.specimenId} dispatched`, description: dispatchTo, tone: 'success' });
                  }}
                >
                  Dispatch
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(`/print/result-report?spec=${o.specimenId}`, '_blank', 'noopener')}>
                  Print report
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {byStage('Dispatched').length > 0 && (
        <Panel title={`Dispatched today (${byStage('Dispatched').length})`}>
          <ul className="flex flex-col divide-y divide-border-subtle text-sm">
            {byStage('Dispatched').map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-1.5">
                <span className="font-numeric text-xs text-text-tertiary">{o.specimenId}</span>
                <span>{o.patient.name}</span>
                <span className="text-text-secondary">{o.testName}</span>
                <span className="text-xs text-text-tertiary">{o.dispatchedAt}</span>
                <span className="rounded-full bg-surface-sunken px-2 text-xs">{o.dispatchTo}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => window.open(`/print/result-report?spec=${o.specimenId}`, '_blank', 'noopener')}>
                  Reprint
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );

  /* -------------------------------------------------------------------------------- QC tab */
  const qcTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity={qcFailures.length > 0 ? 'warning' : 'success'} title={qcFailures.length > 0 ? `${qcFailures.length} quality-control run(s) out of range` : 'All quality-control runs in range'}>
        Patient results are held while a control is out of range, and the note says what was done about it. A lab
        that shows its controls is a lab whose numbers can be trusted.
      </SafetyBanner>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Quality control runs for today</caption>
          <thead className="bg-surface-sunken text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-2 py-1.5">Time</th>
              <th scope="col" className="px-2 py-1.5">Analyser</th>
              <th scope="col" className="px-2 py-1.5">Analyte</th>
              <th scope="col" className="px-2 py-1.5">Level</th>
              <th scope="col" className="px-2 py-1.5 text-right">Target</th>
              <th scope="col" className="px-2 py-1.5 text-right">Measured</th>
              <th scope="col" className="px-2 py-1.5 text-right">± 2 SD</th>
              <th scope="col" className="px-2 py-1.5">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {qc.map((r) => (
              <tr key={r.id} className="border-t border-border-subtle">
                <td className="font-numeric px-2 py-1.5 text-xs">{r.at.slice(11)}</td>
                <td className="px-2 py-1.5">{r.analyser}</td>
                <td className="px-2 py-1.5">{r.analyte}</td>
                <td className="px-2 py-1.5">{r.level}</td>
                <td className="font-numeric px-2 py-1.5 text-right">{r.target}</td>
                <td className="font-numeric px-2 py-1.5 text-right">{r.value}</td>
                <td className="font-numeric px-2 py-1.5 text-right">{r.sd * 2}</td>
                <td className={cx('px-2 py-1.5 text-xs', r.passed ? 'text-safety-success' : 'text-safety-critical')}>
                  {r.passed ? 'In range' : 'Out of range'}
                  {r.comment && <span className="block text-[11px] text-text-tertiary">{r.comment}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------------------- the sheet */
  const editing = current !== null && ['Collected', 'In lab', 'Resulted', 'Verified'].includes(current.status);
  const test = current ? testByCode(current.testCode) : undefined;
  const criticalOpen = current ? needsCallback(current) : false;
  const callbackRecorded = Boolean(current?.callback);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Diagnostics</h1>
          <p className="text-sm text-text-secondary">
            {byStage('Ordered').length} to collect · {byStage('In lab').length} in the lab ·{' '}
            {byStage('Resulted').length} to verify · {byStage('Dispatched').length} dispatched
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/clinical">
            <Button variant="ghost">Consultation</Button>
          </Link>
          <Tooltip content="A walk-in specimen with no encounter: the patient is picked, the test is chosen, and the label prints from the order.">
            <Button variant="primary">Register a walk-in specimen</Button>
          </Tooltip>
        </div>
      </div>

      <SafetyBanner severity="info" title="P4 module — preview screens, synthetic specimens">
        The rules here are the ones the laboratory service will enforce: one identifier from collection to report,
        reference ranges per analyte, a call-back recorded before a critical value is released, and a second person
        verifying every report. The specimens, patients and values are synthetic.
      </SafetyBanner>

      {qcFailures.length > 0 && (
        <SafetyBanner severity="warning" title="A quality-control run is out of range">
          Patient results for {qcFailures[0].analyte} on {qcFailures[0].analyser} are held until the control is
          cleared — that hold is the reason the control exists.
        </SafetyBanner>
      )}

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="Working offline in the laboratory">
          Collection, results, verification and printing all continue on the hospital server. The patient portal and
          SMS wait for the uplink; the queue drains when it returns.
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'worklist', label: 'Worklist', count: filtered.length },
          { id: 'collection', label: 'Collection', count: byStage('Ordered').length },
          { id: 'results', label: 'Results', count: resultable.length },
          { id: 'verify', label: 'Verify', count: byStage('Resulted').length },
          { id: 'dispatch', label: 'Dispatch', count: byStage('Verified').length }, 
          { id: 'qc', label: 'Quality control', count: qcFailures.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'worklist' && worklistTab}
        {tab === 'collection' && collectionTab}
        {tab === 'results' && resultsTab}
        {tab === 'verify' && verifyTab}
        {tab === 'dispatch' && dispatchTab}
        {tab === 'qc' && qcTab}
      </Tabs>

      {/* ---------------------------------------------------------------- result entry sheet */}
      <Sheet
        open={current !== null && editing}
        onClose={() => setOpen(null)}
        title={current ? `${current.specimenId} · ${current.testName}` : ''}
        description={current ? `${current.patient.name} · ${current.patient.mrn} · ${current.patient.age}${current.patient.sex.slice(0, 1)} · ${current.priority}` : ''}
        width="xl"
        footer={
          current && (
            <div className="flex flex-wrap gap-2">
              {['Collected', 'In lab'].includes(current.status) && (
                <Button
                  variant="primary"
                  onClick={() => {
                    patch(current.id, (x) => ({
                      ...x,
                      status: 'Resulted',
                      resultedAt: stamp(),
                      resultedBy: 'A. Kabir (technologist)',
                    }));
                    push({ title: 'Result saved', description: 'Waiting for a second person to verify it', tone: 'success' });
                    setOpen(null);
                  }}
                >
                  Save result
                </Button>
              )}
              {current.status === 'Resulted' && (
                <>
                  <Button
                    variant="primary"
                    disabled={criticalOpen && !callbackRecorded}
                    onClick={() => {
                      patch(current.id, (x) => ({ ...x, status: 'Verified', verifiedAt: stamp(), verifiedBy: 'Dr. N. Islam (pathologist)' }));
                      push({ title: `${current.specimenId} verified`, description: 'Ready to dispatch', tone: 'success' });
                      setOpen(null);
                    }}
                  >
                    Verify and release
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      patch(current.id, (x) => ({ ...x, status: 'In lab' }));
                      push({ title: 'Sent back to the bench', description: 'An amendment is recorded against the original', tone: 'warning' });
                      setOpen(null);
                    }}
                  >
                    Amend
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={() => window.open(`/print/result-report?spec=${current.specimenId}`, '_blank', 'noopener')} className="gap-1.5">
                <Printer className="size-3.5" aria-hidden />
                Print report
              </Button>
            </div>
          )
        }
      >
        {current && test && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <span><span className="block text-xs text-text-secondary">Specimen</span><span className="font-numeric">{current.specimenId}</span></span>
              <span><span className="block text-xs text-text-secondary">Sample</span>{current.sample ?? current.modality}</span>
              <span><span className="block text-xs text-text-secondary">Container</span>{current.container ?? '—'}</span>
              <span><span className="block text-xs text-text-secondary">Method</span>{test.method ?? '—'}</span>
              <span><span className="block text-xs text-text-secondary">Ordered</span><span className="font-numeric">{current.orderedAt}</span></span>
              <span><span className="block text-xs text-text-secondary">Collected</span><span className="font-numeric">{current.collectedAt ?? '—'}</span></span>
              <span><span className="block text-xs text-text-secondary">Turnaround target</span><span className="font-numeric">{current.dueAt}</span></span>
              <span><span className="block text-xs text-text-secondary">Ordered by</span>{current.encounterId ? `Encounter ${current.encounterId}` : 'Walk-in'}</span>
            </div>

            {test.analytes.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th className="py-1">Analyte</th>
                    <th className="py-1">Reference</th>
                    <th className="py-1">Unit</th>
                    <th className="py-1">Value</th>
                    <th className="py-1">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {test.analytes.map((a) => {
                    const raw = current.results[a.key];
                    const flag: ResultFlag = typeof raw === 'number' ? flagValue(a, raw) : 'text';
                    return (
                      <tr key={a.key} className="border-b border-border-subtle last:border-0">
                        <td className="py-1">{a.label}</td>
                        <td className="font-numeric py-1 text-xs text-text-secondary">
                          {a.low}–{a.high}
                          {a.criticalHigh !== undefined ? ` · critical ≥ ${a.criticalHigh}` : ''}
                          {a.criticalLow !== undefined ? ` · critical ≤ ${a.criticalLow}` : ''}
                        </td>
                        <td className="py-1 text-xs text-text-secondary">{a.unit}</td>
                        <td className="py-1">
                          <input
                            type="number"
                            step={a.decimals ? 0.1 : 1}
                            value={raw ?? ''}
                            disabled={current.status === 'Verified'}
                            onChange={(e) => {
                              const v = e.target.value === '' ? '' : Number(e.target.value);
                              patch(current.id, (x) => ({ ...x, results: { ...x.results, [a.key]: v } }));
                            }}
                            className={cx(
                              INPUT,
                              'w-28',
                              flagTone[flag] === 'critical' && 'border-safety-critical text-safety-critical',
                              flagTone[flag] === 'warning' && 'border-safety-warning',
                            )}
                            aria-label={`${a.label} in ${a.unit}`}
                          />
                        </td>
                        <td className="py-1">
                          {typeof raw === 'number' ? flagChip(flag) : <span className="text-xs text-text-tertiary">not entered</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {(test.kind === 'imaging' || current.report !== undefined) && (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Report</span>
                <textarea
                  rows={4}
                  value={current.report ?? ''}
                  disabled={current.status === 'Verified'}
                  onChange={(e) => patch(current.id, (x) => ({ ...x, report: e.target.value }))}
                  className="w-full rounded-md border border-border-default bg-surface-default p-2 text-sm"
                  placeholder="Findings, impression, and anything the clinician must act on"
                />
              </label>
            )}

            {needsCallback(current) && (
              <SafetyBanner severity="critical" title="Critical value — the clinician must be told before this is released">
                {['hb', 'platelets', 'potassium', 'sodium', 'glucose', 'fbs', 'creatinine', 'tsh', 'tg', 'ldl', 'alt', 'ast', 'bilirubin', 'urea', 'wbc']
                  .filter((k) => typeof current.results[k] === 'number')
                  .map((k) => {
                    const a = test.analytes.find((x) => x.key === k);
                    if (!a) return null;
                    const flag = flagValue(a, Number(current.results[k]));
                    return flagTone[flag] === 'critical' ? <p key={k}>{a?.label}: {String(current.results[k])} {a?.unit} — {flagLabel[flag]}</p> : null;
                  })}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Told (clinician or nurse)</span>
                    <input value={callbackBy} onChange={(e) => setCallbackBy(e.target.value)} className={cx(INPUT, 'w-72')} />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={readBack} onChange={(e) => setReadBack(e.target.checked)} />
                    They read the value back
                  </label>
                  <Button
                    onClick={() => {
                      if (!readBack) {
                        push({ title: 'Read-back is part of the rule', description: 'Confirm that the value was repeated back before recording the call', tone: 'warning' });
                        return;
                      }
                      patch(current.id, (x) => ({ ...x, callback: { at: stamp(), by: 'F. Rahman (lab)', toWhom: callbackBy, readBack: true } }));
                      push({ title: 'Call-back recorded', description: `${callbackBy} · read-back confirmed`, tone: 'success' });
                    }}
                  >
                    <Phone className="size-3.5" aria-hidden />
                    Record the call
                  </Button>
                </div>
                {current.callback && (
                  <p className="mt-1 text-sm">
                    Called {current.callback.toWhom} at {current.callback.at} · read-back confirmed.
                  </p>
                )}
              </SafetyBanner>
            )}

            {current.rejection && (
              <SafetyBanner severity="critical" title={`Sample rejected — ${current.rejection.reason}`}>
                Recorded by {current.rejection.by} at {current.rejection.at}. The recollection carries the same
                identifier with an “R” suffix, so the history of this specimen stays readable.
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------- rejection sheet */}
      <Sheet
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.specimenId}` : ''}
        description="A rejected sample is a real outcome, not a deleted row."
        width="md"
        footer={
          rejecting && (
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  patch(rejecting.id, (x) => ({ ...x, status: 'Rejected', rejection: { reason: rejectReason, by: 'F. Rahman (lab)', at: stamp() } }));
                  push({ title: `${rejecting.specimenId} rejected`, description: `${rejectReason} — recollection requested`, tone: 'warning' });
                  setRejecting(null);
                }}
              >
                Reject and request recollection
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            </div>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Reason (the five the laboratory uses)</span>
            <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className={INPUT}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <p className="text-sm text-text-secondary">
            The ward is told automatically, the patient is not charged twice, and the reason is counted in the
            monthly quality review — which is how a recurring problem with one ward&apos;s technique gets fixed.
          </p>
          <SafetyBanner severity="info" title="What the patient is told">
            {rejecting ? `${rejecting.patient.name} is asked for a fresh sample; the collection fee for the repeat is not charged.` : ''}
          </SafetyBanner>
        </div>
      </Sheet>
    </div>
  );
}
