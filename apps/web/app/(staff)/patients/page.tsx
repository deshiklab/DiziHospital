'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, DataGrid, Panel, SafetyBanner, Tabs, copyText, useToast, type Column, type RowAction } from '@dizi/ui';
import { branches, payers, queryPatients, type Patient } from '@/lib/mock';
import { useShell } from '@/lib/shell';

/* Patient list — legacy screens 001/002 replaced.
 *
 * Everything the counter needs is on this page: quick search (name, Bangla name, MRN, phone), advanced
 * filters with removable chips, tabs for the work that is not "search", inline edit of the two fields clerks
 * actually fix, a 3-dot action menu per row, printing, export and column management.
 */

const DUPES: Array<{ a: Patient; b: Patient; reason: string }> = [];

export default function PatientsPage() {
  const { locale, sync } = useShell();
  const { push } = useToast();

  const [tab, setTab] = useState('search');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'mrn', dir: 'asc' });
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [payer, setPayer] = useState('');
  const [view, setView] = useState<string>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [rowsOverride, setRowsOverride] = useState<Record<string, Partial<Patient>>>({});

  const result = useMemo(
    () => queryPatients({ page, pageSize, sort, search, branch, status }),
    [page, pageSize, sort, search, branch, status],
  );

  const rows = useMemo(
    () => result.rows.map((r) => ({ ...r, ...rowsOverride[r.mrn] })) as Patient[],
    [result.rows, rowsOverride],
  );

  const columns: Array<Column<Patient>> = [
    { key: 'mrn', header: 'MRN', width: '9rem', tooltip: 'Medical record number. Legacy numbers are preserved; new patients continue the same series.' },
    { key: 'name', header: 'Patient', render: (p) => (locale === 'bn' ? p.nameBn : p.name) },
    { key: 'age', header: 'Age', width: '4.5rem', align: 'right', numeric: true },
    { key: 'sex', header: 'Sex', width: '5.5rem', hideBelow: 'md' },
    {
      key: 'phone',
      header: 'Mobile',
      width: '9.5rem',
      numeric: true,
      editable: true,
      tooltip: 'Primary follow-up number. Double-click to correct it in place; the change is audited.',
    },
    { key: 'branch', header: 'Branch', hideBelow: 'xl' },
    { key: 'payer', header: 'Payer', hideBelow: 'lg', render: (p) => <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{p.payer}</span> },
    { key: 'lastVisit', header: 'Last visit', width: '8.5rem', numeric: true, hideBelow: 'md' },
    {
      key: 'status',
      header: 'Status',
      width: '9rem',
      editable: true,
      editor: 'select',
      options: ['Active', 'Follow-up', 'Admitted', 'Discharged'].map((s) => ({ value: s, label: s })),
      render: (p) => (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs">
          {p.status}
          {p.allergies && (
            <span title={`Allergy: ${p.allergies}`} className="text-safety-critical" aria-label={`Allergy: ${p.allergies}`}>
              ⚠
            </span>
          )}
        </span>
      ),
    },
  ];

  const rowActions = (p: Patient): RowAction<Patient>[] => [
    { label: 'Open record', onSelect: () => push({ title: `Opening ${p.name}`, description: p.mrn, tone: 'info' }) },
    { label: 'New appointment', onSelect: () => push({ title: `Appointment started for ${p.name}`, tone: 'success' }) },
    { label: 'Print registration slip', onSelect: () => push({ title: 'Slip sent to the counter printer', description: 'Works offline', tone: 'success' }) },
    { label: 'Print ID card', onSelect: () => push({ title: 'ID card queued', tone: 'success' }) },
    {
      label: 'Copy MRN',
      onSelect: () => {
        // The browser can refuse (no secure context, or an embedded frame); say so instead of claiming success.
        void copyText(p.mrn).then((ok) =>
          push(
            ok
              ? { title: 'MRN copied', description: p.mrn, tone: 'info' }
              : { title: 'The browser blocked the copy', description: `Select ${p.mrn} in the record and copy it by hand.`, tone: 'warning' },
          ),
        );
      },
    },
    { label: 'Register a visit', separated: true, onSelect: () => push({ title: `Visit opened for ${p.name}`, tone: 'info' }) },
    { label: 'Mark inactive', danger: true, separated: true, onSelect: () => push({ title: `${p.name} marked inactive`, description: 'Nothing is deleted; the record is retained per the retention policy.', tone: 'warning' }) },
  ];

  const activeFilters = [
    ...(branch ? [{ id: 'branch', label: `Branch: ${branch}`, onRemove: () => setBranch('') }] : []),
    ...(status ? [{ id: 'status', label: `Status: ${status}`, onRemove: () => setStatus('') }] : []),
    ...(payer ? [{ id: 'payer', label: `Payer: ${payer}`, onRemove: () => setPayer('') }] : []),
    ...(search ? [{ id: 'q', label: `Search: “${search}”`, onRemove: () => setSearch('') }] : []),
  ];

  const onInlineEdit = async (rowId: string, key: string, value: string) => {
    setRowsOverride((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value } }));
    if (sync === 'live') push({ title: 'Saved', description: `${rowId} · ${key} updated and audited`, tone: 'success' });
    else push({ title: 'Saved on this device', description: `${rowId} will sync automatically when the connection returns.`, tone: 'warning' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Patients</h1>
          <p className="text-sm text-text-secondary">Search, register and maintain patient records across all branches.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients/new">
            <Button variant="primary">Register patient</Button>
          </Link>
          <Link href="/patients/import">
            <Button>Import</Button>
          </Link>
        </div>
      </div>

      {sync === 'queued' && (
        <SafetyBanner severity="warning" title="You are working offline">
          Records you change now are stored on this device and sync automatically. Printing still works.
        </SafetyBanner>
      )}

      <Tabs
        items={[
          { id: 'search', label: 'Search', count: result.total },
          { id: 'duplicates', label: 'Possible duplicates', count: 14 },
          { id: 'merges', label: 'Recently merged', count: 3 },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'search' && (
          <DataGrid<Patient>
            id="patients"
            caption="Patient register"
            columns={columns}
            rows={rows}
            total={result.total}
            page={page}
            pageSize={pageSize}
            sort={sort}
            rowId={(p) => p.mrn}
            selected={selected}
            onSelectedChange={setSelected}
            onQuery={(q) => {
              setPage(q.page);
              setPageSize(q.pageSize);
              if (q.sort) setSort(q.sort);
            }}
            quickSearch={{
              value: search,
              onChange: (v) => {
                setSearch(v);
                setPage(1);
              },
              placeholder: 'Name, Bangla name, MRN or phone…',
            }}
            filters={
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-branch" className="text-sm text-text-secondary">Branch</label>
                  <select id="f-branch" value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }} className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base">
                    <option value="">All branches</option>
                    {branches.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-status" className="text-sm text-text-secondary">Status</label>
                  <select id="f-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base">
                    <option value="">Any status</option>
                    {['Active', 'Follow-up', 'Admitted', 'Discharged'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-payer" className="text-sm text-text-secondary">Payer</label>
                  <select id="f-payer" value={payer} onChange={(e) => { setPayer(e.target.value); setPage(1); }} className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base">
                    <option value="">Any payer</option>
                    {payers.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-age" className="text-sm text-text-secondary">Age range</label>
                  <div className="flex items-center gap-2">
                    <input id="f-age" type="number" min={0} placeholder="from" className="h-[var(--dizi-density-field-height)] w-full rounded-md border border-border-default bg-surface-default px-2 text-base" />
                    <input type="number" min={0} placeholder="to" aria-label="Maximum age" className="h-[var(--dizi-density-field-height)] w-full rounded-md border border-border-default bg-surface-default px-2 text-base" />
                  </div>
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor="f-visit" className="text-sm text-text-secondary">Last visit between</label>
                  <div className="flex items-center gap-2">
                    <input id="f-visit" type="date" className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base" />
                    <span className="text-text-tertiary">→</span>
                    <input type="date" aria-label="Last visit to" className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base" />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="secondary" onClick={() => { setBranch(''); setStatus(''); setPayer(''); setSearch(''); setPage(1); }}>Clear</Button>
                  <Button variant="primary" onClick={() => push({ title: 'Filters applied', tone: 'info' })}>Apply</Button>
                </div>
              </>
            }
            activeFilters={activeFilters}
            onClearFilters={() => { setBranch(''); setStatus(''); setPayer(''); setSearch(''); }}
            savedViews={['My desk today', 'New this week', 'Chronic care', 'Outstanding balance']}
            activeView={view}
            onViewChange={(v) => { setView(v); push({ title: `View: ${v}`, description: 'Saved views keep their filters and columns.', tone: 'info' }); }}
            rowActions={rowActions}
            onInlineEdit={onInlineEdit}
            bulkActions={[
              { label: 'Print ID cards', onSelect: (ids) => push({ title: `${ids.length} ID cards queued`, tone: 'success' }) },
              { label: 'Send SMS', onSelect: (ids) => push({ title: `Message queued for ${ids.length} patients`, description: 'Sent from the notification outbox', tone: 'success' }) },
              { label: 'Export selection', onSelect: (ids) => push({ title: `Exporting ${ids.length} records`, tone: 'info' }) },
            ]}
            toolbar={<Button size="sm" onClick={() => push({ title: 'Saved as a view', tone: 'success' })}>Save view</Button>}
            exportFileName="patients"
            printMeta={`Branch: ${branch || 'all'} · Status: ${status || 'any'} · Payer: ${payer || 'any'}`}
            emptyLabel="No patient matches these filters. Try the phone number, clear a filter, or register a new patient."
          />
        )}

        {tab === 'duplicates' && (
          <Panel title="Possible duplicates">
            <p className="mb-3 text-sm text-text-secondary">
              Matched on mobile number, national ID and fuzzy name+date of birth. Merging keeps one record and
              writes an audit entry for every field that changed — the legacy merge left no trace of what was merged.
            </p>
            <ul className="flex flex-col gap-2">
              {[
                { a: 'Fatema Begum', b: 'Fatema Bagum', mrn: 'SH-102311 / SH-118904', reason: 'Name spelling differs, same mobile, same date of birth', score: 96 },
                { a: 'Abdul Karim', b: 'A. Karim', mrn: 'SH-102322 / SH-119002', reason: 'Same mobile, age differs by 1 year', score: 88 },
                { a: 'Nasrin Akter', b: 'Nasrin Akhtar', mrn: 'SH-102398 / SH-119115', reason: 'Same national ID, different branch', score: 99 },
              ].map((d) => (
                <li key={d.mrn} className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base">
                      <strong>{d.a}</strong> <span className="text-text-tertiary">and</span> <strong>{d.b}</strong>
                    </p>
                    <p className="font-numeric text-xs text-text-tertiary">{d.mrn}</p>
                    <p className="text-sm text-text-secondary">{d.reason}</p>
                  </div>
                  <span className="font-numeric rounded-full bg-surface-sunken px-2 py-0.5 text-xs">match {d.score}%</span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => push({ title: `Comparing ${d.a} and ${d.b}`, description: 'Field-by-field comparison before merging', tone: 'info' })}>Compare</Button>
                    <Button size="sm" onClick={() => push({ title: `Merged ${d.b} into ${d.a}`, description: 'Audit entry written; the emptied record is retained', tone: 'success' })}>Merge</Button>
                    <Button size="sm" variant="ghost" onClick={() => push({ title: 'Marked as different people', tone: 'info' })}>Not a match</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {tab === 'merges' && (
          <Panel title="Recently merged">
            <p className="mb-3 text-sm text-text-secondary">
              Every merge is reversible in the sense that the original records are retained and every changed field
              is recorded in the audit ledger.
            </p>
            <ul className="flex flex-col gap-2 text-base">
              <li className="flex items-center justify-between rounded-md border border-border-subtle p-3">
                <span>SH-118904 → <strong>SH-102311</strong> (Fatema Begum)</span>
                <span className="text-sm text-text-tertiary">merged 2 days ago by the front office · 4 fields changed</span>
              </li>
              <li className="flex items-center justify-between rounded-md border border-border-subtle p-3">
                <span>SH-119002 → <strong>SH-102322</strong> (Abdul Karim)</span>
                <span className="text-sm text-text-tertiary">merged 5 days ago by the front office · 2 fields changed</span>
              </li>
            </ul>
          </Panel>
        )}
      </Tabs>
    </div>
  );
}
