import Link from 'next/link';
import { Panel } from '@dizi/ui';
import { helpAvailable, listCategories } from '@/lib/help';
import { HOTKEYS } from '@/lib/nav';

/* Help centre.
 *
 * Two kinds of help, deliberately separated:
 *  1. **How the new platform works** — written by us, versioned with the app, so it can never describe a screen
 *     that no longer exists.
 *  2. **The mirrored vendor library** — 39 categories of the legacy product's own documentation, kept for
 *     reference while modules are still legacy-owned. Every page attributes it.
 */

export const dynamic = 'force-dynamic';

const NEW_UI_TOPICS = [
  { title: 'Signing in, MFA and trusted devices', href: '/help#signing-in', summary: 'Two-step sign-in, recovery codes and what to do when a phone is lost.' },
  { title: 'Registering a patient without duplicates', href: '/help#registering', summary: 'The five-section form, duplicate detection, and printing the slip offline.' },
  { title: 'Booking an appointment', href: '/help#booking', summary: 'Choosing a doctor and slot, urgent bookings, and how rescheduling works.' },
  { title: 'Working when the internet is down', href: '/help#offline', summary: 'What queues, what still prints, and how the sync states are shown to staff.' },
  { title: 'Which system owns which module', href: '/help#ownership', summary: 'Legacy versus new, phase by phase and branch by branch.' },
  { title: 'Printing: slips, labels and receipts', href: '/help#print', summary: 'Paper sizes, offline printing, and what to check when a printer stops.' },
];

export default function HelpHomePage() {
  const categories = helpAvailable() ? listCategories() : [];
  const totalArticles = categories.reduce((sum, c) => sum + c.articleCount, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Help &amp; wiki</h1>
          <p className="text-sm text-text-secondary">
            Guides for the new platform, plus the mirrored reference library of the legacy product.
          </p>
        </div>
        <form action="/help/search" className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="q" className="text-sm text-text-secondary">Search all help</label>
            <input
              id="q"
              name="q"
              placeholder="e.g. dispense, appointment, backup"
              className="h-9 w-72 rounded-md border border-border-default bg-surface-default px-3 text-base"
            />
          </div>
          <button type="submit" className="h-9 rounded-md bg-brand-500 px-3 text-sm font-medium text-text-inverse hover:bg-brand-600">
            Search
          </button>
        </form>
      </header>

      <Panel title="How DiziHospital works">
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {NEW_UI_TOPICS.map((topic) => (
            <li key={topic.title} className="rounded-md border border-border-subtle p-3">
              <a href={topic.href} className="text-base font-medium text-brand-700 hover:underline">{topic.title}</a>
              <p className="mt-1 text-sm text-text-secondary">{topic.summary}</p>
            </li>
          ))}
        </ul>

        {/* Each card above anchors into one of these sections: a link that scrolls nowhere is worse than no link. */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border-subtle pt-4 md:grid-cols-2 xl:grid-cols-3">
          <section id="signing-in" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Signing in, MFA and trusted devices</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
              <li>Sign-in is two steps: password, then a six-digit code from the authenticator app.</li>
              <li>A shared desk computer can be marked as a trusted device for one shift, never longer.</li>
              <li>Eight one-time recovery codes are issued at enrolment — printed and kept in the admin safe.</li>
              <li>A lost phone is a same-day reset by an administrator; the reset is written to the audit log.</li>
              <li>Clinical staff sign in with their own account. Shared logins are not permitted, because every
                entry carries the name of the person who made it.</li>
            </ul>
          </section>

          <section id="registering" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Registering a patient without duplicates</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
              <li>Always search before the form: mobile number, or name plus father/husband name.</li>
              <li>Possible duplicates appear as a warning strip above the form, showing the MRN of the match.</li>
              <li>Bangla and English names are both stored; the slip prints both so nothing gets transliterated badly
                at the counter.</li>
              <li>The MRN series continues from the legacy system — old numbers keep working.</li>
              <li>Registration works with the uplink down; the slip prints and the record syncs later.</li>
            </ul>
          </section>

          <section id="booking" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Booking an appointment</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
              <li>Slots are 15 minutes; a longer consultation takes as many consecutive slots as it needs.</li>
              <li>A taken slot cannot be selected, and the tooltip names the patient already holding it.</li>
              <li>Emergency walk-ins are booked with priority Emergency and appear at the top of the queue.</li>
              <li>Rescheduling keeps the token when the same day is kept, and issues a new token when the day moves.</li>
              <li>Online requests from the patient portal arrive in a queue and are approved or declined by the desk.</li>
            </ul>
            <Link href="/appointments" className="mt-2 inline-block text-sm text-brand-600 hover:underline">
              Open the appointment desk →
            </Link>
          </section>

          <section id="offline" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Working when the internet is down</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
              <li>Clinical work runs on the hospital server, so nothing stops when the uplink drops.</li>
              <li>Writes are queued on the device and counted under the connection pill in the header.</li>
              <li>Printing always works. Messages (WhatsApp/SMS) and the patient portal wait for the link.</li>
              <li>A record never says “Saved” until the server has it — “Saved on this device” is a different state,
                and the difference is deliberate.</li>
              <li>Reconciled collections are recorded by the accounting office later; the queue holds the original
                timestamp.</li>
            </ul>
          </section>

          <section id="ownership" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Which system owns which module</h3>
            <p className="mt-1 text-sm text-text-secondary">
              The module ownership matrix (<span className="font-numeric">docs/migration/ownership.md</span>) is the
              single answer: one row per module per branch, with the cutover date. Modules still owned by the legacy
              system are shown read-only here and are edited there.
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              The sidebar makes the same statement: a module with the <span className="font-medium">legacy</span> chip
              still has its records created in the old system.
            </p>
          </section>

          <section id="print" className="scroll-mt-20">
            <h3 className="text-base font-semibold">Printing: slips, labels and receipts</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
              <li>Registration and appointment slips: A5.</li>
              <li>Prescriptions and reports: A4.</li>
              <li>Receipts: 80 mm thermal.</li>
              <li>Specimen labels: 50 × 25 mm.</li>
              <li>Paper size is set by the template, so the operator only has to load the printer.</li>
            </ul>
            <Link href="/print" className="mt-2 inline-block text-sm text-brand-600 hover:underline">
              See every print template →
            </Link>
          </section>
        </div>
      </Panel>

      <Panel title="Keyboard shortcuts">
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2 xl:grid-cols-3">
          {HOTKEYS.map((h) => (
            <li key={h.keys} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1 last:border-0">
              <span className="text-text-secondary">{h.label}</span>
              <kbd className="shrink-0 rounded-sm border border-border-default bg-surface-sunken px-1.5 py-0.5 font-numeric text-xs">
                {h.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`Reference library — the legacy product (${categories.length} categories, ${totalArticles} articles)`}>
        <p className="mb-3 text-sm text-text-secondary">
          The vendor's own published documentation, mirrored locally so the team is not chasing a live website.
          Things this library does not cover: the new interface, the hybrid LAN/cloud behaviour, or anything that
          changed after it was mirrored.
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((c) => (
            <li key={c.slug} className="rounded-md border border-border-subtle p-3">
              <Link href={`/help/${c.slug}`} className="text-base font-medium text-brand-700 hover:underline">
                {c.title}
              </Link>
              <p className="font-numeric mt-0.5 text-xs text-text-tertiary">{c.articleCount} articles</p>
              {c.description && <p className="mt-1 line-clamp-3 text-sm text-text-secondary">{c.description}</p>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
