'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, DataGrid, EmptyState, KpiTile, Panel, SafetyBanner, Sheet, Tabs, cx, useToast, type Column } from '@dizi/ui';
import { BadgeCheck, FileWarning, Landmark, Send, ShieldAlert, TriangleAlert, Undo2 } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money, type Payer } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  AGEING_BUCKETS,
  CLAIM_NEEDS_AGREEMENT,
  CLAIM_OPEN,
  REJECTION_REASONS,
  SHORT_PAY_REASONS,
  ageingBucket,
  checkClaim,
  claimTone,
  claimsSnapshot,
  generateClaims,
  payerAgreement,
  settleClaim,
  type Claim,
  type ClaimStatus,
} from '@/lib/finance';

/* TPA and insurance claims (legacy `admin/tpamanagement` — replaced) — the receivables side of P6.
 *
 * Billing says the payer owes; this screen is where the hospital gets paid, and it is built around the four ways
 * that goes wrong: no pre-authorisation, missing documents, a query nobody answers, and a short payment nobody
 * signed for. Each of those is a refusal or a named line here rather than a surprise on a remittance advice.
 *
 * Preview: the claims are the branch's payer-billed invoices of the day, with answers. Nothing survives a reload;
 * the rules and the ageing do.
 */

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-text-secondary',
  info: 'text-brand-600',
  warning: 'text-safety-warning',
  success: 'text-safety-success',
  critical: 'text-safety-critical',
};

