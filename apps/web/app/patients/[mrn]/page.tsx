'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Button,
  DataGrid,
  FieldSection,
  PatientBanner,
  Panel,
  SafetyBanner,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
  Tooltip,
  useToast,
  type Column,
  type RowAction,
} from '@dizi/ui';
import { patients } from '@/lib/mock';
import { useShell } from '@/lib/shell';

/* Patient record — legacy screens 004/005 and the read-only projection of legacy-owned modules.
 *
 * This page is also the demonstration of three rules from the plan:
 *  - breadcrumbs and a deep link: the URL is the address of the record, tabs included
 *  - tabs replace the legacy tab strip, and a tab survives a reload because it lives in the hash
 *  - legacy-owned modules appear read-only, with a plain "edit in the legacy system" affordance instead of a
 *    disabled-looking form that lies about being editable
 */

interface Visit {
  id: string;
  date: string;
  department: string;
  doctor: string;
  diagnosis: string;
  charged: number;
  status: 'Closed' | 'Open' | 'Follow-up due';
}

const VISITS: Visit[] = [
  { id: 'V-24019', date: '2026-10-12', department: 'Medicine', doctor: 'Dr. Rahman', diagnosis: 'Type 2 diabetes — routine review', charged: 1450, status: 'Closed' },
  { id: 'V-23882', date: '2026-09-28', department: 'Medicine', doctor: 'Dr. Rahman', diagnosis: 'Hypertension follow-up', charged: 900, status: 'Closed' },
  { id: 'V-23710', date: '2026-09-11', department: 'Endocrinology', doctor: 'Dr. Chowdhury', diagnosis: 'Thyroid function review', charged: 2200, status: 'Closed' },
  { id: 'V-23544', date: '2026-08-24', department: 'Medicine', doctor: 'Dr. Rahman', diagnosis: 'Acute gastritis', charged: 1750, status: 'Closed' },
  { id: 'V-24088', date: '2026-10-14', department: 'Medicine', doctor: 'Dr. Rahman', diagnosis: 'Awaiting results', charged: 0, status: 'Open' },
];

