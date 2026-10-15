'use client';

import Link from 'next/link';
import { Button, KpiTile, Panel, SafetyBanner, cx } from '@dizi/ui';
import { ChevronRight, Globe2, Megaphone, ShieldAlert, Smartphone } from 'lucide-react';
import { operations, type OperationMeta } from '@dizi/contracts/client';
import { AdminHeader } from '@/components/AdminShell';
import { COMMS_GROUPS, P8_SCREEN_COUNT, P8_WAITING, adminPhaseStats, adminScreenById, adminScreensIn } from '@/lib/admin';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';

/* Communication and content — the P8 hub (and the launcher the sidebar's Communication item opens).
 *
 * The phase is twelve screens over six jobs, and the reason they are one phase is the thing this page has to say:
 * every one of them is a message or a document leaving the hospital. A live consultation puts a patient on a video
 * call, the Download Centre shares a discharge summary with them, the Front CMS publishes a page to the whole
 * internet, the survey asks them a question and messaging sends them an SMS. What they have in common is that the
 * hospital stops controlling the record at the moment it goes out — which is why the phase carries more online-only
 * operations than any other, and why the panel below prints them from the contract rather than from a list kept
 * beside it.
 */

/** The tags this phase owns in the platform contract. Everything below reads from them. */
const P8_TAGS = ['telemedicine', 'content', 'records', 'engagement', 'cms', 'messaging', 'portal'];