export default function TpaPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const generated = useMemo(() => generateClaims(day, day), [day]);
  /** Answers recorded this session: the payer replied, and the claim now carries the reply. */
  const [answered, setAnswered] = useState<Record<string, Claim>>({});
  const [tab, setTab] = useState('pipeline');
  /* The register is a receivables ledger, not a day list: two hundred-odd claims on one page is not a screen
   * anybody works from. So it is queried like the production grid will be — a page, a page size, a search and a
   * saved view — and the preview does the slicing the server will do. */
  const [view, setView] = useState('Open register');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openNo, setOpenNo] = useState<string | null>(null);
  const [settling, setSettling] = useState<Claim | null>(null);
  const [allowed, setAllowed] = useState('');
  const [shortPayCode, setShortPayCode] = useState('tariff');
  const [rejection, setRejection] = useState<string>('');
  const [absorbedBy, setAbsorbedBy] = useState('');

  const claims = useMemo(
    () => generated.map((c) => answered[c.claimNo] ?? c),
    [generated, answered],
  );
  const snapshot = useMemo(() => claimsSnapshot(claims), [claims]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inView = claims.filter((c) =>
      view === 'Open register' ? CLAIM_OPEN.includes(c.status) && c.basis === 'Final bill'
        : view === 'Awaiting pre-authorisation' ? c.status === 'Pre-auth requested' || c.status === 'Pre-auth approved'
          : view === 'Short-paid or rejected' ? c.disallowed > 0
            : view === 'Overdue' ? c.overdueDays > 0
              : true);
    const searched = q
      ? inView.filter((c) => [c.claimNo, c.invoiceNo, c.mrn, c.patientName, c.payer, c.tpa ?? '', c.preAuth ?? '', c.status].some((f) => f.toLowerCase().includes(q)))
      : inView;
    return searched;
  }, [claims, view, query]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const open = claims.find((c) => c.claimNo === openNo) ?? null;
  const agreement = open ? payerAgreement(open.payer) : null;
  const unassigned = claims.filter((c) => c.disallowed > 0 && c.absorbed > 0 && !c.absorbedBy);

  const submit = (claim: Claim) => {
    const check = checkClaim(claim, claims);
    if (!check.ok) {
      push({ title: `Refused — ${check.refusals[0].message}`, tone: 'critical' });
      return;
    }
    const outcome = queueWrite(`Claim ${claim.claimNo} against ${claim.invoiceNo}: ${money(claim.claimed)} to ${claim.payer}`, {
      id: 'submitClaim',
      recordId: claim.claimNo,
      fields: { invoiceNo: claim.invoiceNo, payer: claim.payer, claimed: claim.claimed, preAuth: claim.preAuth ?? null, documents: claim.documents.length },
    });
    if (!outcome.queued) {
      push({ title: 'Recorded, not submitted', description: `The contract will not queue this write ${outcome.because}`, tone: 'warning' });
      return;
    }
    setAnswered((rows) => ({ ...rows, [claim.claimNo]: { ...claim, status: 'Submitted' as ClaimStatus, submittedAt: `${day} 11:30`, ageDays: 0, overdueDays: 0 } }));
    push({
      title: `${claim.claimNo} submitted — ${money(claim.claimed)} claimed`,
      description: `${claim.documents.length} document(s) with it${claim.preAuth ? `, pre-authorisation ${claim.preAuth}` : ''}. The clock now runs against ${agreement?.settlementDays ?? 30} days, and it is measured from today, not from the query.`,
      tone: 'success',
    });
  };

  const record = () => {
    if (!settling) return;
    const value = Number(allowed);
    if (!rejection && (!Number.isFinite(value) || value < 0 || value > settling.claimed)) {
      push({ title: `Enter what the payer allowed, up to ${money(settling.claimed)}.`, tone: 'critical' });
      return;
    }
    const line = settleClaim(settling, {
      allowed: rejection ? 0 : value,
      code: rejection ? null : shortPayCode,
      rejection: rejection || null,
      absorbedBy: absorbedBy.trim() || null,
      at: `${day} 15:40`,
    });
    const next: Claim = {
      ...settling,
      status: line.status,
      allowed: line.allowed,
      disallowed: line.disallowed,
      toPatient: line.toPatient,
      absorbed: line.absorbed,
      absorbedBy: line.absorbedBy,
      shortPayCode: line.shortPayCode,
      rejectionReason: line.rejectionReason,
      respondedAt: `${day} 15:40`,
      settledAmount: line.allowed - line.toPatient,
      settledAt: line.status === 'Settled' ? `${day} 15:40` : null,
      notes: [...settling.notes, line.because],
    };
    setAnswered((rows) => ({ ...rows, [settling.claimNo]: next }));
    const outcome = queueWrite(`Claim ${settling.claimNo}: payer answered ${money(line.allowed)} of ${money(settling.claimed)}`, {
      id: 'recordClaimResponse',
      recordId: settling.claimNo,
      fields: { allowed: line.allowed, disallowed: line.disallowed, shortPayCode: line.shortPayCode ?? null, rejection: line.rejectionReason ?? null, absorbedBy: line.absorbedBy ?? null, settled: line.allowed - line.toPatient },
    });
    setSettling(null);
    setAllowed('');
    setRejection('');
    setAbsorbedBy('');
    push({
      title: outcome.queued ? `${settling.claimNo} — ${line.status}` : `${settling.claimNo} recorded locally only`,
      description: outcome.queued ? line.because : `The contract will not queue this write ${outcome.because}`,
      tone: line.absorbed > 0 && !line.absorbedBy ? 'warning' : 'success',
    });
  };

  const columns: Array<Column<Claim>> = [
    { key: 'claimNo', header: 'Claim', width: '9rem', render: (c) => (
      <span className="tabular-nums">
        {c.claimNo}
        <span className="block text-xs font-normal text-text-tertiary">{c.invoiceNo}</span>
      </span>
    ) },
    { key: 'patient', header: 'Patient', render: (c) => (
      <span>
        {c.patientName}
        <span className="block text-xs text-text-tertiary">{c.mrn} · {c.payer}{c.tpa ? ` · via ${c.tpa}` : ''}</span>
      </span>
    ) },
    { key: 'status', header: 'Status', width: '9rem', render: (c) => (
      <span className={cx('font-medium', TONE_TEXT[claimTone[c.status]])}>
        {c.status}
        {c.preAuth && <span className="block text-xs font-normal text-text-tertiary">{c.preAuth}</span>}
      </span>
    ) },
    { key: 'claimed', header: 'Claimed', align: 'right', width: '8rem', render: (c) => <span className="tabular-nums">{money(c.claimed)}</span> },
    { key: 'allowed', header: 'Allowed', align: 'right', width: '8rem', render: (c) => (
      <span className="tabular-nums">
        {c.allowed > 0 ? money(c.allowed) : '—'}
        {c.disallowed > 0 && <span className="block text-xs text-safety-warning">{`−${money(c.disallowed)}`}</span>}
      </span>
    ) },
    { key: 'age', header: 'Age', align: 'right', width: '7rem', render: (c) => (
      <span className="tabular-nums">
        {c.ageDays}d
        <span className={cx('block text-xs', c.overdueDays > 0 ? 'text-safety-critical' : 'text-text-tertiary')}>{ageingBucket(c.overdueDays)}</span>
      </span>
    ) },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Landmark className="size-5 text-brand-600" aria-hidden />
            TPA and insurance claims
          </h1>
          <p className="text-sm text-text-secondary">
            {day} — what the payers owe, what they allowed, what came back short and who signed for it.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <Link href="/finance">
          <Button variant="secondary" size="sm">Money today</Button>
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Claimed" value={money(snapshot.totals.claimed)} definition="The payer’s share of today’s bills, after the agreed discount. Billed value is not what a payer owes." asOf={day} />
        <KpiTile label="Outstanding" value={money(snapshot.totals.outstanding)} definition={`${CLAIM_OPEN.length}-state claims that have not been answered: the hospital is owed this money and does not have it.`} asOf={day} />
        <KpiTile label="Short-paid" value={money(snapshot.totals.shortPaid)} definition="Disallowed on a remittance advice. Every line of it carries a reason code, because an unexplained short payment teaches nothing." asOf={day} />
        <KpiTile label="Unassigned write-off" value={money(snapshot.totals.unassigned)} definition="Short-paid money nobody has been named as absorbing. This is the number a finance committee asks about." asOf={day} />
        <KpiTile label="Overdue" value={String(snapshot.overdue.length)} definition={`Claims past the payer’s own settlement period${snapshot.overdue.length > 0 ? ` — the oldest is ${snapshot.overdue[0].overdueDays} days over` : ''}.`} asOf={day} />
      </div>

      {unassigned.length > 0 && (
        <SafetyBanner severity="warning" title={`${unassigned.length} short payment${unassigned.length === 1 ? '' : 's'} with nobody’s name on it — ${money(snapshot.totals.unassigned)}`}>
          <p>
            A disallowed amount stays open until somebody accepts it: absorbed by the hospital, billed to the patient, or sent back for rework.
            An unassigned write-off is money that left without a decision, which is exactly what an auditor looks for.
          </p>
        </SafetyBanner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pipeline', label: 'Pipeline', count: claims.length },
          { id: 'ageing', label: 'Ageing', count: snapshot.overdue.length || undefined },
          { id: 'reasons', label: 'Short payments' },
          { id: 'rules', label: 'The agreements' },
        ]}
      />

      {tab === 'pipeline' && (
        <Panel>
          <DataGrid<Claim>
            id="tpa-claims"
            caption={`Payer claims — ${view.toLowerCase()}, ${filtered.length} of ${claims.length} in the register`}
            columns={columns}
            rows={pageRows}
            total={filtered.length}
            page={Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))}
            pageSize={pageSize}
            onQuery={(q) => { setPage(q.page); setPageSize(q.pageSize); }}
            quickSearch={{ value: query, onChange: (v) => { setQuery(v); setPage(1); }, placeholder: 'Claim, bill, MRN, patient, payer, pre-authorisation…' }}
            savedViews={['Open register', 'Awaiting pre-authorisation', 'Short-paid or rejected', 'Overdue', 'Everything']}
            activeView={view}
            onViewChange={(v) => { setView(v); setPage(1); }}
            printMeta={`Branch: Main Campus · ${view} · ${day}`}
            exportFileName={`claims-${day}`}
            rowId={(c) => c.claimNo}
            height="28rem"
            onRowClick={(c) => setOpenNo(c.claimNo)}
            rowActions={(c) => [
              ...(c.status === 'Draft' || c.status === 'Pre-auth approved'
                ? [{ label: 'Submit the claim', icon: <Send className="size-4" aria-hidden />, onSelect: () => submit(c) }]
                : []),
              ...(c.status === 'Submitted' || c.status === 'Query raised'
                ? [{ label: 'Record the payer’s answer', icon: <BadgeCheck className="size-4" aria-hidden />, onSelect: () => setSettling(c) }]
                : []),
              { label: 'Open the claim', icon: <FileWarning className="size-4" aria-hidden />, onSelect: () => setOpenNo(c.claimNo) },
            ]}
          />
          <p className="mt-2 text-xs text-text-secondary">
            Submitting is refused — with the payer’s own rule — when pre-authorisation or a document is missing, and the payer’s answer is recorded
            against the claim rather than on a new one. The views and the export come from the grid: in production `onQuery` goes to the server, and
            here it slices the same register in memory.
          </p>
        </Panel>
      )}

      {tab === 'ageing' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Ageing against each payer’s promise">
            <ul className="space-y-2 text-sm">
              {snapshot.ageing.map((row) => (
                <li key={row.bucket} className="border-b border-border-subtle pb-2">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cx('font-medium', row.bucket === 'Within terms' ? 'text-text-primary' : row.bucket === 'Over 90' ? 'text-safety-critical' : 'text-safety-warning')}>{row.bucket}</span>
                    <span className="shrink-0 tabular-nums">{row.count} claim{row.count === 1 ? '' : 's'} · {money(row.amount)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-text-secondary">{row.because}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">
              The first bucket is the payer’s own settlement period — {AGEING_BUCKETS.join(' · ')}. A query does not stop the clock: a claim sitting
              with a payer for a hundred days is chased whatever stage it claims to be at.
            </p>
          </Panel>

          <Panel title="To chase, oldest first">
            {snapshot.overdue.length === 0 ? (
              <p className="text-sm text-safety-success">Every open claim is inside the payer’s promised period.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {snapshot.overdue.map((c) => (
                  <li key={c.claimNo} className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2">
                    <span>
                      <span className="font-medium text-text-primary">{c.claimNo}</span>
                      <span className="block text-xs text-text-secondary">
                        {c.payer}{c.tpa ? ` via ${c.tpa}` : ''} · {c.invoiceNo} · submitted {c.submittedAt?.slice(0, 10) ?? 'not submitted'}
                      </span>
                      <span className="block text-xs text-text-tertiary">{c.status}{c.notes[0] ? ` · ${c.notes[0]}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block tabular-nums">{money(c.claimed)}</span>
                      <span className="block text-xs text-safety-critical">{c.overdueDays} days over</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      )}

      {tab === 'reasons' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Why money came back short">
            {snapshot.reasons.length === 0 ? (
              <p className="text-sm text-text-secondary">No short payments recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {snapshot.reasons.map((r) => {
                  const rule = SHORT_PAY_REASONS.find((x) => x.code === r.code);
                  return (
                    <li key={r.code} className="border-b border-border-subtle pb-2">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-text-primary">{r.label}</span>
                        <span className="shrink-0 tabular-nums">{money(r.amount)}</span>
                      </span>
                      <span className="block text-xs text-text-secondary">
                        Carried by: <strong className="font-medium">{r.who}</strong> · {rule?.because}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-text-secondary">
              The vocabulary is fixed on purpose. A short payment recorded as “other” cannot be argued with a payer, reported to a finance
              committee, or learned from.
            </p>
          </Panel>

          <Panel title="Claims still waiting on paperwork">
            {snapshot.missingDocuments.length === 0 ? (
              <p className="text-sm text-safety-success">Every claim carries the documents its payer requires.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {snapshot.missingDocuments.map((c) => (
                  <li key={c.claimNo} className="border-b border-border-subtle pb-2">
                    <span className="font-medium text-text-primary">{c.claimNo} — {c.patientName}</span>
                    <span className="block text-xs text-safety-warning">{c.notes.find((n) => /Waiting on/.test(n))}</span>
                    <span className="block text-xs text-text-tertiary">
                      {payerAgreement(c.payer)?.documents.join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <Panel title="The payer agreements">
          <div className="space-y-3">
            {claims.length === 0 && <EmptyState title="No payer-billed invoices today" description="Every bill of the day is self-paid, so there is nothing to claim." />}
            {[...new Set(claims.map((c) => c.payer))].map((payer: Payer) => {
              const a = payerAgreement(payer);
              if (!a) {
                return (
                  <p key={payer} className="rounded-md bg-safety-warning/10 px-3 py-2 text-sm text-safety-warning">
                    {CLAIM_NEEDS_AGREEMENT}
                  </p>
                );
              }
              return (
                <div key={payer} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium text-text-primary">
                    {payer} <span className="text-xs font-normal text-text-secondary">· {a.kind}{a.tpa ? ` · via ${a.tpa}` : ''}</span>
                  </p>
                  <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                    <div><dt className="text-text-secondary">Settles in</dt><dd className="font-medium tabular-nums">{a.settlementDays} days</dd></div>
                    <div><dt className="text-text-secondary">Agreed discount</dt><dd className="font-medium tabular-nums">{a.discountPct} %</dd></div>
                    <div><dt className="text-text-secondary">Pre-authorisation above</dt><dd className="font-medium tabular-nums">{money(a.preAuthAbove)}</dd></div>
                    <div><dt className="text-text-secondary">Patient co-pay</dt><dd className="font-medium tabular-nums">{a.coPayPct} %</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-text-secondary">{a.because}</p>
                  <p className="mt-1 text-xs text-text-tertiary">Documents: {a.documents.join(' · ')}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ------------------------------------------------------------------ one claim */}
      <Sheet
        open={Boolean(open)}
        onClose={() => setOpenNo(null)}
        title={open ? `${open.claimNo} — ${open.patientName}` : 'Claim'}
        description={open ? `${open.invoiceNo} · ${open.payer}${open.tpa ? ` via ${open.tpa}` : ''} · ${open.claimed ? money(open.claimed) : ''} claimed · ${open.status}` : undefined}
        footer={
          open && (open.status === 'Draft' || open.status === 'Pre-auth approved') ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenNo(null)}>Close</Button>
              <Button size="sm" onClick={() => submit(open)}><Send className="size-4" aria-hidden /> Submit the claim</Button>
            </div>
          ) : open && (open.status === 'Submitted' || open.status === 'Query raised') ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenNo(null)}>Close</Button>
              <Button size="sm" onClick={() => { setSettling(open); setAllowed(String(open.claimed)); }}><BadgeCheck className="size-4" aria-hidden /> Record the answer</Button>
            </div>
          ) : (
            <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={() => setOpenNo(null)}>Close</Button></div>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-secondary">Claimed</dt><dd className="font-medium tabular-nums">{money(open.claimed)}</dd></div>
              <div><dt className="text-xs text-text-secondary">Allowed</dt><dd className="font-medium tabular-nums">{open.allowed > 0 ? money(open.allowed) : '—'}</dd></div>
              <div><dt className="text-xs text-text-secondary">To the patient</dt><dd className="font-medium tabular-nums">{open.toPatient > 0 ? money(open.toPatient) : '—'}</dd></div>
              <div><dt className="text-xs text-text-secondary">Age</dt><dd className={cx('font-medium tabular-nums', open.overdueDays > 0 && 'text-safety-critical')}>{open.ageDays} days · {ageingBucket(open.overdueDays)}</dd></div>
            </dl>

            {open.preAuth ? (
              <p className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700">
                Pre-authorisation {open.preAuth}{agreement ? ` — required above ${money(agreement.preAuthAbove)} on this payer.` : '.'}
              </p>
            ) : agreement && open.claimed > agreement.preAuthAbove ? (
              <p className="flex items-start gap-1.5 rounded-md bg-safety-critical/10 px-3 py-2 text-xs text-safety-critical">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                No pre-authorisation and the claim is above {money(agreement.preAuthAbove)}, so submitting it comes back as “no pre-authorisation” — the hospital’s loss.
              </p>
            ) : null}

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Documents</h3>
              <ul className="space-y-1 text-xs">
                {(agreement?.documents ?? []).map((doc) => {
                  const have = open.documents.includes(doc);
                  return (
                    <li key={doc} className="flex items-center gap-1.5">
                      {have ? <BadgeCheck className="size-3.5 text-safety-success" aria-hidden /> : <TriangleAlert className="size-3.5 text-safety-warning" aria-hidden />}
                      <span className={have ? 'text-text-primary' : 'text-safety-warning'}>{doc}{have ? '' : ' — missing'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {open.disallowed > 0 && (
              <div className="rounded-md bg-surface-sunken px-3 py-2">
                <p className="text-xs font-medium text-text-primary">
                  Short-paid {money(open.disallowed)} — {SHORT_PAY_REASONS.find((r) => r.code === open.shortPayCode)?.label ?? 'no reason recorded'}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {open.absorbed > 0
                    ? open.absorbedBy
                      ? `${money(open.absorbed)} absorbed by the hospital, signed ${open.absorbedBy}.`
                      : `${money(open.absorbed)} is unassigned — nobody has accepted it yet, so the claim stays open.`
                    : `${money(open.toPatient)} moved to the patient's account.`}
                </p>
              </div>
            )}

            {open.notes.length > 0 && (
              <ul className="space-y-1 text-xs text-text-secondary">
                {open.notes.map((n) => (
                  <li key={n} className="border-b border-border-subtle pb-1">{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------ record the answer */}
      <Sheet
        open={Boolean(settling)}
        onClose={() => setSettling(null)}
        title={settling ? `What ${settling.payer} allowed` : 'Remittance'}
        description={settling ? `${settling.claimNo} · claimed ${money(settling.claimed)}. A difference has to be given a reason and somebody who carries it.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSettling(null)}>Cancel</Button>
            <Button size="sm" onClick={record}><Undo2 className="size-4" aria-hidden /> Record the answer</Button>
          </div>
        }
      >
        {settling && (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Allowed</span>
              <input value={allowed} onChange={(e) => setAllowed(e.target.value)} inputMode="decimal" disabled={Boolean(rejection)} className="w-full rounded-md border border-border bg-surface px-3 py-2 tabular-nums disabled:opacity-50" />
              <span className="mt-1 block text-xs text-text-secondary">Claimed {money(settling.claimed)}. Anything below that is a short payment and needs a reason.</span>
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Reason code</span>
              <select value={shortPayCode} onChange={(e) => setShortPayCode(e.target.value)} disabled={Boolean(rejection)} className="w-full rounded-md border border-border bg-surface px-3 py-2 disabled:opacity-50">
                {SHORT_PAY_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label} — carried by {r.who}</option>)}
              </select>
              <span className="mt-1 block text-xs text-text-secondary">{SHORT_PAY_REASONS.find((r) => r.code === shortPayCode)?.because}</span>
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Rejected outright <span className="font-normal text-text-secondary">(instead of a short payment)</span></span>
              <select value={rejection} onChange={(e) => setRejection(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2">
                <option value="">— not a rejection —</option>
                {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-text-primary">Absorbed by <span className="font-normal text-text-secondary">(when the hospital carries it)</span></span>
              <input value={absorbedBy} onChange={(e) => setAbsorbedBy(e.target.value)} placeholder="e.g. Clinical director — necessity documented" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
              <span className="mt-1 block text-xs text-text-secondary">
                Left blank, the short payment stays unassigned and the claim stays open — which is the honest state, and the one the finance
                committee asks about.
              </span>
            </label>
          </div>
        )}
      </Sheet>
    </div>
  );
}
