'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppSlider, Button, DataGrid, KpiTile, Panel, SafetyBanner, Tabs, useToast, type Column, type RowAction, type Slide } from '@dizi/ui';
import { useShell } from '@/lib/shell';
import { t } from '@/lib/nav';

/* Dashboard: the role home.
 *
 * - the big slider is the desktop highlight panel (announcements, module rollout status, bed-crisis notices)
 * - tabs split the working day (Today / This week / This month)
 * - KPI tiles each carry their own definition and "as of" time, because the legacy dashboard shows the same
 *   occupancy as 56 % and 30/54 with no way to tell which is right
 */

interface QueueRow {
  token: string;
  patient: string;
  mrn: string;
  doctor: string;
  desk: string;
  status: 'Checked in' | 'Awaiting vitals' | 'In consultation' | 'Done';
  waited: number;
}

const QUEUE: QueueRow[] = [
  { token: 'A-104', patient: 'Fatema Begum', mrn: 'SH-102311', doctor: 'Dr. Rahman', desk: 'OPD-1', status: 'In consultation', waited: 8 },
  { token: 'A-105', patient: 'Mizanur Rahman', mrn: 'SH-102345', doctor: 'Dr. Rahman', desk: 'OPD-1', status: 'Awaiting vitals', waited: 21 },
  { token: 'B-021', patient: 'Nasrin Akter', mrn: 'SH-102398', doctor: 'Dr. Chowdhury', desk: 'OPD-3', status: 'Checked in', waited: 6 },
  { token: 'B-022', patient: 'Jahangir Alam', mrn: 'SH-102401', doctor: 'Dr. Chowdhury', desk: 'OPD-3', status: 'Checked in', waited: 12 },
  { token: 'C-008', patient: 'Shirin Sultana', mrn: 'SH-102455', doctor: 'Dr. Islam', desk: 'OPD-5', status: 'Done', waited: 0 },
];

const SLIDES: Slide[] = [
  {
    id: 'p1-pilot',
    eyebrow: 'Phase 1 · pilot',
    title: 'Patient registration, search and appointments move to the new platform',
    description:
      'Branch A goes live first on its own edge node: registration, duplicate detection, search by phone or MRN, and booking — all working with the internet down. Other branches follow 2–4 weeks behind.',
    tone: 'brand',
    action: { label: 'See the rollout plan', href: '/help#rollout' },
  },
  {
    id: 'offline',
    eyebrow: 'Working offline',
    title: 'The hospital keeps working when the internet does not',
    description:
      'Clinical work runs on the hospital server. If the uplink drops, nothing stops: writes queue on the device, print still works, and every queued record is listed until it is synced.',
    tone: 'info',
    action: { label: 'How sync states work', href: '/help#sync' },
  },
  {
    id: 'data-access',
    eyebrow: 'Programme risk',
    title: 'Vendor data access is the first thing we need',
    description:
      'A nightly encrypted export per branch is what lets the new platform start with full history. It is tracked as the top Phase 0 risk with a written fallback if the vendor refuses.',
    tone: 'warning',
    action: { label: 'Read the access plan', href: '/help#data-access' },
  },
];

