'use client';

import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, cx } from '@dizi/ui';
import { CalendarDays, ChevronRight, ShieldAlert } from 'lucide-react';
import { AdminHeader } from '@/components/AdminShell';
import { ADMIN_GROUPS, ADMIN_SCREENS, ADMIN_WAITING, adminPhaseStats } from '@/lib/admin';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Administration — the P7 hub (and the launcher the sidebar’s Admin item opens).
 *
 * The phase is eighteen screens, and a wall of eighteen links is how a phase gets declared finished with two of
 * them missing. So the hub does three things the legacy admin menu did not:
 *
 *  1. It groups the eighteen by the job they do, and says why those six belong together.
 *  2. It reads the group membership from `ADMIN_SCREENS` — the same registry the harness compares against
 *     `docs/plan/03-SCREEN-MAP.md`, so the count on this page is the plan’s own count.
 *  3. It prints what the phase is still waiting for, on the screen somebody opening the phase would read first.
 */

const OWNER_TONE: Record<string, string> = {
  new: 'border-safety-success text-safety-success',
  legacy: 'border-border-default text-text-tertiary',
};

export default function AdminHubPage() {
  const { queueWrite, syncEngine } = useShell();
  const day = todayIso();
  const stats = adminPhaseStats();
  const planTotal = 16 + 2;

  const write = (screenId: string) => {
    const screen = ADMIN_SCREENS.find((s) => s.id === screenId);
    if (!screen) return;
    void queueWrite(`Opened Administration › ${screen.title.replace(/^.*› /, '')}`, { id: 'savePlatformSetting', recordId: screen.id, fields: { screen: screen.id, route: screen.route } });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        title="Administration"
        subtitle={`People, the front office and the branches’ own configuration — the phase’s ${planTotal} screens, on one page.`}
        actions={
          <Link href="/setup">
            <Button variant="ghost">Other catalogues</Button>
          </Link>
        }
        waiting={syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync — the settings on these screens queue at this node.` : undefined}
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Screens built" value={`${stats.migrated} / ${planTotal}`} definition={`The phase replaces sixteen screens and two sub-screens. All ${stats.migrated} have a route; the count is read from the same registry the plan is checked against.`} asOf={day} />
        <KpiTile label="Fields replaced" value={String(stats.fields)} definition="Form fields captured from the legacy screens. The new screens keep the fields a ward actually reads and say so where one is deliberately dropped." asOf={day} />
        <KpiTile label="Grids replaced" value={String(stats.grids)} definition="Legacy grid instances on these screens. The multi-branch wall alone had sixteen; the new console keeps the ones with a decision behind them." asOf={day} />
        <KpiTile label="Dialogs replaced" value={String(stats.dialogs)} definition="Modal dialogs in the legacy screens, now sheets: a dialog blocks the screen behind it, which is the wrong shape for a gate with a queue." asOf={day} />
        <KpiTile label="Groups" value={String(ADMIN_GROUPS.length)} definition="How the eighteen are organised: people, the front office, the branches, and calendar and configuration." asOf={day} />
        <KpiTile label="Waiting on" value={`${ADMIN_WAITING.length} items`} definition="What this phase cannot do until the API service exists, printed below rather than discovered later." asOf={day} />
      </div>

      {ADMIN_WAITING.map((item) => (
        <SafetyBanner key={item} severity="info" title="Still waiting">
          {item}
        </SafetyBanner>
      ))}

      {ADMIN_GROUPS.map((group) => {
        const members = group.members.map((id) => ADMIN_SCREENS.find((s) => s.id === id)).filter(Boolean) as typeof ADMIN_SCREENS;
        return (
          <Panel key={group.id} title={group.title} actions={<span className="text-xs text-text-secondary">{members.length} of {planTotal}</span>}>
            <p className="mb-3 text-sm text-text-secondary">{group.because}</p>
            <ul className="grid min-w-0 gap-2 md:grid-cols-2">
              {members.map((screen) => (
                <li key={screen.id} className="min-w-0">
                  <Link href={screen.route} onClick={() => write(screen.id)} className="flex items-start justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 hover:bg-surface-sunken">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text-primary">{screen.title}</span>
                        <span className={cx('rounded-full border px-1.5 py-0.5 text-xs', OWNER_TONE[screen.owner])}>{screen.kind === 'sub' ? 'sub-screen' : 'screen'}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-text-tertiary">
                        <span className="font-numeric break-all">{screen.legacy}</span> → <span className="font-numeric break-all">{screen.route}</span>
                      </span>
                      <span className="mt-1 block text-sm text-text-secondary">{screen.purpose}</span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-text-tertiary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}

      <Panel title="What the phase is judged on">
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-medium text-text-primary">HR, attendance and payroll live.</span>{' '}
            <span className="text-text-secondary">
              The staff register feeds the roster and the payroll file from one employee number; attendance is
              punched at a reader and corrected with a name; a payroll month is run by one person and approved by
              another, online, because a queued approval is a signature nobody can verify.
            </span>
          </li>
          <li>
            <span className="font-medium text-text-primary">Front-office registers live.</span>{' '}
            <span className="text-text-secondary">The gate records who is in the building, who they came to see and which pass they hold — with the pass that stays open when somebody goes home without signing out.</span>
          </li>
          <li>
            <span className="font-medium text-text-primary">Multi-branch console live.</span>{' '}
            <span className="text-text-secondary">Beds, out-patients, money and node state per branch, added up where adding up is meaningful and refused where it is not.</span>
          </li>
          <li>
            <span className="font-medium text-text-primary">Masters and settings migrated.</span>{' '}
            <span className="text-text-secondary">Seven configuration screens, each field saying who reads it and what breaks when it is wrong.</span>
          </li>
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs text-text-tertiary">
          <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Phase 7 runs weeks 29–33 in the roadmap: sixteen screens and two sub-screens, about a hundred and five engineer-days.
        </p>
        <p className="mt-2 flex items-start gap-2 text-xs text-text-tertiary">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            Every screen on this page replaces a legacy screen that is still the system of record for it. The
            ownership matrix (<span className="font-numeric break-all">docs/migration/ownership.md</span>) is what decides when
            a branch stops writing in the old one, and it is not this page’s decision to make.
          </span>
        </p>
      </Panel>
    </div>
  );
}
