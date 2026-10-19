'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, DataGrid, KpiTile, Panel, SafetyBanner, Segmented, Sheet, cx, copyText, useToast, type Column, type RowAction } from '@dizi/ui';
import { FileDown, Printer, Upload } from 'lucide-react';
import { branches, payers } from '@/lib/mock';
import {
  IMPORT_FIELDS,
  SAMPLE_IMPORT_CSV,
  TEMPLATE_HEADER,
  previewImport,
  rejectedCsv,
  type ImportRow,
} from '@/lib/patient-import';

/* Patient import (legacy sub-screen 09-patient-import) — the P1 gap.
 *
 * A migration arrives as a spreadsheet, and the only thing that separates a clean import from a duplicate mess is
 * what happens between the file and the register. So this screen does the four things that matter, in order:
 *
 *  1. **Mapping** — every column is matched to a patient field, guessed from the header and overruled by a human.
 *  2. **Validation** — each row is checked against the rules the register itself enforces, and says why it fails.
 *  3. **Duplicates** — a clash with an existing MRN is an error; a clash on phone or on name+age+sex is a
 *     *possible* duplicate that goes to the merge queue. The import never merges two people on its own.
 *  4. **The dry run** — the summary is a preview. Nothing is written here, and the screen says so on itself.
 */

const STATUS_TONE: Record<ImportRow['status'], string> = {
  ready: 'bg-safety-success/10 text-safety-success',
  duplicate: 'bg-safety-warning/10 text-safety-warning',
  error: 'bg-safety-critical/10 text-safety-critical',
};

