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
import { BadgeCheck, FileStack, Receipt, ShieldAlert, Wallet } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { PAYMENT_METHODS, money, payerCoverage, type PaymentMethod, type Payer } from '@/lib/billing';
import {
  BILL_MODULES,
  CREDIT_RULES,
  CROSS_MATCH_FEE,
  DEPOSIT_DAYS,
  MODULE_RULES,
  PRE_AUTH_THRESHOLD,
  billChecks,
  billableItems,
  moduleBillTotals,
  moduleDay,
  moduleInvoiceNo,
  moduleTotals,
  openBills,
  type BillModule,
  type BillableItem,
  type OpenBill,
} from '@/lib/module-billing';

/* Single-module billing (legacy screens 010, 003, 004, 005 and 006 — replaced) — the P2 `07-billing-bill-dashboard`
 * screen and the four P4 service-line billings, delivered as one screen with a module switch.
 *
 * The legacy product had a separate billing page per module and each one decided for itself when money is due.
 * `lib/module-billing.ts` states the real rule once — the moment of charge, the party that owes it, and the
 * exception that lets a service happen first and be billed after — and this screen applies it: the worklist is the
 * module's own worklist, the price is the module's own price, and the refusal says which rule was hit.
 *
 * The five service lines that come through here:
 *   Pathology · Radiology · Blood issue · Blood components · Pharmacy · IPD · Ambulance · OPD.
 *
 * Preview: every item is drawn from the module that owns it, so this screen cannot invent a chargeable service
 * that does not exist. Nothing survives a reload; the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const PAYERS: Payer[] = ['Self pay', 'Corporate — BRAC', 'Insurance — MetLife', 'Govt. scheme'];

const STATE_CHIP: Record<OpenBill['state'], string> = {
  Draft: 'bg-surface-sunken text-text-secondary',
  Issued: 'bg-safety-info/10 text-safety-info',
  'Partially collected': 'bg-safety-warning/10 text-safety-warning',
  Collected: 'bg-safety-success/10 text-safety-success',
  Cancelled: 'bg-safety-critical/10 text-safety-critical',
};

export default function ModuleBillingPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [module, setModule] = useState<BillModule>('Pathology');
  const [tab, setTab] = useState('bill');
  const [selected, setSelected] = useState<string[]>([]);
  const [discounts, setDiscounts] = useState<Record<string, { pct: number; reason: string }>>({});
  const [payer, setPayer] = useState<Payer>('Self pay');
  const [preAuth, setPreAuth] = useState('');
  const [authorisedBy, setAuthorisedBy] = useState('');
  const [emergency, setEmergency] = useState(false);
  const [depositPaid, setDepositPaid] = useState(0);
  const [creditLimit, setCreditLimit] = useState(150_000);
  const [bills, setBills] = useState<OpenBill[]>(() => openBills(day));
  const [openBillId, setOpenBillId] = useState<string | null>(null);
  const [collectAmount, setCollectAmount] = useState(0);
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>('Cash');
  const [cancelReason, setCancelReason] = useState('Study cancelled by the radiologist before it was performed.');

  const items = useMemo(() => billableItems(day, module), [day, module]);
  const totals = useMemo(() => moduleTotals(day), [day]);
  const dashboard = useMemo(() => moduleDay(day), [day]);
  const chosen = items.filter((i) => selected.includes(i.id));

  const drafts = chosen.map((i) => ({
    ...i,
    id2: `${i.id}-line`,
    chargedTo: (payer === 'Self pay' ? 'Patient' : 'Payer') as 'Patient' | 'Payer',
    discountPct: discounts[i.id]?.pct ?? 0,
    ...(discounts[i.id]?.reason ? { discountReason: discounts[i.id].reason } : {}),
  }));
  const billTotal = moduleBillTotals(drafts, payer);
  const checks = billChecks(drafts, payer, billTotal, {
    ...(preAuth ? { preAuth } : {}),
    creditLimit,
    depositPaid,
    ...(authorisedBy ? { authorisedBy } : {}),
    emergency,
  });

  const openBill = bills.find((b) => b.id === openBillId) ?? null;
  const moduleRule = MODULE_RULES.find((r) => r.module === module)!;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const issue = (collectNow: boolean) => {
    if (drafts.length === 0) {
      push({ title: 'Nothing is selected, so there is nothing to bill.', tone: 'critical' });
      return;
    }
    if (checks.blockers.length > 0) {
      push({ title: `Not issued — ${checks.blockers[0]}`, tone: 'critical' });
      return;
    }
    const invoiceNo = moduleInvoiceNo(day, module, bills.length);
    const collected = collectNow ? billTotal.patientShare : 0;
    const bill: OpenBill = {
      id: `OB-${day}-${bills.length}`,
      invoiceNo,
      module,
      mrn: drafts[0].mrn,
      patientName: drafts[0].patientName,
      payer,
      lines: drafts.length,
      net: billTotal.net,
      payerShare: billTotal.payerShare,
      patientShare: billTotal.patientShare,
      collected,
      at: `${day}T13:10`,
      raisedBy: 'Counter 2 — R. Karim',
      state: collected >= billTotal.patientShare && billTotal.patientShare > 0 ? 'Collected' : collected > 0 ? 'Partially collected' : 'Issued',
    };
    setBills((b) => [bill, ...b]);
    queueWrite(`${invoiceNo}: ${module} bill for ${bill.patientName}, ${money(billTotal.net)}${checks.preAuthRequired ? `, pre-authorisation ${preAuth}` : ''}`);
    push({
      title: `${invoiceNo} issued — net ${money(billTotal.net)}`,
      description: collectNow
        ? `${money(billTotal.patientShare)} collected from the patient, ${money(billTotal.payerShare)} to ${payer}.${checks.warnings.length ? ` ${checks.warnings[0]}` : ''}`
        : `${money(billTotal.patientShare)} to collect, ${money(billTotal.payerShare)} to ${payer}. The invoice is on the register.`,
      tone: checks.overCreditLimit ? 'warning' : 'success',
    });
    setSelected([]);
    setDiscounts({});
    setTab('bills');
  };

  const collectOn = () => {
    if (!openBill) return;
    const amount = Math.max(0, Math.min(collectAmount, openBill.net - openBill.collected));
    if (amount === 0) {
      push({ title: 'Nothing to collect on this bill.', tone: 'critical' });
      return;
    }
    setBills((list) => list.map((b) => (b.id === openBill.id
      ? { ...b, collected: b.collected + amount, state: b.collected + amount >= b.net ? 'Collected' : 'Partially collected' }
      : b)));
    queueWrite(`${openBill.invoiceNo}: ${money(amount)} received by ${collectMethod}`);
    push({ title: `${money(amount)} received on ${openBill.invoiceNo}`, description: `By ${collectMethod}. The bill moves to ${openBill.collected + amount >= openBill.net ? 'collected' : 'partially collected'}.`, tone: 'success' });
    setCollectAmount(0);
  };

  const cancelBill = (bill: OpenBill) => {
    setBills((list) => list.map((b) => (b.id === bill.id ? { ...b, state: 'Cancelled', cancelledBecause: cancelReason } : b)));
    queueWrite(`${bill.invoiceNo}: cancelled — ${cancelReason}`);
    push({
      title: `${bill.invoiceNo} cancelled`,
      description: bill.collected > 0
        ? `${money(bill.collected)} was already taken: it is refunded by the method it came in, with this reason on the record. A cancelled line is never deleted.`
        : 'The line is cancelled, not deleted, so the day-end sheet still balances and the reason is still there.',
      tone: 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <FileStack className="size-5 text-brand-600" aria-hidden />
            Single-module billing
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — bill a service line from the worklist that produced it: pathology, radiology, blood issue, blood
            components, pharmacy, IPD or ambulance.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/billing" className="inline-flex"><Button variant="ghost"><Wallet className="size-4" aria-hidden /> The billing ledger</Button></Link>
          <Link href="/billing/opd" className="inline-flex"><Button variant="ghost"><Receipt className="size-4" aria-hidden /> OPD counter</Button></Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Chargeable today" value={money(totals.value)} definition="Everything the modules have produced today that carries a charge, across all eight lines of business." asOf={day} footnote={`${totals.ready} ready · ${totals.notReady} not yet performed`} />
        <KpiTile label="On bills" value={money(totals.billed)} definition="Value already on invoices issued today — the number the day-end sheet reconciles against." asOf={day} />
        <KpiTile label="Collected" value={money(totals.collected)} definition="Money actually received today: cash, wallet, card, insurance or corporate." asOf={day} />
        <KpiTile label="Outstanding" value={money(totals.outstanding)} definition="Billed and not received. Every one of these is a follow-up call or a corporate settlement." asOf={day} footnote={`Payer ${money(totals.payerShare)}`} />
        <KpiTile label="Pre-authorisation pending" value={String(totals.preAuthPending)} definition={`Insurance or scheme bills above ${money(PRE_AUTH_THRESHOLD)} that need a number before the invoice is issued.`} asOf={day} />
        <KpiTile label="Cancelled" value={String(totals.cancelled)} definition="Cancelled rather than deleted: the service was ordered, then cancelled, by somebody, for a reason." asOf={day} footnote={`Cross-match fee ${money(CROSS_MATCH_FEE)} is separate`} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'bill', label: 'Bill a module', count: chosen.length || undefined },
          { id: 'bills', label: 'Today’s bills', count: bills.length },
          { id: 'modules', label: 'All modules' },
          { id: 'rules', label: 'When each module charges' },
        ]}
      />

      {tab === 'bill' && (
        <div className="grid gap-3 xl:grid-cols-[1fr_24rem]">
          <div className="space-y-3">
            <Panel
              title={`${module} worklist — ${items.length} item(s)`}
              actions={
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setSelected(items.filter((i) => i.ready).map((i) => i.id))}>Select everything ready</Button>
                  <Button variant="ghost" onClick={() => setSelected([])}>Clear</Button>
                </div>
              }
            >
              <Segmented
                name="bill-module"
                label="Service line"
                value={module}
                onChange={(m) => { setModule(m as BillModule); setSelected([]); setDiscounts({}); }}
                options={BILL_MODULES.map((m) => ({ value: m, label: m }))}
              />
              <p className="mt-2 text-xs text-text-secondary">{moduleRule.chargedWhen}</p>
              <p className="mt-1 text-xs text-text-secondary"><span className="font-medium text-text-primary">Owed by:</span> {moduleRule.owedBy}</p>

              {items.length === 0 ? (
                <EmptyState title={`Nothing in ${module} to bill`} description="The worklist is the module’s own: a pathology bill comes from a collected sample, a blood bill from a unit that left the fridge. If the module has done nothing, there is nothing to charge for." />
              ) : (
                <ListView
                  id={`module-${module}`}
                  caption={`${module} billable items`}
                  height="30rem"
                  rows={items}
                  rowId={(i) => i.id}
                  onRowClick={(i) => toggle(i.id)}
                  columns={[
                    { key: 'pick', header: '', width: '44px', render: (i) => (
                      <input
                        type="checkbox"
                        checked={selected.includes(i.id)}
                        onChange={() => toggle(i.id)}
                        aria-label={`Select ${i.description} for ${i.patientName}`}
                        onClick={(e) => e.stopPropagation()}
                        className="size-4"
                      />
                    ) },
                    { key: 'at', header: 'At', width: '90px', render: (i) => i.at.slice(11, 16) },
                    { key: 'description', header: 'Service', render: (i) => (
                      <span>
                        <span className="font-medium text-text-primary">{i.description}</span>
                        <span className="ml-2 text-xs text-text-tertiary">{i.code} · {i.sourceRef}</span>
                        {i.note && <span className="block text-xs text-text-tertiary">{i.note}</span>}
                      </span>
                    ) },
                    { key: 'patient', header: 'Patient', hideBelow: 'md', render: (i) => (
                      <span>
                        {i.patientName}
                        <span className="ml-1 text-xs text-text-tertiary">{i.mrn}</span>
                        <span className="block text-xs text-text-tertiary">{i.where}</span>
                      </span>
                    ) },
                    { key: 'billedTo', header: 'Owed by', hideBelow: 'lg', width: '150px', render: (i) => (
                      <span className={cx(i.billedTo === 'Patient' ? TONE_TEXT.info : TONE_TEXT.neutral)}>{i.billedTo ?? '—'}</span>
                    ) },
                    { key: 'ready', header: 'Status', width: '140px', render: (i) => (
                      i.ready
                        ? <span className={cx(TONE_TEXT.success)}>performed — billable</span>
                        : <span className={cx(TONE_TEXT.warning)}>not yet performed</span>
                    ) },
                    { key: 'qty', header: 'Qty', numeric: true, align: 'right', width: '70px' },
                    { key: 'unitPrice', header: 'Unit', numeric: true, align: 'right', width: '110px', render: (i) => money(i.unitPrice) },
                    { key: 'amount', header: 'Amount', numeric: true, align: 'right', width: '120px', render: (i) => money(i.qty * i.unitPrice) },
                  ]}
                />
              )}
            </Panel>

            {drafts.length > 0 && (
              <Panel title={`Lines on this bill — ${drafts.length}`} actions={<span className="text-xs text-text-secondary">A discount needs a reason before the invoice may be issued</span>}>
                <ul className="space-y-2">
                  {drafts.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-text-primary">{d.description}</span>
                        <span className="ml-2 text-xs text-text-tertiary">{d.qty} × {money(d.unitPrice)} · {d.mrn}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-text-secondary">
                          Discount %
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={d.discountPct}
                            onChange={(e) => setDiscounts((s) => ({ ...s, [d.id]: { pct: Math.max(0, Math.min(100, Number(e.target.value))), reason: s[d.id]?.reason ?? '' } }))}
                            className="ml-1 h-8 w-16 rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                          />
                        </label>
                        <label className="text-xs text-text-secondary">
                          Reason
                          <input
                            value={d.discountReason ?? ''}
                            onChange={(e) => setDiscounts((s) => ({ ...s, [d.id]: { pct: s[d.id]?.pct ?? 0, reason: e.target.value } }))}
                            placeholder="Why this line is reduced"
                            className="ml-1 h-8 w-56 rounded-md border border-border-default bg-surface-default px-2 text-sm"
                          />
                        </label>
                        <span className="tabular-nums text-text-secondary">{money(d.qty * d.unitPrice - Math.round((d.qty * d.unitPrice * d.discountPct) / 100))}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <div className="space-y-3">
            <Panel title="Who is paying, and on what authority">
              <div className="space-y-2">
                <label className="block text-xs text-text-secondary">
                  Payer
                  <select value={payer} onChange={(e) => setPayer(e.target.value as Payer)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                    {PAYERS.map((p) => <option key={p} value={p}>{p} ({Math.round(payerCoverage[p] * 100)} % of the marked lines)</option>)}
                  </select>
                </label>

                {(payer === 'Insurance — MetLife' || payer === 'Govt. scheme') && (
                  <label className="block text-xs text-text-secondary">
                    Pre-authorisation number{checks.preAuthRequired ? ' — required above ' + money(PRE_AUTH_THRESHOLD) : ''}
                    <input
                      value={preAuth}
                      onChange={(e) => setPreAuth(e.target.value)}
                      placeholder="PA-2026-…"
                      className={cx('mt-1 h-9 w-full rounded-md border bg-surface-default px-2 text-sm', checks.preAuthRequired && !preAuth ? 'border-safety-critical' : 'border-border-default')}
                    />
                  </label>
                )}

                {payer === 'Corporate — BRAC' && (
                  <label className="block text-xs text-text-secondary">
                    Company credit left on this case
                    <input
                      type="number"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(Number(e.target.value))}
                      className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                    />
                  </label>
                )}

                <label className="block text-xs text-text-secondary">
                  Deposit already with the hospital ({DEPOSIT_DAYS} day(s) of bed charge is asked for at admission)
                  <input
                    type="number"
                    value={depositPaid}
                    onChange={(e) => setDepositPaid(Number(e.target.value))}
                    className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                  />
                </label>

                <label className="flex items-start gap-2 text-xs text-text-secondary">
                  <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} className="mt-0.5 size-4" />
                  <span>
                    <span className="font-medium text-text-primary">Emergency override</span> — the service happened before the bill, because the
                    alternative was a patient not getting it. The name below goes on the line.
                  </span>
                </label>
                {emergency && (
                  <input
                    value={authorisedBy}
                    onChange={(e) => setAuthorisedBy(e.target.value)}
                    placeholder="Clinician who authorised the service"
                    className="h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
                  />
                )}
              </div>
            </Panel>

            <Panel title="This bill">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-text-secondary">Lines</dt><dd className="tabular-nums">{drafts.length}</dd></div>
                <div className="flex justify-between"><dt className="text-text-secondary">Gross</dt><dd className="tabular-nums">{money(billTotal.gross)}</dd></div>
                <div className="flex justify-between"><dt className="text-text-secondary">Discount</dt><dd className="tabular-nums">− {money(billTotal.discount)}</dd></div>
                <div className="flex justify-between border-t border-border-subtle pt-1 font-medium"><dt>Net</dt><dd className="tabular-nums">{money(billTotal.net)}</dd></div>
                <div className="flex justify-between"><dt className="text-text-secondary">Payer share</dt><dd className="tabular-nums">{money(billTotal.payerShare)}</dd></div>
                <div className="flex justify-between"><dt className="text-text-secondary">Patient share</dt><dd className="tabular-nums">{money(billTotal.patientShare)}</dd></div>
                {billTotal.crossMatch > 0 && (
                  <div className="flex justify-between"><dt className="text-text-secondary">Cross-match fees on the request</dt><dd className="tabular-nums">{money(billTotal.crossMatch)}</dd></div>
                )}
              </dl>

              {checks.blockers.length > 0 && (
                <div className="mt-2 rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2 text-xs">
                  {checks.blockers.map((b) => <p key={b} className={cx(TONE_TEXT.critical)}>{b}</p>)}
                </div>
              )}
              {checks.warnings.length > 0 && (
                <div className="mt-2 rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2 text-xs">
                  {checks.warnings.map((w) => <p key={w} className={cx(TONE_TEXT.warning)}>{w}</p>)}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => issue(true)} disabled={checks.blockers.length > 0}>
                  <BadgeCheck className="size-4" aria-hidden /> Issue and collect {money(billTotal.patientShare)}
                </Button>
                <Button variant="ghost" onClick={() => issue(false)} disabled={checks.blockers.length > 0}>
                  <Receipt className="size-4" aria-hidden /> Issue, collect later
                </Button>
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                {checks.preAuthRequired
                  ? 'This invoice carries a pre-authorisation number on the line: an unauthorised treatment the insurer later declines is a bill the patient never agreed to.'
                  : 'The invoice number is issued once by the server, so the same bill can never be raised twice.'}
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'bills' && (
        <Panel title="Module bills today" actions={<span className="text-xs text-text-secondary">Cancelled stays visible; collected stays traceable to a method</span>}>
          <ListView
            id="module-bills"
            caption="Module bills issued today"
            height="30rem"
            rows={bills}
            rowId={(b) => b.id}
            onRowClick={(b) => { setOpenBillId(b.id); setCollectAmount(0); }}
            columns={[
              { key: 'invoiceNo', header: 'Invoice', width: '150px' },
              { key: 'module', header: 'Module', width: '140px' },
              { key: 'patientName', header: 'Patient', render: (b) => (
                <span>
                  {b.patientName}
                  <span className="ml-2 text-xs text-text-tertiary">{b.mrn}</span>
                </span>
              ) },
              { key: 'payer', header: 'Payer', hideBelow: 'lg', width: '170px' },
              { key: 'lines', header: 'Lines', numeric: true, align: 'right', width: '80px' },
              { key: 'net', header: 'Net', numeric: true, align: 'right', width: '120px', render: (b) => money(b.net) },
              { key: 'payerShare', header: 'Payer', numeric: true, align: 'right', hideBelow: 'md', width: '110px', render: (b) => money(b.payerShare) },
              { key: 'collected', header: 'Collected', numeric: true, align: 'right', width: '120px', render: (b) => (
                <span className={cx(b.collected >= b.net ? TONE_TEXT.success : b.collected > 0 ? TONE_TEXT.warning : TONE_TEXT.critical)}>{money(b.collected)}</span>
              ) },
              { key: 'state', header: 'State', width: '170px', render: (b) => (
                <span className={cx('rounded-full px-2 py-0.5 text-xs', STATE_CHIP[b.state])}>{b.state}</span>
              ) },
            ]}
          />
        </Panel>
      )}

      {tab === 'modules' && (
        <div className="space-y-3">
          <Panel title="What each module has produced, and what has been billed">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Chargeable value and billed value by module</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Module</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Items</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Ready to bill</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Chargeable value</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Billed</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Not yet billed</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.map((d) => {
                    const unbilled = Math.max(0, d.value - d.billed);
                    return (
                      <tr key={d.module} className="border-b border-border-subtle last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-text-primary">{d.module}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{d.items.length}</td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {d.ready} ready{d.notReady > 0 ? ` · ${d.notReady} waiting on the service` : ''}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(d.value)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(d.billed)}</td>
                        <td className={cx('py-1.5 text-right tabular-nums', unbilled > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(unbilled)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-default font-medium">
                    <td className="py-1.5 pr-3" colSpan={3}>All modules</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(totals.value)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(totals.billed)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(Math.max(0, totals.value - totals.billed))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">
              A gap between the two columns is not always a leak: a test ordered but not collected is not billable, and a unit issued but not yet
              transfused is billable at issue. The unit test is whether the module has done the thing it charges for.
            </p>
          </Panel>

          <Panel title="Where the money is not yet on a bill">
            <ul className="space-y-1 text-sm">
              {dashboard
                .map((d) => ({ module: d.module, unbilled: Math.max(0, d.value - d.billed), notReady: d.notReady }))
                .sort((a, b) => b.unbilled - a.unbilled)
                .slice(0, 6)
                .map((r) => (
                  <li key={r.module} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-2">
                    <span>
                      <span className="font-medium text-text-primary">{r.module}</span>
                      <span className="ml-2 text-xs text-text-tertiary">
                        {r.notReady > 0 ? `${r.notReady} item(s) waiting on the service itself` : 'all items performed'}
                      </span>
                    </span>
                    <span className={cx('tabular-nums', r.unbilled > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(r.unbilled)} unbilled</span>
                  </li>
                ))}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="When each module charges, and who owes it">
            <div className="space-y-3">
              {MODULE_RULES.map((r) => (
                <div key={r.module} className="rounded-md border border-border-subtle px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    <ShieldAlert className="size-4 text-brand-600" aria-hidden />
                    {r.module}
                    <span className="text-xs font-normal text-text-tertiary">{r.legacy}</span>
                  </p>
                  <p className="mt-1 text-sm text-text-secondary"><span className="font-medium text-text-primary">Charged when:</span> {r.chargedWhen}</p>
                  <p className="text-sm text-text-secondary"><span className="font-medium text-text-primary">Owed by:</span> {r.owedBy}</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-text-secondary">
                    {r.exceptions.map((e) => <li key={e}>· {e}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Credit, deposits and authorisation">
            <ul className="space-y-2 text-sm">
              {CREDIT_RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Related screens">
            <p className="text-sm text-text-secondary">
              The ledger and the day-end sheet live on <Link href="/billing" className="underline">billing</Link>; the OPD counter and the patient’s own
              account on <Link href="/billing/opd" className="underline">the OPD bill screen</Link> and{' '}
              <Link href="/billing/opd-patient" className="underline">the OPD patient view</Link>; the prices come from{' '}
              <Link href="/setup" className="underline">Setup › Hospital charges and Blood Bank</Link>; and the worklists come from{' '}
              <Link href="/diagnostics" className="underline">diagnostics</Link>, <Link href="/bloodbank" className="underline">the blood bank</Link>,{' '}
              <Link href="/pharmacy" className="underline">the pharmacy</Link>, <Link href="/ward" className="underline">the ward board</Link> and{' '}
              <Link href="/ambulance" className="underline">ambulance dispatch</Link>.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- bill sheet */}
      <Sheet
        open={Boolean(openBill)}
        onClose={() => setOpenBillId(null)}
        title={openBill ? `${openBill.invoiceNo} — ${openBill.patientName}` : 'Bill'}
        description={openBill ? `${openBill.module} · raised by ${openBill.raisedBy} · ${openBill.at.slice(11)} · payer ${openBill.payer}` : undefined}
        footer={
          openBill && (
            <div className="flex flex-wrap items-end justify-end gap-2">
              <label className="text-xs text-text-secondary">
                Collect
                <input
                  type="number"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(Number(e.target.value))}
                  className="ml-1 h-9 w-28 rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                />
              </label>
              <label className="text-xs text-text-secondary">
                Method
                <select value={collectMethod} onChange={(e) => setCollectMethod(e.target.value as PaymentMethod)} className="ml-1 h-9 rounded-md border border-border-default bg-surface-default px-2 text-sm">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <Button onClick={collectOn} disabled={openBill.state === 'Cancelled'}><Receipt className="size-4" aria-hidden /> Take the money</Button>
            </div>
          )
        }
      >
        {openBill && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-secondary">Lines</dt><dd className="font-medium tabular-nums">{openBill.lines}</dd></div>
              <div><dt className="text-xs text-text-secondary">Net</dt><dd className="font-medium tabular-nums">{money(openBill.net)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Payer share</dt><dd className="font-medium tabular-nums">{money(openBill.payerShare)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Patient share</dt><dd className="font-medium tabular-nums">{money(openBill.patientShare)}</dd></div>
            </dl>

            <p className={cx('rounded-md border px-3 py-2', openBill.state === 'Cancelled' ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-border-subtle')}>
              {openBill.state === 'Cancelled'
                ? `Cancelled: ${openBill.cancelledBecause ?? 'reason on the record'}. ${openBill.collected > 0 ? `${money(openBill.collected)} is refunded by the method it came in.` : 'No money had been taken.'}`
                : `${money(openBill.collected)} of ${money(openBill.net)} collected. ${openBill.patientShare > 0 ? `The patient’s share is ${money(openBill.patientShare)}.` : 'This bill is entirely on the payer.'}`}
            </p>

            {openBill.state !== 'Cancelled' && (
              <div>
                <label className="block text-xs text-text-secondary">
                  Cancel the bill — reason (kept on the record, never deleted)
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                </label>
                <Button variant="ghost" className="mt-2" onClick={() => cancelBill(openBill)}>Cancel the bill and refund what was taken</Button>
              </div>
            )}

            <p className="text-xs text-text-tertiary">
              The worklist this bill came off is on <Link href={`/billing/modules`} className="underline">single-module billing</Link>; the ledger and
              day-end reconciliation on <Link href="/billing" className="underline">billing</Link>.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
