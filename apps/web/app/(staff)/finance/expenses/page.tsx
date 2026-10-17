'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, Tabs, cx, useToast, type Column } from '@dizi/ui';
import { BadgeCheck, Landmark, PenLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  APPROVAL_LADDER,
  CAPITAL_FLOOR,
  CASH_PAYMENT_LIMIT,
  CLOSE_LOCK_DAYS,
  COST_CENTRES,
  EXPENSE_HEADS,
  INPUT_VAT_CREDITABLE,
  INPUT_VAT_NOTE,
  PAYEE_SUGGESTIONS,
  approvalFor,
  checkExpense,
  deductionsFor,
  expenseHeadByCode,
  generateExpenseVouchers,
  type ExpenseVoucher,
  type MoneyRoute,
} from '@/lib/finance';

/* Expense vouchers and the approval queue (legacy `admin/expense` — replaced).
 *
 * The payment voucher is where money leaves the building, so the screen is built around the two questions an
 * auditor asks: who approved it, and does the amount match the ladder that amount sits on? The queue prints the
 * rule that refused each voucher rather than colouring the row red, and the sheet re-checks the ladder as the
 * amount is typed — a refusal is cheapest before the bill is paid.
 *
 * Preview: the vouchers are the branch's own synthetic day. Nothing survives a reload; the ladder does.
 */

const PAYMENT_ROUTES: MoneyRoute[] = ['Bank transfer', 'Cheque', 'Cash'];

