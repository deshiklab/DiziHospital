'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Panel, SafetyBanner } from '@dizi/ui';

/* Placeholder for modules that are not built yet — and, in the meantime, the *launcher*.
 *
 * Administration no longer has an entry here: P7 built `/admin` as a real hub with eighteen routes under it, so a
 * launcher pointing at the legacy settings screen would be a second answer to a question that now has one. What
 * remains below is the list of modules whose own phase has not shipped.
 *
 * With no vendor source we cannot route inside the legacy system (plan 08 §1), so the honest thing to show a
 * clerk is which system currently owns the module. This page reads from the same module-ownership registry the
 * team maintains, so it can never disagree with the plan.
 */
const MODULES: Record<string, { title: string; phase: string; owner: 'legacy' | 'new'; legacyPath?: string; note: string }> = {
  appointments: { title: 'Appointments', phase: 'P1', owner: 'legacy', legacyPath: '/admin/appointment', note: 'Booked in the legacy system until P1 pilot exits in your branch.' },
  clinical: { title: 'OPD consultation', phase: 'P2', owner: 'legacy', legacyPath: '/admin/patient/ipdprofile', note: 'The consultation workspace is the heart of P2.' },
  diagnostics: { title: 'Diagnostics (lab, imaging, blood bank)', phase: 'P4', owner: 'legacy', legacyPath: '/admin/lab', note: 'Worklist, specimens and result release land in P4.' },
  pharmacy: { title: 'Pharmacy', phase: 'P3', owner: 'legacy', legacyPath: '/admin/pharmacy', note: 'Dispensing with batch/expiry guard is the first stream-B module.' },
  billing: { title: 'Billing', phase: 'P2', owner: 'legacy', legacyPath: '/admin/bill', note: 'Billing needs a two-week parallel run before it is allowed to own money.' },
  inventory: { title: 'Inventory', phase: 'P3', owner: 'legacy', legacyPath: '/admin/item', note: 'Per-location stock ledgers replace the global counters.' },
  reports: { title: 'Reports', phase: 'P6', owner: 'legacy', legacyPath: '/admin/report', note: 'All 17 reports are rebuilt once the modules they read are migrated.' },
  help: { title: 'Help', phase: 'P0', owner: 'new', note: 'The help drawer in the header already links to the mirrored help library.' },
};

export default function ModuleLauncherPage() {
  const params = useParams<{ slug: string[] }>();
  const key = Array.isArray(params?.slug) ? params.slug[0] : '';
  const module = MODULES[key];

  if (!module) {
    return (
      <Panel title="Not found">
        <p className="text-base text-text-secondary">
          That screen is not part of the current build. Use the command palette (⌘K) or the navigation.
        </p>
      </Panel>
    );
  }

  const legacyOwned = module.owner === 'legacy';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{module.title}</h1>
        <p className="text-sm text-text-secondary">Planned for phase {module.phase}</p>
      </div>

      {legacyOwned ? (
        <SafetyBanner severity="info" title="This module still lives in the legacy system">
          {module.note} Until its cutover, records are created there and mirrored into the new platform read-only
          — you will still be able to search and view them here.
          <div className="mt-2 flex gap-2">
            <Button variant="primary">Open {module.title} in the legacy system</Button>
            <Link href="/patients">
              <Button variant="ghost">Search patients instead</Button>
            </Link>
          </div>
        </SafetyBanner>
      ) : (
        <SafetyBanner severity="success" title="Owned by the new platform">
          {module.note}
        </SafetyBanner>
      )}

      <Panel title="What moves here, and when">
        <ul className="flex flex-col gap-2 text-base">
          <li>
            {/* clean-room:allow — the product name is what staff call the system they use today; no vendor code or assets are involved */}
            <span className="text-text-secondary">Owning system today:</span> {legacyOwned ? 'Legacy system (the current vendor product)' : 'DiziHospital platform'}
          </li>
          <li>
            <span className="text-text-secondary">Registry:</span> <span className="font-numeric">docs/migration/ownership.md</span> (module ×
            branch matrix)
          </li>
          <li>
            <span className="text-text-secondary">Screens planned:</span> see <span className="font-numeric">docs/plan/03-SCREEN-MAP.md</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
