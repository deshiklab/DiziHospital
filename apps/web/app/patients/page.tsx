'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, DataGrid, Panel, SubNav, type Column } from '@dizi/ui';
import { branches, queryPatients, toCsv, type Patient } from '@/lib/mock';
import { useShell } from '@/lib/shell';

/* Patient list (legacy screen 001/002 replaced).
 *
 * Search matches name, Bangla name, MRN and phone — the legacy search matched name only, which is why the
 * counters kept a paper register beside it. Query, sort and paging are server-shaped so the API swap is a
 * one-line change (P0-303).
 */
export default function PatientsPage() {
  const { locale } = useShell();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'mrn', dir: 'asc' });
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const result = useMemo(
    () => queryPatients({ page, pageSize, sort, search, branch, status }),
    [page, pageSize, sort, search, branch, status],
  );

  const columns: Array<Column<Patient>> = [
    { key: 'mrn', header: 'MRN', width: '9rem' },
    { key: 'name', header: 'Patient', render: (p) => (locale === 'bn' ? p.nameBn : p.name) },
    { key: 'age', header: 'Age', width: '4.5rem', align: 'right', numeric: true },
    { key: 'sex', header: 'Sex', width: '5.5rem', hideBelow: 'md' },
    { key: 'phone', header: 'Phone', width: '9rem', numeric: true },
    { key: 'branch', header: 'Branch', hideBelow: 'xl' },
    { key: 'payer', header: 'Payer', hideBelow: 'lg' },
    { key: 'lastVisit', header: 'Last visit', width: '8rem', numeric: true, hideBelow: 'md' },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      render: (p) => (
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">
          {p.status}
          {p.allergies ? ' · ⚠' : ''}
        </span>
      ),
    },
  ];

  const exportCsv = () => {
    const csv = toCsv(result.rows, columns.map((c) => ({ key: c.key, header: c.header })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patients-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <div className="flex gap-2">
          <Link href="/patients/new">
            <Button variant="primary">Register patient</Button>
          </Link>
          <Button>Import</Button>
        </div>
      </div>

      <SubNav
        items={[
          { id: 'search', label: 'Search', count: result.total },
          { id: 'duplicates', label: 'Possible duplicates', count: 14 },
          { id: 'merges', label: 'Merge history', count: 3 },
        ]}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="search" className="text-sm text-text-secondary">
              Name, Bangla name, MRN or phone
            </label>
            <input
              id="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="e.g. 01712… or SH-102345"
              className="h-[var(--dizi-density-field-height)] w-72 rounded-md border border-border-default bg-surface-default px-3 text-base"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="branch" className="text-sm text-text-secondary">
              Branch
            </label>
            <select
              id="branch"
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setPage(1);
              }}
              className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-sm text-text-secondary">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base"
            >
              <option value="">Any</option>
              {['Active', 'Follow-up', 'Admitted', 'Discharged'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {selected.length > 0 && (
            <p className="text-sm text-text-secondary">
              {selected.length} selected · <button className="text-brand-600 underline">print ID cards</button> ·{' '}
              <button className="text-brand-600 underline">add to campaign</button>
            </p>
          )}
        </div>

        <div className="mt-3">
          <DataGrid
            columns={columns}
            rows={result.rows}
            total={result.total}
            page={page}
            pageSize={pageSize}
            sort={sort}
            rowId={(p) => p.mrn}
            selected={selected}
            onSelectedChange={setSelected}
            savedViews={['My desk today', 'New this week', 'Chronic care', 'Outstanding balance']}
            onQuery={(q) => {
              setPage(q.page);
              if (q.sort) setSort(q.sort);
            }}
            onExport={exportCsv}
            emptyLabel="No patient matches that search. Try the phone number, or register a new patient."
          />
        </div>
      </Panel>

      <p className="text-xs text-text-tertiary">
        Data shown is synthetic (2 000 generated records) — the grid, filters and export behave exactly as they
        will against the real API.
      </p>
    </div>
  );
}
