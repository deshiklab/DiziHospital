'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, Segmented, Sheet, cx } from '@dizi/ui';
import { Download, FileSpreadsheet, Info, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { copyText, useToast } from '@dizi/ui';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { monthLabel } from '@/lib/hr';
import {
  BRANCHES,
  BRANCH_REPORT_NOTES,
  branchReport,
  consoleTotals,
  branchDay,
  profileOf,
  reportTotals,
  type BranchReportRow,
} from '@/lib/branches';

/* Multi Branch › Report (P7) — one row per branch per month, and where every figure came from.
 *
 * This is the console's own report rather than another operational screen, so it answers the question a branch
 * comparison is actually asked: is Uttara's out-patient count small because it is small, or because its node is
 * behind? Every row therefore carries its provenance — continuous for Main Campus, a scheduled post for Uttara, and
 * for Mirpur the batches it arrived in and the two days that were re-sent by hand.
 *
 * The totals are the branches added up, and the one double-count in the whole console is named in the notes: nine
 * staff are seconded from Main Campus to Uttara, and their salary is counted where they are paid.
 */

export default function MultiBranchReportPage() {
  const day = todayIso();
  const { push } = useToast();
  const [month, setMonth] = useState(day.slice(0, 7));
  const [scope, setScope] = useState<'all' | 'main' | 'satellite'>('all');
  const [queries, setQueries] = useState('');
  const [selected, setSelected] = useState<BranchReportRow | null>(null);

  const rows = useMemo(() => branchReport(month), [month]);
  const filtered = useMemo(() => {
    const q = queries.trim().toLowerCase();
    return rows
      .filter((r) => (scope === 'all' ? true : scope === 'main' ? r.branch === 'Main Campus' : r.branch !== 'Main Campus'))
      .filter((r) => !q || r.branch.toLowerCase().includes(q) || r.source.toLowerCase().includes(q));
  }, [rows, scope, queries]);

  const totals = useMemo(() => reportTotals(rows), [rows]);

  const copyCsv = async () => {
    const header = ['Branch', 'Period', 'Out-patients', 'Admissions', 'Bed nights', 'Theatre', 'Emergency', 'Billed', 'Collected', 'Outstanding', 'Payroll cost', 'On duty', 'Source'];
    const csv = [header.join(','), ...filtered.map((r) => [r.branch, r.period, r.outPatients, r.admissions, r.bedNights, r.theatreCases, r.emergencySeen, r.billed, r.collected, r.outstanding, r.payrollCost, r.staffOnDuty, `"${r.source}"`].join(','))].join('\n');
    const done = await copyText(csv);
    push({ title: done ? 'Copied the branch month' : 'Could not copy', description: done ? `${filtered.length} row(s) with their provenance, as CSV.` : 'The clipboard refused the copy. The rows are on the screen and nothing was lost.', tone: done ? 'success' : 'warning' });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="multibranch-report"
        subtitle={`${monthLabel(month)} · ${BRANCHES.length} branches · every row carries where its figures came from.`}
        actions={
          <>
            <Link href="/admin/multibranch">
              <Button variant="ghost">The console</Button>
            </Link>
            <Link href="/admin/multibranch/branches">
              <Button variant="ghost">What differs</Button>
            </Link>
            <Button variant="primary" onClick={copyCsv}>
              <Download className="size-4" aria-hidden /> Copy as CSV
            </Button>
          </>
        }
        waiting="The report is read-only by design: a figure in a branch report is a record of what a node posted, and a report that can be edited is one nobody can reconcile."
      />

      <AdminSiblings screenId="multibranch-report" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Out-patients" value={String(totals.outPatients)} definition="Seen across the three clinics in the month, counted where they were seen. A patient referred on to Main Campus is one visit at the branch and one investigation here." asOf={month} />
        <KpiTile label="Admissions" value={String(totals.admissions)} definition="Admitted in the month. Mirpur admits for day surgery only, so its figure is a day-care figure and is read beside Uttara’s rather than against it." asOf={month} />
        <KpiTile label="Bed nights" value={String(totals.bedNights)} definition="Occupied bed nights across the three branches. The satellite wards run at a lower occupancy, which is what a satellite is for: a bed near home, not a full house." asOf={month} />
        <KpiTile label="Collected" value={money(totals.collected)} definition="Money taken at the three counters in the month, from each branch’s own day book. Transfers between branches are settlement and appear once, not as revenue in two books." asOf={month} footnote={`${money(totals.outstanding)} outstanding`} />
        <KpiTile label="Payroll cost" value={money(totals.payrollCost)} definition="Salaries of the three branches’ own establishments. Nine Uttara staff are seconded from Main Campus and are counted where they are paid, which is why this is not the hospital’s payroll." asOf={month} />
        <KpiTile label="On duty (latest day)" value={String(totals.staffOnDuty)} definition="Staff on the floor on the branch’s latest posting day — Main Campus live, the satellites as of their post — so a branch with no activity does not read as a branch that is closed." asOf={month} />
      </div>

      <SafetyBanner severity="warning" title="A branch that is behind on its uplink is not a branch with a quiet month">
        Mirpur’s figures arrived in three batches after its link was restored, and two days at the start of the month were re-sent by hand and are marked in the register. Uttara posts on a
        two-hour schedule, so its latest day is its 14:05 posting. Both are in the month, and both say so, because a stalled node reading as a small day is the one mistake this report
        cannot make.
      </SafetyBanner>

      <Panel
        title="One row per branch"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              name="branch-report-scope"
              label="Scope"
              value={scope}
              onChange={(v) => setScope(v as typeof scope)}
              options={[
                { value: 'all', label: 'All branches' },
                { value: 'main', label: 'Main Campus' },
                { value: 'satellite', label: 'Satellites' },
              ]}
            />
            <Button variant="ghost" onClick={copyCsv}>
              <FileSpreadsheet className="size-4" aria-hidden /> CSV
            </Button>
          </div>
        }
      >
        <ListView
          id="branch-report"
          caption={`Branch report, ${monthLabel(month)}`}
          rows={filtered}
          rowId={(r) => r.branch}
          onRowClick={(r) => setSelected(r)}
          quickSearch={{ value: queries, onChange: setQueries, placeholder: 'Branch or provenance' }}
          emptyLabel="No branch matches this scope."
          columns={[
            { key: 'branch', header: 'Branch', render: (r) => (<span><span className="font-medium">{r.branch}</span><span className="block text-xs text-text-tertiary">{profileOf(r.branch).address}</span></span>) },
            { key: 'period', header: 'Period', width: '9.5rem', hideBelow: 'md', render: (r) => <span className="font-numeric">{r.period}</span> },
            { key: 'outPatients', header: 'Out-patients', width: '9rem', align: 'right', numeric: true },
            { key: 'admissions', header: 'Admissions', width: '9rem', align: 'right', numeric: true, hideBelow: 'md' },
            { key: 'bedNights', header: 'Bed nights', width: '9rem', align: 'right', numeric: true, hideBelow: 'md' },
            { key: 'theatreCases', header: 'Theatre', width: '7.5rem', align: 'right', numeric: true, hideBelow: 'lg' },
            { key: 'emergencySeen', header: 'Emergency', width: '8.5rem', align: 'right', numeric: true, hideBelow: 'lg' },
            { key: 'billed', header: 'Billed', width: '10rem', align: 'right', numeric: true, render: (r) => money(r.billed) },
            { key: 'collected', header: 'Collected', width: '10rem', align: 'right', numeric: true, render: (r) => money(r.collected) },
            { key: 'outstanding', header: 'Outstanding', width: '10rem', align: 'right', numeric: true, hideBelow: 'md', render: (r) => money(r.outstanding) },
            { key: 'payrollCost', header: 'Payroll', width: '10rem', align: 'right', numeric: true, hideBelow: 'lg', render: (r) => money(r.payrollCost) },
            { key: 'source', header: 'Where the figures came from', hideBelow: 'lg', render: (r) => <span className="text-xs text-text-secondary">{r.source.split(':')[0]}</span> },
          ]}
        />
        <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Totals: {money(totals.billed)} billed, {money(totals.collected)} collected, {money(totals.outstanding)} outstanding over {filtered.length} branch row(s). A
          branch’s revenue is its own day book: a patient referred from Mirpur and treated at Main Campus is one visit and one bill, in the branch that did the work.
        </p>
      </Panel>

      <Panel title="What this report insists on saying" actions={<span className="text-xs text-text-secondary">{BRANCH_REPORT_NOTES.length} notes</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {BRANCH_REPORT_NOTES.map((note) => (
            <li key={note.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {note.title}
              </p>
              <p className="text-text-secondary">{note.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ------------------------------------------------------------------------------------------ one branch row */}
      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.branch} — ${selected.period}` : 'Branch month'}
        description={selected ? `Posted ${selected.posted} · ${profileOf(selected.branch).node}` : undefined}
        width="lg"
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['Out-patients', String(selected.outPatients)],
                ['Admissions', String(selected.admissions)],
                ['Bed nights', String(selected.bedNights)],
                ['Theatre cases', String(selected.theatreCases)],
                ['Emergency seen', String(selected.emergencySeen)],
                ['Billed', money(selected.billed)],
                ['Collected', money(selected.collected)],
                ['Outstanding', money(selected.outstanding)],
                ['Payroll cost', money(selected.payrollCost)],
                ['Expected collection rate', `${Math.round((selected.collected / selected.billed) * 100)}%`],
                ['Beds in the branch', String(profileOf(selected.branch).beds)],
                ['Own establishment / seconded in', `${profileOf(selected.branch).establishment} / ${profileOf(selected.branch).seconded}`],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-numeric font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <Panel title="Provenance">
              <p className="text-text-secondary">{selected.source}</p>
              <p className="mt-1 text-xs text-text-tertiary">
                Posted {selected.posted}. A late posting lands in the day it happened, not the day it arrived, which is why a month is a month rather than a delivery schedule.
              </p>
            </Panel>

            <Panel title="The latest day at this branch, as its board had it">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(() => {
                  const latest = branchDay(selected.branch, day);
                  const t = consoleTotals([latest]);
                  return [
                    ['Occupied beds', `${latest.beds.occupied}/${latest.beds.total}`],
                    ['Free', String(latest.beds.free)],
                    ['Out-patients', String(latest.outPatients.seen)],
                    ['Waiting', String(latest.outPatients.waiting)],
                    ['Admissions', String(latest.inPatients.admissions)],
                    ['Collected', money(latest.money.collected)],
                    ['On duty', `${latest.staff.onDuty}/${latest.staff.rostered}`],
                    ['Node', latest.node.node],
                    ['Posting', latest.node.figuresAreLastPosting ? latest.node.lastUplink.slice(11) : 'live'],
                  ].map(([label, value]) => (
                    <li key={label} className="rounded-md border border-border-subtle px-2 py-1">
                      <span className="block text-xs text-text-secondary">{label}</span>
                      <span className="font-numeric font-medium">{value}</span>
                    </li>
                  ))
                })()}
              </ul>
              <p className="mt-2 text-xs text-text-tertiary">
                Shown for contrast, not as the month: today’s board is one day, and a branch comparison read from one day is how a busy Tuesday becomes a trend.
              </p>
            </Panel>

            <div className={cx('rounded-md border border-border-subtle px-3 py-2')}>
              <p className="font-medium text-text-primary">What this row cannot tell you</p>
              <ul className="mt-1 space-y-1 text-text-secondary">
                <li>· Why a figure moved. The console reports what each node posted; the operational screens behind it hold the reasons.</li>
                <li>· Whether the month is settled. Money is collected over weeks, and an outstanding figure for a recent month is normal.</li>
                <li>· Where the patients went after a referral. That is on the clinical record at the receiving branch, which this report does not read.</li>
              </ul>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
