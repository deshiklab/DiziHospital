'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Sheet, cx } from '@dizi/ui';
import { Building2, CircleAlert, RadioTower, Route, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import {
  BRANCHES,
  BRANCH_PROFILES,
  BRANCH_RULES,
  CAPABILITIES,
  NODE_MODES,
  branchDay,
  branchHas,
  consoleTotals,
  profileOf,
  referralsFor,
  type BranchId,
} from '@/lib/branches';

/* Multi Branch › Overview (P7) — one wall for three branches.
 *
 * The console exists to make the differences visible rather than to average them: a satellite has no ICU, a node is
 * behind on its uplink, and a bed count at Mirpur means something different from a bed count at Main Campus. Two
 * things are therefore never smoothed over here — a figure that comes from a posting carries the time it was
 * posted, and a service a branch does not have is shown as the route a patient takes rather than as a gap.
 */

export default function MultiBranchOverviewPage() {
  const day = todayIso();
  const [selected, setSelected] = useState<BranchId | null>(null);

  const days = useMemo(() => BRANCHES.map((b) => branchDay(b, day)), [day]);
  const totals = useMemo(() => consoleTotals(days), [days]);
  const record = selected ? days.find((d) => d.branch === selected) ?? null : null;
  const profile = selected ? profileOf(selected) : null;

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="multibranch-overview"
        subtitle={`${day} · ${BRANCHES.length} branches · ${totals.beds.total} beds · ${totals.staleBranches.length ? `${totals.staleBranches.length} reading from a posting rather than from now` : 'every branch posting live'}.`}
        actions={
          <>
            <Link href="/admin/multibranch/branches">
              <Button variant="ghost">What differs</Button>
            </Link>
            <Link href="/admin/multibranch/report">
              <Button variant="ghost">Branch report</Button>
            </Link>
          </>
        }
        waiting={totals.staleBranches.length ? totals.staleBranches.map((s) => `${s.branch}: last posting ${s.posted}, ${s.pending} queued.`).join(' ') : undefined}
      />

      <AdminSiblings screenId="multibranch-overview" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Beds occupied" value={`${totals.beds.occupied}/${totals.beds.total}`} definition="Occupied beds across the three branches, counted by each branch’s own ward board. A bed at Mirpur is a day-care bed unless it is one of the twelve in-patient beds." asOf={day} footnote={`${totals.beds.percentOccupied}% · ${totals.beds.free} free`} />
        <KpiTile label="Out-patients" value={String(totals.outPatients)} definition="Seen today across the three clinics. A patient who attends Uttara and is sent to Main Campus is counted where they were seen, once." asOf={day} footnote={`${totals.waiting} waiting now`} />
        <KpiTile label="Admissions" value={String(totals.admissions)} definition="Admitted today. Mirpur admits for day surgery only: an overnight admission there is a transfer that has not been arranged yet." asOf={day} />
        <KpiTile label="Theatre cases" value={String(totals.theatreCases)} definition="Main Campus runs a theatre round the clock; Uttara does day cases until 16:00; Mirpur has a day-care list with no overnight stay." asOf={day} />
        <KpiTile label="Emergency seen" value={String(totals.emergencySeen)} definition="Across the three doors. Mirpur’s is open fourteen hours a day, which the console states rather than leaving a midnight arrival to find out." asOf={day} />
        <KpiTile label="Collected today" value={money(totals.collected)} definition="Cash and card taken at the three counters, from each branch’s own day book. Out-standing is billed and not yet collected, not a loss." asOf={day} footnote={`${money(totals.outstanding)} outstanding`} />
        <KpiTile label="Staff on duty" value={String(totals.staffOnDuty)} definition="On the floor across the three branches. Nine of Uttara’s are seconded from Main Campus and are counted where they are paid, which is why the hospital’s payroll and this figure differ." asOf={day} footnote={`${BRANCH_PROFILES.reduce((n, p) => n + p.seconded, 0)} seconded in`} />
      </div>

      {totals.staleBranches.length > 0 && (
        <SafetyBanner severity="critical" title={`${totals.staleBranches.length} branch reading from its last posting`}>
          <ul className="list-disc space-y-1 pl-5">
            {totals.staleBranches.map((s) => {
              const state = days.find((d) => d.branch === s.branch)!.node;
              return (
                <li key={s.branch}>
                  <span className="font-medium">{s.branch}</span> — last posting {s.posted}, {s.pending} posting(s) queued. {state.note}
                </li>
              );
            })}
          </ul>
        </SafetyBanner>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {days.map((d) => {
          const p = profileOf(d.branch);
          const mode = NODE_MODES.find((m) => m.mode === d.node.mode)!;
          return (
            <Panel
              key={d.branch}
              title={p.id}
              actions={
                <span className={cx('inline-flex items-center gap-1 text-xs', mode.tone === 'success' ? 'text-safety-success' : mode.tone === 'warning' ? 'text-safety-warning' : 'text-safety-critical')}>
                  <RadioTower className="size-3.5" aria-hidden /> {mode.label}
                </span>
              }
            >
              <div className="space-y-2 text-sm">
                <p className="text-xs text-text-tertiary">
                  {p.address} · {p.licence.kind} {p.licence.number} to {p.licence.expires}
                  {p.distanceKm !== null && ` · ${p.distanceKm} km from Main Campus`}
                </p>

                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-text-secondary">Beds</span>
                    <span className="font-numeric">
                      {d.beds.occupied}/{d.beds.total} ({d.beds.percentOccupied}%)
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface-sunken">
                    <div className="bg-safety-critical/70" style={{ width: `${(d.beds.occupied / d.beds.total) * 100}%` }} />
                    <div className="bg-safety-warning/60" style={{ width: `${(d.beds.other / d.beds.total) * 100}%` }} />
                    <div className="bg-safety-success/50" style={{ width: `${(d.beds.free / d.beds.total) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {d.beds.occupied} occupied · {d.beds.other} cleaning, blocked or reserved · {d.beds.free} free
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {[
                    ['Out-patients', `${d.outPatients.seen} (${d.outPatients.waiting} waiting)`],
                    ['Admissions', `${d.inPatients.admissions} in, ${d.inPatients.discharges} out`],
                    ['Theatre', `${d.theatre.cases} case(s)${d.theatre.cancelled ? `, ${d.theatre.cancelled} cancelled` : ''}`],
                    ['Emergency', `${d.emergency.seen} seen, ${d.emergency.referred} referred`],
                    ['Billed / collected', `${money(d.money.billed)} / ${money(d.money.collected)}`],
                    ['Staff on duty', `${d.staff.onDuty} of ${d.staff.rostered}${p.seconded ? ` (+${p.seconded} seconded)` : ''}`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-text-secondary">{label}</dt>
                      <dd className="font-numeric">{value}</dd>
                    </div>
                  ))}
                </dl>

                <p className="text-xs text-text-tertiary">{d.node.figuresAreLastPosting ? `Figures posted ${d.node.lastUplink} · ${d.node.pending} queued` : `Posting live · node ${d.node.node}`}</p>

                <div className="flex flex-wrap gap-1">
                  {referralsFor(d.branch).slice(0, 3).map((r) => (
                    <span key={r.capability} className="inline-flex items-center gap-1 rounded-full border border-safety-warning/40 bg-safety-warning/5 px-2 py-0.5 text-xs text-safety-warning">
                      <Route className="size-3" aria-hidden /> {r.capability}
                    </span>
                  ))}
                  {referralsFor(d.branch).length === 0 && <span className="text-xs text-safety-success">Every service on site</span>}
                </div>

                <Button variant="ghost" onClick={() => setSelected(d.branch)}>
                  Open {p.short}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="The three branches, side by side" actions={<span className="text-xs text-text-secondary">as of {day} 15:20, with each branch’s own posting time</span>}>
        <ListView
          id="branch-comparison"
          caption="Branch comparison"
          rows={days}
          rowId={(d) => d.branch}
          onRowClick={(d) => setSelected(d.branch)}
          emptyLabel="No branches configured."
          columns={[
            { key: 'branch', header: 'Branch', render: (d) => (<span><span className="font-medium">{d.branch}</span><span className="block text-xs text-text-tertiary">{profileOf(d.branch).address}</span></span>) },
            { key: 'node', header: 'Node', width: '9.5rem', render: (d) => (<span className={cx('font-numeric text-xs', d.node.figuresAreLastPosting ? 'text-safety-warning' : 'text-safety-success')}>{d.node.node}</span>) },
            { key: 'posted', header: 'Last posting', width: '10rem', render: (d) => (<span className={cx('font-numeric', d.node.figuresAreLastPosting ? 'text-safety-critical' : 'text-text-secondary')}>{d.node.figuresAreLastPosting ? d.node.lastUplink.slice(11) : 'now'}</span>) },
            { key: 'queued', header: 'Queued', width: '6.5rem', align: 'right', numeric: true, render: (d) => (d.node.pending ? String(d.node.pending) : '—') },
            { key: 'beds', header: 'Beds', width: '8rem', align: 'right', numeric: true, render: (d) => `${d.beds.occupied}/${d.beds.total}` },
            { key: 'outPatients', header: 'Out-patients', width: '8rem', align: 'right', numeric: true, render: (d) => String(d.outPatients.seen) },
            { key: 'admissions', header: 'Admissions', width: '8rem', align: 'right', numeric: true, hideBelow: 'md', render: (d) => String(d.inPatients.admissions) },
            { key: 'collected', header: 'Collected', width: '9rem', align: 'right', numeric: true, render: (d) => money(d.money.collected) },
            { key: 'outstanding', header: 'Outstanding', width: '9rem', align: 'right', numeric: true, hideBelow: 'lg', render: (d) => money(d.money.outstanding) },
            { key: 'staff', header: 'On duty', width: '7rem', align: 'right', hideBelow: 'md', numeric: true, render: (d) => `${d.staff.onDuty}/${d.staff.rostered}` },
          ]}
        />
        <p className="mt-2 text-xs text-text-tertiary">
          Totals above are the branches added up: {totals.beds.occupied} of {totals.beds.total} beds, {money(totals.collected)} collected.{' '}
          {totals.staleBranches.length === 0 ? 'Every branch is posting live.' : `The total includes ${totals.staleBranches.map((s) => `${s.branch}'s ${s.posted} posting`).join(' and ')}, which the console states rather than presents as now.`}
        </p>
      </Panel>

      <Panel title="What each branch can do" actions={<span className="text-xs text-text-secondary">{CAPABILITIES.length} services checked</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th className="py-1">Service</th>
                {BRANCHES.map((b) => (
                  <th key={b} className="py-1 text-center">{profileOf(b).short}</th>
                ))}
                <th className="py-1">When it is not on site</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => {
                const missing = BRANCHES.filter((b) => !branchHas(b, cap));
                const referral = missing.length && missing.length < BRANCHES.length ? referralsFor(missing[0]).find((r) => r.capability === cap) : undefined;
                return (
                  <tr key={cap} className="border-b border-border-subtle/60">
                    <td className="py-1 font-medium">{cap}</td>
                    {BRANCHES.map((b) => (
                      <td key={b} className="py-1 text-center">
                        {branchHas(b, cap) ? <span className="text-safety-success">✓</span> : <span className="text-text-tertiary">·</span>}
                      </td>
                    ))}
                    <td className="py-1 text-xs text-text-secondary">{missing.length === 0 ? 'On site everywhere' : referral ? referral.route : missing.length === BRANCHES.length ? 'Not on site anywhere' : `Not at ${missing.map((b) => profileOf(b).short).join(', ')}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="What the console refuses to hide" actions={<span className="text-xs text-text-secondary">{BRANCH_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {BRANCH_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---------------------------------------------------------------------------------------------- one branch */}
      <Sheet
        open={Boolean(record)}
        onClose={() => setSelected(null)}
        title={record ? record.branch : 'Branch'}
        description={profile && record ? `${profile.address} · opened ${profile.opened} · ${record.beds.total} beds, ${profile.cabins} cabin(s)` : undefined}
        width="lg"
        footer={
          record && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/admin/multibranch/branches">
                <Button variant="ghost">What differs here</Button>
              </Link>
              <Link href="/admin/multibranch/report">
                <Button variant="ghost">This branch’s month</Button>
              </Link>
            </div>
          )
        }
      >
        {record && profile && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['Records node', record.node.node],
                ['Posting', record.node.figuresAreLastPosting ? `last posted ${record.node.lastUplink}` : 'live'],
                ['Queued', record.node.pending ? `${record.node.pending} posting(s)` : 'nothing'],
                ['Beds', `${record.beds.total} (${profile.cabins} cabin)`],
                ['Own establishment', `${profile.establishment} on this branch’s payroll`],
                ['Seconded in', profile.seconded ? `${profile.seconded} from Main Campus` : 'none'],
                ['Licence', `${profile.licence.kind} ${profile.licence.number}`],
                ['Licence expires', profile.licence.expires],
                ['Complaints today', String(record.complaints)],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-text-secondary">{profile.note}</p>

            <SafetyBanner severity={record.node.mode === 'live' ? 'success' : record.node.mode === 'lanOnly' ? 'warning' : 'critical'} title={NODE_MODES.find((m) => m.mode === record.node.mode)!.label}>
              {record.node.note}
            </SafetyBanner>

            <Panel title="What this branch sends away" actions={<span className="text-xs text-text-secondary">{referralsFor(record.branch).length} route(s)</span>}>
              {referralsFor(record.branch).length === 0 ? (
                <p className="text-text-secondary">Nothing: every service on the console’s list is on site here. Referrals out of Main Campus are to specialist centres in the city rather than to another branch.</p>
              ) : (
                <ul className="space-y-2">
                  {referralsFor(record.branch).map((r) => (
                    <li key={r.capability} className="rounded-md border border-border-subtle px-3 py-2">
                      <p className="flex items-center gap-1.5 font-medium text-text-primary">
                        <CircleAlert className="size-3.5 text-safety-warning" aria-hidden /> {r.capability}
                      </p>
                      <p className="text-text-secondary">{r.because}</p>
                      <p className="text-xs text-text-tertiary">{r.route}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-text-tertiary">
                Inter-branch transfers are recorded as a referral on the patient’s clinical record, which is not part of this build. What the console owns is the route and the
                reason, so a patient is not sent across the city because nobody knew what was on site.
              </p>
            </Panel>

            <Panel title="The day as the branch’s board has it">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ['Occupied', `${record.beds.occupied}/${record.beds.total}`],
                  ['Free', String(record.beds.free)],
                  ['Cleaning, blocked, reserved', String(record.beds.other)],
                  ['Out-patients seen', String(record.outPatients.seen)],
                  ['Waiting now', String(record.outPatients.waiting)],
                  ['New / follow-up', `${record.outPatients.newPatients} / ${record.outPatients.followUps}`],
                  ['Referred out', String(record.outPatients.referred)],
                  ['Admissions / discharges', `${record.inPatients.admissions} / ${record.inPatients.discharges}`],
                  ['Emergency seen', String(record.emergency.seen)],
                  ['Billed', money(record.money.billed)],
                  ['Collected', money(record.money.collected)],
                  ['Outstanding', money(record.money.outstanding)],
                ].map(([label, value]) => (
                  <li key={label} className="rounded-md border border-border-subtle px-2 py-1">
                    <span className="block text-xs text-text-secondary">{label}</span>
                    <span className="font-numeric font-medium">{value}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Where the money came from">
              <ul className="space-y-1">
                {record.money.byPayer.map((p) => (
                  <li key={p.payer} className="flex items-baseline justify-between border-b border-border-subtle/60 py-1">
                    <span>{p.payer}</span>
                    <span className="font-numeric">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
                <Building2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> The payer mix is a branch fact and not a hospital fact: a satellite sees more self-paying patients, and that is the
                reason its collection rate and its outstanding look the way they do.
              </p>
            </Panel>
          </div>
        )}
      </Sheet>
    </div>
  );
}
