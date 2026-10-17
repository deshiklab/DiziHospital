'use client';

import { useMemo, useState } from 'react';
import {
  Board,
  Button,
  DataGrid,
  Panel,
  SafetyBanner,
  Sheet,
  Tabs,
  Tooltip,
  cx,
  useToast,
  type BoardCard,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { AlertTriangle, Printer } from 'lucide-react';
import { allergyHits, highAlertHits, type RxLine } from '@/lib/clinical';
import {
  DRUGS,
  EXPIRY_WARN_DAYS,
  QUEUE_COLUMNS,
  controlledRegister,
  daysToExpiry,
  dispenseTone,
  drugById,
  expiryState,
  fefo,
  generateBatches,
  generateDispenses,
  generateLedger,
  stockOnHand,
  substitutesFor,
  type Batch,
  type Dispense,
  type DispenseStatus,
  type StockMovement,
} from '@/lib/pharmacy';
import { money } from '@/lib/billing';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Pharmacy (legacy screens 020/021 replaced) — the P3 module.
 *
 * The counter, not the shelf, is where a prescription becomes medicine, so this screen carries the three checks
 * that matter: first-expiry-first-out (an expired batch cannot be chosen at all), the allergy check repeated at
 * dispensing time because the prescription may be a day old, and the controlled-substance register with a
 * witness. Substitutions keep both names, so the prescriber sees what was actually given.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';

export default function PharmacyPage() {
  const { sync } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [batches, setBatches] = useState<Batch[]>(() => generateBatches(day));
  const [dispenses, setDispenses] = useState<Dispense[]>(() => generateDispenses(day, generateBatches(day)));
  const [open, setOpen] = useState<Dispense | null>(null);
  const [tab, setTab] = useState('queue');
  const [stockQuery, setStockQuery] = useState('');
  const [witness, setWitness] = useState('');

  const ledger = useMemo(() => generateLedger(day, batches, dispenses), [day, batches, dispenses]);
  const register = useMemo(() => controlledRegister(dispenses, batches, day), [dispenses, batches, day]);

  const drugRefs = DRUGS;
  const blockers = (d: Dispense) => allergyHits(d.lines.map((l) => l.rxLine), drugRefs, d.patient.allergies);
  const highs = (d: Dispense) => highAlertHits(d.lines.map((l) => l.rxLine), drugRefs);

  const setStatus = (id: string, status: DispenseStatus, extra: Partial<Dispense> = {}) =>
    setDispenses((list) => list.map((d) => (d.id === id ? { ...d, status, ...extra } : d)));

  /* ------------------------------------------------------------------------------- queue tab */
  const boardCards: BoardCard[] = dispenses.map((d) => {
    const lines = d.lines.length;
    const outOfStock = d.lines.filter((l) => (l.batchId ? 0 : 1) === 1).length;
    return {
      id: d.id,
      title: `${d.rxNumber} · ${d.patient.name}`,
      subtitle: `${d.room} · ${d.prescriber}`,
      meta: [
        `${lines} item${lines === 1 ? '' : 's'}`,
        money(d.total),
        `counter ${d.counter}`,
        d.patient.allergies ? `allergy: ${d.patient.allergies}` : '',
      ].filter(Boolean) as string[],
      badge: d.patient.allergies
        ? { label: 'Allergy on record', tone: 'critical' as const }
        : outOfStock > 0
          ? { label: `${outOfStock} short`, tone: 'warning' as const }
          : { label: d.status, tone: dispenseTone[d.status] },
      transitions: [
        { to: 'In progress', label: 'Start dispensing' },
        { to: 'Dispensed', label: 'Dispense' },
        { to: 'Partially dispensed', label: 'Partially dispense' },
        { to: 'Returned', label: 'Return to patient', danger: true },
      ],
      onOpen: () => setOpen(d),
    };
  });

  const queueTab = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-secondary">
          Every prescription that arrived from a signed consultation. Move a card with the ⋯ menu — a return is a
          deliberate, recorded action, not a drag.
        </p>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.open('/print/dispense-label', '_blank', 'noopener')}>Label stock</Button>
        </div>
      </div>
      <Board
        columns={[
          { id: 'Waiting', title: 'Waiting', tone: 'warning', hint: 'Prescription handed in' },
          { id: 'In progress', title: 'In progress', tone: 'info', hint: 'Being picked' },
          { id: 'Dispensed', title: 'Dispensed', tone: 'success' },
          { id: 'Partially dispensed', title: 'Partly dispensed', tone: 'warning', hint: 'Some items short' },
          { id: 'Returned', title: 'Returned', tone: 'critical' },
        ]}
        cards={boardCards}
        columnOf={(c) => dispenses.find((d) => d.id === c.id)?.status ?? 'Waiting'}
        onTransition={(id, to) => {
          const d = dispenses.find((x) => x.id === id);
          if (!d) return;
          if (to === 'Dispensed') {
            const conflicts = blockers(d);
            if (conflicts.length > 0) {
              push({ title: 'Allergy conflict — not dispensed', description: conflicts[0].message, tone: 'critical' });
              return;
            }
            const needsWitness = d.lines.some((l) => l.drug.controlled);
            if (needsWitness && witness.trim().length === 0) {
              push({ title: 'A witness is required', description: 'Controlled medicines need two names — open the sheet and record both', tone: 'warning' });
              return;
            }
            setStatus(id, 'Dispensed', {
              dispensedAt: `${day} ${new Date().toTimeString().slice(0, 5)}`,
              dispensedBy: 'R. Haque (pharmacist)',
              witness: needsWitness ? witness.trim() : undefined,
            });
            push({
              title: `${d.rxNumber} dispensed`,
              description: sync === 'live' ? `${money(d.total)} · stock ledger updated` : 'Queued — the ledger and the bill sync with the connection',
              tone: sync === 'live' ? 'success' : 'warning',
              action: { label: 'Print label', onSelect: () => window.open(`/print/dispense-label?dsp=${d.id}`, '_blank', 'noopener') },
            });
            return;
          }
          setStatus(id, to as DispenseStatus);
          if (to === 'Returned') push({ title: `${d.rxNumber} returned`, description: 'Reason recorded; stock goes back to the same batch', tone: 'warning' });
        }}
        emptyLabel="No prescriptions waiting"
      />
      {dispenses.some((d) => d.lines.some((l) => l.drug.controlled)) && (
        <label className="flex max-w-md flex-col gap-1">
          <span className={LABEL}>Witness for controlled medicines (second name, required)</span>
          <input value={witness} onChange={(e) => setWitness(e.target.value)} placeholder="N. Sultana (nurse)" className={INPUT} />
        </label>
      )}
    </div>
  );

  /* ------------------------------------------------------------------------------- stock tab */
  const stockRows = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    return batches.filter((b) => {
      const drug = drugById(b.drugId);
      if (!drug) return false;
      if (!q) return true;
      return drug.brand.toLowerCase().includes(q) || drug.generic.toLowerCase().includes(q) || b.batchNo.toLowerCase().includes(q);
    });
  }, [batches, stockQuery]);

  const stockColumns: Array<Column<Batch>> = [
    {
      key: 'drugId',
      header: 'Medicine',
      render: (b) => {
        const drug = drugById(b.drugId);
        return (
          <span className="flex flex-col">
            <span className="font-medium">{drug?.brand}</span>
            <span className="text-xs text-text-tertiary">{drug?.generic} {drug?.strength}</span>
          </span>
        );
      },
    },
    { key: 'batchNo', header: 'Batch', hideBelow: 'md', render: (b) => <span className="font-numeric text-xs">{b.batchNo}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      sortable: true,
      render: (b) => {
        const state = expiryState(b.expiry, day);
        const days = daysToExpiry(b.expiry, day);
        return (
          <span className={cx('font-numeric', state === 'expired' ? 'text-safety-critical' : state === 'expiring' ? 'text-safety-warning' : '')}>
            {b.expiry}
            {state === 'expired' ? ' · expired' : state === 'expiring' ? ` · ${days} days` : ''}
          </span>
        );
      },
    },
    { key: 'qty', header: 'In stock', align: 'right', numeric: true },
    { key: 'location', header: 'Location', hideBelow: 'lg' },
    { key: 'supplier', header: 'Supplier', hideBelow: 'xl' },
    {
      key: 'value',
      header: 'Stock value',
      align: 'right',
      numeric: true,
      render: (b) => money(b.qty * (drugById(b.drugId)?.price ?? 0)),
    },
  ];

  const stockActions = (b: Batch): RowAction<Batch>[] => {
    const state = expiryState(b.expiry, day);
    return [
      { label: 'Show the ledger for this batch', onSelect: () => { setTab('ledger'); setStockQuery(b.batchNo); } },
      { label: 'Show in the register', onSelect: () => setTab('register') },
      ...(state === 'expired'
        ? [{
            label: 'Quarantine and write off',
            danger: true,
            separated: true,
            hint: 'Two people sign; the movements are kept',
            onSelect: (row: Batch) => {
              setBatches((list) => list.map((x) => (x.id === row.id ? { ...x, qty: 0 } : x)));
              push({ title: `${row.batchNo} written off`, description: 'Expired stock quarantined; a witness is recorded on the write-off', tone: 'warning' });
            },
          }]
        : []),
    ];
  };

  const expiringSoon = batches.filter((b) => expiryState(b.expiry, day) === 'expiring').length;
  const expired = batches.filter((b) => expiryState(b.expiry, day) === 'expired').length;

  const stockTab = (
    <div className="flex flex-col gap-2">
      {(expired > 0 || expiringSoon > 0) && (
        <SafetyBanner severity={expired > 0 ? 'critical' : 'warning'} title={`${expired} expired and ${expiringSoon} expiring within ${EXPIRY_WARN_DAYS} days`}>
          Expired stock cannot be dispensed — the batch picker will not offer it. Expiring stock is used first
          (FEFO) or returned to the supplier before the date; the write-off is recorded with a witness.
        </SafetyBanner>
      )}
      <DataGrid<Batch>
        id="pharmacy-stock"
        caption="Stock batches"
        columns={stockColumns}
        rows={stockRows}
        total={stockRows.length}
        page={1}
        pageSize={50}
        rowId={(b) => b.id}
        height="28rem"
        sort={{ key: 'expiry', dir: 'asc' }}
        quickSearch={{ value: stockQuery, onChange: setStockQuery, placeholder: 'Medicine or batch number…' }}
        rowActions={stockActions}
        exportFileName="stock-batches"
        printMeta={`Stock as of ${new Date().toLocaleString()}`}
        emptyLabel="No batches match that search."
      />
    </div>
  );

  /* -------------------------------------------------------------------------- ledger + register */
  const ledgerColumns: Array<Column<StockMovement>> = [
    { key: 'at', header: 'When', width: '10rem', render: (m) => <span className="font-numeric text-xs">{m.at}</span> },
    {
      key: 'drugId',
      header: 'Medicine',
      render: (m) => drugById(m.drugId)?.brand ?? m.drugId,
    },
    { key: 'batchId', header: 'Batch', hideBelow: 'md', render: (m) => <span className="font-numeric text-xs">{batches.find((b) => b.id === m.batchId)?.batchNo ?? m.batchId}</span> },
    { key: 'kind', header: 'Movement' },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      numeric: true,
      render: (m) => <span className={m.qty < 0 ? 'text-safety-warning' : 'text-safety-success'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>,
    },
    { key: 'reference', header: 'Reference', hideBelow: 'lg', render: (m) => <span className="font-numeric text-xs">{m.reference}</span> },
    { key: 'by', header: 'By', hideBelow: 'xl' },
  ];

  const ledgerTab = (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        The ledger is append-only: one row per movement, in and out, with who did it and against which document. A
        balance you cannot explain is a balance nobody trusts, so there is no “edit quantity” anywhere on this page.
      </p>
      <DataGrid<StockMovement>
        id="pharmacy-ledger"
        caption="Stock ledger"
        columns={ledgerColumns}
        rows={ledger}
        total={ledger.length}
        page={1}
        pageSize={50}
        rowId={(m) => m.id}
        height="28rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Batch, reference or medicine…' }}
        exportFileName="stock-ledger"
        printMeta={`Movements as of ${new Date().toLocaleString()}`}
        emptyLabel="No movements."
      />
    </div>
  );

  const registerColumns: Array<Column<ReturnType<typeof controlledRegister>[number]>> = [
    { key: 'at', header: 'When', render: (r) => <span className="font-numeric text-xs">{r.at}</span> },
    { key: 'drugId', header: 'Controlled medicine', render: (r) => drugById(r.drugId)?.brand ?? r.drugId },
    { key: 'qty', header: 'Qty', align: 'right', numeric: true },
    { key: 'patient', header: 'Patient' },
    { key: 'mrn', header: 'MRN', hideBelow: 'md', render: (r) => <span className="font-numeric text-xs">{r.mrn}</span> },
    { key: 'prescriber', header: 'Prescriber', hideBelow: 'lg' },
    { key: 'dispensedBy', header: 'Dispensed by', hideBelow: 'lg' },
    {
      key: 'witness',
      header: 'Witness',
      render: (r) => <span className={r.witness === '—' ? 'text-safety-critical' : ''}>{r.witness}</span>,
    },
    { key: 'balanceAfter', header: 'Balance after', align: 'right', numeric: true },
  ];

  const registerTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity="warning" title="Controlled register — two names on every line">
        The law asks for the dispenser and the witness, and it asks for the balance after each movement. A line
        without a witness cannot be closed, which is why the queue refuses to dispense a controlled medicine until
        the second name is entered.
      </SafetyBanner>
      <DataGrid<ReturnType<typeof controlledRegister>[number]>
        id="pharmacy-controlled"
        caption="Controlled substance register"
        columns={registerColumns}
        rows={register}
        total={register.length}
        page={1}
        pageSize={25}
        rowId={(r) => r.id}
        height="24rem"
        exportFileName="controlled-register"
        printMeta={`Controlled register as of ${new Date().toLocaleString()} · pilot branch`}
        emptyLabel="No controlled movements recorded."
      />
    </div>
  );

  /* ---------------------------------------------------------------------------- dispense sheet */
  const sheetLines = open?.lines ?? [];
  const sheetAllergy = open ? blockers(open) : [];
  const sheetHigh = open ? highs(open) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Pharmacy</h1>
          <p className="text-sm text-text-secondary">
            {dispenses.filter((d) => d.status === 'Waiting').length} waiting ·{' '}
            {dispenses.filter((d) => d.status === 'Dispensed').length} dispensed · {expired} expired batches on the shelf
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => window.open('/print/dispense-label', '_blank', 'noopener')} className="gap-1.5">
            <Printer className="size-3.5" aria-hidden />
            Labels
          </Button>
          <Tooltip content="Stock take freezes the counters, asks for counts, and writes the differences as adjustments with a reason.">
            <Button variant="ghost">Start stock take</Button>
          </Tooltip>
        </div>
      </div>

      <SafetyBanner severity="info" title="P3 module — preview screens, synthetic stock">
        FEFO, the dispensing-time allergy check and the controlled register are the real rules of the pharmacy
        module. The quantities, batches and expiry dates are synthetic, so nothing here is a real stock position.
      </SafetyBanner>

      {sync !== 'live' && (
        <SafetyBanner severity="warning" title="Dispensing offline">
          Dispensing, labels and the controlled register keep working. Receipts are numbered from this branch's
          block and the movements queue until the connection returns — the accounting office reconciles them later.
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'queue', label: 'Dispense queue', count: dispenses.filter((d) => d.status === 'Waiting' || d.status === 'In progress').length },
          { id: 'stock', label: 'Stock', count: batches.length },
          { id: 'register', label: 'Controlled register', count: register.length },
          { id: 'ledger', label: 'Stock ledger', count: ledger.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'queue' && queueTab}
        {tab === 'stock' && stockTab}
        {tab === 'register' && registerTab}
        {tab === 'ledger' && ledgerTab}
      </Tabs>

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${open.rxNumber} · ${open.patient.name}` : ''}
        description={open ? `${open.room} · ${open.prescriber} · ${open.orderedAt}` : ''}
        width="xl"
        footer={
          open && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  if (sheetAllergy.length > 0) {
                    push({ title: 'Allergy conflict — not dispensed', description: sheetAllergy[0].message, tone: 'critical' });
                    return;
                  }
                  const needsWitness = sheetLines.some((l) => l.drug.controlled);
                  if (needsWitness && witness.trim().length === 0) {
                    push({ title: 'Witness required', description: 'Record the second name in the fields below', tone: 'warning' });
                    return;
                  }
                  setStatus(open.id, 'Dispensed', {
                    dispensedAt: `${day} ${new Date().toTimeString().slice(0, 5)}`,
                    dispensedBy: 'R. Haque (pharmacist)',
                    witness: needsWitness ? witness.trim() : undefined,
                  });
                  // FEFO, made real: the batch that leaves the shelf is the one the ledger records.
                  setBatches((list) =>
                    list.map((b) => {
                      const line = sheetLines.find((l) => l.batchId === b.id);
                      return line ? { ...b, qty: Math.max(0, b.qty - line.qty) } : b;
                    }),
                  );
                  push({ title: `${open.rxNumber} dispensed`, description: `${money(open.total)} · ledger updated`, tone: 'success', action: { label: 'Print label', onSelect: () => window.open(`/print/dispense-label?dsp=${open.id}`, '_blank', 'noopener') } });
                  setOpen(null);
                }}
              >
                Dispense and print label
              </Button>
              <Button onClick={() => { setStatus(open.id, 'Partially dispensed'); push({ title: 'Partial dispense recorded', description: 'The patient is told which items are short, and a purchase request is raised', tone: 'warning' }); }}>
                Partially dispense
              </Button>
              <Button variant="ghost" onClick={() => window.print()}>Print sheet</Button>
            </div>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <span><span className="block text-xs text-text-secondary">Patient</span>{open.patient.name} ({open.patient.nameBn})</span>
              <span><span className="block text-xs text-text-secondary">MRN</span><span className="font-numeric">{open.patient.mrn}</span></span>
              <span><span className="block text-xs text-text-secondary">Age / sex</span>{open.patient.age} · {open.patient.sex}</span>
              <span><span className="block text-xs text-text-secondary">Payer</span>{open.patient.payer}</span>
            </div>

            {open.patient.allergies && (
              <SafetyBanner severity="critical" title={`Allergy on record: ${open.patient.allergies}`}>
                {sheetAllergy.length === 0
                  ? 'None of the prescribed medicines belongs to that group — checked again here, at the counter.'
                  : sheetAllergy.map((h, i) => <p key={i}>{h.message}. {h.fix}.</p>)}
              </SafetyBanner>
            )}

            {sheetHigh.length > 0 && (
              <SafetyBanner severity="warning" title="High-alert medicine">
                {sheetHigh.map((h, i) => <p key={i}>{h.message}. {h.fix}.</p>)}
              </SafetyBanner>
            )}

            <ul className="flex flex-col gap-2">
              {sheetLines.map((line) => {
                const options = fefo(batches, line.drug.id, day);
                const onHand = stockOnHand(batches, line.drug.id);
                const chosen = options.find((b) => b.id === line.batchId) ?? options[0];
                const substitutes = substitutesFor(line.drug).filter((s) => stockOnHand(batches, s.id) > 0);
                return (
                  <li key={line.id} className="rounded-md border border-border-subtle p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{line.drug.brand}</span>
                      <span className="text-xs text-text-secondary">{line.drug.generic} {line.drug.strength} · {line.drug.form}</span>
                      {line.drug.controlled && <span className="rounded-full border border-safety-critical px-1.5 text-[10px] text-safety-critical">controlled</span>}
                      {line.drug.highAlert && <span className="rounded-full border border-safety-warning px-1.5 text-[10px] text-safety-warning">high alert</span>}
                      <span className="ml-auto text-sm">{money(line.qty * line.drug.price)}</span>
                    </div>

                    <p className="mt-1 text-xs text-text-secondary">
                      {line.rxLine.dose} · {line.rxLine.route} · {line.rxLine.frequency} · {line.rxLine.durationDays} days
                      {line.rxLine.instructions ? ` · ${line.rxLine.instructions}` : ''}
                    </p>

                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                      <label className="flex flex-col gap-1 md:col-span-2">
                        <span className={LABEL}>Batch (first expiry first out)</span>
                        <select
                          value={chosen?.id ?? ''}
                          onChange={(e) =>
                            setDispenses((list) =>
                              list.map((d) =>
                                d.id === open.id ? { ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, batchId: e.target.value } : l)) } : d,
                              ),
                            )
                          }
                          className={INPUT}
                          disabled={options.length === 0}
                        >
                          {options.length === 0 && <option value="">Out of stock — usable batches: none</option>}
                          {options.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchNo} · expires {b.expiry} ({daysToExpiry(b.expiry, day)} days) · {b.qty} in {b.location}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Quantity</span>
                        <input
                          type="number"
                          min={1}
                          max={chosen?.qty ?? 1}
                          value={line.qty}
                          onChange={(e) =>
                            setDispenses((list) =>
                              list.map((d) =>
                                d.id === open.id ? { ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, qty: Number(e.target.value) } : l)) } : d,
                              ),
                            )
                          }
                          className={INPUT}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Substitute (same class)</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const to = DRUGS.find((s) => s.id === e.target.value);
                            if (!to) return;
                            const target = fefo(batches, to.id, day)[0];
                            setDispenses((list) =>
                              list.map((d) =>
                                d.id === open.id
                                  ? {
                                      ...d,
                                      lines: d.lines.map((l) =>
                                        l.id === line.id
                                          ? { ...l, drug: to, batchId: target?.id ?? null, substitution: { from: line.drug.brand, to: to.brand, reason: 'Chennai brand not in stock' } }
                                          : l,
                                      ),
                                    }
                                  : d,
                              ),
                            );
                            push({ title: `Substituted ${line.drug.brand} → ${to.brand}`, description: 'Both names are printed on the label and shown to the prescriber', tone: 'info' });
                          }}
                          className={INPUT}
                        >
                          <option value="">— keep {line.drug.brand} —</option>
                          {substitutes.map((s) => (
                            <option key={s.id} value={s.id}>{s.brand} {s.strength} · {stockOnHand(batches, s.id)} in stock</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {line.substitution && (
                      <p className="mt-1 text-xs text-safety-info">
                        Substituted {line.substitution.from} → {line.substitution.to} ({line.substitution.reason})
                      </p>
                    )}
                    {onHand < line.qty && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-safety-warning">
                        <AlertTriangle className="size-3" aria-hidden />
                        Only {onHand} on hand — dispense what there is, or raise a purchase request.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-sunken p-3 text-sm">
              <span>Total <strong>{money(open.total)}</strong></span>
              <span className="text-text-secondary">Charged to {open.patient.payer} at the billing counter</span>
              <label className="ml-auto flex items-center gap-2">
                <span className={LABEL}>Witness (controlled items)</span>
                <input value={witness} onChange={(e) => setWitness(e.target.value)} className={cx(INPUT, 'w-56')} placeholder="N. Sultana (nurse)" />
              </label>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
