'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, Tabs, cx, useToast, type Column } from '@dizi/ui';
import { Banknote, FileX2, Receipt, Undo2 } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money, type PaymentMethod } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  INCOME_HEADS,
  generateIncomeVouchers,
  incomeHeadByCode,
  routeOfPayment,
  routeGroup,
  settlementNote,
  type IncomeVoucher,
} from '@/lib/finance';

/* Income vouchers (legacy `admin/income` — replaced) — the receipt side of the cash book.
 *
 * Three things this screen insists on: a receipt is chronologically numbered in one series, it posts to a head
 * (not to "misc"), and a mistake is reversed with a contra voucher that names the original and the person who
 * approved it rather than edited away. The reversal is the reason the entity is append-only in the contract.
 *
 * Preview: the vouchers are the billing module's own payments plus the pharmacy and ambulance counters. Nothing
 * survives a reload; the rules do.
 */

const COUNTER_METHODS: PaymentMethod[] = ['Cash', 'bKash', 'Nagad', 'Card'];
const REVERSAL_REASONS = ['Duplicate receipt', 'Wrong head', 'Wrong amount', 'Patient refunded', 'Corrected counter'];
const COUNTERS = ['Counter 1', 'Counter 2', 'Emergency desk', 'Pharmacy window 1', 'Ambulance desk'];

