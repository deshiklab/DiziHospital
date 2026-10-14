'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, KpiTile, Panel, SafetyBanner, Sheet, Tabs, cx, useToast, type Column } from '@dizi/ui';
import { Handshake, Info, Landmark, Receipt, TriangleAlert, Users } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  COMMISSION_BLOCKED_HEADS,
  COMMISSION_HOLD_DAYS,
  COMMISSION_TDS_PCT,
  INCOME_HEADS,
  REFERRERS,
  accrualsFor,
  payoutRun,
  referralAccruals,
  referrerByCode,
  type Accrual,
  type PayoutLine,
  type Referrer,
} from '@/lib/finance';

/* Referral commission — the register, the accruals and the payout run (legacy `admin/referral/payment`, 33 fields).
 *
 * Five rules keep a commission register from becoming a marketing list:
 * collected rather than billed; only on the heads the written agreement names; a fortnight's hold so a refund can
 * net off; withholding leaving with the payment; and never both a referral commission and a consultant's share for
 * one consultation. Everything on this screen is one of those five, and the excluded lines say which.
 *
 * Preview: accruals come from the branch's synthetic invoices; a payout recorded here is added to the session's
 * own list. Nothing survives a reload; the rules and the hold do.
 */

const PAYOUT_METHODS = ['Bank transfer', 'Cheque', 'Cash'] as const;

