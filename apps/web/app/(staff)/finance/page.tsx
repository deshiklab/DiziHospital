'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, cx, useToast } from '@dizi/ui';
import type { PaymentMethod } from '@/lib/billing';
import { Banknote, Check, CloudOff, Landmark, Scale, ShieldCheck, Wallet, X } from 'lucide-react';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  CASH_FLOAT_RETAINED,
  INCOME_HEADS,
  INPUT_VAT_NOTE,
  financeSnapshot,
  incomeHeadByCode,
  routeGroup,
  routeOfPayment,
  settlementNote,
  voucherNo,
  type CollectionPoint,
  type IncomeVoucher,
} from '@/lib/finance';

/* Money today (P6 — the legacy income and expense screens' overview).
 *
 * One question decides whether this screen is any good: if the drawer and the book disagree, does the screen say
 * *which counter* and *why*? So the reconciliation is the first thing on the page, per counter, with the verdict
 * on each line rather than one branch-level tick that hides a short drawer behind a busy one.
 *
 * The book and the till are computed from the same modules here (there is no server yet), so they agree by
 * construction — except for the difference this product really creates: a receipt still queued on a device that
 * lost its uplink. Post one below and watch the verdict change from `agrees` to `explained`, naming the voucher.
 */

const VERDICT_TONE: Record<string, { tone: 'success' | 'warning' | 'critical'; label: string }> = {
  agrees: { tone: 'success', label: 'Every counter agrees with its module' },
  explained: { tone: 'warning', label: 'Explained by the queue' },
  investigate: { tone: 'critical', label: 'Investigate — the queue does not explain this' },
};

const ROUTE_LABEL: Record<string, string> = { Drawer: 'Cash in the drawer', Bank: 'Settles through the bank', 'Payer account': 'Billed to the payer' };

/** What a counter can actually take. A receipt is never a bank transfer or a cheque — those pay bills, not patients. */
const COUNTER_METHODS: PaymentMethod[] = ['Cash', 'bKash', 'Nagad', 'Card'];