/** `YYYY-MM-DD HH:MM` — read when the write happens, never while rendering. */
const stampNow = (): string => {
  const now = new Date();
  return `${todayIso()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

export default function IncomeVouchersPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const generated = useMemo(() => generateIncomeVouchers(day), [day]);
  const [extra, setExtra] = useState<IncomeVoucher[]>([]);
  const [tab, setTab] = useState('book');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [headCode, setHeadCode] = useState(INCOME_HEADS[0].code);
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [counter, setCounter] = useState(COUNTERS[0]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [narration, setNarration] = useState('');
  const [reversing, setReversing] = useState<IncomeVoucher | null>(null);
  const [reversalReason, setReversalReason] = useState(REVERSAL_REASONS[0]);
  const [reversalApprover, setReversalApprover] = useState('Finance manager — S. Chowdhury');

  const vouchers = useMemo(() => [...generated, ...extra].sort((a, b) => (a.at < b.at ? -1 : 1)), [generated, extra]);
  const booked = vouchers.filter((v) => !v.queued);
  const queued = vouchers.filter((v) => v.queued);
  const cash = booked.filter((v) => v.route === 'Cash');
  const offInvoice = booked.filter((v) => !v.invoiceNo);

  const post = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      push({ title: 'A receipt is a positive amount.', description: 'Money going back is a reversal, not a negative receipt.', tone: 'critical' });
      return;
    }
    const head = incomeHeadByCode(headCode)!;
    const voucher: IncomeVoucher = {
      id: `${day}-MAN-${vouchers.length + 1}`,
      no: `RV-${day.replace(/-/g, '').slice(2)}-${String(900 + extra.length)}`,
      day,
      at: stampNow(),
      sequence: booked.length + extra.length + 1,
      headCode,
      amount: value,
      method,
      route: routeOfPayment(method),
      point: counter.startsWith('Pharmacy') ? 'Pharmacy counter' : counter === 'Ambulance desk' ? 'Ambulance desk' : 'Billing counter',
      counter,
      ...(invoiceNo.trim() ? { invoiceNo: invoiceNo.trim() } : {}),
      narration: narration.trim() || head.label,
      recordedBy: 'Reception — R. Akter',
      queued: true,
    };
    setExtra((rows) => [...rows, voucher]);
    const outcome = queueWrite(`Income voucher ${voucher.no}: ${money(value)} (${method})`, {
      id: 'createIncomeVoucher',
      recordId: voucher.id,
      fields: { headCode, amount: value, method, counter, at: voucher.at, ...(voucher.invoiceNo ? { invoiceNo: voucher.invoiceNo } : {}) },
    });
    setSheetOpen(false);
    setNarration('');
    setInvoiceNo('');
    push({
      title: outcome.queued ? `${voucher.no} posted on this device` : `${voucher.no} recorded, not posted`,
      description: outcome.queued
        ? `${money(value)} to ${head.label} at ${counter}. ${routeOfPayment(method) === 'Cash' ? 'This one is in the drawer tonight.' : 'This one settles through the bank.'}`
        : `The contract will not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  const reverse = () => {
    if (!reversing) return;
    const contra: IncomeVoucher = {
      id: `${day}-REV-${reversing.id}`,
      no: `RV-${day.replace(/-/g, '').slice(2)}-${String(950 + extra.length)}`,
      day,
      at: stampNow(),
      sequence: booked.length + extra.length + 1,
      headCode: reversing.headCode,
      amount: -reversing.amount,
      method: reversing.method,
      route: reversing.route,
      point: reversing.point,
      counter: reversing.counter,
      narration: `Reversal of ${reversing.no} — ${reversalReason.toLowerCase()}, approved by ${reversalApprover}`,
      recordedBy: 'Reception — R. Akter',
      queued: true,
    };
    setExtra((rows) => [...rows, contra]);
    const outcome = queueWrite(`Reversal of ${reversing.no}: ${money(reversing.amount)} back — ${reversalReason}`, {
      id: 'createIncomeVoucher',
      recordId: contra.id,
      fields: { headCode: contra.headCode, amount: contra.amount, method: contra.method, reversalOf: reversing.no, reason: reversalReason, approvedBy: reversalApprover, at: contra.at },
    });
    setReversing(null);
    push({
      title: outcome.queued ? `${contra.no} reverses ${reversing.no}` : `${contra.no} recorded, not posted`,
      description: outcome.queued
        ? `${money(reversing.amount)} goes back on the same head, on the same day, with the reason and the approver on the voucher. The original stays where it is — an auditor reads a reversal, not a deletion.`
        : `The contract will not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  const columns: Array<Column<IncomeVoucher>> = [
    { key: 'no', header: 'Voucher', width: '9rem', render: (v) => <span className="tabular-nums">{v.no}{v.queued && <span className="ml-1.5 rounded-full bg-safety-warning/10 px-1.5 text-xs text-safety-warning">queued</span>}</span> },
    { key: 'at', header: 'Time', width: '5rem', render: (v) => <span className="tabular-nums text-text-secondary">{v.at.slice(11, 16)}</span> },
    { key: 'head', header: 'Head', render: (v) => <span>{incomeHeadByCode(v.headCode)?.label ?? v.headCode}<span className="block text-xs text-text-tertiary">{v.headCode}</span></span> },
    { key: 'counter', header: 'Counter', render: (v) => <span>{v.counter}<span className="block text-xs text-text-tertiary">{v.point}</span></span> },
    { key: 'method', header: 'Method', width: '8rem', render: (v) => <span>{v.method}<span className="block text-xs text-text-tertiary">{v.route}</span></span> },
    { key: 'invoice', header: 'Invoice', width: '8rem', render: (v) => (v.invoiceNo ? <span className="tabular-nums">{v.invoiceNo}</span> : <span className="text-text-tertiary">not billed</span>) },
    { key: 'amount', header: 'Amount', align: 'right', width: '8rem', render: (v) => <span className={cx('tabular-nums font-medium', v.amount < 0 && 'text-safety-critical')}>{money(v.amount)}</span> },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Receipt className="size-5 text-brand-600" aria-hidden />
            Income vouchers
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — every receipt, numbered in one series, on the head it belongs to.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <Banknote className="size-4" aria-hidden /> Post a receipt
          </Button>
          <Link href="/finance">
            <Button variant="secondary" size="sm">Money today</Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Vouchers in the book" value={String(booked.length)} definition="Receipts the ledger has, in the order they were taken." asOf={day} />
        <KpiTile label="Cash receipts" value={money(cash.reduce((n, v) => n + v.amount, 0))} definition="The part of today that has to be countably correct at the end of the shift." asOf={day} />
        <KpiTile label="Not billed to anyone" value={money(offInvoice.reduce((n, v) => n + v.amount, 0))} definition="Counter takings with no invoice behind them — a certificate fee, a rent. Real money, no patient account." asOf={day} />
        <KpiTile label="Queued on this device" value={String(queued.length)} definition="Receipts taken here that the server has not seen: in the drawer, not yet in the book." asOf={day} footnote={queued.length ? money(queued.reduce((n, v) => n + v.amount, 0)) : undefined} />
        <KpiTile label="Reversals" value={String(booked.filter((v) => v.amount < 0).length)} definition="Contra vouchers against earlier receipts. Counted, not hidden: a reversal rate that climbs is a training problem." asOf={day} />
      </div>

      {queued.length > 0 && (
        <SafetyBanner severity="warning" title={`${queued.length} receipt${queued.length === 1 ? '' : 's'} queued and not in the book`}>
          <p>
            {queued.map((v) => v.no).join(', ')} — {money(queued.reduce((n, v) => n + v.amount, 0))} sitting in a drawer with no ledger line
            yet. The day book says <em>explained</em> rather than <em>agrees</em> until the queue drains, and the reconciliation names these
            vouchers.
          </p>
        </SafetyBanner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'book', label: 'The book', count: vouchers.length },
          { id: 'heads', label: 'Heads' },
          { id: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'book' && (
        <Panel>
          <ListView<IncomeVoucher>
            id="income-vouchers"
            caption={`Income vouchers for ${day}`}
            columns={columns}
            rows={vouchers}
            rowId={(v) => v.id}
            height="30rem"
            rowActions={(v) => [
              {
                id: 'reverse',
                label: 'Reverse with a contra voucher',
                icon: <Undo2 className="size-4" aria-hidden />,
                onSelect: () => {
                  setReversing(v);
                  setTab('book');
                },
              },
            ]}
          />
          <p className="mt-2 text-xs text-text-secondary">
            {money(booked.reduce((n, v) => n + v.amount, 0))} in the book after reversals. A voucher is never edited: a correction is another
            voucher that names this one.
          </p>
        </Panel>
      )}

      {tab === 'heads' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="What each head collected">
            <ul className="space-y-1.5 text-sm">
              {INCOME_HEADS.map((h) => {
                const rows = booked.filter((v) => v.headCode === h.code);
                const total = rows.reduce((n, v) => n + v.amount, 0);
                return (
                  <li key={h.code} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1.5">
                    <span>
                      <span className="text-text-primary">{h.label}</span>
                      <span className="block text-xs text-text-tertiary">
                        {h.code} · {h.group} · {rows.length} voucher{rows.length === 1 ? '' : 's'}{h.category ? ` · billed as ${h.category}` : ' · never billed'}
                      </span>
                      <span className="block text-xs text-text-secondary">{h.note}</span>
                    </span>
                    <span className={cx('shrink-0 font-medium tabular-nums', total === 0 && 'text-text-tertiary')}>{money(total)}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="By method, and where it settles">
            <ul className="space-y-1.5 text-sm">
              {(['Cash', 'bKash', 'Nagad', 'Card', 'Insurance', 'Corporate'] as PaymentMethod[]).map((m) => {
                const rows = booked.filter((v) => v.method === m);
                if (rows.length === 0) return null;
                const total = rows.reduce((n, v) => n + v.amount, 0);
                const route = routeOfPayment(m);
                return (
                  <li key={m} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1.5">
                    <span>
                      <span className="text-text-primary">{m}</span>
                      <span className="block text-xs text-text-tertiary">{route} — {settlementNote[routeGroup(route)]}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{money(total)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">
              Money taken at a counter is not the same as money the hospital has: the payer’s share of a bill is collected from the insurer
              weeks later, and it never touches a drawer.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <Panel title="What makes a receipt valid">
          <ul className="space-y-2 text-sm text-text-secondary">
            <li><strong className="font-medium text-text-primary">One series, one time.</strong> Receipts are numbered in the order they were taken, and the number is what a missing voucher is found by. The sequence is per node, which is how two branches number receipts without ever colliding.</li>
            <li><strong className="font-medium text-text-primary">A head, always.</strong> “Miscellaneous” is not a head. If a receipt does not belong to one of the thirteen, the head is missing, not the receipt.</li>
            <li><strong className="font-medium text-text-primary">Cash is not the payer’s money.</strong> An insurer’s share posts to a payer account, and it is a receivable until the money arrives.</li>
            <li><strong className="font-medium text-text-primary">Reversed, never edited.</strong> A wrong receipt gets a contra voucher naming the original, the reason and the approver. Both vouchers stay in the book, which is what makes the correction auditable.</li>
            <li><strong className="font-medium text-text-primary">Queued is not lost.</strong> A receipt taken while the uplink is down is written to the outbox on the device that took it, and the reconciliation shows it as awaiting sync — never as a difference nobody can explain.</li>
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------------------------------ post a receipt */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Post a receipt"
        description="One voucher, one head, one method. It queues on this device and reaches the ledger when the uplink is back."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={post}>Post the voucher</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Income head</span>
            <select value={headCode} onChange={(e) => setHeadCode(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
              {INCOME_HEADS.map((h) => <option key={h.code} value={h.code}>{h.code} — {h.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-text-secondary">{incomeHeadByCode(headCode)?.note}</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Amount</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded-md border border-border bg-surface px-3 py-2 tabular-nums" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Counter</span>
              <select value={counter} onChange={(e) => setCounter(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                {COUNTERS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-1 font-medium text-text-primary">How it came in</legend>
            <div className="flex flex-wrap gap-1.5">
              {COUNTER_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cx('rounded-md border px-2.5 py-1 text-xs', method === m ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border text-text-secondary hover:bg-surface-sunken')}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-xs text-text-secondary">
              {routeOfPayment(method)} settles to {routeGroup(routeOfPayment(method)) === 'Drawer' ? 'tonight’s drawer, so it is in the figure somebody counts' : routeGroup(routeOfPayment(method)) === 'Payer account' ? 'a payer account — a receivable, never cash' : 'the bank, a day or two later, so it is never in the drawer figure'}.
            </span>
          </fieldset>

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Invoice it settles <span className="font-normal text-text-secondary">(optional)</span></span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-… — leave blank for counter income that was never billed" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            <span className="mt-1 block text-xs text-text-secondary">
              With an invoice number the receipt is part of what the billing counter reconciles against; without one it is counter income
              that no module expects, and the day book says so.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Narration</span>
            <input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What it was for" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
          </label>
        </div>
      </Sheet>

      {/* ------------------------------------------------------------------ reverse a receipt */}
      <Sheet
        open={Boolean(reversing)}
        onClose={() => setReversing(null)}
        title={reversing ? `Reverse ${reversing.no}` : 'Reverse'}
        description={reversing ? `${money(reversing.amount)} on ${incomeHeadByCode(reversing.headCode)?.label} — a contra voucher goes in beside it, and the original stays.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReversing(null)}>Cancel</Button>
            <Button size="sm" onClick={reverse}>
              <FileX2 className="size-4" aria-hidden /> Post the contra voucher
            </Button>
          </div>
        }
      >
        {reversing && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Original</dt><dd className="font-medium tabular-nums">{reversing.no}</dd></div>
              <div><dt className="text-xs text-text-secondary">Head</dt><dd className="font-medium">{incomeHeadByCode(reversing.headCode)?.label}</dd></div>
              <div><dt className="text-xs text-text-secondary">Method</dt><dd className="font-medium">{reversing.method} · {reversing.route}</dd></div>
            </dl>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Reason</span>
              <select value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                {REVERSAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Approved by</span>
              <input value={reversalApprover} onChange={(e) => setReversalApprover(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
              <span className="mt-1 block text-xs text-text-secondary">
                Money going back out is a decision, so it carries a name. A reversal with no approver is a drawer shortage waiting to be
                discovered.
              </span>
            </label>
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
              Only reversals of {day} are offered here. Older receipts go back through a refund voucher approved by finance, because the day
              book of an earlier day has already been closed and counted.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
