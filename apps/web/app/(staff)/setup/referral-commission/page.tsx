'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarClock, FileSignature, Handshake, History, Pause, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, SelectField, Sheet, Tabs, TextAreaField, TextField, cx, useToast, type Column } from '@dizi/ui';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { useShell } from '@/lib/shell';
import {
  AGREEMENT_WARN_DAYS,
  COMMISSION_BLOCKED_HEADS,
  COMMISSION_HOLD_DAYS,
  COMMISSION_TDS_PCT,
  INCOME_HEADS,
  agreementLife,
  incomeHeadByCode,
  type ReferrerKind,
} from '@/lib/finance';
import {
  AGREEMENT_MAX_YEARS,
  RATE_CEILING_PCT,
  SEED_AGREEMENTS,
  agreementStatus,
  agreementSummary,
  checkAgreement,
  renewAgreement,
  type PayoutMethod,
  type ReferrerAgreement,
} from '@/lib/finance-setup';

/* Setup › Referral (legacy `admin/referral/commission` — replaced).
 *
 * The referral register's own setup screen: who may be paid, on which heads, at what rate, from when to when, under
 * which signed document, with which payout terms and who approved it. The register on `/finance/referral` pays
 * against exactly these records — the same referrers, the same heads — which is why the expiry on this screen is a
 * date the money obeys rather than a reminder somebody is supposed to read.
 *
 * Preview: the agreements are seeded from the branch's own register, with one of them lapsed on purpose so the
 * refusal has something to refuse. Edits are held in memory; the rules are not.
 */

const KINDS: ReferrerKind[] = ['External doctor', 'Clinic or agent', 'In-house consultant', 'Corporate partner'];
const PAYOUT_METHODS: PayoutMethod[] = ['Bank transfer', 'Cheque', 'Cash'];

const STATE_TONE: Record<string, string> = {
  Active: 'text-safety-success',
  'Expiring soon': 'text-safety-warning',
  Expired: 'text-safety-critical',
};

const blank = (day: string): ReferrerAgreement => ({
  id: `agr-${day}-new`,
  code: 'REF-',
  name: '',
  kind: 'External doctor',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  tin: null,
  bin: null,
  registration: null,
  agreementNo: '',
  signedOn: day,
  expiresOn: '',
  documentRef: '',
  heads: [],
  ratePct: 0,
  headRates: {},
  capPerPatient: 0,
  capPerMonth: 0,
  payoutMethod: 'Bank transfer',
  payoutAccount: '',
  tdsPct: COMMISSION_TDS_PCT,
  holdDays: COMMISSION_HOLD_DAYS,
  minPayout: 0,
  preparedBy: '',
  approvedBy: '',
  boardRef: null,
  suspendedBecause: null,
  versions: [],
});