export default function DashboardPage() {
  const { locale, role, sync, queued, siteMode, density } = useShell();
  const { push } = useToast();
  const [tab, setTab] = useState('today');
  const [queueQuery, setQueueQuery] = useState('');

  const queueRows = QUEUE.filter((r) =>
    queueQuery.trim() === ''
      ? true
      : [r.token, r.patient, r.mrn, r.doctor, r.status].some((v) => v.toLowerCase().includes(queueQuery.trim().toLowerCase())),
  );

  const queueColumns: Array<Column<QueueRow>> = [
    { key: 'token', header: 'Token', width: '6rem', tooltip: 'Queue token printed at the reception desk.' },
    { key: 'patient', header: 'Patient', render: (r) => <Link className="text-brand-600 hover:underline" href={`/patients/${r.mrn}`}>{r.patient}</Link> },
    { key: 'mrn', header: 'MRN', width: '9rem', numeric: true, hideBelow: 'md' },
    { key: 'doctor', header: 'Doctor', hideBelow: 'lg' },
    { key: 'desk', header: 'Desk', width: '6rem', hideBelow: 'lg' },
    {
      key: 'waited',
      header: 'Waiting (min)',
      width: '8rem',
      align: 'right',
      tooltip: 'Minutes since check-in. Counted from the token time to now, excluding time already in consultation.',
      render: (r) => <span className={r.waited > 15 ? 'font-semibold text-safety-warning' : ''}>{r.waited}</span>,
    },
    { key: 'status', header: 'Status', width: '9rem', editable: true, editor: 'select', options: ['Checked in', 'Awaiting vitals', 'In consultation', 'Done'].map((s) => ({ value: s, label: s })) },
  ];

  const rowActions = (r: QueueRow): RowAction<QueueRow>[] => [
    { label: 'Open patient', onSelect: () => push({ title: `Opening ${r.patient}`, tone: 'info' }), hint: r.mrn },
    { label: 'Call next', onSelect: () => push({ title: `${r.token} called`, description: 'Announced on the waiting-room display', tone: 'success' }) },
    { label: 'Print token slip', onSelect: () => push({ title: 'Token slip sent to the desk printer', tone: 'success' }) },
    { label: 'Cancel visit', danger: true, separated: true, onSelect: () => push({ title: `${r.token} cancelled`, description: 'Reason is required and recorded in the audit ledger', tone: 'warning' }) },
  ];

  const slideNotes =
    tab === 'today'
      ? 'Live queue and today’s collection.'
      : tab === 'week'
        ? 'Averages over the last 7 days, so a single bad Monday does not look like a trend.'
        : 'Month-to-date with the previous month for comparison.';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.dashboard', locale)}</h1>
          <p className="text-sm text-text-secondary">
            {t('shell.hospital', locale)} · Main Campus · {siteMode === 'edge-authoritative' ? t('shell.mode.edge', locale) : 'cloud-direct'} ·{' '}
            {density === 'compact' ? t('shell.compact', locale) : t('shell.comfortable', locale)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients/new">
            <Button variant="primary">Register patient</Button>
          </Link>
          <Link href="/appointments">
            <Button>Book appointment</Button>
          </Link>
        </div>
      </div>

      {sync !== 'live' && (
        <SafetyBanner
          severity={sync === 'conflict' ? 'critical' : 'warning'}
          title={
            sync === 'conflict'
              ? '1 record needs review before it can sync'
              : queued.length > 0
                ? `${queued.length} record${queued.length > 1 ? 's' : ''} saved on this device, waiting to sync`
                : 'Working on the hospital network'
          }
        >
          Clinical work continues normally. Nothing is blocked, and queued records are listed under the connection
          indicator in the header.
        </SafetyBanner>
      )}

      <AppSlider slides={SLIDES} />

      <Tabs
        items={[
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'This week' },
          { id: 'month', label: 'This month' },
        ]}
        value={tab}
        onChange={setTab}
      >
        <p className="mb-3 text-sm text-text-secondary">{slideNotes}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Patients today"
            value="218"
            delta={{ value: '12 vs yesterday', direction: 'up' }}
            definition="Distinct patients with at least one encounter (OPD, IPD or diagnostic) registered today, by encounter start time. Cancelled registrations are excluded."
            asOf="14:05"
          />
          <KpiTile
            label="Bed occupancy"
            value="56%"
            definition="Occupied beds ÷ total active beds at this moment, counting admitted patients only. The second legacy figure (30/54) counted transfers twice — this definition is the one finance and nursing agree on."
            asOf="14:05"
            footnote="ward breakdown on the bed board"
          />
          <KpiTile
            label="Awaiting results"
            value="37"
            definition="Ordered investigations with no released result, older than 2 hours, across lab and imaging."
            asOf="14:05"
          />
          <KpiTile
            label="Collected today"
            value="৳ 412,650"
            definition="Sum of payments received (cash, card, mobile, insurance settlement) with a receipt timestamp today, net of refunds issued today."
            asOf="14:05"
          />
        </div>
      </Tabs>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="Live queue" className="xl:col-span-2">
          <DataGrid<QueueRow>
            id="dashboard-queue"
            caption="Today's OPD queue"
            columns={queueColumns}
            rows={queueRows}
            total={queueRows.length}
            page={1}
            pageSize={25}
            rowId={(r) => r.token}
            height="22rem"
            quickSearch={{ value: queueQuery, onChange: setQueueQuery, placeholder: 'Search token, patient or MRN…' }}
            rowActions={rowActions}
            onInlineEdit={(rowId, key, value) => {
              if (sync === 'live') push({ title: 'Status updated', description: `${rowId} · ${key} → ${value}`, tone: 'success' });
              else push({ title: 'Saved on this device', description: `${rowId} will sync when the connection returns.`, tone: 'warning' });
            }}
            printMeta={`Desk: OPD · ${roleLabelsFor(role)}`}
            exportFileName="opd-queue"
            emptyLabel="Nobody is waiting."
          />
        </Panel>

        <Panel title="My actions">
          <ul className="flex flex-col gap-2 text-base">
            <li className="flex items-center justify-between"><span>Unsigned OPD notes</span><span className="font-numeric">{role === 'doctor' ? 3 : 0}</span></li>
            <li className="flex items-center justify-between"><span>Critical results to acknowledge</span><span className="font-numeric text-safety-critical">1</span></li>
            <li className="flex items-center justify-between"><span>Prescriptions to verify</span><span className="font-numeric">{role === 'pharmacist' ? 6 : 2}</span></li>
            <li className="flex items-center justify-between"><span>Insurance claims pending</span><span className="font-numeric">4</span></li>
          </ul>
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Hot actions</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => push({ title: 'Vitals form opened', tone: 'info' })}>Record vitals <kbd className="font-numeric text-[10px] opacity-70">Alt+1</kbd></Button>
              <Button size="sm" onClick={() => push({ title: 'Order set: fever panel', tone: 'info' })}>Order labs <kbd className="font-numeric text-[10px] opacity-70">Alt+2</kbd></Button>
              <Button size="sm" onClick={() => push({ title: 'Prescription draft started', tone: 'info' })}>Prescribe <kbd className="font-numeric text-[10px] opacity-70">Alt+3</kbd></Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function roleLabelsFor(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
