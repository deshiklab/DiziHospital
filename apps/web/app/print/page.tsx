import Link from 'next/link';
import { Panel, SafetyBanner } from '@dizi/ui';

/* Index of every printable document, with the paper it expects.
 *
 * The desk needs this list on paper as much as on screen: when a printer is loaded with the wrong roll or the
 * wrong tray, "which paper does this need?" is the whole conversation. */

export const dynamic = 'force-dynamic';

const TEMPLATES = [
  { doc: 'registration-slip', title: 'Registration slip', paper: 'A5', when: 'Handed to the patient at the counter after registration.' },
  { doc: 'appointment-slip', title: 'Appointment slip', paper: 'A5', when: 'Given when a booking is made, and reprinted for walk-ins.' },
  { doc: 'prescription', title: 'Prescription', paper: 'A4', when: 'Printed at the end of a consultation, with the Bangla advice and the allergy line.' },
  { doc: 'receipt', title: 'Payment receipt', paper: 'Thermal 80 mm', when: 'Printed at the billing counter, offline included.' },
  { doc: 'invoice', title: 'Invoice', paper: 'A4', when: 'The full bill, with the payer share and any approved discount.' },
  { doc: 'dispense-label', title: 'Medicine label', paper: '50 × 25 mm', when: 'Applied to the pack at the pharmacy; dose in Bangla and English.' },
  { doc: 'result-report', title: 'Laboratory report', paper: 'A4', when: 'Released after verification; carries the reference ranges, the flags and the verifier’s name.' },
  { doc: 'specimen-label', title: 'Specimen label', paper: '50 × 25 mm', when: 'Applied to sample tubes at collection; the lab scans the barcode.' },
  { doc: 'id-card', title: 'Patient ID card', paper: 'CR80 card', when: 'Optional, for long-term patients and corporate schemes.' },
  { doc: 'day-list', title: 'Appointment day list', paper: 'A4 landscape', when: 'Printed at the start of a shift, and again after a change of plan.' },
];

export default function PrintIndexPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <header>
        <h1 className="text-2xl font-semibold">Print templates</h1>
        <p className="text-sm text-text-secondary">
          Every document the platform prints, with the paper it expects. Printing is deliberately the last thing to
          depend on the network: with the uplink down, these templates still render and still print.
        </p>
      </header>

      <SafetyBanner severity="info" title="Preview templates, sample data">
        These render real layouts with sample patients. Each preview is opened in its own tab so the desk can print
        without losing what they were doing.
      </SafetyBanner>

      <Panel title={`${TEMPLATES.length} templates`}>
        <ul className="flex flex-col divide-y divide-border-subtle">
          {TEMPLATES.map((t) => (
            <li key={t.doc} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <Link href={`/print/${t.doc}`} className="text-base font-medium text-brand-700 hover:underline">
                {t.title}
              </Link>
              <span className="rounded-sm border border-border-default px-1.5 py-0.5 text-xs text-text-secondary">{t.paper}</span>
              <span className="text-sm text-text-secondary">{t.when}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="text-xs text-text-tertiary">
        Paper size is set on each template with <span className="font-numeric">@page</span>, so choosing the right
        paper is the printer&apos;s job, not the operator&apos;s memory.
      </p>
    </div>
  );
}
