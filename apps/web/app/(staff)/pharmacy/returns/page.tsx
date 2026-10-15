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
import { Trash2, Undo2 } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { money } from '@/lib/billing';
import { EXPIRY_WARN_DAYS } from '@/lib/pharmacy';
import {
  PATIENT_REASONS,
  RETURN_CONDITIONS,
  RETURN_REASONS,
  RETURN_RULES,
  RETURN_WINDOW_DAYS,
  MIN_REMAINING_SHELF_DAYS,
  checkReturn,
  draftLine,
  returnRegister,
  returnStats,
  returnableDispenses,
  type ReturnCondition,
  type ReturnLineDraft,
  type SaleReturn,
} from '@/lib/returns';

/* Pharmacy sale returns and credit notes (legacy screen 013 — replaced) — the P3 sub-screen.
 *
 * The rules are in `lib/returns.ts` and the screen refuses on them where they belong: the seven-day window, sealed
 * packs only, cold chain never coming back, controlled medicines destroyed with a witness instead of restocked,
 * nothing returned to the shelf without a decision, and the credit going back the way the money came.
 *
 * Preview: the bills are the pharmacy module’s own synthetic dispenses. Nothing survives a reload; the rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

export default function PharmacyReturnsPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const dispenses = useMemo(() => returnableDispenses(day), [day]);
  const [register, setRegister] = useState<SaleReturn[]>(() => returnRegister(day));
  const [tab, setTab] = useState('counter');
  const [dispenseId, setDispenseId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, ReturnLineDraft>>({});
  const [reason, setReason] = useState(RETURN_REASONS[0]);
  const [patientReason, setPatientReason] = useState(PATIENT_REASONS[0]);
  const [witness, setWitness] = useState('Staff nurse M. Akter');
  const [approvedBy, setApprovedBy] = useState('Pharmacist in-charge');
  const [openReturnId, setOpenReturnId] = useState<string | null>(null);

  const dispense = dispenses.find((d) => d.id === dispenseId) ?? null;
  const stats = useMemo(() => returnStats(day, dispenses), [day, dispenses]);
  const openReturn = register.find((r) => r.id === openReturnId) ?? null;

  const startReturn = (id: string) => {
    const d = dispenses.find((x) => x.id === id);
    if (!d) return;
    const drafts: Record<string, ReturnLineDraft> = {};
    d.lines.forEach((l) => {
      drafts[l.id] = { ...draftLine(l, undefined), returnQty: 0 };
    });
    setDispenseId(id);
    setLines(drafts);
    setTab('counter');
  };

  const patchLine = (id: string, patch: Partial<ReturnLineDraft>) => setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const chosenLines = Object.values(lines).filter((l) => l.returnQty > 0);
  const checks = dispense ? chosenLines.map((l) => ({ line: l, check: checkReturn(dispense, l, day) })) : [];
  const blocked = checks.filter((c) => !c.check.ok);
  const credit = checks.filter((c) => c.check.ok).reduce((n, c) => n + c.check.credit, 0);
  const willRestock = checks.filter((c) => c.check.ok && c.check.restock);
  const willWriteOff = checks.filter((c) => c.check.ok && !c.check.restock);

  const issueReturn = () => {
    if (!dispense) return;
    if (chosenLines.length === 0) {
      push({ title: 'Put a quantity against the line that is coming back.', tone: 'critical' });
      return;
    }
    if (blocked.length > 0) {
      push({ title: `Refused — ${blocked[0].check.blockers[0]}`, tone: 'critical' });
      return;
    }
    const note = `CN-${day.slice(2, 4)}${day.slice(5, 7)}-${String(6200 + register.length)}`;
    const record: SaleReturn = {
      id: `RET-${4300 + register.length}`,
      creditNote: note,
      dispenseId: dispense.id,
      rxNumber: dispense.rxNumber,
      mrn: dispense.patient.mrn,
      patientName: dispense.patient.name,
      at: `${day} 12:15`,
      lines: checks.map(({ line, check }) => ({
        name: line.name,
        batchNo: line.batchNo,
        qty: line.returnQty,
        credit: check.credit,
        restocked: check.restock,
        condition: line.condition,
      })),
      reason: `${reason}${patientReason ? ` · patient: ${patientReason.toLowerCase()}` : ''}`,
      creditedTo: 'Patient',
      method: 'Cash',
      approvedBy,
      ...(willWriteOff.length > 0 ? { destruction: { qty: willWriteOff.reduce((n, c) => n + c.line.returnQty, 0), witnessedBy: witness, because: 'Not restockable: written off with a witness and a reason, recorded in the stock ledger.' } } : {}),
      total: credit,
    };
    setRegister((r) => [record, ...r]);
    setDispenseId(null);
    setLines({});
    queueWrite(`Pharmacy return ${record.id} on ${dispense.rxNumber}: ${money(credit)} credited, ${willRestock.length} line(s) to quarantine`, {
      // A return credits the sale: another document against the invoice, and the quarantine lines are on it.
      id: 'createInvoice',
      recordId: record.id,
      fields: { creditNoteOf: dispense.rxNumber, credit, restocked: willRestock.length, writtenOff: willWriteOff.length },
    });
    push({
      title: `${money(credit)} credited — ${note}`,
      description: `${willRestock.length} line(s) to quarantine for a restock decision, ${willWriteOff.length} written off${willWriteOff.length ? ` with ${witness} witnessing` : ''}. The credit note goes back where the money came from.`,
      tone: 'success',
    });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Undo2 className="size-5 text-brand-600" aria-hidden />
            Sale returns and credit notes
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — medicines coming back: what may be restocked, what is written off, and who witnessed it.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Returns today" value={String(stats.returnsToday)} definition={`Returns inside the ${RETURN_WINDOW_DAYS}-day window, each with its original bill.`} asOf={day} />
        <KpiTile label="Credited" value={money(stats.valueReturned)} definition="Total credit notes issued today, whatever the method it goes back by." asOf={day} />
        <KpiTile label="Restocked" value={String(stats.restocked)} definition={`Returns that went back on the shelf: sealed, in date, and with more than ${MIN_REMAINING_SHELF_DAYS} days of shelf life left.`} asOf={day} />
        <KpiTile label="Written off" value={money(stats.writtenOff)} definition="Value destroyed rather than restocked — opened packs, broken cold chain, controlled medicines." asOf={day} footnote={`${stats.destructions} destruction(s) with a witness`} />
        <KpiTile label="Return rate" value={`${stats.returnRate} %`} definition="Returns as a share of today’s dispensed prescriptions. A rate that climbs is a prescribing or a counselling problem, not a stocking one." asOf={day} />
        <KpiTile label={`Expiring in ${EXPIRY_WARN_DAYS} days`} value={String(stats.nearExpiryUnits)} definition="Units nearing expiry, which is what a return has to be judged against — a return with less life left than the shelf already holds is not worth restocking." asOf={day} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'counter', label: 'Take a return', count: dispenses.length || undefined },
          { id: 'register', label: 'Register', count: register.length },
          { id: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'counter' && (
        <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
          <Panel title="Bills inside the window" className="h-fit">
            <p className="mb-2 text-xs text-text-secondary">
              Dispensed in the last {RETURN_WINDOW_DAYS} days. A return without the bill number is not a return — the bill is what proves where the
              medicine has been.
            </p>
            <ul className="space-y-1">
              {dispenses.slice(0, 9).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => startReturn(d.id)}
                    className={cx('w-full rounded-md px-3 py-2 text-left text-sm', dispenseId === d.id ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary')}
                  >
                    <span className="font-medium">{d.patient.name}</span>
                    <span className="block text-xs text-text-tertiary">
                      {d.rxNumber} · {d.dispensedAt?.slice(11) ?? 'not dispensed'} · {d.lines.length} line(s) · {money(d.total)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-3">
            {!dispense ? (
              <EmptyState
                title="No bill selected"
                description="Pick a bill on the left. The window, the quantity and the condition are all checked against the original lines — you cannot return what was not dispensed."
              />
            ) : (
              <>
                <Panel title={`${dispense.patient.name} · ${dispense.rxNumber}`} actions={<span className="text-xs text-text-secondary">Dispensed {dispense.dispensedAt?.slice(0, 16).replace('T', ' ')}</span>}>
                  <p className="text-sm text-text-secondary">
                    Allergies on the record: {dispense.patient.allergies || 'none'}. Prescriber {dispense.prescriber}; dispensed by {dispense.dispensedBy ?? 'the counter'}
                    {dispense.witness ? ` with ${dispense.witness} witnessing` : ''}.
                  </p>
                </Panel>

                <Panel title="Lines coming back" actions={<span className="text-xs text-text-secondary">Set the quantity and the condition per line</span>}>
                  <ul className="space-y-2">
                    {dispense.lines.map((l) => {
                      const draft = lines[l.id];
                      if (!draft) return null;
                      const check = chosenLines.some((c) => c.lineId === l.id) ? checkReturn(dispense, draft, day) : null;
                      return (
                        <li key={l.id} className={cx('rounded-md border px-3 py-2 text-sm', check && !check.ok ? 'border-safety-critical/40 bg-safety-critical/5' : 'border-border-subtle')}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <span className="font-medium text-text-primary">{l.drug.brand} {l.drug.strength}</span>
                              <span className="ml-2 text-xs text-text-tertiary">
                                dispensed {l.qty} × {money(l.drug.price)}
                                {l.substitution ? ` · dispensed as ${l.substitution.to}` : ''}
                              </span>
                            </span>
                            <span className="flex flex-wrap items-center gap-2">
                              <label className="text-xs text-text-secondary">
                                Returning
                                <input
                                  type="number"
                                  min={0}
                                  max={l.qty}
                                  value={draft.returnQty}
                                  onChange={(e) => patchLine(l.id, { returnQty: Math.max(0, Math.min(l.qty, Number(e.target.value))) })}
                                  className="ml-1 h-8 w-20 rounded-md border border-border-default bg-surface-default px-2 text-sm tabular-nums"
                                />
                              </label>
                              <label className="text-xs text-text-secondary">
                                Condition
                                <select
                                  value={draft.condition}
                                  onChange={(e) => patchLine(l.id, { condition: e.target.value as ReturnCondition })}
                                  className="ml-1 h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
                                >
                                  {RETURN_CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                                </select>
                              </label>
                            </span>
                          </div>
                          {check && (
                            <div className="mt-1 space-y-0.5 text-xs">
                              {check.blockers.map((b) => <p key={b} className={cx(TONE_TEXT.critical)}>{b}</p>)}
                              {check.warnings.map((w) => <p key={w} className={cx(TONE_TEXT.warning)}>{w}</p>)}
                              {check.ok && (
                                <p className={check.restock ? TONE_TEXT.success : TONE_TEXT.neutral}>
                                  {check.restock
                                    ? `Quarantine, then restock if the batch still has more than ${MIN_REMAINING_SHELF_DAYS} days of life — ${money(check.credit)} credited.`
                                    : `Quarantine, then write-off with a reason — ${money(check.credit)} credited, nothing back on the shelf.`}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                <Panel title="Why it is coming back">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-text-secondary">
                      Clinical / operational reason
                      <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                        {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      In the patient’s words
                      <select value={patientReason} onChange={(e) => setPatientReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm">
                        {PATIENT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Approved by
                      <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                    </label>
                    <label className="text-xs text-text-secondary">
                      Witness (any write-off)
                      <input value={witness} onChange={(e) => setWitness(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm" />
                    </label>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                      <p className="text-xs text-text-secondary">Credit</p>
                      <p className="font-medium tabular-nums">{money(credit)}</p>
                    </div>
                    <div className="rounded-md border border-border-subtle px-3 py-2 text-sm">
                      <p className="text-xs text-text-secondary">To quarantine for a restock decision</p>
                      <p className="font-medium">{willRestock.length} line(s)</p>
                    </div>
                    <div className={cx('rounded-md border px-3 py-2 text-sm', willWriteOff.length ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                      <p className="text-xs text-text-secondary">To be written off</p>
                      <p className="font-medium">{willWriteOff.length} line(s){willWriteOff.length ? `, witnessed by ${witness}` : ''}</p>
                    </div>
                  </div>

                  {blocked.length > 0 && (
                    <p className={cx('mt-2 text-sm', TONE_TEXT.critical)} role="status">
                      {blocked.length} line(s) cannot be accepted as they stand: {blocked[0].check.blockers[0]}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={issueReturn} disabled={blocked.length > 0}>
                      <Undo2 className="size-4" aria-hidden /> Accept the return and issue the credit note
                    </Button>
                    <Button variant="ghost" onClick={() => { setDispenseId(null); setLines({}); }}>Clear</Button>
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'register' && (
        <Panel title="Returns and credit notes today" actions={<span className="text-xs text-text-secondary">Every return keeps its bill number, its reason and its witness</span>}>
          <ListView
            id="returns-register"
            caption="Pharmacy returns register"
            height="28rem"
            rows={register}
            rowId={(r) => r.id}
            onRowClick={(r) => setOpenReturnId(r.id)}
            columns={[
              { key: 'creditNote', header: 'Credit note', width: '150px' },
              { key: 'patientName', header: 'Patient', render: (r) => (
                <span>
                  {r.patientName}
                  <span className="ml-2 text-xs text-text-tertiary">{r.mrn}</span>
                </span>
              ) },
              { key: 'rxNumber', header: 'Bill', width: '130px' },
              { key: 'at', header: 'At', hideBelow: 'md', width: '110px', render: (r) => r.at.slice(11) },
              { key: 'reason', header: 'Reason', hideBelow: 'lg', render: (r) => <span className="text-xs">{r.reason}</span> },
              { key: 'restock', header: 'Outcome', width: '190px', render: (r) => (
                r.lines.every((l) => l.restocked)
                  ? <span className={cx(TONE_TEXT.success)}>to quarantine, restock</span>
                  : <span className={cx(TONE_TEXT.warning)}>write-off{r.destruction ? ` · ${r.destruction.witnessedBy}` : ''}</span>
              ) },
              { key: 'total', header: 'Credit', numeric: true, align: 'right', width: '120px', render: (r) => money(r.total) },
            ]}
          />
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="Seven rules for a return">
            <ul className="space-y-2 text-sm">
              {RETURN_RULES.map((r) => (
                <li key={r.title}>
                  <span className="font-medium text-text-primary">{r.title}.</span> <span className="text-text-secondary">{r.because}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="What each condition does to the stock">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Return conditions and their outcome</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Condition</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Goes back on the shelf</th>
                    <th scope="col" className="py-1.5 font-medium">Because</th>
                  </tr>
                </thead>
                <tbody>
                  {RETURN_CONDITIONS.map((c) => (
                    <tr key={c.id} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{c.id}</td>
                      <td className={cx('py-1.5 pr-3', c.restock ? TONE_TEXT.success : TONE_TEXT.warning)}>{c.restock ? 'yes, after quarantine' : 'no — written off'}</td>
                      <td className="py-1.5 text-text-secondary">{c.because}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">
              A controlled medicine never appears in this table as restockable: it goes to the controlled register with a witness, because a
              controlled substance that quietly returns to the shelf is a controlled substance that stops being counted.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- return sheet */}
      <Sheet
        open={Boolean(openReturn)}
        onClose={() => setOpenReturnId(null)}
        title={openReturn ? `${openReturn.creditNote} — ${openReturn.patientName}` : 'Return'}
        description={openReturn ? `Against ${openReturn.rxNumber} · ${openReturn.at.slice(0, 16).replace('T', ' ')} · approved by ${openReturn.approvedBy}` : undefined}
      >
        {openReturn && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-text-secondary">Credit</dt><dd className="font-medium tabular-nums">{money(openReturn.total)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Credited to</dt><dd className="font-medium">{openReturn.creditedTo} · {openReturn.method}</dd></div>
              <div><dt className="text-xs text-text-secondary">Reason</dt><dd className="font-medium">{openReturn.reason}</dd></div>
            </dl>

            <ul className="space-y-1">
              {openReturn.lines.map((l, i) => (
                <li key={`${l.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2">
                  <span>
                    {l.name}
                    <span className="ml-2 text-xs text-text-tertiary">batch {l.batchNo} · {l.condition}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className={cx(l.restocked ? TONE_TEXT.success : TONE_TEXT.warning)}>{l.restocked ? 'quarantine → restock' : 'quarantine → write-off'}</span>
                    <span className="tabular-nums">{l.qty} × {money(l.credit / l.qty)} = {money(l.credit)}</span>
                  </span>
                </li>
              ))}
            </ul>

            {openReturn.destruction && (
              <div className="rounded-md border border-safety-warning/40 bg-safety-warning/5 px-3 py-2">
                <p className="flex items-center gap-1.5 font-medium text-text-primary">
                  <Trash2 className="size-4 text-safety-warning" aria-hidden /> Destruction recorded
                </p>
                <p className="text-text-secondary">
                  {openReturn.destruction.qty} unit(s), witnessed by {openReturn.destruction.witnessedBy}. {openReturn.destruction.because}
                </p>
              </div>
            )}

            <p className="text-xs text-text-tertiary">
              The stock ledger on <Link href="/inventory" className="underline">inventory</Link> receives the quarantine movement, the dispensing queue
              on <Link href="/pharmacy" className="underline">pharmacy</Link> shows the return against the original prescription, and the credit note
              reaches the patient’s account through <Link href="/billing/opd-patient" className="underline">the OPD patient view</Link>.
            </p>
          </div>
        )}
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/pharmacy/search" className="underline">medicine search</Link> is what the counter uses before handing anything
        over, and <Link href="/inventory" className="underline">inventory</Link> owns the batches these returns move.
      </p>
    </div>
  );
}