/** `YYYY-MM-DD HH:MM` — read when the write happens, never while rendering. */
const stampNow = (): string => {
  const now = new Date();
  return `${todayIso()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

export default function FinancePage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  /** Receipts taken on this device that the server has not seen — they are not in the book until the queue drains. */
  const [posted, setPosted] = useState<IncomeVoucher[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [headCode, setHeadCode] = useState(INCOME_HEADS[0].code);
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [narration, setNarration] = useState('');

  /** What the cashier counted at the end of the shift. Empty until somebody counts — that is the point. */
  const [counts, setCounts] = useState<Partial<Record<CollectionPoint, string>>>({});
  const counted = useMemo(() => {
    const out: Partial<Record<CollectionPoint, number>> = {};
    for (const [point, value] of Object.entries(counts)) {
      const n = Number(value);
      if (value !== undefined && value !== '' && Number.isFinite(n)) out[point as CollectionPoint] = n;
    }
    return out;
  }, [counts]);

  const snapshot = useMemo(() => financeSnapshot(day, day, { queuedIncome: posted, counted }), [day, posted, counted]);
  const book = snapshot.book;
  const verdict = VERDICT_TONE[book.verdict];

  const post = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      push({ title: 'A receipt is a positive amount.', tone: 'critical' });
      return;
    }
    const voucher: IncomeVoucher = {
      id: `${day}-MAN-${posted.length + 1}`,
      no: voucherNo('income', day, 900 + posted.length),
      day,
      at: stampNow(),
      sequence: 0,
      headCode,
      amount: value,
      method,
      route: routeOfPayment(method),
      point: 'Billing counter',
      counter: 'Counter 1',
      narration: narration.trim() || `${incomeHeadByCode(headCode)?.label ?? headCode} — counter receipt`,
      recordedBy: 'Reception — R. Akter',
      queued: true,
    };
    setPosted((rows) => [...rows, voucher]);
    // The contract decides whether this may be queued at all: a voucher is append-only and reaches the server
    // through the outbox, with a name, an idempotency key and a ledger line of its own.
    const outcome = queueWrite(`Income voucher ${voucher.no}: ${money(value)} (${method})`, {
      id: 'createIncomeVoucher',
      recordId: voucher.id,
      fields: { headCode, amount: value, method: voucher.method, counter: voucher.counter, at: voucher.at },
    });
    setSheetOpen(false);
    setNarration('');
    push({
      title: outcome.queued ? `${voucher.no} posted on this device` : `${voucher.no} recorded, not posted`,
      description: outcome.queued
        ? `It is in the drawer and not yet in the book — the reconciliation below now says so, by ${money(value)}.`
        : `The contract does not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Wallet className="size-5 text-brand-600" aria-hidden />
            Money today
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — the day book, the drawer, and every counter reconciled against the module that knows what it
            should have taken.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
            <Banknote className="size-4" aria-hidden /> Record a counter receipt
          </Button>
          <Link href="/finance/income">
            <Button variant="secondary" size="sm">Income vouchers</Button>
          </Link>
          <Link href="/finance/expenses">
            <Button variant="secondary" size="sm">Expense vouchers</Button>
          </Link>
        </div>
      </header>

      {/* ---------------------------------------------------------------- reconciliation, first */}
      <Panel title="Day-end reconciliation">
        <p className="mb-2 text-xs text-text-secondary">
          As of {book.asOf.slice(11)} — computed from the same modules the counters use, so a difference is a real one to chase.
        </p>
        <div className={cx('mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm', verdict.tone === 'success' && 'bg-safety-success/10 text-safety-success', verdict.tone === 'warning' && 'bg-safety-warning/10 text-safety-warning', verdict.tone === 'critical' && 'bg-safety-critical/10 text-safety-critical')} role="status">
          {book.verdict === 'agrees' ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            <strong className="font-semibold">{verdict.label}.</strong> {book.because}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Each collection point against the module that knows what it should have taken</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th scope="col" className="py-1.5 pr-3 font-medium">Counter</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Book says</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Module expects</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Difference</th>
                <th scope="col" className="py-1.5 font-medium">Because</th>
              </tr>
            </thead>
            <tbody>
              {book.points.map((p) => (
                <tr key={p.point} className="border-b border-border-subtle align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-text-primary">{p.point}</th>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(p.recorded)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(p.expected)}</td>
                  <td className={cx('py-2 pr-3 text-right tabular-nums', p.verdict === 'agrees' ? 'text-text-secondary' : p.verdict === 'explained' ? 'text-safety-warning' : 'text-safety-critical')}>
                    {p.variance === 0 ? '—' : money(p.variance)}
                  </td>
                  <td className="py-2 text-xs text-text-secondary">
                    {p.because}
                    {p.drawer !== p.recorded && <span className="mt-0.5 block text-text-tertiary">In the box with the queue: {money(p.drawer)}.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-md border border-border p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            <Scale className="size-3.5" aria-hidden /> Count the drawer
          </h3>
          <p className="mb-2 text-xs text-text-secondary">
            The book figure is what the ledger says should be in the box; only a person can say what is. Type what was counted and the
            difference appears where it belongs: as a short drawer, not as a rounding note. Leave a counter blank until it has been counted.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {book.points.map((p) => (
              <label key={p.point} className="block text-xs">
                <span className="mb-1 block font-medium text-text-primary">{p.point}</span>
                <input
                  value={counts[p.point] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [p.point]: e.target.value }))}
                  inputMode="decimal"
                  placeholder={`should be ${Math.round(p.drawer).toLocaleString('en-US')}`}
                  aria-label={`Cash counted at the ${p.point}`}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 tabular-nums"
                />
                <span className={cx('mt-1 block', p.drawerVariance == null ? 'text-text-tertiary' : Math.abs(p.drawerVariance) < 1 ? 'text-safety-success' : 'text-safety-critical')}>
                  {p.drawerVariance == null ? 'not counted yet' : Math.abs(p.drawerVariance) < 1 ? 'adds up' : `${p.drawerVariance < 0 ? 'short' : 'over'} ${money(Math.abs(p.drawerVariance))}`}
                </span>
              </label>
            ))}
          </div>
        </div>

        <ul className="mt-3 grid gap-1.5 lg:grid-cols-2">
          {book.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-xs">
              {c.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-safety-success" aria-hidden /> : <X className="mt-0.5 size-3.5 shrink-0 text-safety-critical" aria-hidden />}
              <span>
                <span className="font-medium text-text-primary">{c.label}</span>
                <span className="block text-text-secondary">{c.because}</span>
                {c.detail && <span className="block text-text-tertiary">{c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---------------------------------------------------------------- figures */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {snapshot.metrics.map((m) => (
          <KpiTile key={m.id} label={m.label} value={m.value} definition={m.because} asOf={day} />
        ))}
      </div>

      {book.awaitingSync.count > 0 && (
        <SafetyBanner
          severity="warning"
          title={`${book.awaitingSync.count} receipt${book.awaitingSync.count === 1 ? '' : 's'} queued on this device — ${money(book.awaitingSync.amount)} not yet in the book`}
        >
          <p>
            {book.awaitingSync.numbers.join(', ')}. The money is in the drawer and the ledger line arrives when the queue drains. Until it
            does, the reconciliation says <em>explained</em> rather than <em>agrees</em> — a book that hides an in-flight receipt is a book
            nobody can count against.
          </p>
        </SafetyBanner>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* -------------------------------------------------------------- the day book */}
        <Panel title="The day book">
          <p className="mb-2 text-xs text-text-secondary">
            Opening float, what moved, and what is left to bank. Cash kept back for change: {money(CASH_FLOAT_RETAINED)}.
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              { label: 'Opening float', value: book.cash.opening, why: `${book.cash.counters.length} counter(s) × ${money(book.cash.opening / Math.max(1, book.cash.counters.length))}` },
              { label: 'Cash in', value: book.cash.in, why: `Counter receipts, any head${book.cash.in !== book.cash.bookedIn ? ` — ${money(book.cash.in - book.cash.bookedIn)} of it not in the book yet` : ''}` },
              { label: 'Cash out', value: -book.cash.out, why: 'Vouchers paid at the counter' },
              { label: 'Closing', value: book.cash.closing, why: 'What a person can count tonight' },
              { label: 'Deposit due', value: -book.cash.depositDue, why: 'Goes to the bank in the morning' },
              { label: 'Banked this morning', value: book.cash.bankedToday, why: 'Yesterday’s deposit, arriving' },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1">
                <dt className="text-text-secondary">
                  {row.label}
                  <span className="block text-xs text-text-tertiary">{row.why}</span>
                </dt>
                <dd className={cx('shrink-0 font-medium tabular-nums', row.value < 0 && 'text-text-secondary')}>{money(row.value)}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <Landmark className="size-3.5" aria-hidden /> Where the money is
            </h3>
            <ul className="space-y-1 text-sm">
              {book.settlement.map((s) => (
                <li key={s.group} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="text-text-primary">{ROUTE_LABEL[s.group]}</span>
                    <span className="block text-xs text-text-secondary">{settlementNote[s.group]}</span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block">{money(s.in - s.out)}</span>
                    <span className="block text-xs text-text-tertiary">in {money(s.in)} · out {money(s.out)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* -------------------------------------------------------------- income and expense heads */}
        <div className="space-y-3">
          <Panel title="Income by head">
            <p className="mb-2 text-xs text-text-secondary">What the counters collected, sorted by the head it posted to.</p>
            {book.byIncomeHead.length === 0 ? (
              <p className="text-sm text-text-secondary">No receipts yet today.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {book.byIncomeHead.map((h) => (
                  <li key={h.code} className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1">
                    <span>
                      <span className="text-text-primary">{h.label}</span>
                      <span className="block text-xs text-text-tertiary">{h.code} · {h.count} voucher{h.count === 1 ? '' : 's'} · {incomeHeadByCode(h.code)?.group}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{money(h.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-text-secondary">
              {money(book.offTill)} of today’s counter cash belongs to no invoice at all — a certificate fee or a rent. That is why the
              book and the till are two figures.
            </p>
          </Panel>

          <Panel title="Expenses by head">
            <p className="mb-2 text-xs text-text-secondary">Posted payments only. A voucher waiting for a signature is money still in the bank.</p>
            <ul className="space-y-1 text-sm">
              {book.byExpenseHead.map((h) => (
                <li key={h.code} className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1">
                  <span>
                    <span className="text-text-primary">{h.label}</span>
                    <span className="block text-xs text-text-tertiary">{h.code} · {h.count} voucher{h.count === 1 ? '' : 's'}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(h.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">
              Withholding {money(book.withholding.ait)} and VAT {money(book.withholding.vat)} recorded today. {INPUT_VAT_NOTE}
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <Panel title="Last movements">
          <p className="mb-2 text-xs text-text-secondary">One chronological book: receipts and payments in the order they happened.</p>
          <ol className="space-y-1.5 text-sm">
            {snapshot.audit.map((row) => (
              <li key={row.voucher} className="flex items-start gap-3 border-b border-border-subtle pb-1.5">
                <span className="w-24 shrink-0 text-xs tabular-nums text-text-tertiary">{row.at.slice(11, 16)}</span>
                <span className="min-w-0">
                  <span className="block text-text-primary">{row.what}</span>
                  <span className="block text-xs text-text-secondary">{row.voucher} · {row.actor}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Waiting for a signature">
          <p className="mb-2 text-xs text-text-secondary">Vouchers the approval ladder would not pass yet.</p>
          {snapshot.openApprovals.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-safety-success">
              <ShieldCheck className="size-4" aria-hidden /> Every voucher of the day carries the signatures its size requires.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshot.openApprovals.map((v) => (
                <li key={v.id} className="rounded-md bg-surface-sunken px-3 py-2">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-text-primary">{v.payee}</span>
                    <span className="shrink-0 tabular-nums">{money(v.payable)}</span>
                  </span>
                  <span className="block text-xs text-text-secondary">{v.no} · {v.method} · {v.costCentre}</span>
                  {v.refusals && <span className="mt-1 block text-xs text-safety-warning">{v.refusals[0]}</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/finance/expenses" className="mt-3 inline-block text-sm text-brand-700 underline-offset-2 hover:underline">
            Open the approval queue →
          </Link>
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- post a receipt */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Record a counter receipt"
        description="Posts an income voucher against a head. It is queued on this device and reaches the ledger when the uplink is back."
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
              {INCOME_HEADS.map((h) => (
                <option key={h.code} value={h.code}>{h.code} — {h.label}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-text-secondary">{incomeHeadByCode(headCode)?.note}</span>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Amount</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded-md border border-border bg-surface px-3 py-2 tabular-nums" />
          </label>

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
              {routeGroup(routeOfPayment(method)) === 'Drawer' ? 'This one lands in the drawer, so the reconciliation watches it tonight.' : 'This settles through the bank: it is not counted in the drawer figure.'}
            </span>
          </fieldset>

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Narration</span>
            <input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What it was for" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
          </label>
        </div>
      </Sheet>
    </div>
  );
}
