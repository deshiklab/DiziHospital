'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, DataGrid, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Tooltip, copyText, cx, useToast, type Column } from '@dizi/ui';
import { ArrowLeft, CalendarClock, Info, Printer, Table2, TriangleAlert } from 'lucide-react';
import { todayIso } from '@/lib/appointments';
import { money } from '@/lib/billing';
import { SCHEDULING_NEEDS_SERVER } from '@/lib/reports';
import { BRANCH_NOTE, CONSOLIDATED, RANGES, REPORT_SUITE_NOTE, SCOPES, buildReport, type RangeId, type Scope } from '@/lib/report-suite';

/* One Reports › … screen for every report in the suite.
 *
 * Seventeen legacy screens each asked for the same five things and printed a table nobody could check. This is the
 * one screen they all become: the report's own question at the top, the days it actually read, the columns with what
 * each one means, the per-branch switch, and two lines that let a reader check the table rather than trust it — the
 * control total the figures have to agree with, and the reconciliation that says how the consolidated column was
 * arrived at.
 *
 * The rows are built by `lib/report-suite.ts` from the same generators the operational screens use, so a figure here
 * and the record behind it cannot drift apart. The scope changes which rows are shown, not which report is run.
 */

type Row = { id: string; label: string } & Record<string, string | number>;