export default function ExpenseVouchersPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const generated = useMemo(() => generateExpenseVouchers(day, day), [day]);
  const [posted, setPosted] = useState<ExpenseVoucher[]>([]);
  /** Vouchers this session cleared through the ladder, so they leave the queue the moment they are signed. */
  const [cleared, setCleared] = useState<string[]>([]);
  const [tab, setTab] = useState('queue');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signing, setSigning] = useState<ExpenseVoucher | null>(null);

  // The draft being written on the sheet, and the live verdict on it.
  const [headCode, setHeadCode] = useState('EXP-DRUG');
  const [payee, setPayee] = useState(PAYEE_SUGGESTIONS[0]);
  const [gross, setGross] = useState('24000');
  const [route, setRoute] = useState<MoneyRoute>('Bank transfer');
  const [costCentre, setCostCentre] = useState(COST_CENTRES[0]);
  const [billNo, setBillNo] = useState('');
  const [quotationRef, setQuotationRef] = useState('');
  const [preparedBy, setPreparedBy] = useState('Accounts officer — N. Haque');
  const [approvedBy, setApprovedBy] = useState('Finance manager — S. Chowdhury');
  const [secondApprover, setSecondApprover] = useState('');
  const [narration, setNarration] = useState('');

  const awaiting = generated.filter((v) => v.status === 'Awaiting approval' && !cleared.includes(v.id));
  const checkedIn = generated.filter((v) => v.status === 'Posted');
  const allPosted = [...checkedIn, ...posted];
  const head = expenseHeadByCode(headCode)!;
  const draftAmount = Number(gross) || 0;
  const check = checkExpense({ headCode, payee, gross: draftAmount, method: route, preparedBy, approvedBy, secondApprover, quotationRef, day, today: day });
  const deductions = deductionsFor(head, draftAmount);

  const post = (voucher: ExpenseVoucher) => {
    const outcome = queueWrite(`Payment ${voucher.no}: ${money(voucher.payable)} to ${voucher.payee} (${voucher.method})`, {
      id: 'createExpenseVoucher',
      recordId: voucher.id,
      fields: { headCode: voucher.headCode, payee: voucher.payee, gross: voucher.gross, ait: voucher.ait, vat: voucher.vat, method: voucher.method, chequeNo: voucher.chequeNo ?? null, at: voucher.at },
    });
    if (!outcome.queued) {
      push({ title: `${voucher.no} recorded, not posted`, description: `The contract will not queue this write ${outcome.because}`, tone: 'warning' });
      return;
    }
    setPosted((rows) => [voucher, ...rows]);
    setCleared((rows) => (rows.includes(voucher.id) ? rows : [...rows, voucher.id]));
    push({
      title: `${voucher.no} posted — ${money(voucher.payable)} to ${voucher.payee}`,
      description: `Gross ${money(voucher.gross)}, withholding ${money(voucher.ait)}, VAT ${money(voucher.vat)}${INPUT_VAT_CREDITABLE ? ' claimable' : ' absorbed as a cost'}. It queues on this device until the uplink is back.`,
      tone: 'success',
    });
  };

  const clearFromQueue = (voucher: ExpenseVoucher, approvers: { approvedBy: string; secondApprover: string }) => {
    const recheck = checkExpense({ headCode: voucher.headCode, payee: voucher.payee, gross: voucher.gross, method: voucher.method, preparedBy: voucher.preparedBy, quotationRef: voucher.quotationRef, day: voucher.day, today: day, ...approvers });
    if (!recheck.ok) {
      push({ title: `Still refused — ${recheck.refusals[0].message}`, tone: 'critical' });
      return;
    }
    post({ ...voucher, ...approvers, status: 'Posted', refusals: undefined });
    setSigning(null);
  };

  const writeDraft = () => {
    if (!check.ok) {
      push({ title: `Refused — ${check.refusals[0].message}`, tone: 'critical' });
      return;
    }
    const voucher: ExpenseVoucher = {
      id: `${day}-MAN-PV-${posted.length + 1}`,
      no: `PV-${day.replace(/-/g, '').slice(2)}-${String(900 + posted.length)}`,
      day,
      at: `${day} ${new Date().toTimeString().slice(0, 5)}`,
      sequence: allPosted.length + posted.length + 1,
      headCode,
      payee,
      gross: draftAmount,
      ait: deductions.ait,
      vat: deductions.vat,
      payable: deductions.payable,
      method: route,
      costCentre,
      ...(billNo.trim() ? { billNo: billNo.trim() } : {}),
      ...(quotationRef.trim() ? { quotationRef: quotationRef.trim() } : {}),
      ...(route === 'Cheque' ? { chequeNo: `CHQ-${String(32_500 + posted.length).padStart(6, '0')}` } : {}),
      narration: narration.trim() || head.label,
      preparedBy,
      ...(approvedBy ? { approvedBy } : {}),
      ...(secondApprover ? { secondApprover } : {}),
      status: 'Posted',
    };
    post(voucher);
    setSheetOpen(false);
    setNarration('');
    setBillNo('');
  };

  const postedColumns: Array<Column<ExpenseVoucher>> = [
    { key: 'no', header: 'Voucher', width: '9rem', render: (v) => <span className="tabular-nums">{v.no}</span> },
    { key: 'payee', header: 'Payee', render: (v) => <span>{v.payee}<span className="block text-xs text-text-tertiary">{expenseHeadByCode(v.headCode)?.label ?? v.headCode} · {v.costCentre}</span></span> },
    { key: 'gross', header: 'Gross', align: 'right', width: '7rem', render: (v) => <span className="tabular-nums">{money(v.gross)}</span> },
    { key: 'tax', header: 'AIT / VAT', align: 'right', width: '8rem', render: (v) => <span className="tabular-nums text-text-secondary">−{money(v.ait)} / {money(v.vat)}</span> },
    { key: 'payable', header: 'Paid', align: 'right', width: '8rem', render: (v) => <span className="tabular-nums font-medium">{money(v.payable)}</span> },
    { key: 'method', header: 'Method', width: '9rem', render: (v) => <span>{v.method}{v.chequeNo && <span className="block text-xs tabular-nums text-text-tertiary">{v.chequeNo}</span>}</span> },
    { key: 'approvedBy', header: 'Approved by', render: (v) => <span>{v.approvedBy ?? <span className="text-text-tertiary">below the threshold</span>}{v.secondApprover && <span className="block text-xs text-text-tertiary">2nd: {v.secondApprover}</span>}</span> },
    { key: 'narration', header: 'For', render: (v) => <span className="text-text-secondary">{v.narration}</span> },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Landmark className="size-5 text-brand-600" aria-hidden />
            Expense vouchers
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — money leaving, the signature its size requires, and the tax held back on the way out.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <PenLine className="size-4" aria-hidden /> Write a payment voucher
          </Button>
          <Link href="/finance">
            <Button variant="secondary" size="sm">Money today</Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Paid today" value={money(allPosted.reduce((n, v) => n + v.payable, 0))} definition="Net of withholding, including anything queued on this device." asOf={day} />
        <KpiTile label="Held for the tax office" value={money(allPosted.reduce((n, v) => n + v.ait, 0))} definition="Deducted at source from suppliers, landlords and professionals. It is never the hospital’s money to spend." asOf={day} />
        <KpiTile label="VAT recorded" value={money(allPosted.reduce((n, v) => n + v.vat, 0))} definition={INPUT_VAT_CREDITABLE ? 'Claimable input tax.' : 'Absorbed into the cost — see the VAT note below, because this branch’s services are outside the VAT net.'} asOf={day} />
        <KpiTile label="Awaiting a signature" value={money(awaiting.reduce((n, v) => n + v.payable, 0))} definition={`${awaiting.length} voucher${awaiting.length === 1 ? '' : 's'} the ladder has not cleared yet. Each one names the rule it is waiting on.`} asOf={day} />
        <KpiTile label="Through the bank" value={money(allPosted.filter((v) => v.method !== 'Cash').reduce((n, v) => n + v.payable, 0))} definition={`Cash payments stop at ${money(CASH_PAYMENT_LIMIT)}: above that the money leaves through a transfer with a reference.`} asOf={day} />
      </div>

      {awaiting.length > 0 && (
        <SafetyBanner severity="warning" title={`${awaiting.length} voucher${awaiting.length === 1 ? '' : 's'} cannot be paid yet — ${money(awaiting.reduce((n, v) => n + v.payable, 0))}`}>
          <p>
            The ladder decides by amount, and each queue row prints the rule that is missing. Nothing here is a warning to click past: a
            voucher without the signature its size requires is money out without a control.
          </p>
        </SafetyBanner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'queue', label: 'Approval queue', count: awaiting.length || undefined },
          { id: 'posted', label: 'Posted', count: allPosted.length },
          { id: 'limits', label: 'Heads and limits' },
          { id: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'queue' && (
        <Panel title="Waiting for the ladder">
          {awaiting.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-safety-success">
              <ShieldCheck className="size-4" aria-hidden /> Every voucher of the day carries the signatures its size requires.
            </p>
          ) : (
            <ul className="space-y-2">
              {awaiting.map((v) => {
                const step = approvalFor(v.gross);
                return (
                  <li key={v.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {v.payee} — {money(v.gross)}
                          <span className="ml-2 text-xs font-normal text-text-secondary">{expenseHeadByCode(v.headCode)?.label}</span>
                        </p>
                        <p className="text-xs text-text-secondary">
                          {v.no} · {v.method} · {v.costCentre} · prepared by {v.preparedBy}
                          {v.billNo && ` · bill ${v.billNo}`}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setSigning(v)}>
                        <BadgeCheck className="size-4" aria-hidden /> Add the signature
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-text-secondary">
                      Ladder: {step.role} at this amount{step.second ? ', with a second signature' : ''}{step.quotation ? ', and a quotation on file' : ''} — {step.because}
                    </p>
                    {v.refusals?.map((r) => (
                      <p key={r} className="mt-1 flex items-start gap-1.5 text-xs text-safety-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {r}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'posted' && (
        <Panel>
          <ListView<ExpenseVoucher>
            id="expense-vouchers"
            caption={`Posted expense vouchers for ${day}`}
            columns={postedColumns}
            rows={allPosted}
            rowId={(v) => v.id}
            height="30rem"
          />
          <p className="mt-2 text-xs text-text-secondary">
            {money(allPosted.reduce((n, v) => n + v.payable, 0))} paid, {money(allPosted.reduce((n, v) => n + v.gross, 0))} of it billed value. A
            voucher is appended and never edited: a wrong payment is corrected by a reversing voucher with its own approver.
          </p>
        </Panel>
      )}

      {tab === 'limits' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="The approval ladder">
            <table className="w-full text-sm">
              <caption className="sr-only">Amounts and the signatures they require</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-secondary">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Amount</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Needs</th>
                  <th scope="col" className="py-1.5 font-medium">Because</th>
                </tr>
              </thead>
              <tbody>
                {APPROVAL_LADDER.map((step) => (
                  <tr key={step.min} className="border-b border-border-subtle align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-medium tabular-nums text-text-primary">
                      {step.upTo === Number.POSITIVE_INFINITY ? `above ${money(step.min)}` : step.min === 0 ? `up to ${money(step.upTo)}` : `${money(step.min)}–${money(step.upTo)}`}
                    </th>
                    <td className="py-2 pr-3">
                      {step.role}
                      {step.second && <span className="block text-xs text-text-secondary">+ a second signature</span>}
                      {step.quotation && <span className="block text-xs text-text-secondary">+ a quotation on file</span>}
                    </td>
                    <td className="py-2 text-xs text-text-secondary">{step.because}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-3 space-y-1 text-xs text-text-secondary">
              <li>Nobody approves their own voucher, and a second signature has to be a second person.</li>
              <li>Cash stops at {money(CASH_PAYMENT_LIMIT)}; above it the payment leaves through the bank.</li>
              <li>At {money(CAPITAL_FLOOR)} or above, a purchase is an asset on the register rather than an expense of the month.</li>
              <li>Books for a day older than {CLOSE_LOCK_DAYS} days need a late-posting note with the paper voucher.</li>
            </ul>
          </Panel>

          <Panel title="Heads, withholding and VAT">
            <ul className="space-y-1.5 text-sm">
              {EXPENSE_HEADS.map((h) => (
                <li key={h.code} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1.5">
                  <span>
                    <span className="text-text-primary">{h.label}</span>
                    <span className="block text-xs text-text-tertiary">
                      {h.code} · {h.klass} · AIT {h.aitPct == null ? 'none' : `${h.aitPct} %`} · VAT {h.vatPct == null ? 'none' : `${h.vatPct} %`}
                      {h.quotable ? ' · quoted' : ' · meter or agreement'}
                    </span>
                    <span className="block text-xs text-text-secondary">{h.note}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">{INPUT_VAT_NOTE}</p>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <Panel title="What makes a payment valid">
          <ul className="space-y-2 text-sm text-text-secondary">
            <li><strong className="font-medium text-text-primary">The ladder, not a habit.</strong> The amount decides who signs and whether a second signature or a quotation is needed. The screen prints the rule it used.</li>
            <li><strong className="font-medium text-text-primary">Nobody signs their own.</strong> The preparer and the approver are different people, and two signatures from one person are one signature.</li>
            <li><strong className="font-medium text-text-primary">Meter, agreement or purchase.</strong> A quotation is demanded for a purchase. Electricity, rent, a licence and a salary are paid against a tariff or an agreement, so the reference that matters is the bill.</li>
            <li><strong className="font-medium text-text-primary">Tax leaves with the payment, not later.</strong> Withholding is deducted when the supplier is paid; a hospital that pays gross and promises to deduct is the one that carries the liability when it forgets.</li>
            <li><strong className="font-medium text-text-primary">Capital is not this month’s cost.</strong> Anything at or above the capitalisation floor goes on the asset register and is depreciated, so one month is not made to look expensive and the next twelve free.</li>
            <li><strong className="font-medium text-text-primary">Refused vouchers stay refused.</strong> The queue keeps the voucher and the rule beside it, so the reason survives the person who found it.</li>
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------------------------------ write a voucher */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Write a payment voucher"
        description="The ladder is checked as you type. A refusal here costs nothing; the same refusal after the money has left is an audit finding."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={writeDraft} disabled={!check.ok}>Post the voucher</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Expense head</span>
              <select value={headCode} onChange={(e) => setHeadCode(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                {EXPENSE_HEADS.map((h) => <option key={h.code} value={h.code}>{h.code} — {h.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Cost centre</span>
              <select value={costCentre} onChange={(e) => setCostCentre(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                {COST_CENTRES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">Payee</span>
            <input value={payee} onChange={(e) => setPayee(e.target.value)} list="payees" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            <datalist id="payees">
              {PAYEE_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Bill amount (before VAT)</span>
              <input value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" className="w-full rounded-md border border-border bg-surface px-3 py-2 tabular-nums" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Bill number</span>
              <input value={billNo} onChange={(e) => setBillNo(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            </label>
          </div>

          <fieldset>
            <legend className="mb-1 font-medium text-text-primary">How it leaves</legend>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_ROUTES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoute(r)}
                  className={cx('rounded-md border px-2.5 py-1 text-xs', route === r ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border text-text-secondary hover:bg-surface-sunken')}
                >
                  {r}
                </button>
              ))}
            </div>
            {route === 'Cash' && draftAmount > CASH_PAYMENT_LIMIT && (
              <span className="mt-1 block text-xs text-safety-critical">Cash stops at {money(CASH_PAYMENT_LIMIT)} — this one has to go through the bank.</span>
            )}
          </fieldset>

          <dl className="grid gap-2 rounded-md bg-surface-sunken px-3 py-2 text-xs sm:grid-cols-3">
            <div><dt className="text-text-secondary">Gross</dt><dd className="font-medium tabular-nums">{money(draftAmount)}</dd></div>
            <div><dt className="text-text-secondary">Withholding {head.aitPct == null ? '(none)' : `${head.aitPct} %`}</dt><dd className="font-medium tabular-nums">−{money(deductions.ait)}</dd></div>
            <div><dt className="text-text-secondary">VAT recorded {head.vatPct == null ? '(none)' : `${head.vatPct} %`}</dt><dd className="font-medium tabular-nums">{money(deductions.vat)}</dd></div>
            <div className="sm:col-span-3"><dt className="text-text-secondary">Leaves the bank</dt><dd className="font-semibold tabular-nums">{money(deductions.payable)}</dd></div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Prepared by</span>
              <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Approved by <span className="font-normal text-text-secondary">({approvalFor(draftAmount).role} at this amount)</span></span>
              <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            </label>
          </div>

          {approvalFor(draftAmount).quotation && head.quotable && (
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Quotation or tender reference</span>
              <input value={quotationRef} onChange={(e) => setQuotationRef(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            </label>
          )}

          {approvalFor(draftAmount).second && (
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Second approver</span>
              <input value={secondApprover} onChange={(e) => setSecondApprover(e.target.value)} placeholder="A different person from the first approver" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block font-medium text-text-primary">For</span>
            <input value={narration} onChange={(e) => setNarration(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
          </label>

          <div className={cx('rounded-md px-3 py-2 text-xs', check.ok ? 'bg-safety-success/10 text-safety-success' : 'bg-safety-warning/10 text-safety-warning')}>
            {check.ok ? (
              <p className="flex items-center gap-1.5"><BadgeCheck className="size-3.5" aria-hidden /> The ladder clears: {check.approval.role}{check.approval.second ? ' with a second signature' : ''}.</p>
            ) : (
              <ul className="space-y-1">
                {check.refusals.map((r) => (
                  <li key={r.code} className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {r.message}</li>
                ))}
              </ul>
            )}
            {check.notes.map((n) => (
              <p key={n} className="mt-1 text-text-secondary">{n}</p>
            ))}
          </div>
        </div>
      </Sheet>

      {/* ------------------------------------------------------------------ add a signature */}
      <Sheet
        open={Boolean(signing)}
        onClose={() => setSigning(null)}
        title={signing ? `Clear ${signing.no} for payment` : 'Signature'}
        description={signing ? `${signing.payee} — ${money(signing.gross)}, ${approvalFor(signing.gross).role} at this amount.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSigning(null)}>Cancel</Button>
            {signing && (
              <Button size="sm" onClick={() => clearFromQueue(signing, { approvedBy: signing.approvedBy ?? '', secondApprover: secondApprover || '' })}>
                Post the payment
              </Button>
            )}
          </div>
        }
      >
        {signing && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Gross</dt><dd className="font-medium tabular-nums">{money(signing.gross)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Withholding</dt><dd className="font-medium tabular-nums">−{money(signing.ait)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Leaves the bank</dt><dd className="font-medium tabular-nums">{money(signing.payable)}</dd></div>
            </dl>
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Approved by</span>
              <input
                value={signing.approvedBy ?? ''}
                onChange={(e) => setSigning({ ...signing, approvedBy: e.target.value })}
                placeholder={`${approvalFor(signing.gross).role} — name`}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </label>
            {approvalFor(signing.gross).second && (
              <label className="block">
                <span className="mb-1 block font-medium text-text-primary">Second approver</span>
                <input value={secondApprover} onChange={(e) => setSecondApprover(e.target.value)} placeholder="A different person" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
                <span className="mt-1 block text-xs text-text-secondary">
                  The same name twice is refused by the ladder — a second signature is only a control if a second person gives it.
                </span>
              </label>
            )}
            {signing.refusals?.map((r) => (
              <p key={r} className="flex items-start gap-1.5 rounded-md bg-safety-warning/10 px-3 py-2 text-xs text-safety-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {r}
              </p>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