export default function CommsHubPage() {
  const { syncEngine } = useShell();
  const day = todayIso();
  const stats = adminPhaseStats('P8');
  const screens = adminScreensIn('P8');
  const planTotal = P8_SCREEN_COUNT.screens + P8_SCREEN_COUNT.subs;

  const allOps = Object.values(operations) as OperationMeta[];
  const phaseOps = allOps.filter((op) => op.tag && P8_TAGS.includes(op.tag));
  const onlineOnly = phaseOps.filter((op) => op.offline === 'online-only');
  const queued = phaseOps.filter((op) => op.offline === 'queue');
  const cached = phaseOps.filter((op) => op.offline === 'cache');

  return (
    <div className="space-y-3">
      <AdminHeader
        title="Communication and content"
        subtitle={`${day} · the phase’s ${planTotal} screens on one page: live rooms, the Download Centre, numbered documents, surveys, the public website and messaging.`}
        actions={
          <>
            <Link href="/admin">
              <Button variant="ghost">Administration (P7)</Button>
            </Link>
            <Link href="/setup">
              <Button variant="ghost">Other catalogues</Button>
            </Link>
          </>
        }
        waiting={
          syncEngine.summary.pending > 0
            ? `${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync — a notice, an upload or a share recorded at this node drains with the rest of the outbox, and the screens say which of their writes are records and which are not.`
            : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Screens built" value={`${stats.migrated} / ${planTotal}`} definition={`The phase replaces ${P8_SCREEN_COUNT.screens} screens and no sub-screens. The count is read from the same registry the screen map is checked against, so the denominator on this page is the plan's own.`} asOf={day} />
        <KpiTile label="Fields replaced" value={String(stats.fields)} definition="Form fields captured from the legacy screens. The two certificate and ID-card screens account for most of them: a numbered document carries the subject's details or it is worthless." asOf={day} />
        <KpiTile label="Grids replaced" value={String(stats.grids)} definition="Legacy grids on these screens, down to one share list. What replaced them is the audience: a document is now described by who may see it rather than by which folder it sits in." asOf={day} />
        <KpiTile label="Dialogs replaced" value={String(stats.dialogs)} definition="Modal dialogs, now sheets. Sharing a clinical document to a patient is a decision worth the whole width of the screen rather than a small box." asOf={day} />
        <KpiTile label="Groups" value={String(COMMS_GROUPS.length)} definition="How the twelve are organised: live rooms, the Download Centre, certificates and cards, surveys, the website, and messaging." asOf={day} />
        <KpiTile label="Online-only acts" value={`${onlineOnly.length} of ${phaseOps.length}`} definition={`Operations in this phase the contract refuses to queue. ${queued.length} write operations queue at this node and ${cached.length} reads are served from the replica.`} asOf={day} footnote={onlineOnly.length ? 'each says why, in the panel below' : undefined} />
      </div>

      {P8_WAITING.map((item) => (
        <SafetyBanner key={item} severity="info" title="Still waiting">
          {item}
        </SafetyBanner>
      ))}

      {COMMS_GROUPS.map((group) => {
        const members = group.members.map((id) => adminScreenById(id)).filter(Boolean) as ReturnType<typeof adminScreensIn>;
        return (
          <Panel key={group.id} title={group.title} actions={<span className="text-xs text-text-secondary">{members.length} of {planTotal}</span>}>
            <p className="mb-3 text-sm text-text-secondary">{group.because}</p>
            <ul className="grid gap-2 md:grid-cols-2">
              {members.map((screen) => (
                <li key={screen.id}>
                  <Link href={screen.route} className="flex items-start justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 hover:bg-surface-sunken">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text-primary">{screen.title}</span>
                        <span className={cx('rounded-full border px-1.5 py-0.5 text-xs', screen.owner === 'new' ? 'border-safety-success text-safety-success' : 'border-border-default text-text-tertiary')}>
                          {screen.kind === 'sub' ? 'sub-screen' : 'screen'}
                        </span>
                        <span className="font-numeric rounded-full border border-border-subtle px-1.5 py-0.5 text-xs text-text-tertiary">{screen.size}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-text-tertiary">
                        <span className="font-numeric">{screen.legacy}</span> → <span className="font-numeric">{screen.route}</span> · {screen.fields} fields · {screen.grids} grid{screen.grids === 1 ? '' : 's'}
                        {screen.maxCols ? ` · ${screen.maxCols} columns` : ''} · {screen.dialogs} sheet{screen.dialogs === 1 ? '' : 's'}
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="The seven acts that refuse to be queued" actions={<span className="text-xs text-text-secondary">read from the contract</span>}>
          <p className="text-xs text-text-secondary">
            An offline hospital keeps working because writes queue at the node and drain later. These are the writes that may not: each of them either puts
            information outside the hospital or changes something every branch reads at once, and a queued version of either would tell somebody that something
            happened which has not.
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {onlineOnly.map((op) => (
              <li key={op.id} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-numeric font-medium text-text-primary">{op.method.toUpperCase()} {op.path}</span>
                  <span className="rounded-full border border-safety-warning px-1.5 text-[10px] text-safety-warning">online-only</span>
                  {op.tag && <span className="text-text-tertiary">{op.tag}</span>}
                </p>
                <p className="mt-1 text-text-secondary">{op.notes ?? op.because}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="The two front doors this phase opens">
          <p className="text-xs text-text-secondary">
            Neither of these is a staff screen, and neither of them lives inside the staff shell: a patient on a phone is not at a desk, and a stranger reading the
            website has never been in the building. They are mounted beside the application, with their own layouts and their own navigation.
          </p>
          <div className="mt-2 grid gap-2">
            <Link href="/portal" className="flex items-start gap-3 rounded-md border border-border-subtle px-3 py-2 hover:bg-surface-sunken">
              <Smartphone className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              <span>
                <span className="block font-medium text-text-primary">The patient portal — /portal</span>
                <span className="mt-0.5 block text-sm text-text-secondary">
                  Appointments, prescriptions, released results, bills and feedback, in Bangla first with an English switch, on a phone held in one hand. Sign-in is
                  the honest stub: the one-time code is shown on the screen rather than sent, because the identity service (#24) does not exist yet.
                </span>
              </span>
            </Link>
            <Link href="/site" className="flex items-start gap-3 rounded-md border border-border-subtle px-3 py-2 hover:bg-surface-sunken">
              <Globe2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              <span>
                <span className="block font-medium text-text-primary">The public website — /site</span>
                <span className="mt-0.5 block text-sm text-text-secondary">
                  Rendered from the same page records the Front CMS edits, so the two cannot disagree about what the public reads. The facts strangers telephone for —
                  hours, the emergency number, the address — come from the branch record rather than from the page.
                </span>
              </span>
            </Link>
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            Every screen in this phase writes through a real contract operation, and the portal is no exception: its outbox checks each write against the same
            capability metadata the desk uses, which is why a booking queues on a phone with a weak signal and a payment never does.
          </p>
        </Panel>
      </div>

      <Panel title="What the phase is judged on">
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-medium text-text-primary">A consultation happens in a room that is written down.</span>{' '}
            <span className="text-text-secondary">
              The room, the waiting list, the consent for anything recorded and the outcome are one record, and the same room record serves the meeting screen:
              what differs is who is in it and what has to be written afterwards.
            </span>
          </li>
          <li>
            <span className="font-medium text-text-primary">A document knows who may see it.</span>{' '}
            <span className="text-text-secondary">
              The Download Centre, the share list, the certificates and the ID cards all answer one question before anything leaves the building, and a withdrawal is
              a row rather than a deletion, so the hospital can show what was shared and when it stopped.
            </span>
          </li>
          <li>
            <span className="font-medium text-text-primary">The website is content the hospital owns.</span>{' '}
            <span className="text-text-secondary">
              Pages are records with revisions in two languages, the facts come from the branches, and publication is one act in one place because the site is one
              site.
            </span>
          </li>
          <li>
            <span className="font-medium text-text-primary">Messaging stays two things.</span>{' '}
            <span className="text-text-secondary">
              The noticeboard is a record that works with the uplink down; SMS, WhatsApp and email are outbound, consent-bound and refused when they cannot be
              confirmed. A hospital that blurs those two ends up believing it told somebody something.
            </span>
          </li>
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs text-text-tertiary">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The phase runs weeks 34–37 in the roadmap: twelve screens, no sub-screens, about sixty-four engineer-days. Its exit criteria are the phase outcome in{' '}
          <span className="font-numeric">docs/plan/04-ROADMAP.md</span>, and every screen here states what it is waiting for rather than leaving it to be discovered.
        </p>
        <p className="mt-2 flex items-start gap-2 text-xs text-text-tertiary">
          <Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The screens in this phase replace legacy screens that are still the system of record for the work they do. Nothing is switched off from here: the ownership
          matrix decides when a branch stops writing in the old one.
        </p>
      </Panel>
    </div>
  );
}