export default function ReferralCommissionPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const accruals = useMemo(() => referralAccruals(day), [day]);
  const run = useMemo(() => payoutRun(accruals, day), [accruals, day]);
  /** Payouts prepared this session. A register that forgets is a register that pays twice. */
  const [paid, setPaid] = useState<Array<{ voucherNo: string; code: string; net: number; method: string; reference: string; at: string }>>([]);
  const [tab, setTab] = useState('run');
  const [paying, setPaying] = useState<PayoutLine | null>(null);
  const [method, setMethod] = useState<(typeof PAYOUT_METHODS)[number]>('Bank transfer');
  const [reference, setReference] = useState('');
  const [preparedBy, setPreparedBy] = useState('Accounts officer — N. Haque');
  const [approvedBy, setApprovedBy] = useState('Finance manager — S. Chowdhury');
  const [openReferrer, setOpenReferrer] = useState<string | null>(null);

  const held = accruals.filter((a) => a.status === 'Held');
  const excluded = accruals.filter((a) => a.status === 'Excluded');
  const referrer = openReferrer ? referrerByCode(openReferrer) : undefined;
  const mine = referrer ? accrualsFor(accruals, referrer.code) : [];

  const recordPayout = () => {
    if (!paying) return;
    if (!reference.trim()) {
      push({ title: 'A payment with no reference cannot be traced back to this statement.', tone: 'critical' });
      return;
    }
    if (preparedBy === approvedBy) {
      push({ title: 'The same person cannot prepare and approve a payment.', description: 'Two names, or the register records a self-approval an auditor will find.', tone: 'critical' });
      return;
    }
    const voucherNo = `COM-${day.replace(/-/g, '').slice(2)}-${String(3_100 + paid.length)}`;
    const outcome = queueWrite(
      `Commission ${voucherNo}: ${money(paying.net)} to ${paying.referrerName} (${method} ${reference})`,
      { id: 'createCommissionPayout', recordId: voucherNo, fields: { referrerCode: paying.referrerCode, gross: paying.payable, tds: paying.tds, net: paying.net, method, reference, at: day } },
    );
    setPaid((rows) => [...rows, { voucherNo, code: paying.referrerCode, net: paying.net, method, reference: reference.trim(), at: `${day} 14:10` }]);
    setPaying(null);
    setReference('');
    push({
      title: outcome.queued ? `${voucherNo} — ${money(paying.net)} to ${paying.referrerName}` : `${voucherNo} recorded locally only`,
      description: outcome.queued
        ? `Gross ${money(paying.payable)} less ${COMMISSION_TDS_PCT} % withholding ${money(paying.tds)}. ${money(paying.held)} stays held until it has been collected ${COMMISSION_HOLD_DAYS} days.`
        : `The contract will not queue this write ${outcome.because}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  const runColumns: Array<Column<PayoutLine>> = [
    { key: 'referrerName', header: 'Referrer', render: (l) => (
      <span>
        {l.referrerName}
        <span className="block text-xs text-text-tertiary">{l.referrerCode} · {l.kind}{l.tin ? ` · ${l.tin}` : ' · no TIN'}</span>
      </span>
    ) },
    { key: 'lines', header: 'Lines', align: 'right', width: '5rem', render: (l) => <span className="tabular-nums">{l.lines}</span> },
    { key: 'accrued', header: 'Accrued', align: 'right', width: '8rem', render: (l) => <span className="tabular-nums">{money(l.accrued)}</span> },
    { key: 'held', header: 'Held', align: 'right', width: '8rem', render: (l) => (
      <span className="tabular-nums">
        {l.held > 0 ? money(l.held) : '—'}
        {l.held > 0 && <span className="block text-xs text-text-tertiary">inside {COMMISSION_HOLD_DAYS} days</span>}
      </span>
    ) },
    { key: 'payable', header: 'Payable', align: 'right', width: '8rem', render: (l) => <span className="tabular-nums">{money(l.payable)}</span> },
    { key: 'net', header: 'Net of TDS', align: 'right', width: '8rem', render: (l) => (
      <span className="tabular-nums">
        {money(l.net)}
        <span className="block text-xs text-text-tertiary">{`−${money(l.tds)} at ${COMMISSION_TDS_PCT} %`}</span>
      </span>
    ) },
  ];

  const accrualColumns: Array<Column<Accrual>> = [
    { key: 'invoiceNo', header: 'Bill', width: '8rem', render: (a) => (
      <span className="tabular-nums">
        {a.invoiceNo}
        <span className="block text-xs font-normal text-text-tertiary">{a.mrn}</span>
      </span>
    ) },
    { key: 'headCode', header: 'Head', width: '9rem', render: (a) => (
      <span>
        {INCOME_HEADS.find((h) => h.code === a.headCode)?.label ?? a.headCode}
        <span className="block text-xs text-text-tertiary">{a.headCode}</span>
      </span>
    ) },
    { key: 'collected', header: 'Collected', align: 'right', width: '8rem', render: (a) => <span className="tabular-nums">{money(a.collected)}</span> },
    { key: 'base', header: 'Share of it', align: 'right', width: '8rem', render: (a) => <span className="tabular-nums">{money(a.base)}</span> },
    { key: 'rate', header: 'Rate', align: 'right', width: '5rem', render: (a) => <span className="tabular-nums">{Math.round(a.rate * 100)} %</span> },
    { key: 'commission', header: 'Commission', align: 'right', width: '8rem', render: (a) => (
      <span className={cx('tabular-nums', a.status === 'Excluded' && 'text-text-tertiary')}>{a.commission > 0 ? money(a.commission) : '—'}</span>
    ) },
    { key: 'status', header: 'Status', width: '9rem', render: (a) => (
      <span className={cx('font-medium', a.status === 'Payable' ? 'text-safety-success' : a.status === 'Excluded' ? 'text-text-tertiary' : 'text-safety-warning')}>
        {a.status}
        <span className="block text-xs font-normal text-text-tertiary">
          {a.status === 'Held' ? `payable ${a.payableFrom.slice(5)}` : a.status === 'Payable' ? `collected ${a.collectedAt.slice(0, 10)}` : 'not commissioned'}
        </span>
      </span>
    ) },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Handshake className="size-5 text-brand-600" aria-hidden />
            Referral commission
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — paid on money collected, per head, under a written agreement, with a {COMMISSION_HOLD_DAYS}-day hold so a refund can net off.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance/tpa"><Button variant="secondary" size="sm">Claims</Button></Link>
          <Link href="/finance"><Button variant="secondary" size="sm">Money today</Button></Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Payable today" value={money(run.totalPayable)} definition={`Commission on money collected at least ${COMMISSION_HOLD_DAYS} days ago, across ${run.lines.length} referrer(s).`} asOf={day} />
        <KpiTile label="Held" value={money(held.reduce((s, a) => s + a.commission, 0))} definition="Collected too recently to pay: a patient who returns within the fortnight takes their money with them, and the commission should follow." asOf={day} />
        <KpiTile label="Withholding" value={money(run.totalTds)} definition={`${COMMISSION_TDS_PCT} % withheld at source on commission, like any other professional payment. It leaves with the payment.`} asOf={day} />
        <KpiTile label="Net to pay" value={money(run.totalNet)} definition="What leaves the bank if today's run is released in full." asOf={day} />
        <KpiTile label="Excluded" value={money(run.excluded)} definition="Billed value no agreement commissions — pharmacy above all. Every excluded line names its head and its reason." asOf={day} />
      </div>

      {excluded.some((a) => COMMISSION_BLOCKED_HEADS.includes(a.headCode)) && (
        <SafetyBanner severity="info" title="Pharmacy is not commissioned, and the register says why">
          <p>
            {money(excluded.filter((a) => a.headCode === 'INC-PHARM').reduce((s, a) => s + a.base, 0))} of drug sales passed through patient bills this window and not one taka of it accrues
            to a referrer: a commission on dispensed medicine pays a prescriber to prescribe. The same rule covers donations and sundry income.
          </p>
        </SafetyBanner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'run', label: 'Payout run', count: run.lines.length },
          { id: 'accruals', label: 'Accruals', count: accruals.length },
          { id: 'excluded', label: 'Excluded', count: excluded.length || undefined },
          { id: 'register', label: 'Referral register', count: REFERRERS.length },
        ]}
      />

      {tab === 'run' && (
        <Panel
          title={`Run for ${day}`}
          actions={<span className="text-xs text-text-secondary">{COMMISSION_HOLD_DAYS}-day hold · {COMMISSION_TDS_PCT} % withholding · one voucher per referrer</span>}
        >
          {run.lines.length === 0 ? (
            <EmptyState title="Nothing payable today" description={`Every accrual is still inside the ${COMMISSION_HOLD_DAYS}-day hold. The register shows what is accruing, so a referrer asking where their money is gets a date rather than a shrug.`} />
          ) : (
            <>
              <ListView<PayoutLine>
                id="referral-payout-run"
                caption={`Referral commission payable on ${day}`}
                columns={runColumns}
                rows={run.lines}
                rowId={(l) => l.referrerCode}
                height="20rem"
                onRowClick={(l) => setOpenReferrer(l.referrerCode)}
                rowActions={(l) => [
                  { label: `Prepare the payout — ${money(l.net)} net`, icon: <Receipt className="size-4" aria-hidden />, onSelect: () => setPaying(l) },
                  { label: 'Open the register entry', icon: <Users className="size-4" aria-hidden />, onSelect: () => setOpenReferrer(l.referrerCode) },
                ]}
              />
              <p className="mt-2 text-xs text-text-secondary">{run.because}</p>
            </>
          )}

          {paid.length > 0 && (
            <div className="mt-3 border-t border-border-subtle pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Prepared in this session</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {paid.map((p) => (
                  <li key={p.voucherNo} className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="font-medium text-text-primary">{p.voucherNo}</span>
                      <span className="block text-xs text-text-tertiary">{referrerByCode(p.code)?.name} · {p.method} · {p.reference} · {p.at}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(p.net)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                Nothing survives a reload here. In production the voucher is part of the same ledger the expense vouchers post to, and a statement for
                the period is emailed to the referrer with the vouchers attached.
              </p>
            </div>
          )}
        </Panel>
      )}

      {tab === 'accruals' && (
        <Panel title="Everything that accrued" actions={<span className="text-xs text-text-secondary">Last {30} days of collection</span>}>
          <ListView<Accrual>
            id="referral-accruals"
            caption={`Referral commission accruals on collections of the last 30 days, ${accruals.length} lines`}
            columns={accrualColumns}
            rows={accruals.slice(0, 200)}
            rowId={(a) => a.id}
            height="28rem"
            emptyLabel="No invoice in the window was referred by anybody on the register."
            rowActions={(a) => [
              { label: 'Open the referrer', icon: <Users className="size-4" aria-hidden />, onSelect: () => setOpenReferrer(a.referrerCode) },
            ]}
          />
          <p className="mt-2 text-xs text-text-secondary">
            The base is the collected amount apportioned to the head, not the billed amount: commission on a bill nobody has paid is a loan to a
            referrer, and it is repaid out of the hospital’s own pocket.
          </p>
        </Panel>
      )}

      {tab === 'excluded' && (
        <Panel title="Billed value the register refuses to commission">
          {excluded.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing was excluded in this window.</p>
          ) : (
            <>
              <ul className="space-y-2 text-sm">
                {[...new Map(excluded.map((a) => [a.exclusion ?? '', a])).values()].map((a) => {
                  const total = excluded.filter((x) => x.exclusion === a.exclusion).reduce((s, x) => s + x.base, 0);
                  return (
                    <li key={a.exclusion} className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2">
                      <span className="text-text-secondary">{a.exclusion}</span>
                      <span className="shrink-0 tabular-nums">{money(total)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                The exclusions are computed per line as the register is built, so an excluded head never accrues rather than accruing and being
                removed later — a removal somebody has to remember, and the kind that stops happening in a busy month.
              </p>
            </>
          )}
        </Panel>
      )}

      {tab === 'register' && (
        <Panel title="Who may be paid, and on what">
          <div className="space-y-2">
            {REFERRERS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenReferrer(r.code)}
                className="w-full rounded-md border border-border p-3 text-left hover:border-brand-300 hover:bg-brand-50/40"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary">{r.name}</span>
                  <span className="text-xs text-text-secondary">{r.commissionPct} % · agreement to {r.agreementTo}</span>
                </span>
                <span className="mt-1 block text-xs text-text-secondary">{r.kind} · {r.phone}{r.tin ? ` · ${r.tin}` : ' · no TIN on file'}</span>
                <span className="mt-1 block text-xs text-text-tertiary">Heads: {r.heads.length > 0 ? r.heads.join(' · ') : 'none — a referrer with no heads begins on nothing'}</span>
                <span className="mt-1 block text-xs text-text-tertiary">{r.because}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            An agreement with an end date is the whole point of a register: a rate nobody has renewed is not a rate, and the expiry on this screen is
            what stops a commission running quietly past its agreement.
          </p>
        </Panel>
      )}

      {/* ------------------------------------------------------------------ one referrer */}
      <Sheet
        open={Boolean(referrer)}
        onClose={() => setOpenReferrer(null)}
        title={referrer?.name ?? 'Referrer'}
        description={referrer ? `${referrer.code} · ${referrer.kind} · ${referrer.commissionPct} % on ${referrer.heads.length} head(s), agreement to ${referrer.agreementTo}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpenReferrer(null)}>Close</Button>
            {(() => {
              const line = run.lines.find((l) => l.referrerCode === referrer?.code);
              return line && line.net > 0 ? (
                <Button size="sm" onClick={() => { setPaying(line); setOpenReferrer(null); }}>
                  <Receipt className="size-4" aria-hidden /> Prepare the payout
                </Button>
              ) : null;
            })()}
          </div>
        }
      >
        {referrer && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Phone</dt><dd className="font-medium">{referrer.phone}</dd></div>
              <div><dt className="text-xs text-text-secondary">TIN</dt><dd className={cx('font-medium', !referrer.tin && 'text-safety-warning')}>{referrer.tin ?? 'Not on file'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Agreement</dt><dd className="font-medium">to {referrer.agreementTo}</dd></div>
            </dl>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Heads this agreement commissions</h3>
              <ul className="flex flex-wrap gap-1">
                {INCOME_HEADS.map((h) => {
                  const on = referrer.heads.includes(h.code);
                  const blocked = COMMISSION_BLOCKED_HEADS.includes(h.code);
                  return (
                    <li
                      key={h.code}
                      className={cx(
                        'rounded-full border px-2 py-0.5 text-xs',
                        blocked ? 'border-safety-critical/40 text-safety-critical' : on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border text-text-tertiary',
                      )}
                    >
                      {h.label}
                      {blocked ? ' — never' : on ? '' : ' — no'}
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-text-secondary">{referrer.because}</p>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Accruals in the window</h3>
              {mine.length === 0 ? (
                <p className="text-xs text-text-secondary">Nothing accrued for this referrer in the window.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-auto text-xs">
                  {mine.slice(0, 40).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1">
                      <span>
                        <span className="tabular-nums text-text-primary">{a.invoiceNo}</span>
                        <span className="text-text-tertiary"> · {INCOME_HEADS.find((h) => h.code === a.headCode)?.label ?? a.headCode} · {a.status.toLowerCase()}{a.status === 'Held' ? `, payable ${a.payableFrom}` : ''}</span>
                        {a.exclusion && <span className="block text-text-tertiary">{a.exclusion}</span>}
                      </span>
                      <span className={cx('shrink-0 tabular-nums', a.commission === 0 && 'text-text-tertiary')}>{a.commission > 0 ? money(a.commission) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------ prepare a payout */}
      <Sheet
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        title={paying ? `Payout — ${paying.referrerName}` : 'Payout'}
        description={paying ? `Gross ${money(paying.payable)} less ${COMMISSION_TDS_PCT} % withholding ${money(paying.tds)} = ${money(paying.net)}. ${money(paying.held)} stays held inside the ${COMMISSION_HOLD_DAYS}-day window.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPaying(null)}>Cancel</Button>
            <Button size="sm" onClick={recordPayout}><Landmark className="size-4" aria-hidden /> Record the payout</Button>
          </div>
        }
      >
        {paying && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-secondary">Accrued</dt><dd className="font-medium tabular-nums">{money(paying.accrued)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Payable</dt><dd className="font-medium tabular-nums">{money(paying.payable)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Withholding</dt><dd className="font-medium tabular-nums">{money(paying.tds)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Net</dt><dd className="font-medium tabular-nums">{money(paying.net)}</dd></div>
            </dl>

            {!paying.tin && (
              <p className="flex items-start gap-1.5 rounded-md bg-safety-warning/10 px-3 py-2 text-xs text-safety-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                No TIN on file. A commission paid to a professional without one attracts the higher deduction, so the number is collected before the
                payment rather than after.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as (typeof PAYOUT_METHODS)[number])} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Reference</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque number, bKash trx id or bank reference" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
              <span className="mt-1 block text-xs text-text-secondary">A payment with no reference cannot be reconciled against a bank statement, so it is refused rather than recorded.</span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-text-primary">Prepared by</span>
                <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-text-primary">Approved by</span>
                <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2" />
                <span className="mt-1 block text-xs text-text-secondary">The two names have to differ: the same person preparing and approving a payment is what an auditor looks for first.</span>
              </label>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
