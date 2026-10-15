'use client';

import { useMemo, useState } from 'react';
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
import { Printer, Receipt } from 'lucide-react';
import {
  DISCOUNT_LIMIT_PCT,
  PAYMENT_METHODS,
  TARIFF,
  dayEnd,
  generateInvoices,
  invoiceTone,
  lineDiscount,
  lineGross,
  lineNet,
  money,
  nextStatus,
  paymentTone,
  receiptNo,
  totals,
  type Invoice,
  type PaymentMethod,
  type TariffItem,
} from '@/lib/billing';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Billing (legacy screens 030/031 replaced) — the P2 module.
 *
 * The billing counter is where a hospital's offline story is either believable or not: an invoice is built from
 * what the doctor ordered, a receipt printed with the uplink down is still money, and the day-end sheet has to
 * agree with the drawer. So: nothing is deleted (a wrong invoice is cancelled with a reason and a replacement),
 * a discount above the limit carries the approver's name, and the receipt numbers come from the branch block.
 */

const INPUT = 'h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm';
const LABEL = 'text-xs text-text-secondary';

export default function BillingPage() {
  const { sync, role } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [invoices, setInvoices] = useState<Invoice[]>(() => generateInvoices(day));
  const [open, setOpen] = useState<Invoice | null>(null);
  const [tab, setTab] = useState('invoices');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [reference, setReference] = useState('');
  const [counted, setCounted] = useState('');

  const summary = useMemo(() => dayEnd(invoices), [invoices]);
  const live = invoices.filter((i) => i.status !== 'Cancelled');
  const needsApproval = live.filter((i) => i.lines.some((l) => l.discountPct > DISCOUNT_LIMIT_PCT) && !i.approvedBy);
  const openTotals = open ? totals(open) : null;
  const opened = open ? invoices.find((i) => i.id === open.id) ?? open : null;

  const patch = (id: string, updater: (i: Invoice) => Invoice) =>
    setInvoices((list) => list.map((i) => (i.id === id ? updater(i) : i)));

  const isSupervisor = role === 'admin' || role === 'billing';
  const variance = counted.trim() === '' ? null : Number(counted) - summary.cashExpected;

  /* ------------------------------------------------------------------------------- the list */
  const columns: Array<Column<Invoice>> = [
    { key: 'number', header: 'Invoice', width: '11rem', render: (i) => <span className="font-numeric text-xs">{i.number}</span> },
    {
      key: 'patientName',
      header: 'Patient',
      render: (i) => (
        <span className="flex flex-col">
          <span className="font-medium">{i.patientName}</span>
          <span className="font-numeric text-xs text-text-tertiary">{i.mrn}</span>
        </span>
      ),
    },
    { key: 'payer', header: 'Payer', hideBelow: 'lg' },
    { key: 'counter', header: 'Counter', hideBelow: 'xl' },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      numeric: true,
      render: (i) => money(totals(i).net),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      numeric: true,
      render: (i) => money(totals(i).paid),
    },
    {
      key: 'due',
      header: 'Due',
      align: 'right',
      numeric: true,
      render: (i) => {
        const due = totals(i).due;
        return <span className={due > 0 ? 'text-safety-warning' : ''}>{money(due)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => (
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-xs',
            invoiceTone[i.status] === 'success'
              ? 'bg-safety-success/10 text-safety-success'
              : invoiceTone[i.status] === 'warning'
                ? 'bg-safety-warning/10 text-safety-warning'
                : invoiceTone[i.status] === 'critical'
                  ? 'bg-safety-critical/10 text-safety-critical'
                  : 'bg-surface-sunken text-text-secondary',
          )}
        >
          {i.status}
        </span>
      ),
    },
    {
      key: 'approvedBy',
      header: 'Discount approved by',
      hideBelow: 'xl',
      render: (i) => (i.lines.some((l) => l.discountPct > 0) ? i.approvedBy ?? <span className="text-safety-warning">not yet</span> : '—'),
    },
  ];

  const rowActions = (i: Invoice): RowAction<Invoice>[] => [
    { label: 'Open the invoice', onSelect: (row) => setOpen(row) },
    {
      label: 'Take full payment',
      onSelect: (row) => {
        if (row.status === 'Cancelled') {
          push({ title: 'This invoice is cancelled', description: `Replaced by ${row.replacedBy ?? 'a new invoice'}`, tone: 'warning' });
          return;
        }
        const t = totals(row);
        if (t.due <= 0) {
          push({ title: 'Nothing to collect', description: 'This invoice is settled', tone: 'info' });
          return;
        }
        const seq = row.payments.length + 1;
        patch(row.id, (inv) => {
          const withPayment = {
            ...inv,
            payments: [
              ...inv.payments,
              {
                id: `${inv.id}-P${seq}`,
                at: `${day} ${new Date().toTimeString().slice(0, 5)}`,
                method: paymentMethod,
                amount: t.due,
                reference: reference || (paymentMethod === 'Cash' ? undefined : `TRX${Math.floor(100000 + Math.random() * 899999)}`),
                receivedBy: 'Billing counter',
              },
            ],
          };
          return { ...withPayment, status: nextStatus(withPayment) };
        });
        push({
          title: `${money(t.due)} received`,
          description:
            sync === 'live'
              ? `${paymentMethod} · receipt ${receiptNo(day, seq)}`
              : `Queued on this device · receipt ${receiptNo(day, seq)} prints now, reconciles later`,
          tone: sync === 'live' ? 'success' : 'warning',
          action: { label: 'Print receipt', onSelect: () => window.open(`/print/receipt?inv=${row.id}`, '_blank', 'noopener') },
        });
      },
    },
    { label: 'Print receipt (80 mm)', onSelect: (row) => window.open(`/print/receipt?inv=${row.id}`, '_blank', 'noopener') },
    { label: 'Print A4 invoice', onSelect: (row) => window.open(`/print/invoice?inv=${row.id}`, '_blank', 'noopener') },
    {
      label: 'Cancel this invoice',
      danger: true,
      separated: true,
      hint: 'A reason is required and the number stays in the series',
      onSelect: (row) => {
        if (row.status === 'Cancelled') return;
        patch(row.id, (inv) => ({ ...inv, status: 'Cancelled', cancelledReason: 'Cancelled at the counter — reason required' }));
        push({ title: `${row.number} cancelled`, description: 'The number is not reused; issue a replacement instead', tone: 'warning' });
      },
    },
  ];

  const invoicesTab = (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        Built from what the doctor ordered — consultation, investigations, pharmacy lines. Cancel with a reason
        rather than deleting, so the receipt series has no holes.
      </p>
      <DataGrid<Invoice>
        id="billing-invoices"
        caption="Invoices"
        columns={columns}
        rows={invoices}
        total={invoices.length}
        page={1}
        pageSize={25}
        rowId={(i) => i.id}
        height="30rem"
        quickSearch={{ value: '', onChange: () => undefined, placeholder: 'Invoice number, patient or MRN…' }}
        rowActions={rowActions}
        onRowClick={(row) => setOpen(row)}
        exportFileName="invoices"
        printMeta={`Invoices as of ${new Date().toLocaleString()} · counters: all`}
        emptyLabel="No invoices yet today."
      />
    </div>
  );

  /* ------------------------------------------------------------------------------- day end */
  const dayEndTab = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <p className="text-sm text-text-secondary">
          The sheet the counter signs at the end of the shift: what was collected, by which method and category, and
          what should be in the drawer.
        </p>
        <Button className="ml-auto gap-1.5" onClick={() => window.print()}>
          <Printer className="size-3.5" aria-hidden />
          Print day-end sheet
        </Button>
      </div>

      <Panel title={`Collections — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Invoices', value: String(summary.invoices) },
            { label: 'Billed (net)', value: money(summary.net) },
            { label: 'Collected', value: money(summary.collected) },
            { label: 'Outstanding', value: money(summary.due) },
          ].map((k) => (
            <div key={k.label} className="rounded-md border border-border-subtle p-3">
              <p className="text-xs text-text-secondary">{k.label}</p>
              <p className="font-numeric text-lg">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">By method</h3>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {summary.byMethod.map((m) => (
                  <tr key={m.method} className="border-b border-border-subtle last:border-0">
                    <td className="py-1">{m.method}</td>
                    <td className="py-1 text-right text-text-secondary">{m.count} receipt(s)</td>
                    <td className="font-numeric py-1 text-right">{money(m.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1">Total</td>
                  <td />
                  <td className="font-numeric py-1 text-right">{money(summary.collected)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold">By category</h3>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {summary.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-border-subtle last:border-0">
                    <td className="py-1">{c.category}</td>
                    <td className="font-numeric py-1 text-right">{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border-subtle pt-4 md:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold">Counter handover</h3>
            <ul className="mt-1 text-sm text-text-secondary">
              {summary.byCounter.map((c) => (
                <li key={c.counter} className="flex justify-between gap-3">
                  <span>{c.counter}</span>
                  <span className="font-numeric">{money(c.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Payer split</h3>
            <p className="mt-1 text-sm text-text-secondary">
              Patient {money(summary.patientShare)} · payer {money(summary.payerShare)}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Corporate and insurance lines are invoiced to the payer; the patient pays the consultation.
            </p>
          </div>
          <div className="no-print">
            <h3 className="text-sm font-semibold">Cash drawer</h3>
            <label className="mt-1 flex flex-col gap-1">
              <span className={LABEL}>Counted cash</span>
              <input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} className={INPUT} placeholder={String(summary.cashExpected)} />
            </label>
            <p className="mt-1 text-sm">
              Expected <span className="font-numeric">{money(summary.cashExpected)}</span>
              {variance !== null && (
                <>
                  {' '}· variance{' '}
                  <span className={cx('font-numeric', variance === 0 ? 'text-safety-success' : 'text-safety-critical')}>
                    {variance > 0 ? '+' : ''}{money(variance)}
                  </span>
                </>
              )}
            </p>
            {variance !== null && variance !== 0 && (
              <p className="mt-1 text-xs text-safety-critical">
                A variance is recorded with a reason and the name of the person counting — it is never quietly
                adjusted, because that is how a small difference becomes a habit.
              </p>
            )}
          </div>
        </div>
      </Panel>

      <SafetyBanner severity={sync === 'live' ? 'info' : 'warning'} title={sync === 'live' ? 'Reconciled with the accounting office' : 'Offline collections are queued'}>
        {sync === 'live'
          ? 'Receipts, refunds and cancellations are pushed to the accounting office nightly, and the reconciliation harness compares both systems (P0-406).'
          : 'Receipts printed now are numbered from this branch’s block and queued. They are money, not drafts: the accounting office reconciles the queue when the link returns, and the numbers are never reissued.'}
      </SafetyBanner>
    </div>
  );

  /* ------------------------------------------------------------------------------- tariff */
  const tariffColumns: Array<Column<TariffItem>> = [
    { key: 'code', header: 'Code', width: '9rem', render: (t) => <span className="font-numeric text-xs">{t.code}</span> },
    { key: 'name', header: 'Service' },
    { key: 'category', header: 'Category' },
    { key: 'price', header: 'Price', align: 'right', numeric: true, render: (t) => money(t.price) },
  ];

  const tariffTab = (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        One price list for the branch, used by the consultation, the laboratory, the pharmacy and this counter — so
        the patient sees the same number wherever they stand. A price change is an approved, dated event, not an
        edit, and the old price stays on the invoices that used it.
      </p>
      <DataGrid<TariffItem>
        id="billing-tariff"
        caption="Tariff"
        columns={tariffColumns}
        rows={TARIFF}
        total={TARIFF.length}
        page={1}
        pageSize={50}
        rowId={(t) => t.code}
        height="26rem"
        exportFileName="tariff"
        printMeta="Tariff · pilot branch · all prices in BDT"
        emptyLabel="No tariff items."
      />
    </div>
  );

  /* ------------------------------------------------------------------------------- approvals */
  const approvalsTab = (
    <div className="flex flex-col gap-2">
      <SafetyBanner severity={needsApproval.length > 0 ? 'warning' : 'info'} title={`${needsApproval.length} discount(s) above the ${DISCOUNT_LIMIT_PCT} % limit without a name`}>
        Below {DISCOUNT_LIMIT_PCT} % any clerk may discount. Above it, the approver is recorded — not to slow the
        counter down, but because “why is this patient paying less” is the question the accounts office asks.
      </SafetyBanner>
      {needsApproval.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-sm text-text-tertiary">
          Nothing waiting for approval.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {needsApproval.map((i) => {
            const worst = Math.max(...i.lines.map((l) => l.discountPct));
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="font-numeric text-xs text-text-tertiary">{i.number}</span>
                <span className="text-sm font-medium">{i.patientName}</span>
                <span className="font-numeric text-xs">{i.mrn}</span>
                <span className="rounded-full border border-safety-warning px-1.5 text-[11px] text-safety-warning">{worst} % discount</span>
                <span className="text-xs text-text-secondary">
                  {money(i.lines.reduce((s, l) => s + lineDiscount(l), 0))} off {money(i.lines.reduce((s, l) => s + lineGross(l), 0))}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!isSupervisor}
                    onClick={() => {
                      patch(i.id, (inv) => ({ ...inv, approvedBy: 'S. Ahmed (accounts supervisor)' }));
                      push({ title: 'Discount approved', description: `${i.number} · ${worst} % · your name is on the record`, tone: 'success' });
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      patch(i.id, (inv) => ({
                        ...inv,
                        lines: inv.lines.map((l) => (l.discountPct > DISCOUNT_LIMIT_PCT ? { ...l, discountPct: DISCOUNT_LIMIT_PCT, discountReason: 'Reduced to the limit pending approval' } : l)),
                      }));
                      push({ title: 'Discount reduced to the limit', description: 'The invoice now needs no approval', tone: 'warning' });
                    }}
                  >
                    Bring it to the limit
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!isSupervisor && (
        <p className="text-xs text-text-tertiary">
          Your current role cannot approve a discount above the limit — the button is disabled rather than hidden, so
          you know who to ask.
        </p>
      )}
    </div>
  );

  /* ------------------------------------------------------------------------------- the sheet */
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-text-secondary">
            {summary.invoices} invoices · collected <span className="font-numeric">{money(summary.collected)}</span> · outstanding{' '}
            <span className="font-numeric">{money(summary.due)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients">
            <Button variant="ghost">Register a patient</Button>
          </Link>
          <Button
            variant="primary"
            className="gap-1.5"
            onClick={() => push({ title: 'Walk-in invoice', description: 'Starts empty — services are added from the tariff', tone: 'info' })}
          >
            <Receipt className="size-3.5" aria-hidden />
            New invoice
          </Button>
        </div>
      </div>

      <SafetyBanner severity="info" title="P2 module — preview screens, synthetic money">
        The rules here are the ones the billing service will enforce: invoices built from orders, cancellations
        instead of deletions, a named approver above the discount limit, and receipts numbered from the branch
        block. No real money moves through this screen.
      </SafetyBanner>

      <Tabs
        items={[
          { id: 'invoices', label: 'Invoices', count: live.length },
          { id: 'dayend', label: 'Day end' },
          { id: 'approvals', label: 'Discount approvals', count: needsApproval.length },
          { id: 'tariff', label: 'Tariff', count: TARIFF.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'invoices' && invoicesTab}
        {tab === 'dayend' && dayEndTab}
        {tab === 'approvals' && approvalsTab}
        {tab === 'tariff' && tariffTab}
      </Tabs>

      <Sheet
        open={opened !== null}
        onClose={() => setOpen(null)}
        title={opened ? `${opened.number} · ${opened.patientName}` : ''}
        description={opened ? `${opened.mrn} · ${opened.age} ${opened.sex} · ${opened.payer} · ${opened.counter}` : ''}
        width="xl"
        footer={
          opened && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" className="gap-1.5" onClick={() => window.open(`/print/receipt?inv=${opened.id}`, '_blank', 'noopener')}>
                <Printer className="size-3.5" aria-hidden />
                Receipt (80 mm)
              </Button>
              <Button className="gap-1.5" onClick={() => window.open(`/print/invoice?inv=${opened.id}`, '_blank', 'noopener')}>
                <Printer className="size-3.5" aria-hidden />
                A4 invoice
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  patch(opened.id, (inv) => ({ ...inv, status: 'Cancelled', cancelledReason: 'Cancelled from the detail view' }));
                  push({ title: `${opened.number} cancelled`, description: 'A replacement invoice keeps the series clean', tone: 'warning' });
                  setOpen(null);
                }}
              >
                Cancel invoice
              </Button>
            </div>
          )
        }
      >
        {opened && openTotals && (
          <div className="flex flex-col gap-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                  <th className="py-1">Service</th>
                  <th className="py-1">Qty</th>
                  <th className="py-1 text-right">Price</th>
                  <th className="py-1 text-right">Discount</th>
                  <th className="py-1 text-right">Net</th>
                  <th className="py-1">Charged to</th>
                </tr>
              </thead>
              <tbody>
                {opened.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border-subtle last:border-0">
                    <td className="py-1">
                      <span className="font-numeric text-xs text-text-tertiary">{l.code}</span> {l.name}
                      {l.discountReason && <span className="block text-[11px] text-text-tertiary">{l.discountReason}</span>}
                    </td>
                    <td className="py-1">{l.qty}</td>
                    <td className="font-numeric py-1 text-right">{money(lineGross(l))}</td>
                    <td className="py-1 text-right">
                      {opened.status === 'Cancelled' ? (
                        <span className="font-numeric">{l.discountPct} %</span>
                      ) : (
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={l.discountPct}
                            aria-label={`Discount percent for ${l.name}`}
                            onChange={(e) => {
                              const pct = Number(e.target.value);
                              if (pct > DISCOUNT_LIMIT_PCT && !isSupervisor) {
                                push({ title: `Above ${DISCOUNT_LIMIT_PCT} % needs a supervisor`, description: 'The value is kept but flagged for approval', tone: 'warning' });
                              }
                              patch(opened.id, (inv) => ({
                                ...inv,
                                lines: inv.lines.map((x) => (x.id === l.id ? { ...x, discountPct: pct, discountReason: pct > 0 ? x.discountReason ?? 'Counter discount' : undefined } : x)),
                              }));
                            }}
                            className="h-7 w-16 rounded-sm border border-border-default bg-surface-default px-1 text-right text-xs"
                          />
                          <span className="text-xs text-text-tertiary">%</span>
                        </label>
                      )}
                    </td>
                    <td className="font-numeric py-1 text-right">{money(lineNet(l))}</td>
                    <td className="py-1 text-xs">{l.chargedTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border-subtle p-3 text-sm">
                <p className="flex justify-between"><span className="text-text-secondary">Gross</span><span className="font-numeric">{money(openTotals.gross)}</span></p>
                <p className="flex justify-between"><span className="text-text-secondary">Discount</span><span className="font-numeric">-{money(openTotals.discount)}</span></p>
                <p className="flex justify-between font-semibold"><span>Net</span><span className="font-numeric">{money(openTotals.net)}</span></p>
                <p className="mt-1 flex justify-between text-xs text-text-secondary"><span>Payer share</span><span className="font-numeric">{money(openTotals.payerShare)}</span></p>
                <p className="flex justify-between text-xs text-text-secondary"><span>Patient share</span><span className="font-numeric">{money(openTotals.patientShare)}</span></p>
              </div>

              <div className="rounded-md border border-border-subtle p-3 text-sm">
                <p className="flex justify-between"><span className="text-text-secondary">Paid</span><span className="font-numeric">{money(openTotals.paid)}</span></p>
                <p className="flex justify-between font-semibold"><span>Due</span><span className={cx('font-numeric', openTotals.due > 0 && 'text-safety-warning')}>{money(openTotals.due)}</span></p>
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {opened.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>
                        {p.at.slice(11)} · <span className={cx('rounded-full border px-1.5', paymentTone[p.method] === 'success' ? 'text-safety-success' : 'text-text-secondary')}>{p.method}</span>
                        {p.reference ? ` · ${p.reference}` : ''}
                      </span>
                      <span className="font-numeric">{money(p.amount)}</span>
                    </li>
                  ))}
                  {opened.payments.length === 0 && <li className="text-text-tertiary">No payment recorded yet</li>}
                </ul>
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
                <span className="text-sm font-semibold">Collect</span>
                <Segmented
                  name="pay-method"
                  label="Payment method"
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Amount</span>
                  <input
                    type="number"
                    value={paymentAmount === '' ? openTotals.due : paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className={INPUT}
                  />
                </label>
                {paymentMethod !== 'Cash' && (
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Reference (transaction id)</span>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} placeholder="TRX123456" />
                  </label>
                )}
                <Button
                  variant="primary"
                  onClick={() => {
                    const amount = paymentAmount === '' ? openTotals.due : Number(paymentAmount);
                    if (amount <= 0) {
                      push({ title: 'Enter an amount', tone: 'warning' });
                      return;
                    }
                    const seq = opened.payments.length + 1;
                    patch(opened.id, (inv) => {
                      const withPayment = {
                        ...inv,
                        payments: [
                          ...inv.payments,
                          {
                            id: `${inv.id}-P${seq}`,
                            at: `${day} ${new Date().toTimeString().slice(0, 5)}`,
                            method: paymentMethod,
                            amount,
                            reference: reference || undefined,
                            receivedBy: 'Billing counter',
                          },
                        ],
                      };
                      return { ...withPayment, status: nextStatus(withPayment) };
                    });
                    setPaymentAmount('');
                    setReference('');
                    push({
                      title: `${money(amount)} received`,
                      description: sync === 'live' ? `${paymentMethod} · receipt ${receiptNo(day, seq)}` : 'Queued for the accounts office; the receipt prints now',
                      tone: sync === 'live' ? 'success' : 'warning',
                    });
                  }}
                >
                  Record payment
                </Button>
                <Tooltip content="Printing a receipt for a queued payment is deliberate: the patient is standing there, and the number must come from this branch's block.">
                  <span className="text-xs text-text-tertiary">Receipts print offline by design.</span>
                </Tooltip>
              </div>
            </div>

            {opened.status === 'Cancelled' && (
              <SafetyBanner severity="warning" title="This invoice is cancelled">
                {opened.cancelledReason} {opened.replacedBy ? `Replacement: ${opened.replacedBy}.` : ''} The number is
                kept in the series so an auditor can see what happened.
              </SafetyBanner>
            )}
            {opened.lines.some((l) => l.discountPct > DISCOUNT_LIMIT_PCT) && (
              <SafetyBanner severity={opened.approvedBy ? 'info' : 'warning'} title={opened.approvedBy ? `Discount approved by ${opened.approvedBy}` : 'Discount above the limit — needs a name'}>
                {opened.approvedBy
                  ? 'The approval is part of the invoice, not a note in somebody’s diary.'
                  : 'Approve it from the Discount approvals tab, or bring it down to the limit.'}
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