export default function ReferralCommissionSetupPage() {
  const { queueWrite, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [agreements, setAgreements] = useState<ReferrerAgreement[]>(() => SEED_AGREEMENTS.map((a) => ({ ...a, heads: [...a.heads] })));
  const [tab, setTab] = useState('register');
  const [editing, setEditing] = useState<ReferrerAgreement | null>(null);
  /** The refusals and warnings for the draft being written, recomputed on every keystroke. */
  const [live, setLive] = useState<{ refusals: Array<{ code: string; field: string; message: string }>; warnings: string[] }>({ refusals: [], warnings: [] });
  const [renewing, setRenewing] = useState<ReferrerAgreement | null>(null);
  const [renewTo, setRenewTo] = useState('');
  const [renewRate, setRenewRate] = useState('');
  const [renewBy, setRenewBy] = useState('Finance manager — S. Chowdhury');
  const [suspendReason, setSuspendReason] = useState('');

  const stats = useMemo(() => {
    const states = agreements.map((a) => agreementStatus(a, day));
    return {
      active: states.filter((s) => s.state === 'Active' && s.pays).length,
      expiring: states.filter((s) => s.state === 'Expiring soon').length,
      expired: states.filter((s) => s.state === 'Expired').length,
      paused: agreements.filter((a) => a.suspendedBecause).length,
      avgRate: agreements.filter((a) => a.ratePct > 0).reduce((n, a) => n + a.ratePct, 0) / Math.max(1, agreements.filter((a) => a.ratePct > 0).length),
      nextExpiry: [...agreements].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0],
    };
  }, [agreements, day]);

  const check = (draft: ReferrerAgreement) => checkAgreement(draft, agreements, day);

  const openDraft = (a: ReferrerAgreement) => {
    const fresh = { ...a, heads: [...a.heads], headRates: { ...a.headRates } };
    setEditing(fresh);
    const c = check(fresh);
    setLive({ refusals: c.refusals, warnings: c.warnings });
  };

  const edit = (patch: Partial<ReferrerAgreement>) => {
    if (!editing) return;
    const next = { ...editing, ...patch };
    setEditing(next);
    const c = check(next);
    setLive({ refusals: c.refusals, warnings: c.warnings });
  };

  const fieldError = (field: string): string | undefined => live.refusals.find((r) => r.field === field)?.message;

  const save = () => {
    if (!editing) return;
    const c = check(editing);
    if (!c.ok) {
      push({ title: `Refused — ${c.refusals[0].message}`, description: c.refusals.length > 1 ? `${c.refusals.length - 1} more thing(s) on the form are not right yet.` : undefined, tone: 'critical' });
      return;
    }
    const isNew = !agreements.some((a) => a.code === editing.code);
    const versioned: ReferrerAgreement = isNew
      ? editing
      : {
          ...editing,
          versions: [
            ...editing.versions,
            {
              from: day,
              ratePct: editing.ratePct,
              heads: [...editing.heads],
              by: 'Hospital admin',
              what: `Terms saved: ${editing.ratePct} % on ${editing.heads.length} head(s), to ${editing.expiresOn}`,
            },
          ],
        };
    setAgreements((rows) => (isNew ? [versioned, ...rows] : rows.map((a) => (a.code === versioned.code ? versioned : a))));
    const outcome = queueWrite(
      `Referral agreement ${versioned.code}: ${versioned.ratePct} % on ${versioned.heads.length} head(s), to ${versioned.expiresOn}`,
      { id: 'createPatient', recordId: versioned.code, fields: { code: versioned.code, ratePct: versioned.ratePct, heads: versioned.heads.join(','), expiresOn: versioned.expiresOn } },
    );
    setEditing(null);
    push({
      title: `${versioned.code} saved`,
      description: `${agreementSummary(versioned, day)}${outcome.queued ? '' : ` — recorded locally only: ${outcome.because}`}`,
      tone: 'success',
    });
  };

  const suspend = (a: ReferrerAgreement) => {
    if (!suspendReason.trim()) {
      push({ title: 'A suspension needs a reason on the record.', description: 'It stops a person’s income without ending the agreement, so somebody later will ask why.', tone: 'critical' });
      return;
    }
    setAgreements((rows) => rows.map((x) => (x.code === a.code ? { ...x, suspendedBecause: suspendReason.trim() } : x)));
    queueWrite(`Referral agreement ${a.code} suspended — ${suspendReason.trim()}`, { id: 'appendAuditEntry', recordId: a.code, fields: { code: a.code, reason: suspendReason.trim(), at: day } });
    push({ title: `${a.code} suspended`, description: 'Nothing accrues from today. The agreement is not terminated — the register stops the money and the record says who stopped it.', tone: 'warning' });
    setSuspendReason('');
  };

  const lift = (a: ReferrerAgreement) => {
    setAgreements((rows) => rows.map((x) => (x.code === a.code ? { ...x, suspendedBecause: null } : x)));
    queueWrite(`Referral agreement ${a.code} reinstated`, { id: 'appendAuditEntry', recordId: a.code, fields: { code: a.code, at: day } });
    push({ title: `${a.code} reinstated`, description: 'The suspension stays in the history; what it did was stop the money for a period, and that is a fact about the record.', tone: 'success' });
  };

  const renew = () => {
    if (!renewing) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(renewTo)) {
      push({ title: 'A renewal needs an end date.', description: `An agreement with no end date is a rate nobody revisits — ${AGREEMENT_MAX_YEARS} years is the outside limit.`, tone: 'critical' });
      return;
    }
    const rate = renewRate.trim() === '' ? renewing.ratePct : Number(renewRate);
    const next = renewAgreement(renewing, { to: renewTo, ratePct: rate, by: renewBy, at: `${day} 16:10` });
    const c = checkAgreement(next, agreements, day);
    if (!c.ok) {
      push({ title: `Refused — ${c.refusals[0].message}`, tone: 'critical' });
      return;
    }
    setAgreements((rows) => rows.map((a) => (a.code === next.code ? next : a)));
    queueWrite(`Referral agreement ${next.code} renewed to ${next.expiresOn} at ${next.ratePct} %`, { id: 'appendAuditEntry', recordId: next.code, fields: { code: next.code, ratePct: next.ratePct, expiresOn: next.expiresOn, at: day } });
    push({
      title: `${next.code} renewed to ${next.expiresOn}`,
      description: rate !== renewing.ratePct ? `The rate moves ${renewing.ratePct} % → ${rate} %, as a new dated version: the register keeps paying the old one until today and the new one from today.` : 'The rate is unchanged; only the term moved, which is what a renewal without a renegotiation is.',
      tone: 'success',
    });
    setRenewing(null);
    setRenewTo('');
    setRenewRate('');
  };

  const columns: Array<Column<ReferrerAgreement>> = [
    { key: 'code', header: 'Referrer', render: (a) => (
      <span>
        {a.name}
        <span className="block text-xs text-text-tertiary">{a.code} · {a.kind} · {a.contactPerson}</span>
      </span>
    ) },
    { key: 'heads', header: 'Heads', hideBelow: 'lg', render: (a) => (
      <span className="text-xs">
        {a.heads.length === 0 ? '— none —' : a.heads.map((c) => incomeHeadByCode(c)?.label ?? c).join(' · ')}
      </span>
    ) },
    { key: 'ratePct', header: 'Rate', align: 'right', width: '7rem', render: (a) => (
      <span className="tabular-nums">
        {a.ratePct} %
        {Object.keys(a.headRates).length > 0 && <span className="block text-xs text-text-tertiary">+ {Object.keys(a.headRates).length} head rate</span>}
      </span>
    ) },
    { key: 'caps', header: 'Ceilings', align: 'right', hideBelow: 'lg', width: '9rem', render: (a) => (
      <span className="tabular-nums text-xs">
        {a.capPerPatient > 0 ? `${money(a.capPerPatient)} / patient` : 'no patient ceiling'}
        <span className="block text-text-tertiary">{a.capPerMonth > 0 ? `${money(a.capPerMonth)} / month` : 'no monthly ceiling'}</span>
      </span>
    ) },
    { key: 'expiresOn', header: 'Agreement', width: '11rem', render: (a) => {
      const s = agreementStatus(a, day);
      return (
        <span>
          <span className={cx('font-medium', STATE_TONE[s.state] ?? 'text-text-secondary')}>{a.suspendedBecause ? 'Suspended' : s.state}</span>
          <span className="block text-xs text-text-tertiary">{a.agreementNo} · to {a.expiresOn}</span>
        </span>
      );
    } },
    { key: 'terms', header: 'Payout terms', hideBelow: 'xl', render: (a) => (
      <span className="text-xs text-text-secondary">
        {a.holdDays}-day hold · {a.tdsPct} % withheld · {a.payoutMethod}
        <span className="block text-text-tertiary">{a.payoutAccount ?? 'no account on file'}</span>
      </span>
    ) },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Handshake className="size-5 text-brand-600" aria-hidden />
            Referral commission agreements
          </h1>
          <p className="text-sm text-text-secondary">
            Setup › Referral — who may be paid, on which heads, at what rate, until when, and who signed for it. The
            register on <Link href="/finance/referral" className="text-brand-600 underline">Referral commission</Link> pays against these records.
            {syncEngine.summary.pending > 0 && ` ${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openDraft(blank(day))}><FileSignature className="size-4" aria-hidden /> Write a new agreement</Button>
          <Link href="/setup"><Button variant="secondary" size="sm">All catalogues</Button></Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiTile label="Paying today" value={String(stats.active)} definition="Agreements in date, with heads named and a rate above zero. Everything else on this screen earns nothing, and the register says which of the reasons it is." asOf={day} />
        <KpiTile label={`Expiring in ${AGREEMENT_WARN_DAYS} days`} value={String(stats.expiring)} definition="Renew or stop before the end date: the register stops the money on the day the paper runs out, without a reminder." asOf={day} />
        <KpiTile label="Expired or suspended" value={String(stats.expired + stats.paused)} definition="Rates with no current paper behind them. One is deliberate: a lapsed agreement that the register refuses to pay is the rule working." asOf={day} footnote={stats.nextExpiry ? `next end date ${stats.nextExpiry.expiresOn}` : undefined} />
        <KpiTile label="Average rate" value={`${stats.avgRate.toFixed(1)} %`} definition={`Across the agreements that pay. Above ${RATE_CEILING_PCT} % the board has to be on the file, and the screen will not save one without the resolution reference.`} asOf={day} />
        <KpiTile label="Heads commissioned" value={String(new Set(agreements.flatMap((a) => a.heads)).size)} definition="Distinct income heads any agreement pays on. Pharmacy, donations and sundry income are never among them, whoever names them." asOf={day} />
      </div>

      {stats.expired + stats.paused > 0 && (
        <SafetyBanner severity="warning" title={`${stats.expired + stats.paused} agreement(s) not paying`}>
          <p>
            An expired or suspended agreement accrues nothing — the register excludes every line and names the reason
            rather than paying on a rate nobody has renewed. Renew on this screen, or terminate the record with the
            reason kept.
          </p>
        </SafetyBanner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'register', label: 'Agreements', count: agreements.length },
          { id: 'lifecycle', label: 'Renewals and stops' },
          { id: 'rules', label: 'What is refused' },
        ]}
      />

      {tab === 'register' && (
        <Panel>
          <ListView<ReferrerAgreement>
            id="setup-referral-register"
            caption={`Referral commission agreements — ${agreements.length} on file for ${day}`}
            columns={columns}
            rows={agreements}
            rowId={(a) => a.code}
            height="26rem"
            onRowClick={(a) => openDraft(a)}
            emptyLabel="No agreements on file. A referrer with no agreement is a referrer nobody may pay."
            rowActions={(a) => [
              { label: 'Open and edit the terms', icon: <FileSignature className="size-4" aria-hidden />, onSelect: () => openDraft(a) },
              { label: 'Renew it', icon: <RefreshCw className="size-4" aria-hidden />, onSelect: () => { setRenewing(a); setRenewTo(a.expiresOn); setRenewRate(String(a.ratePct)); } },
              ...(a.suspendedBecause
                ? [{ label: 'Reinstate', icon: <BadgeCheck className="size-4" aria-hidden />, onSelect: () => lift(a) }]
                : [{ label: 'Open it to suspend', icon: <Pause className="size-4" aria-hidden />, danger: true, separated: true, onSelect: () => openDraft(a) }]),
            ]}
          />
          <p className="mt-2 text-xs text-text-secondary">
            The register pays on money collected, per head, only while the agreement is in date. That is why the
            end date is the most important field on this form: it is the one the money obeys.
          </p>
        </Panel>
      )}

      {tab === 'lifecycle' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="End dates, soonest first" actions={<span className="text-xs text-text-secondary">{AGREEMENT_WARN_DAYS}-day warning window</span>}>
            <ol className="space-y-2 text-sm">
              {[...agreements].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)).map((a) => {
                const s = agreementStatus(a, day);
                const life = agreementLife(a.expiresOn, day);
                return (
                  <li key={a.code} className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2">
                    <span>
                      <span className="font-medium text-text-primary">{a.name}</span>
                      <span className="block text-xs text-text-tertiary">{a.code} · {a.agreementNo} · signed {a.signedOn}</span>
                      <span className={cx('block text-xs', STATE_TONE[s.state] ?? 'text-text-secondary')}>{s.why}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block tabular-nums">{a.expiresOn}</span>
                      <span className={cx('block text-xs', life.state === 'Expired' ? 'text-safety-critical' : life.state === 'Expiring soon' ? 'text-safety-warning' : 'text-text-tertiary')}>
                        {life.state === 'Expired' ? `${Math.abs(life.daysToExpiry)} days ago` : `${life.daysToExpiry} days left`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel title="Rate history" actions={<span className="text-xs text-text-secondary">A rate change makes a version, never an overwrite</span>}>
            <ul className="space-y-2 text-xs">
              {agreements.flatMap((a) => a.versions.map((v) => ({ ...v, code: a.code, name: a.name }))).sort((x, y) => y.from.localeCompare(x.from)).slice(0, 12).map((v, i) => (
                <li key={`${v.code}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1">
                  <span>
                    <span className="text-text-primary">{v.code} — {v.ratePct} % from {v.from}</span>
                    <span className="block text-text-tertiary">{v.what} · {v.by}</span>
                  </span>
                  <span className="shrink-0 text-text-tertiary">{v.heads.length} head(s)</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">
              The register records the rate a voucher was paid under, so an old statement still reads what it said at
              the time. That is the whole reason a rate change is a dated version instead of an edit.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="What this screen refuses, and why">
            <ul className="space-y-2 text-sm">
              {[
                ['An agreement with no end date', `A rate nobody revisits. Every agreement runs out, and ${AGREEMENT_MAX_YEARS} years is the outside limit.`],
                ['An active agreement with no TIN', 'A commission paid without a taxpayer number attracts the higher deduction, so the number is collected before anybody may be paid.'],
                ['An external doctor with no BMDC number', 'The hospital is paying for a clinical decision; a clinician it cannot identify is a payment an auditor will not accept.'],
                ['Pharmacy, donations or sundry income named as a head', 'Paying a share of drug sales pays a prescriber to prescribe, and a donation is not the patient’s spending to share.'],
                [`A rate above ${RATE_CEILING_PCT} % with no board reference`, 'The same ceiling as the corporate discount, on purpose: money given away at the counter and money paid at the back come out of one margin.'],
                ['A hold shorter than the refund window', `At least ${COMMISSION_HOLD_DAYS} days, so a returning patient’s refund nets off before the commission leaves.`],
                ['Withholding below the statutory rate', `At least ${COMMISSION_TDS_PCT} %: an agreement may hold back more, never less.`],
                ['A cash payout above the counter limit', 'Above the counter limit the money moves by bank or cheque, whatever the arrangement says.'],
                ['The same person preparing and approving it', 'Two names on an agreement, or the record is a finding waiting for an auditor.'],
                ['A rate on an in-house consultant', 'They earn the consultant share of what they bill. Two payouts for one consultation is the double dip this register exists to refuse.'],
              ].map(([what, why]) => (
                <li key={what} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-safety-warning" aria-hidden />
                  <span>
                    <span className="font-medium text-text-primary">{what}</span>
                    <span className="block text-xs text-text-secondary">{why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Heads that may never be commissioned">
            <ul className="space-y-2 text-sm">
              {COMMISSION_BLOCKED_HEADS.map((code) => {
                const head = incomeHeadByCode(code);
                return (
                  <li key={code} className="border-b border-border-subtle pb-2">
                    <span className="font-medium text-text-primary">{head?.label ?? code}</span>
                    <span className="block text-xs text-text-tertiary">{code}{head ? ` · ${head.group} · ${head.categories.length > 0 ? `billed as ${head.categories.join(' and ')}` : 'no billing category'}` : ''}</span>
                    <span className="block text-xs text-text-secondary">
                      {code === 'INC-PHARM'
                        ? 'Paying a share of drug sales pays a prescriber to prescribe. The register refuses it on every accrual, whoever the agreement names.'
                        : code === 'INC-DONATION'
                          ? 'A donation is other people’s generosity, not the patient’s spending, so there is nothing to share.'
                          : 'Sundry counter income is not attributable to a referrer, and a share of it cannot be justified to the person who paid it.'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-text-secondary">
              The refusal is computed on every register line as it is built, not on save, so an agreement written
              before this rule existed cannot pay on a blocked head either.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------------ the agreement form */}
      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? (editing.name || 'A new referral agreement') : 'Agreement'}
        description={editing ? `${editing.code} · ${editing.agreementNo || 'no agreement number yet'} · ${agreementSummary(editing, day)}` : undefined}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            {editing && !editing.suspendedBecause && agreements.some((a) => a.code === editing.code) && (
              <Button variant="secondary" size="sm" onClick={() => suspend(editing)}><Pause className="size-4" aria-hidden /> Suspend with a reason</Button>
            )}
            <Button size="sm" onClick={save}><FileSignature className="size-4" aria-hidden /> Save the agreement</Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4 text-sm">
            {live.refusals.length > 0 && (
              <div className="rounded-md bg-safety-critical/10 px-3 py-2 text-xs text-safety-critical" role="status">
                <p className="font-medium">{live.refusals.length} thing{live.refusals.length === 1 ? '' : 's'} to fix before this may be saved:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {live.refusals.map((r) => <li key={r.code}>{r.message}</li>)}
                </ul>
              </div>
            )}
            {live.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md bg-safety-warning/10 px-3 py-2 text-xs text-safety-warning">
                {live.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <FieldSection title="Who they are" description="A payment to an unnamed referrer cannot be queried, and a commission nobody can query is one nobody can stop.">
              <TextField label="Referrer code" name="code" required value={editing.code} onChange={(e) => edit({ code: e.target.value.toUpperCase() })} error={fieldError('code')} hint="REF- followed by 3 to 10 characters." />
              <TextField label="Name" name="name" required value={editing.name} onChange={(e) => edit({ name: e.target.value })} error={fieldError('name')} className="md:col-span-2" />
              <SelectField
                label="Kind"
                name="kind"
                value={editing.kind}
                onChange={(e) => edit({ kind: e.target.value as ReferrerKind })}
                options={KINDS.map((k) => ({ value: k, label: k }))}
                hint="An in-house consultant earns the consultant share, not a commission."
              />
              <TextField label="Contact person" name="contactPerson" value={editing.contactPerson} onChange={(e) => edit({ contactPerson: e.target.value })} error={fieldError('contactPerson')} hint="The person the register deals with. A clinic is a building." />
              <TextField label="Phone" name="phone" value={editing.phone} onChange={(e) => edit({ phone: e.target.value })} error={fieldError('phone')} hint="01XXX-XXX-XXX." />
              <TextField label="Email" name="email" value={editing.email} onChange={(e) => edit({ email: e.target.value })} error={fieldError('email')} hint="Where the monthly statement goes." />
              <TextAreaField label="Address" name="address" rows={2} value={editing.address} onChange={(e) => edit({ address: e.target.value })} className="md:col-span-2" />
            </FieldSection>

            <FieldSection title="The numbers that make them payable" description="Without a taxpayer number nothing may be paid, whatever the rate says.">
              <TextField label="TIN" name="tin" value={editing.tin ?? ''} onChange={(e) => edit({ tin: e.target.value || null })} hint="Required before a payout." />
              <TextField label="BIN" name="bin" value={editing.bin ?? ''} onChange={(e) => edit({ bin: e.target.value || null })} hint="A clinic or a company registered for VAT." />
              <TextField label="Registration" name="registration" value={editing.registration ?? ''} onChange={(e) => edit({ registration: e.target.value || null })} error={fieldError('registration')} hint="BMDC number for a doctor, trade licence for an agency." />
            </FieldSection>

            <FieldSection title="The paper" description="The end date is the field the money obeys.">
              <TextField label="Agreement number" name="agreementNo" required value={editing.agreementNo} onChange={(e) => edit({ agreementNo: e.target.value.toUpperCase() })} error={fieldError('agreementNo')} hint="E.g. AGR-2026-004." />
              <TextField label="Signed on" name="signedOn" type="date" required value={editing.signedOn} onChange={(e) => edit({ signedOn: e.target.value })} error={fieldError('signedOn')} />
              <TextField label="Expires on" name="expiresOn" type="date" required value={editing.expiresOn} onChange={(e) => edit({ expiresOn: e.target.value })} error={fieldError('expiresOn')} hint={`At most ${AGREEMENT_MAX_YEARS} years from signing.`} />
              <TextField label="Where the signed copy is filed" name="documentRef" required value={editing.documentRef} onChange={(e) => edit({ documentRef: e.target.value })} error={fieldError('documentRef')} className="md:col-span-2" />
              <TextField label="Board resolution" name="boardRef" value={editing.boardRef ?? ''} onChange={(e) => edit({ boardRef: e.target.value || null })} error={fieldError('boardRef')} hint={`Required above ${RATE_CEILING_PCT} %.`} />
            </FieldSection>

            <FieldSection title="What it pays, on what" description="A rate applies to the heads the agreement names, never to everything the patient spends.">
              <TextField label="Rate (%)" name="ratePct" required value={String(editing.ratePct)} onChange={(e) => edit({ ratePct: Number(e.target.value) || 0 })} inputMode="decimal" error={fieldError('ratePct')} hint={`Above ${RATE_CEILING_PCT} % the board has to be on the file.`} />
              <TextField label="Ceiling per patient" name="capPerPatient" value={String(editing.capPerPatient)} onChange={(e) => edit({ capPerPatient: Number(e.target.value) || 0 })} inputMode="decimal" error={fieldError('capPerPatient')} hint="0 means no ceiling on one patient." />
              <TextField label="Ceiling per month" name="capPerMonth" value={String(editing.capPerMonth)} onChange={(e) => edit({ capPerMonth: Number(e.target.value) || 0 })} inputMode="decimal" error={fieldError('capPerMonth')} hint="Required above 10 %." />
              <div className="md:col-span-2 xl:col-span-3">
                <p className="mb-1 text-sm font-medium text-text-secondary">Heads this agreement commissions</p>
                <ul className="flex flex-wrap gap-1">
                  {INCOME_HEADS.map((h) => {
                    const on = editing.heads.includes(h.code);
                    const blocked = COMMISSION_BLOCKED_HEADS.includes(h.code);
                    return (
                      <li key={h.code}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => edit({ heads: on ? editing.heads.filter((c) => c !== h.code) : [...editing.heads, h.code] })}
                          className={cx(
                            'rounded-full border px-2 py-0.5 text-xs',
                            blocked ? 'border-safety-critical/40 text-safety-critical' : on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:border-brand-300',
                          )}
                        >
                          {h.label}{blocked ? ' — never' : ''}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {fieldError('heads') && <p role="alert" className="mt-1 text-xs font-medium text-safety-critical">{fieldError('heads')}</p>}
                <p className="mt-1 text-xs text-text-tertiary">A rate with no heads earns nothing, which is not what a signed agreement means.</p>
              </div>
            </FieldSection>

            <FieldSection title="How it is paid" description="The hold is long enough for a returning patient’s refund to net off first.">
              <SelectField
                label="Payout method"
                name="payoutMethod"
                value={editing.payoutMethod}
                onChange={(e) => edit({ payoutMethod: e.target.value as PayoutMethod })}
                options={PAYOUT_METHODS.map((m) => ({ value: m, label: m }))}
                error={fieldError('payoutMethod')}
              />
              <TextField label="Account" name="payoutAccount" value={editing.payoutAccount ?? ''} onChange={(e) => edit({ payoutAccount: e.target.value || null })} error={fieldError('payoutAccount')} hint="Required for a bank transfer." className="md:col-span-2" />
              <TextField label="Withholding (%)" name="tdsPct" value={String(editing.tdsPct)} onChange={(e) => edit({ tdsPct: Number(e.target.value) || 0 })} inputMode="decimal" error={fieldError('tdsPct')} hint={`At least ${COMMISSION_TDS_PCT} % — the law’s, not the contract’s.`} />
              <TextField label="Hold (days)" name="holdDays" value={String(editing.holdDays)} onChange={(e) => edit({ holdDays: Number(e.target.value) || 0 })} inputMode="numeric" error={fieldError('holdDays')} hint={`At least ${COMMISSION_HOLD_DAYS}.`} />
              <TextField label="Minimum payout" name="minPayout" value={String(editing.minPayout)} onChange={(e) => edit({ minPayout: Number(e.target.value) || 0 })} inputMode="decimal" error={fieldError('minPayout')} hint="Below this the amount accumulates." />
            </FieldSection>

            <FieldSection title="Two names" description="The same person preparing and approving an agreement is the finding an auditor writes down first.">
              <TextField label="Prepared by" name="preparedBy" value={editing.preparedBy} onChange={(e) => edit({ preparedBy: e.target.value })} error={fieldError('preparedBy')} />
              <TextField label="Approved by" name="approvedBy" value={editing.approvedBy} onChange={(e) => edit({ approvedBy: e.target.value })} error={fieldError('approvedBy')} />
              <TextField
                label="Suspend it with a reason"
                name="suspendReason"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                hint="Stops the money without ending the agreement. Press Suspend below to record it."
              />
            </FieldSection>

            {editing.versions.length > 0 && (
              <div>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  <History className="size-3.5" aria-hidden /> Rate history
                </h3>
                <ul className="space-y-1 text-xs">
                  {editing.versions.map((v, i) => (
                    <li key={`${v.from}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1">
                      <span className="text-text-primary">{v.ratePct} % from {v.from}</span>
                      <span className="text-text-tertiary">{v.what} · {v.by}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------------ renewal */}
      <Sheet
        open={Boolean(renewing)}
        onClose={() => setRenewing(null)}
        title={renewing ? `Renew — ${renewing.name}` : 'Renewal'}
        description={renewing ? `${renewing.code} · currently to ${renewing.expiresOn} at ${renewing.ratePct} %. A renewal makes a new dated version; it does not rewrite the rate the register has been paying.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRenewing(null)}>Cancel</Button>
            <Button size="sm" onClick={renew}><CalendarClock className="size-4" aria-hidden /> Renew</Button>
          </div>
        }
      >
        {renewing && (
          <div className="space-y-3 text-sm [&>*]:max-w-md">
            <TextField label="New end date" name="renewTo" type="date" required value={renewTo} onChange={(e) => setRenewTo(e.target.value)} hint={`At most ${AGREEMENT_MAX_YEARS} years from signing.`} />
            <TextField label="Rate (%)" name="renewRate" value={renewRate} onChange={(e) => setRenewRate(e.target.value)} inputMode="decimal" hint={`Leave as it is for a plain renewal. Above ${RATE_CEILING_PCT} % the board reference has to already be on the record.`} />
            <TextField label="Approved by" name="renewBy" value={renewBy} onChange={(e) => setRenewBy(e.target.value)} hint="A renewal is an approval, so it carries a name." />
            {renewing.expiresOn < day && (
              <p className="rounded-md bg-safety-warning/10 px-3 py-2 text-xs text-safety-warning">
                This agreement lapsed on {renewing.expiresOn}, so nothing has accrued since. Renewing dates the new
                version from today: the days in between stay unpaid, which is what a lapsed agreement means.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