export function ReportScreen({ topic }: { topic: string }) {
  const day = todayIso();
  const { push } = useToast();
  const [scope, setScope] = useState<Scope>(CONSOLIDATED);
  const [range, setRange] = useState<RangeId>('week');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  /** The saved view, by label, plus the plain table. `undefined` means “Everything”. */
  const [view, setView] = useState<string | undefined>(undefined);

  const table = useMemo(() => buildReport(topic, { day, range, scope }), [topic, day, range, scope]);
  const def = table.def;
  const views = def.views ?? [];
  const activeView = views.find((v) => v.label === view);

  const rows = useMemo<Row[]>(
    () =>
      table.rows.map((r) => ({
        id: r.id,
        label: r.label,
        ...r.cells,
        ...(r.from
          ? Object.fromEntries(Object.entries(r.from).map(([branch, value]) => [`branch:${branch}`, value as number]))
          : {}),
      })),
    [table],
  );

  const filtered = useMemo(() => {
    /* The saved view first, then the search inside it: a reader who has opened “Awaiting a report” and then types
       a modality means the two together, not the search across everything. */
    const kept = activeView ? table.rows.filter(activeView.keep).map((r) => r.id) : null;
    const scoped = kept ? rows.filter((row) => kept.includes(row.id)) : rows;
    if (!query.trim()) return scoped;
    const q = query.trim().toLowerCase();
    return scoped.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, table.rows, activeView, query]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  const format = (value: number | string, kind = 'count'): string => {
    if (typeof value !== 'number') return String(value);
    if (kind === 'money') return money(value);
    if (kind === 'percent') return `${value} %`;
    return value.toLocaleString('en-US');
  };

  const isName = (key: string): boolean => def.columns[0]?.key === key;

  const columns: Array<Column<Row>> = table.columns.map((c) => ({
    key: c.key,
    header: c.header,
    ...(c.align ? { align: c.align } : {}),
    ...(c.width ? { width: c.width } : {}),
    render: (row: Row) =>
      c.kind === 'text' ? (
        <span className={cx(isName(c.key) ? 'font-medium text-text-primary' : 'text-text-secondary')}>{format(row[c.key], 'text')}</span>
      ) : (
        <span className="tabular-nums">{format(row[c.key], c.kind ?? (c.key.startsWith('branch:') ? 'count' : 'count'))}</span>
      ),
  }));

  /** The headline figures: everything that adds up, so the tiles are the report's own totals and not a summary. */
  const tiles = table.columns
    .filter((c) => c.kind !== 'text' && !c.key.startsWith('branch:') && !c.percentOf && !c.avgOf)
    .slice(0, 5);

  const unavailableForScope = table.unavailable.find((u) => u.branch === scope);
  const definitionOf = (key: string): string => {
    const c = table.columns.find((x) => x.key === key);
    if (!c) return '';
    if (c.percentOf) return `${c.header} is a ratio of ${c.percentOf.part} to ${c.percentOf.whole}, recomputed for whatever rows are shown — never added up as a percentage.`;
    if (c.avgOf) return `${c.header} is a pooled average: every row's ${c.avgOf.total} added up over every row's ${c.avgOf.count}, so a branch with fewer cases cannot swing it.`;
    if (c.aggregate === 'max') return `${c.header} is the oldest of the rows shown, not their sum — an age does not add up.`;
    return `${c.header}, added up over the rows shown.`;
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-text-primary">
            <Table2 className="size-5 text-brand-600" aria-hidden />
            {def.title}
            <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-normal text-text-tertiary">{def.group}</span>
          </h1>
          <p className="text-sm text-text-secondary">{def.question}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {table.rangeNote} Legacy screen {def.legacy}. Owner: {def.owner}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reports">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="size-4" aria-hidden /> All reports
            </Button>
          </Link>
          <Tooltip content="Print, or save as PDF from the print dialog">
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Print
            </Button>
          </Tooltip>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              /* One shareable line, not a CSV dump: a figure that leaves this screen has to carry its definition
                 with it, or the person it reaches has a number and no idea what it means. */
              const headline = tiles[0];
              const line = `${def.title} — ${headline ? `${headline.header} ${format(table.totals[headline.key] ?? 0, headline.kind)}` : 'no headline figure'}; ${table.daysRead.length} day(s) read (${table.daysRead[0]} to ${table.daysRead[table.daysRead.length - 1]}); scope ${scope === CONSOLIDATED ? 'all branches' : scope}; ${def.owner}.`;
              const ok = await copyText(line);
              push({ title: ok ? 'Copied with its definition' : 'Copy refused by the browser', description: line, tone: ok ? 'success' : 'warning' });
            }}
          >
            Copy the summary line
          </Button>
        </div>
      </header>

      {def.caveat && (
        <SafetyBanner severity="info" title="What this report can and cannot read">
          <p>{def.caveat}</p>
        </SafetyBanner>
      )}

      {unavailableForScope && (
        <SafetyBanner severity="warning" title={`${unavailableForScope.branch} cannot answer this report`}>
          <p>{unavailableForScope.because}</p>
          <p className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => setScope(CONSOLIDATED)}>
              Show the consolidated report
            </Button>
          </p>
        </SafetyBanner>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
        {tiles.map((c) => (
          <KpiTile
            key={c.key}
            label={c.header}
            value={format(table.totals[c.key] ?? 0, c.kind)}
            definition={definitionOf(c.key)}
            asOf={day}
          />
        ))}
        <KpiTile
          label="Rows"
          value={String(table.rows.length)}
          definition={`The dimension this report counts in — ${table.columns[0].header.toLowerCase()} — over ${table.daysRead.length} day${table.daysRead.length === 1 ? '' : 's'}.`}
          asOf={day}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_21rem]">
        <Panel>
          {table.rows.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing to report for this scope over the days read.{' '}
              {unavailableForScope ? unavailableForScope.because : 'The branches that do run this service are shown under the consolidated report.'}
            </p>
          ) : (
            <DataGrid<Row>
              id={`report-${def.topic}`}
              caption={`${def.title} — ${scope === CONSOLIDATED ? 'every branch' : scope}, ${filtered.length} row${filtered.length === 1 ? '' : 's'}, read ${table.daysRead[0]} to ${table.daysRead[table.daysRead.length - 1]}`}
              columns={columns}
              rows={pageRows}
              total={filtered.length}
              page={Math.min(page, pageCount)}
              pageSize={pageSize}
              onQuery={(q) => {
                setPage(q.page);
                setPageSize(q.pageSize);
              }}
              savedViews={['Everything', ...views.map((v) => v.label)]}
              activeView={view ?? 'Everything'}
              onViewChange={(v) => {
                setView(v === 'Everything' ? undefined : v);
                setPage(1);
              }}
              quickSearch={{
                value: query,
                onChange: (v) => {
                  setQuery(v);
                  setPage(1);
                },
                placeholder: `Filter by ${table.columns[0].header.toLowerCase()}…`,
              }}
              printMeta={`${def.title} · ${scope === CONSOLIDATED ? 'Consolidated' : scope} · ${table.daysRead[0]} to ${table.daysRead[table.daysRead.length - 1]} · printed ${day}`}
              exportFileName={`${def.topic}-${scope.toLowerCase().replace(/\s+/g, '-')}-${day}`}
              rowId={(r) => r.id}
              height="26rem"
            />
          )}
          {activeView && filtered.length > 0 && (
            <p className="mt-2 flex items-start gap-2 text-xs text-text-tertiary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-text-secondary">{activeView.label}</span> — {activeView.hint} The view is a filter over this report’s
                own rows: the figures are the same arithmetic, over the rows it keeps.
              </span>
            </p>
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Scope and period">
            <Segmented<Scope>
              name="report-scope"
              label="Which branches"
              value={scope}
              onChange={(v) => {
                setScope(v);
                setPage(1);
              }}
              options={SCOPES.map((s) => ({ value: s, label: s === CONSOLIDATED ? 'All' : s.replace(' Branch', '').replace(' Campus', '') }))}
            />
            <SelectField
              label="Period"
              name="report-range"
              value={range}
              onChange={(e) => setRange(e.target.value as RangeId)}
              options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
              className="mt-3"
              hint={table.daysRead.length < (RANGES.find((r) => r.id === range)?.days ?? 0) ? `This report’s data holds ${def.maxDays} day(s); the days read are named above rather than implied.` : RANGES.find((r) => r.id === range)?.note}
            />
            <p className="mt-2 text-xs text-text-secondary">
              {scope === CONSOLIDATED
                ? 'Every branch, added up by the report itself — so the total is the sum of the rows and cannot disagree with them.'
                : BRANCH_NOTE[scope as Exclude<Scope, typeof CONSOLIDATED>]}
            </p>
          </Panel>

          <Panel title="The control total">
            <p className="text-sm text-text-secondary">{table.closing}</p>
          </Panel>

          <Panel title="Per branch and consolidated">
            <p className="text-sm text-text-secondary">{table.reconciliation}</p>
            {table.unavailable.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-text-secondary">
                {table.unavailable.map((u) => (
                  <li key={u.branch} className="flex gap-2">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-safety-warning" aria-hidden />
                    <span>
                      <span className="font-medium text-text-primary">{u.branch}</span> — {u.because}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Scheduled delivery">
            <p className="flex items-start gap-2 text-sm text-text-secondary">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              {def.schedule}
            </p>
            <p className="mt-2 text-xs text-text-tertiary">{SCHEDULING_NEEDS_SERVER}</p>
          </Panel>

          <Panel title="What this report takes">
            <ul className="flex flex-col gap-2 text-xs">
              {def.filters.map((f) => (
                <li key={f.key}>
                  <span className="font-medium text-text-primary">{f.label}</span>
                  <span className="text-text-tertiary"> — {f.value}</span>
                  <span className="block text-text-secondary">{f.hint}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {REPORT_SUITE_NOTE}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
