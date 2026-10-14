'use client';

import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner } from '@dizi/ui';
import { useShell } from '@/lib/shell';
import { t } from '@/lib/i18n';

/* Dashboard (role home). Every KPI carries its own definition and an "as of" timestamp, because the legacy
 * dashboard shows 56 % and 30/54 for the same occupancy figure and nobody can tell which is right. */
export default function DashboardPage() {
  const { locale, role, sync, queued, siteMode } = useShell();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.dashboard', locale)}</h1>
          <p className="text-sm text-text-secondary">
            {t('shell.hospital', locale)} · Main Campus ·{' '}
            <span className="font-medium">{siteMode === 'edge-authoritative' ? t('shell.mode.edge', locale) : 'cloud-direct'}</span>
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

      {siteMode === 'edge-authoritative' && sync !== 'live' && (
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
          Clinical work continues normally. Nothing is blocked, and queued records are listed under the sync
          indicator in the header.
        </SafetyBanner>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Patients today"
          value="218"
          delta={{ value: '12 vs yesterday', direction: 'up' }}
          definition="Distinct patients with at least one encounter (OPD, IPD or diagnostic) registered today, by encounter start time. Excludes cancelled registrations."
          asOf="14:05"
        />
        <KpiTile
          label="Bed occupancy"
          value="56%"
          definition="Occupied beds ÷ total active beds at this moment, counting admitted patients only. Ward-level breakdown is on the bed board; the legacy dashboard's second occupancy figure counted transfers twice."
          asOf="14:05"
        />
        <KpiTile
          label="Awaiting results"
          value="37"
          definition="Ordered investigations with no released result, older than 2 hours, across lab and imaging. Values within the last 2 hours are excluded to avoid counting work in progress."
          asOf="14:05"
        />
        <KpiTile
          label="Collected today"
          value="৳ 412,650"
          definition="Sum of payments received (cash, card, mobile, insurance settlement) with a receipt timestamp today, net of refunds issued today."
          asOf="14:05"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Today's queue" className="lg:col-span-2">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="text-sm text-text-secondary">
                <th scope="col" className="py-1">Token</th>
                <th scope="col" className="py-1">Patient</th>
                <th scope="col" className="py-1">Doctor</th>
                <th scope="col" className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['A-104', 'Fatema Begum', 'Dr. Rahman', 'In consultation'],
                ['A-105', 'Mizanur Rahman', 'Dr. Rahman', 'Awaiting vitals'],
                ['B-021', 'Nasrin Akter', 'Dr. Chowdhury', 'Checked in'],
                ['B-022', 'Jahangir Alam', 'Dr. Chowdhury', 'Checked in'],
              ].map(([token, patient, doctor, status]) => (
                <tr key={token} className="h-[var(--dizi-density-row-height)] border-t border-border-subtle">
                  <td className="font-numeric">{token}</td>
                  <td>{patient}</td>
                  <td className="text-text-secondary">{doctor}</td>
                  <td>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="My actions">
          <ul className="flex flex-col gap-2 text-base">
            <li className="flex items-center justify-between">
              <span>Unsigned OPD notes</span>
              <span className="font-numeric">{role === 'doctor' ? 3 : 0}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Critical results to acknowledge</span>
              <span className="font-numeric text-safety-critical">1</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Prescriptions to verify</span>
              <span className="font-numeric">{role === 'pharmacist' ? 6 : 2}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Insurance claims pending</span>
              <span className="font-numeric">4</span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