export default function PatientImportPage() {
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState(SAMPLE_IMPORT_CSV);
  const [source, setSource] = useState<'sample' | 'file' | 'pasted'>('sample');
  const [stage, setStage] = useState<'file' | 'map' | 'review'>('file');
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [imported, setImported] = useState<{ ready: number; duplicates: number; errors: number } | null>(null);
  const [filter, setFilter] = useState<'all' | 'ready' | 'duplicate' | 'error'>('all');
  const [rowSheet, setRowSheet] = useState<ImportRow | null>(null);

  const preview = useMemo(() => previewImport(csv, mapping ?? undefined), [csv, mapping]);
  const rows = filter === 'all' ? preview.rows : preview.rows.filter((r) => r.status === filter);
  const duplicates = preview.counts.duplicate;

  const download = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Array<Column<ImportRow>> = [
    { key: 'line', header: 'Line', width: '4rem', render: (r) => <span className="font-numeric text-text-tertiary">{r.line}</span> },
    { key: 'status', header: 'Verdict', width: '8rem', render: (r) => <span className={cx('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[r.status])}>{r.status === 'duplicate' ? 'possible duplicate' : r.status}</span> },
    { key: 'mrn', header: 'MRN', width: '8rem', render: (r) => <span className="font-numeric">{r.values.mrn || '—'}</span> },
    { key: 'name', header: 'Patient', render: (r) => (
      <span className="flex flex-col">
        <span>{r.values.name || '—'}</span>
        {r.values.nameBn && <span className="text-xs text-text-tertiary">{r.values.nameBn}</span>}
      </span>
    ) },
    { key: 'who', header: 'Age / sex', hideBelow: 'md', render: (r) => `${r.values.age || '—'} · ${r.values.sex || '—'}` },
    { key: 'phone', header: 'Phone', hideBelow: 'lg', render: (r) => <span className="font-numeric">{r.values.phone || '—'}</span> },
    { key: 'branch', header: 'Branch', hideBelow: 'xl', render: (r) => r.values.branch || 'Main Campus' },
    { key: 'problems', header: 'What is wrong', render: (r) => <span className={cx('text-xs', r.status === 'ready' ? 'text-text-tertiary' : 'text-safety-critical')}>{r.problems.length ? r.problems.join('; ') : 'Nothing — the row is ready'}</span> },
  ];

  const rowActions = (r: ImportRow): RowAction<ImportRow>[] => [
    { label: 'See the whole row', onSelect: () => setRowSheet(r) },
    ...(r.status === 'duplicate' ? [{ label: 'Send to the merge queue', onSelect: () => push({ title: 'Queued for the merge desk', description: `${r.values.name} joins the duplicates tab on the patient register, where a person decides. Nothing was merged.`, tone: 'info' }) }] : []),
    { label: 'Copy the line', onSelect: () => void copyText(String(r.line)).then((ok) => push({ title: ok ? `Line ${r.line} copied` : 'The browser would not let me copy', tone: ok ? 'success' : 'warning' })) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Import patients</h1>
          <p className="text-sm text-text-secondary">
            {source === 'sample' ? 'The sample file' : source === 'file' ? 'The file that was chosen' : 'The text that was pasted'} · {preview.counts.total} row(s) ·{' '}
            {branches.length} branches · {payers.length} payers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            name="import-stage"
            label="Step"
            value={stage}
            onChange={setStage}
            options={[
              { value: 'file', label: '1 · File' },
              { value: 'map', label: '2 · Columns' },
              { value: 'review', label: '3 · Review' },
            ]}
          />
          <Link href="/patients">
            <Button variant="ghost">Patient register</Button>
          </Link>
        </div>
      </div>

      <SafetyBanner severity="info" title="A dry run — nothing is written from this screen">
        The file is read in the browser and checked row by row. On the real system the import runs on the server in
        one transaction, writes an audit entry per row and files the source file against the batch; this screen is
        where the mapping and the duplicate decisions are made, which is the part that needs a person.
      </SafetyBanner>

      {stage === 'file' && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel title="Choose the file">
            <div className="flex flex-col gap-3">
              <label htmlFor="patient-import-file" className="text-sm font-medium text-text-secondary">Choose a patient CSV file</label>
              <input
                id="patient-import-file"
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="text-sm"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  setCsv(text);
                  setSource('file');
                  setMapping(null);
                  setImported(null);
                  push({ title: `${file.name} read`, description: `${previewImport(text).counts.total} row(s) found. Check the column mapping next.`, tone: 'success' });
                }}
              />
              <p className="text-xs text-text-tertiary">
                A CSV exported from the legacy register, from Excel, or from a paper register somebody typed. The file
                never leaves this device.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => download('patient-import-template.csv', `${TEMPLATE_HEADER}\n`)}>
                  <FileDown className="size-3.5" aria-hidden />
                  Template (CSV)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() =>
                    void copyText(TEMPLATE_HEADER).then((ok) =>
                      push({ title: ok ? 'Header row copied' : 'The browser would not let me copy', description: ok ? 'Paste it into the first row of the spreadsheet.' : 'Select the header text and copy it by hand.', tone: ok ? 'success' : 'warning' }),
                    )
                  }
                >
                  Copy the header row
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setCsv(SAMPLE_IMPORT_CSV); setSource('sample'); setMapping(null); setImported(null); }}>
                  Load the sample file
                </Button>
                <Button size="sm" onClick={() => setStage('map')} disabled={preview.headers.length === 0}>
                  Continue to the columns →
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="…or paste the rows">
            <label htmlFor="patient-import-csv" className="mb-1 block text-sm font-medium text-text-secondary">Patient CSV text</label>
            <textarea
              id="patient-import-csv"
              className="font-numeric min-h-40 w-full rounded-md border border-border-default bg-surface-default p-2 text-xs"
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setSource('pasted'); setMapping(null); setImported(null); }}
              spellCheck={false}
            />
            <p className="mt-2 text-xs text-text-tertiary">
              The first line is the header. Quoted fields and embedded commas are handled; anything the parser cannot
              read honestly it will not read at all.
            </p>
          </Panel>
        </div>
      )}

      {stage === 'map' && (
        <Panel title="Match each column to a patient field">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {IMPORT_FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">
                  {field.label}
                  {field.required && <span className="ml-1 text-safety-critical">required</span>}
                </span>
                <select
                  className="h-9 w-full rounded-md border border-border-default bg-surface-default px-2 text-sm"
                  value={preview.mapping[field.key] ?? ''}
                  onChange={(e) => setMapping({ ...preview.mapping, [field.key]: e.target.value })}
                >
                  <option value="">Not in this file</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <span className="text-[11px] text-text-tertiary">{field.hint}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setStage('review')}>Check the {preview.counts.total} row(s) →</Button>
            <span className="text-xs text-text-tertiary">
              The mapping was guessed from the header row. A required field left unmapped does not fail the import — it
              fails every row that needed it, with the row number and the reason, which is the only way anybody can fix
              a file.
            </span>
          </div>
        </Panel>
      )}

      {stage === 'review' && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiTile label="Rows read" value={String(preview.counts.total)} definition="Every line after the header." asOf="this file" />
            <KpiTile label="Ready to import" value={String(preview.counts.ready)} definition="Validated against the same rules the register enforces." asOf="this file" />
            <KpiTile label="Possible duplicates" value={String(preview.counts.duplicate)} definition="They clash with an existing MRN, phone, or name+age+sex. Nothing is merged automatically." asOf="this file" footnote={preview.counts.duplicate ? 'the merge desk decides' : undefined} />
            <KpiTile label="Rejected rows" value={String(preview.counts.error)} definition="Missing required fields, or a value that does not exist in this hospital's lists." asOf="this file" footnote={preview.counts.error ? 'fix and bring the file back' : undefined} />
          </div>

          {preview.counts.duplicate > 0 && (
            <SafetyBanner severity="warning" title={`${preview.counts.duplicate} row(s) look like patients who are already here`}>
              An existing MRN is always the authority: the row is rejected rather than renumbered. A shared phone
              number, or the same name with the same age and sex, is a <em>possible</em> duplicate — common with
              relatives and with names like Md. Selim — so those rows go to the merge desk, where a person compares
              the two records. Merging two real patients cannot be undone; leaving two rows for an afternoon can.
            </SafetyBanner>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              name="import-filter"
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All (${preview.counts.total})` },
                { value: 'ready', label: `Ready (${preview.counts.ready})` },
                { value: 'duplicate', label: `Duplicates (${preview.counts.duplicate})` },
                { value: 'error', label: `Rejected (${preview.counts.error})` },
              ]}
            />
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => download('patient-import-rejected.csv', rejectedCsv(preview))} disabled={preview.needsReview.length === 0}>
              <FileDown className="size-3.5" aria-hidden />
              Download the {preview.needsReview.length} row(s) that need fixing
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => window.print()}
            >
              <Printer className="size-3.5" aria-hidden />
              Print the review sheet
            </Button>
          </div>

          <DataGrid<ImportRow>
            id="patient-import-preview"
            caption="Import preview"
            columns={columns}
            rows={rows}
            total={rows.length}
            page={1}
            pageSize={50}
            rowId={(r) => String(r.line)}
            height="28rem"
            rowActions={rowActions}
            onRowClick={(r) => setRowSheet(r)}
            printMeta={`Patient import dry run · ${preview.counts.total} rows · ${preview.counts.ready} ready · ${preview.counts.duplicate} possible duplicates · ${preview.counts.error} rejected`}
          />

          <Panel title="Run the import">
            <div className="flex flex-col gap-3">
              {duplicates > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>
                    The {duplicates} possible duplicate(s) have been looked at by the registration desk.
                    <span className="block text-xs text-text-tertiary">
                      They stay out of this import either way — they go to the merge queue. This box is the record that
                      somebody looked, which is the difference between a queue and a skip.
                    </span>
                  </span>
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={preview.counts.ready === 0 || (duplicates > 0 && !acknowledged)}
                  onClick={() => {
                    setImported({ ready: preview.counts.ready, duplicates: preview.counts.duplicate, errors: preview.counts.error });
                    push({
                      title: `${preview.counts.ready} patient(s) ready to be written`,
                      description: 'On the real system this posts one batch: every row audited, the source file kept, and the duplicates filed against the merge queue.',
                      tone: 'success',
                    });
                  }}
                >
                  <Upload className="size-3.5" aria-hidden />
                  Import {preview.counts.ready} row(s)
                </Button>
                <span className="text-xs text-text-tertiary">
                  {preview.counts.error > 0 ? `${preview.counts.error} rejected row(s) are skipped, not guessed at.` : 'No rejected rows.'}
                </span>
              </div>

              {imported && (
                <div className="rounded-md border border-border-subtle bg-surface-sunken p-3 text-sm">
                  <p className="font-medium">Dry run finished — nothing was written</p>
                  <p className="mt-1 text-text-secondary">
                    {imported.ready} record(s) would be created, {imported.duplicates} filed to the merge queue and{' '}
                    {imported.errors} returned to the sender with their reasons. On the live system this is one
                    transaction with an audit entry per row, and the batch carries the file it came from.
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </>
      )}

      <Sheet
        open={Boolean(rowSheet)}
        onClose={() => setRowSheet(null)}
        title={rowSheet ? `Line ${rowSheet.line} · ${rowSheet.values.name ?? 'unnamed row'}` : 'Row'}
        description={rowSheet ? rowSheet.problems.join('; ') || 'Nothing is wrong with this row.' : undefined}
        width="lg"
      >
        {rowSheet && (
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {IMPORT_FIELDS.map((field) => (
                <div key={field.key}>
                  <dt className="text-xs text-text-tertiary">{field.label}</dt>
                  <dd className={rowSheet.values[field.key] ? '' : 'text-safety-critical'}>
                    {rowSheet.values[field.key] || (field.required ? 'missing — required' : 'empty')}
                  </dd>
                </div>
              ))}
            </dl>
            {rowSheet.duplicateOf && (
              <p className="rounded-md border border-safety-warning/40 bg-safety-warning/5 p-2 text-sm">
                Looks like <strong>{rowSheet.duplicateOf}</strong> already in the register. Compare the two before
                deciding: a shared phone number is normal in one household, and a shared name is normal in this
                district.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