export default function PatientRecordPage() {
  const params = useParams<{ mrn: string }>();
  const mrn = decodeURIComponent(params?.mrn ?? '');
  const { sync, locale } = useShell();
  const { push } = useToast();
  const patient = useMemo(() => patients.find((p) => p.mrn === mrn) ?? patients[0], [mrn]);

  const [visitQuery, setVisitQuery] = useState('');
  const [contact, setContact] = useState({
    phone: patient.phone,
    branch: patient.branch,
    payer: patient.payer,
    address: 'House 24, Road 7, Uttara Sector 4, Dhaka',
    guardian: 'Rezaul Karim (husband)',
    notes: '',
  });

  const dirty = contact.phone !== patient.phone || contact.branch !== patient.branch || contact.payer !== patient.payer;

  const save = () => {
    if (sync === 'live') push({ title: 'Saved', description: `${patient.mrn} updated and audited`, tone: 'success' });
    else push({ title: 'Saved on this device', description: 'The change syncs when the connection returns.', tone: 'warning' });
  };

  const visitColumns: Array<Column<Visit>> = [
    { key: 'id', header: 'Visit', width: '7.5rem', numeric: true, tooltip: 'Legacy visit identifier, preserved from the original system.' },
    { key: 'date', header: 'Date', width: '8rem', numeric: true },
    { key: 'department', header: 'Department' },
    { key: 'doctor', header: 'Consultant', hideBelow: 'lg' },
    { key: 'diagnosis', header: 'Diagnosis / reason' },
    { key: 'charged', header: 'Charged', width: '8rem', align: 'right', numeric: true, render: (v) => (v.charged ? `৳ ${v.charged.toLocaleString()}` : '—') },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      render: (v) => (
        <span className={`rounded-full px-2 py-0.5 text-xs ${v.status === 'Open' ? 'bg-safety-warning/10 text-safety-warning' : 'bg-surface-sunken'}`}>{v.status}</span>
      ),
    },
  ];

  const visitActions = (v: Visit): RowAction<Visit>[] => [
    { label: 'Open visit note', onSelect: () => push({ title: `Opening ${v.id}`, tone: 'info' }) },
    { label: 'Print prescription', onSelect: () => push({ title: 'Prescription sent to the printer', tone: 'success' }) },
    { label: 'Print invoice', onSelect: () => push({ title: 'Invoice sent to the printer', tone: 'success' }) },
    { label: 'Copy visit ID', onSelect: () => { void navigator.clipboard?.writeText(v.id); push({ title: 'Visit ID copied', tone: 'info' }); } },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Patient record</h1>
        <div className="flex gap-2">
          <Tooltip title="Print record" content="Prints the patient summary and the visit list with the current columns." shortcut="Ctrl+P">
            <Button onClick={() => window.print()}>Print record</Button>
          </Tooltip>
          <Link href="/patients">
            <Button variant="ghost">Back to list</Button>
          </Link>
        </div>
      </div>

      <PatientBanner
        mrn={patient.mrn}
        name={locale === 'bn' ? patient.nameBn : patient.name}
        age={patient.age}
        sex={patient.sex}
        payer={contact.payer}
        allergies={patient.allergies ? [patient.allergies] : []}
        alerts={['Diabetic — check sugar before procedures']}
        extra={[
          { label: 'Branch', value: contact.branch },
          { label: 'Last visit', value: patient.lastVisit },
        ]}
      />

      <Tabs
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'visits', label: 'Visits', count: VISITS.length },
          { id: 'invoices', label: 'Bills & payments' },
          { id: 'documents', label: 'Documents', count: 4 },
          { id: 'notes', label: 'Notes' },
        ]}
        defaultValue="overview"
      >
        <div className="flex flex-col gap-3">
          <Panel title="Contact and billing details">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <TextField label="Mobile" name="phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} hint="Primary follow-up number; results and reminders go here" />
              <SelectField
                label="Branch"
                name="branch"
                value={contact.branch}
                onChange={(e) => setContact({ ...contact, branch: e.target.value })}
                options={['Main Campus', 'Uttara Branch', 'Mirpur Branch'].map((b) => ({ value: b, label: b }))}
              />
              <SelectField
                label="Payer"
                name="payer"
                value={contact.payer}
                onChange={(e) => setContact({ ...contact, payer: e.target.value })}
                options={['Self pay', 'Corporate — BRAC', 'Insurance — MetLife', 'Govt. scheme'].map((p) => ({ value: p, label: p }))}
              />
              <TextField label="Guardian / next of kin" name="guardian" value={contact.guardian} onChange={(e) => setContact({ ...contact, guardian: e.target.value })} />
              <TextField label="Address" name="address" value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} className="md:col-span-2" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" disabled={!dirty} onClick={save}>Save changes</Button>
              <Button variant="ghost" disabled={!dirty} onClick={() => setContact({ ...contact, phone: patient.phone, branch: patient.branch, payer: patient.payer })}>
                Discard
              </Button>
              <span className="text-sm text-text-tertiary">
                {dirty ? (sync === 'live' ? 'Unsaved changes' : 'Unsaved changes will be stored on this device first') : 'No changes'}
              </span>
            </div>
          </Panel>

          {sync === 'lanOnly' && (
            <SafetyBanner severity="info" title="Working on the hospital network">
              Result messages and the patient portal are paused while the internet link is down. Registration,
              prescribing, dispensing and printing are unaffected.
            </SafetyBanner>
          )}
        </div>
      </Tabs>

      {/* The visits table lives outside the tab strip so it stays reachable by deep link and by print. */}
      <div className="print-block">
        <Panel title="Visit history">
          <DataGrid<Visit>
            id="patient-visits"
            caption={`Visit history — ${patient.name} (${patient.mrn})`}
            columns={visitColumns}
            rows={VISITS.filter((v) =>
              visitQuery.trim() === ''
                ? true
                : [v.id, v.department, v.doctor, v.diagnosis, v.status].some((f) => f.toLowerCase().includes(visitQuery.trim().toLowerCase())),
            )}
            total={
              VISITS.filter((v) =>
                visitQuery.trim() === ''
                  ? true
                  : [v.id, v.department, v.doctor, v.diagnosis, v.status].some((f) => f.toLowerCase().includes(visitQuery.trim().toLowerCase())),
              ).length
            }
            page={1}
            pageSize={10}
            rowId={(v) => v.id}
            height="24rem"
            quickSearch={{ value: visitQuery, onChange: setVisitQuery, placeholder: 'Search diagnosis, consultant or visit ID…' }}
            rowActions={visitActions}
            exportFileName={`visits-${patient.mrn}`}
            printMeta={`Patient: ${patient.name} · MRN ${patient.mrn} · Branch ${contact.branch}`}
            emptyLabel="No visits recorded."
          />
        </Panel>
      </div>

      <Panel title="Legacy-owned modules (read-only here)">
        <p className="mb-2 text-sm text-text-secondary">
          These modules still create records in the legacy system until their cutover. They are shown read-only so
          you can find everything in one place — editing stays where the record lives.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { name: 'Bills & payments', phase: 'P2', value: '৳ 4,300 due', note: 'Invoiced in the legacy system' },
            { name: 'Lab investigations', phase: 'P4', value: '2 results pending', note: 'Ordered in the legacy system' },
            { name: 'Pharmacy dispense', phase: 'P3', value: 'Last dispensed 2026-10-12', note: 'Dispensed in the legacy system' },
          ].map((m) => (
            <div key={m.name} className="rounded-md border border-border-subtle p-3">
              <p className="text-base font-medium">{m.name}</p>
              <p className="font-numeric text-sm text-text-secondary">{m.value}</p>
              <p className="mt-1 text-xs text-text-tertiary">{m.note} · moves here in {m.phase}</p>
              <Button size="sm" className="mt-2" onClick={() => push({ title: `Opening ${m.name} in the legacy system`, description: 'With the legacy launcher (P0) or a plain bookmark until then', tone: 'info' })}>
                Open in legacy system
              </Button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Clinical notes">
        <TextAreaField
          label="Note"
          name="notes"
          value={contact.notes}
          onChange={(e) => setContact({ ...contact, notes: e.target.value })}
          hint="Notes are appended, never overwritten — the audit ledger keeps every version."
          rows={4}
        />
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => push({ title: 'Note appended', tone: 'success' })} disabled={!contact.notes}>
            Append note
          </Button>
          <Button variant="ghost" onClick={() => push({ title: 'Note templates', description: 'Order sets and note templates arrive with P2', tone: 'info' })}>
            Templates
          </Button>
        </div>
      </Panel>

      <FieldSection title="Record metadata" description="Shown for every record: who touched it, when, and where it lives.">
        <TextField label="Created" name="created" value="2019-04-08 · legacy system" readOnly />
        <TextField label="Last modified" name="modified" value={`${patient.lastVisit} · Dr. Rahman`} readOnly />
        <TextField label="Owning system" name="owner" value="DiziHospital platform (patients migrated in P1)" readOnly />
      </FieldSection>
    </div>
  );
}
