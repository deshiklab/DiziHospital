'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  KpiTile,
  Panel,
  Sheet,
  Tabs,
  cx,
  useToast,
} from '@dizi/ui';
import { Printer, Search, Wallet } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { patients } from '@/lib/mock';
import { money } from '@/lib/billing';
import { FOLLOW_UP_FREE_DAYS, encounterTotals, opdAccount, type OpdEncounter } from '@/lib/opd';

/* OPD patient view (legacy screen 020 — the patient’s OPD account — replaced) — the P2 sub-screen the counter
 * turns to when a patient says “I have already paid for this”.
 *
 * It is an account, not a balance: every visit, what it was billed, what was paid and by which method, what was
 * refunded and why, and what is still open — with the dates and the receipt numbers, so the conversation at the
 * counter takes a minute instead of an argument. `lib/opd.ts` computes it from the same encounters the billing
 * screen issues, so the two can never disagree.
 *
 * Preview: the account is synthetic. Nothing survives a reload; the arithmetic is real.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const STATUS_CHIP: Record<OpdEncounter['status'], string> = {
  Draft: 'bg-surface-sunken text-text-secondary',
  Issued: 'bg-safety-warning/10 text-safety-warning',
  'Partially paid': 'bg-safety-warning/10 text-safety-warning',
  Paid: 'bg-safety-success/10 text-safety-success',
  Cancelled: 'bg-safety-critical/10 text-safety-critical',
};

export function OpdPatientView({ initialMrn, day }: { initialMrn?: string; day: string }) {
  const { push } = useToast();
  const [query, setQuery] = useState(initialMrn ?? patients[0].mrn);
  const [mrn, setMrn] = useState(initialMrn ?? patients[0].mrn);
  const [tab, setTab] = useState('account');
  const [openId, setOpenId] = useState<string | null>(null);

  const account = useMemo(() => opdAccount(mrn, day), [mrn, day]);
  const open = account.visits.find((v) => v.id === openId) ?? null;
  const matches = patients.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return p.mrn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.phone.includes(q);
  }).slice(0, 6);

  const statementLines = account.visits.flatMap((v) => [
    ...v.lines.filter((l) => l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100) > 0).map((l) => ({
      id: `${v.id}-${l.id}`,
      day: v.day,
      kind: 'Charge' as const,
      what: `${l.name}${l.discountPct ? ` (${l.discountPct}% off)` : ''}`,
      reference: v.receipt ?? '—',
      amount: l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100),
    })),
    ...v.payments.map((p) => ({ id: `${v.id}-${p.id}`, day: v.day, kind: 'Payment' as const, what: `${p.method} received`, reference: p.reference ?? v.receipt ?? '—', amount: -p.amount })),
    ...v.refunds.map((r) => ({ id: `${v.id}-${r.id}`, day: v.day, kind: 'Refund' as const, what: r.because, reference: v.receipt ?? '—', amount: -r.amount })),
  ]).sort((a, b) => b.day.localeCompare(a.day));

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Wallet className="size-5 text-brand-600" aria-hidden />
            OPD patient account
          </h1>
          <p className="text-sm text-text-secondary">
            Every visit, charge, payment and refund on one page — so “I have already paid for this” takes a minute to answer.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-text-secondary">
            Patient (MRN, name or phone)
            <div className="mt-1 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SH-102311"
                className="h-9 w-52 rounded-md border border-border-default bg-surface-default px-2 text-sm"
              />
              <Button
                variant="ghost"
                onClick={() => {
                  if (matches.length === 0) {
                    push({ title: 'No patient matches that — try the MRN from the receipt, or the phone number.', tone: 'critical' });
                    return;
                  }
                  setMrn(matches[0].mrn);
                }}
              >
                <Search className="size-4" aria-hidden /> Open
              </Button>
            </div>
          </label>
        </div>
      </header>

      {matches.length > 0 && query.trim() && query !== mrn && (
        <Panel title="Matches">
          <ul className="space-y-1">
            {matches.map((p) => (
              <li key={p.mrn}>
                <button
                  type="button"
                  onClick={() => { setMrn(p.mrn); setQuery(p.mrn); }}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-sunken hover:text-text-primary"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-text-tertiary">{p.mrn} · {p.phone} · {p.payer}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!account.patient ? (
        <EmptyState title="No patient loaded" description="Search by MRN, name or phone number to open an account." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
            <KpiTile label="Patient" value={account.patient.name} definition={`${account.patient.mrn} · ${account.patient.age} · ${account.patient.sex}`} asOf={day} />
            <KpiTile label="Payer" value={account.patient.payer} definition={account.payerCoverage > 0 ? `This payer settles ${Math.round(account.payerCoverage * 100)} % of the lines marked to them.` : 'Self pay: every line is the patient’s.'} asOf={day} />
            <KpiTile label="Billed" value={money(account.billed)} definition="Net of discounts across every visit in this account, cancelled encounters excluded." asOf={day} footnote={`${account.visits.length} visit(s)`} />
            <KpiTile label="Paid" value={money(account.paid)} definition="Everything received, by any method, with the reference recorded." asOf={day} />
            <KpiTile label="Refunded" value={money(account.refunded)} definition="Money returned, back to the method it came by, with the reason on the record." asOf={day} />
            <KpiTile label="Outstanding" value={money(account.due)} definition="Billed and not yet paid — each one a collection gate still closed." asOf={day} />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'account', label: 'Visits', count: account.visits.length },
              { id: 'statement', label: 'Statement', count: statementLines.length },
              { id: 'rules', label: 'How this account works' },
            ]}
          />

          {tab === 'account' && (
            <Panel title={`Visits — ${account.patient.name}`}>
              <ListView
                id="opd-patient-visits"
                caption="OPD visits for this patient"
                height="26rem"
                rows={account.visits}
                rowId={(v) => v.id}
                onRowClick={(v) => setOpenId(v.id)}
                columns={[
                  { key: 'day', header: 'Visit date', width: '120px' },
                  { key: 'receipt', header: 'Receipt', width: '150px', render: (v) => v.receipt ?? '—' },
                  { key: 'department', header: 'Department', width: '150px' },
                  { key: 'doctorName', header: 'Doctor', hideBelow: 'md', render: (v) => `${v.doctorName} · ${v.room}` },
                  { key: 'type', header: 'Type', width: '110px', render: (v) => (
                    <span className={cx(v.type === 'Follow-up' ? TONE_TEXT.info : TONE_TEXT.neutral)}>{v.type}{!v.consultationCharged ? ' (fee waived)' : ''}</span>
                  ) },
                  { key: 'net', header: 'Net', numeric: true, align: 'right', width: '130px', render: (v) => money(encounterTotals(v).net) },
                  { key: 'due', header: 'Due', numeric: true, align: 'right', width: '120px', render: (v) => (
                    <span className={cx(encounterTotals(v).due > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(encounterTotals(v).due)}</span>
                  ) },
                  { key: 'status', header: 'Status', width: '140px', render: (v) => (
                    <span className={cx('rounded-full px-2 py-0.5 text-xs', STATUS_CHIP[v.status])}>{v.status}</span>
                  ) },
                ]}
              />
            </Panel>
          )}

          {tab === 'statement' && (
            <Panel title="Statement" actions={<span className="text-xs text-text-secondary">Charges positive, payments and refunds negative — a running account, not a single figure</span>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <caption className="sr-only">Statement for this patient</caption>
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Date</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Kind</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">What</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Reference</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementLines.map((l) => (
                      <tr key={l.id} className="border-b border-border-subtle last:border-0">
                        <td className="py-1.5 pr-3 tabular-nums">{l.day}</td>
                        <td className={cx('py-1.5 pr-3 font-medium', l.kind === 'Charge' ? TONE_TEXT.neutral : l.kind === 'Refund' ? TONE_TEXT.warning : TONE_TEXT.success)}>{l.kind}</td>
                        <td className="py-1.5 pr-3">{l.what}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-text-tertiary">{l.reference}</td>
                        <td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-default font-medium">
                      <td className="py-1.5 pr-3" colSpan={4}>Outstanding</td>
                      <td className="py-1.5 text-right tabular-nums">{money(account.due)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" onClick={() => push({ title: 'Statement sent to the print queue', description: 'The printed statement carries the receipt numbers, which is what a query is actually about.', tone: 'info' })}>
                  <Printer className="size-4" aria-hidden /> Print the statement
                </Button>
              </div>
            </Panel>
          )}

          {tab === 'rules' && (
            <div className="space-y-3">
              <Panel title="What this account answers, and what it does not">
                <ul className="space-y-2 text-sm">
                  <li><span className="font-medium text-text-primary">It answers “have I paid for this?”</span> <span className="text-text-secondary">with the date, the receipt number, the method and the reference — the four things a counter argument is actually about.</span></li>
                  <li><span className="font-medium text-text-primary">It shows a waived fee as a line, not as an absence.</span> <span className="text-text-secondary">A follow-up inside {FOLLOW_UP_FREE_DAYS} days appears at zero with the reason, so a patient can see that nothing was hidden from them.</span></li>
                  <li><span className="font-medium text-text-primary">It separates the payer’s part from the patient’s.</span> <span className="text-text-secondary">A corporate patient can see which lines the employer covers, line by line, without waiting for the accounts desk to explain it next week.</span></li>
                  <li><span className="font-medium text-text-primary">It does not show clinical results.</span> <span className="text-text-secondary">This is a billing account: results live on the patient’s clinical record, behind the same access rules as the consultation itself.</span></li>
                  <li><span className="font-medium text-text-primary">It is a ledger, not a balance.</span> <span className="text-text-secondary">Every figure here can be traced to a visit, a line and a receipt — which is the difference between a statement and an assertion.</span></li>
                </ul>
              </Panel>
              <Panel title="Where the numbers come from">
                <p className="text-sm text-text-secondary">
                  The same encounters the counter issues on <Link href="/billing/opd" className="underline">the OPD bill screen</Link>, plus the
                  historical visits seeded for this patient. Refunds reduce the account by the amount that went back, by the method it went back by;
                  cancelled encounters keep their lines but are excluded from the totals, because the sequence is never re-used and the day-end sheet
                  has to reconcile.
                </p>
              </Panel>
            </div>
          )}
        </>
      )}

      <Sheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open ? `${open.receipt ?? open.id} — ${open.day}` : 'Visit'}
        description={open ? `${open.department} · ${open.doctorName} · ${open.room} · ${open.type}` : undefined}
      >
        {open && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {open.lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                  <span>
                    {l.name}
                    <span className="ml-2 text-xs text-text-tertiary">{l.chargedTo === 'Payer' ? 'payer' : 'patient'}{l.discountReason ? ` · ${l.discountReason}` : ''}</span>
                  </span>
                  <span className="tabular-nums">{money(l.qty * l.unitPrice - Math.round((l.qty * l.unitPrice * l.discountPct) / 100))}</span>
                </li>
              ))}
            </ul>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Net</dt><dd className="font-medium tabular-nums">{money(encounterTotals(open).net)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Paid</dt><dd className="font-medium tabular-nums">{money(encounterTotals(open).paid)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Due</dt><dd className={cx('font-medium tabular-nums', encounterTotals(open).due > 0 ? TONE_TEXT.warning : TONE_TEXT.success)}>{money(encounterTotals(open).due)}</dd></div>
            </dl>
            {open.payments.length > 0 && (
              <div>
                <p className="font-medium text-text-primary">Payments</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {open.payments.map((p) => <li key={p.id}>· {money(p.amount)} by {p.method}{p.reference ? ` (${p.reference})` : ''} at {p.at.slice(11)} — {p.receivedBy}</li>)}
                </ul>
              </div>
            )}
            {open.refunds.length > 0 && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="font-medium text-text-primary">Refunds on this visit</p>
                <ul className="mt-1 space-y-1 text-text-secondary">
                  {open.refunds.map((r) => <li key={r.id}>· {money(r.amount)} by {r.method} — {r.because} (approved by {r.approvedBy})</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
