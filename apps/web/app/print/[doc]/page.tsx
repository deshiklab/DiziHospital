'use client';

import { use } from 'react';
import Link from 'next/link';
import { Button, SafetyBanner, Tooltip, cx } from '@dizi/ui';
import { DOCTORS, doctorById, generateAppointments, timeLabel, todayIso } from '@/lib/appointments';
import { encounterById, generateEncounters } from '@/lib/clinical';
import { DRUGS, drugById, generateBatches, generateDispenses } from '@/lib/pharmacy';
import { generateInvoices, lineNet, receiptNo, totals } from '@/lib/billing';
import {
  flagLabel,
  flagTone,
  flagValue,
  generateDiagnosticOrders,
  needsCallback,
  testByCode,
  worstFlag,
} from '@/lib/diagnostics';
import {
  generateInventory,
  poTotals,
  supplierById,
  type PurchaseOrder,
} from '@/lib/inventory';
import { patients } from '@/lib/mock';

/* Print templates.
 *
 * Every document here is a real layout, sized for the paper it will be printed on, with the buttons and
 * surrounding chrome removed at print time. Printing is the one thing that must work with the uplink down, so
 * nothing on this page fetches anything; each template reads its data from the same deterministic modules the
 * screens use, which is why a slip printed from here matches the screen it came from.
 *
 * Templates take a query parameter for the record they print (`?id=`, `?enc=`, `?inv=`, `?dsp=`, `?spec=`); with
 * no parameter they render a sample, and the preview banner says so.
 */

type DocKind =
  | 'registration-slip'
  | 'appointment-slip'
  | 'prescription'
  | 'receipt'
  | 'invoice'
  | 'dispense-label'
  | 'specimen-label'
  | 'result-report'
  | 'purchase-order'
  | 'id-card'
  | 'day-list';

const DOC_META: Record<DocKind, { title: string; paper: string; page: string; note: string; param?: string }> = {
  'registration-slip': { title: 'Registration slip', paper: 'A5', page: 'A5 portrait', note: 'Handed to the patient at the counter.', param: 'mrn' },
  'appointment-slip': { title: 'Appointment slip', paper: 'A5', page: 'A5 portrait', note: 'Includes the token and the reporting time.', param: 'id' },
  prescription: { title: 'Prescription', paper: 'A4', page: 'A4 portrait', note: 'Bangla advice, allergies and the doctor’s signature.', param: 'enc' },
  receipt: { title: 'Payment receipt', paper: 'Thermal 80 mm', page: '80mm auto', note: 'Monospace layout for a thermal printer.', param: 'inv' },
  invoice: { title: 'Invoice', paper: 'A4', page: 'A4 portrait', note: 'The full bill for the patient, the payer or the file.', param: 'inv' },
  'dispense-label': { title: 'Medicine label', paper: '50 × 25 mm', page: '50mm 25mm', note: 'Applied to the pack: four doses a day, in Bangla and English.', param: 'dsp' },
  'result-report': { title: 'Laboratory report', paper: 'A4', page: 'A4 portrait', note: 'Reference ranges, flags and the verifier’s name.', param: 'spec' },
  'purchase-order': { title: 'Purchase order', paper: 'A4', page: 'A4 portrait', note: 'Sent to the supplier; the store keeps the copy that was ordered.', param: 'po' },
  'specimen-label': { title: 'Specimen label', paper: '50 × 25 mm', page: '50mm 25mm', note: 'Two-line label for tubes; the barcode is what the lab scans.', param: 'spec' },
  'id-card': { title: 'Patient ID card', paper: 'CR80 card', page: 'A4 portrait', note: 'Crop marks shown for card printers.', param: 'mrn' },
  'day-list': { title: 'Appointment day list', paper: 'A4 landscape', page: 'A4 landscape', note: 'What the desk prints at the start of a shift.' },
};

/** Deterministic bar pattern from a string — stands in for Code 128 until the real encoder lands (P4). */
function BarCode({ value, height = 40, className }: { value: string; height?: number; className?: string }) {
  const bits = Array.from(value).flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code & 1, (code >> 1) & 1, (code >> 2) & 1, (code >> 3) & 1, 1, (code >> 4) & 1];
  });
  return (
    <div className={className} aria-hidden>
      <div className="flex items-end gap-px" style={{ height }}>
        {bits.map((b, i) => (
          <span key={i} className={b ? 'bg-black' : 'bg-transparent'} style={{ width: b ? 2 : 1, height: '100%' }} />
        ))}
      </div>
      <p className="mt-0.5 text-center font-mono text-[10px] tracking-widest">{value}</p>
    </div>
  );
}

export default function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ doc: string }>;
  searchParams: Promise<{ id?: string; mrn?: string; enc?: string; inv?: string; dsp?: string; spec?: string; po?: string }>;
}) {
  const { doc } = use(params);
  const query = use(searchParams);
  const known = Object.prototype.hasOwnProperty.call(DOC_META, doc);
  const kind = (known ? doc : 'appointment-slip') as DocKind;
  const meta = DOC_META[kind];
  const day = todayIso();

  /* ------------------------------------------------------------------------------ data */
  const appointments = generateAppointments(day);
  const appointment = appointments.find((a) => a.id === query.id) ?? appointments[0];
  const patient =
    patients.find((p) => p.mrn === query.mrn) ??
    patients.find((p) => p.mrn === appointment?.patient.mrn) ??
    patients[0];
  const doctor = doctorById(appointment?.doctorId ?? DOCTORS[0].id);

  const encounters = generateEncounters(day);
  const encounter = (query.enc ? encounterById(query.enc, day) : undefined) ?? encounters.find((e) => e.rx.length > 0) ?? encounters[0];

  const dispenses = generateDispenses(day, generateBatches(day));
  const dispense = dispenses.find((d) => d.id === query.dsp) ?? dispenses[0];

  const invoices = generateInvoices(day);
  const invoice = invoices.find((i) => i.number.endsWith(query.inv ?? '') || i.id === query.inv) ?? invoices.find((i) => i.status !== 'Cancelled')!;
  const invoiceTotals = totals(invoice);

  const diagnosticOrders = generateDiagnosticOrders(day);
  const report =
    diagnosticOrders.find((o) => o.specimenId === query.spec) ??
    diagnosticOrders.find((o) => Object.keys(o.results).length > 0) ??
    diagnosticOrders[0];
  const reportTest = testByCode(report.testCode);

  const inventory = generateInventory(day);
  const purchaseOrder: PurchaseOrder =
    inventory.purchaseOrders.find((po) => po.id === query.po) ??
    inventory.purchaseOrders.find((po) => po.status === 'Sent') ??
    inventory.purchaseOrders[0];

  const specimenId = query.spec ?? `SP-${appointment?.token ?? '000'}1`;

  const header = (title: string, subtitle?: string) => (
    <header className="mb-3 border-b border-black pb-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base font-bold">Shaheed Suhrawardy General Hospital</p>
          <p className="text-xs">Main Campus, Dhaka · Hotline 16263</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">{title}</p>
          {subtitle && <p className="text-xs">{subtitle}</p>}
        </div>
      </div>
    </header>
  );

  const docContent = () => {
    switch (kind) {
      case 'registration-slip':
        return (
          <div className="w-[148mm] bg-white p-4 text-black">
            {header('Registration slip', patient.mrn)}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div><dt className="text-xs">Patient</dt><dd className="font-semibold">{patient.name}</dd></div>
              <div><dt className="text-xs">In Bangla</dt><dd>{patient.nameBn}</dd></div>
              <div><dt className="text-xs">Age / sex</dt><dd>{patient.age} · {patient.sex}</dd></div>
              <div><dt className="text-xs">Mobile</dt><dd className="font-mono">{patient.phone}</dd></div>
              <div><dt className="text-xs">Branch</dt><dd>{patient.branch}</dd></div>
              <div><dt className="text-xs">Payer</dt><dd>{patient.payer}</dd></div>
              <div className="col-span-2"><dt className="text-xs">Registered</dt><dd>{new Date().toLocaleString()}</dd></div>
            </dl>
            {patient.allergies && (
              <p className="mt-2 border border-black px-2 py-1 text-sm font-bold">ALLERGY: {patient.allergies.toUpperCase()}</p>
            )}
            <div className="mt-4 flex items-end justify-between">
              <BarCode value={patient.mrn} />
              <p className="text-xs">Keep this slip for laboratory and pharmacy counters.</p>
            </div>
          </div>
        );

      case 'appointment-slip':
        return (
          <div className="w-[148mm] bg-white p-4 text-black">
            {header('Appointment slip', `Token ${appointment?.token}`)}
            <p className="mb-1 text-xs">Report at the OPD counter 15 minutes before the time below.</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div><dt className="text-xs">Patient</dt><dd className="font-semibold">{appointment?.patient.name}</dd></div>
              <div><dt className="text-xs">MRN</dt><dd className="font-mono">{appointment?.patient.mrn}</dd></div>
              <div><dt className="text-xs">Doctor</dt><dd>{doctor.name} · {doctor.department}</dd></div>
              <div><dt className="text-xs">Room</dt><dd>{doctor.room}</dd></div>
              <div><dt className="text-xs">Date</dt><dd>{new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
              <div><dt className="text-xs">Time</dt><dd className="text-base font-bold">{appointment ? timeLabel(appointment.start) : '—'}</dd></div>
              <div><dt className="text-xs">Type</dt><dd>{appointment?.type}</dd></div>
              <div><dt className="text-xs">Priority</dt><dd>{appointment?.priority}</dd></div>
              <div className="col-span-2"><dt className="text-xs">Reason</dt><dd>{appointment?.reason}</dd></div>
              {appointment?.liveConsultation && (
                <div className="col-span-2 border border-black px-2 py-1 text-sm">
                  Live video consultation — the link is sent by SMS/WhatsApp before the slot.
                </div>
              )}
            </dl>
            <div className="mt-4 flex items-end justify-between">
              <BarCode value={appointment?.token ?? patient.mrn} />
              <p className="text-xs">Bring previous prescriptions and reports.</p>
            </div>
          </div>
        );

      case 'prescription':
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Prescription', `${doctor.name} · ${doctor.department}`)}
            <div className="mb-2 flex justify-between text-sm">
              <div>
                <p className="font-semibold">
                  {encounter.patient.name} <span className="font-normal">({encounter.patient.nameBn})</span>
                </p>
                <p className="font-mono text-xs">
                  {encounter.patient.mrn} · {encounter.patient.age}{encounter.patient.sex.slice(0, 1)} · {encounter.patient.phone}
                </p>
              </div>
              <p className="text-xs">
                {new Date(`${day}T00:00:00`).toLocaleDateString('en-GB')} · {encounter.room} · token {encounter.token}
              </p>
            </div>

            {encounter.patient.allergies && (
              <p className="mb-2 border border-black px-2 py-1 text-sm font-bold">
                ALLERGY: {encounter.patient.allergies.toUpperCase()}
              </p>
            )}

            {encounter.diagnoses.length > 0 && (
              <p className="mb-2 text-sm">
                <span className="text-xs">Diagnosis </span>
                {encounter.diagnoses.map((d) => `${d.label} (${d.code})`).join('; ')}
              </p>
            )}

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">#</th>
                  <th className="border border-black px-2 py-1 text-left">Medicine</th>
                  <th className="border border-black px-2 py-1 text-left">Dose</th>
                  <th className="border border-black px-2 py-1 text-left">Frequency</th>
                  <th className="border border-black px-2 py-1 text-left">Duration</th>
                  <th className="border border-black px-2 py-1 text-left">Instructions</th>
                </tr>
              </thead>
              <tbody>
                {encounter.rx.map((line, i) => (
                  <tr key={line.id}>
                    <td className="border border-black px-2 py-1 align-top">{i + 1}</td>
                    <td className="border border-black px-2 py-1 align-top">
                      {line.brand} <span className="text-xs">{line.generic} {line.strength}</span>
                      {line.substitutedFor && <span className="block text-[10px]">substituted for {line.substitutedFor}</span>}
                    </td>
                    <td className="border border-black px-2 py-1 align-top">{line.dose}</td>
                    <td className="border border-black px-2 py-1 align-top">{line.frequency}{line.prn ? ' (as needed)' : ''}</td>
                    <td className="border border-black px-2 py-1 align-top">{line.durationDays} days</td>
                    <td className="border border-black px-2 py-1 align-top">{line.instructions}</td>
                  </tr>
                ))}
                {encounter.rx.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border border-black px-2 py-3 text-center">
                      No medicines prescribed on this visit.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {encounter.adviceBn && (
              <div className="mt-3 border border-black px-2 py-1 text-sm">
                <p className="text-xs">পরামর্শ / Advice</p>
                <p className="text-base">{encounter.adviceBn}</p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div className="col-span-2">
                <p className="text-xs">Plan</p>
                <p>{encounter.soap.plan || 'Review with the reports.'}</p>
              </div>
              <div>
                <p className="text-xs">Follow-up</p>
                <p>{new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-GB')}</p>
              </div>
            </div>

            <div className="mt-8 flex justify-between text-xs">
              <BarCode value={`RX-${encounter.token}`} height={32} />
              <div className="text-right">
                <p className="mb-1">{encounter.signedBy ?? 'Doctor signature & BMDC number'}</p>
                <div className="h-10 w-48 border-b border-black" />
                <p>Signed {encounter.signedAt ?? '—'}</p>
              </div>
            </div>
          </div>
        );

      case 'receipt':
        return (
          <div className="w-[80mm] bg-white p-2 font-mono text-[11px] leading-tight text-black">
            <p className="text-center font-bold">Shaheed Suhrawardy General Hospital</p>
            <p className="text-center">Main Campus · Hotline 16263</p>
            <p className="my-1 border-t border-dashed border-black" />
            <p>Receipt : {receiptNo(day, invoice.payments.length || 1)}</p>
            <p>Invoice : {invoice.number}</p>
            <p>Patient: {invoice.patientName}</p>
            <p>MRN    : {invoice.mrn}</p>
            <p>Date   : {new Date().toLocaleString()}</p>
            <p className="my-1 border-t border-dashed border-black" />
            {invoice.lines.map((l) => (
              <p key={l.id} className="flex justify-between">
                <span className="truncate pr-2">{l.name}{l.qty > 1 ? ` x${l.qty}` : ''}</span>
                <span>{lineNet(l).toFixed(2)}</span>
              </p>
            ))}
            <p className="my-1 border-t border-dashed border-black" />
            <p className="flex justify-between"><span>GROSS</span><span>{invoiceTotals.gross.toFixed(2)}</span></p>
            <p className="flex justify-between"><span>DISCOUNT</span><span>-{invoiceTotals.discount.toFixed(2)}</span></p>
            <p className="flex justify-between font-bold"><span>NET</span><span>{invoiceTotals.net.toFixed(2)}</span></p>
            <p className="flex justify-between"><span>PAID</span><span>{invoiceTotals.paid.toFixed(2)}</span></p>
            <p className="flex justify-between"><span>DUE</span><span>{invoiceTotals.due.toFixed(2)}</span></p>
            {invoiceTotals.payerShare > 0 && (
              <>
                <p className="my-1 border-t border-dashed border-black" />
                <p>Patient share : {invoiceTotals.patientShare.toFixed(2)}</p>
                <p>Payer share   : {invoiceTotals.payerShare.toFixed(2)} ({invoice.payer})</p>
              </>
            )}
            <p className="my-1 border-t border-dashed border-black" />
            {invoice.payments.map((p) => (
              <p key={p.id}>{p.method} {p.reference ? `(${p.reference})` : ''} {p.amount.toFixed(2)}</p>
            ))}
            <p className="text-center">Bill prepared by: {invoice.counter}</p>
            <p className="text-center">Not valid without the official seal</p>
            <p className="mt-2 text-center">||| ||||| ||| |||||| ||||</p>
            <p className="text-center">{invoice.number}</p>
          </div>
        );

      case 'invoice':
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Invoice', invoice.number)}
            <div className="mb-3 flex justify-between text-sm">
              <div>
                <p className="font-semibold">{invoice.patientName} ({invoice.patientNameBn})</p>
                <p className="font-mono text-xs">{invoice.mrn} · {invoice.age}{invoice.sex.slice(0, 1)}</p>
                <p className="text-xs">Payer: {invoice.payer}</p>
              </div>
              <p className="text-xs">{new Date(invoice.createdAt.replace(' ', 'T')).toLocaleString()}<br />{invoice.counter}</p>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">Code</th>
                  <th className="border border-black px-2 py-1 text-left">Service</th>
                  <th className="border border-black px-2 py-1 text-left">Category</th>
                  <th className="border border-black px-2 py-1 text-right">Qty</th>
                  <th className="border border-black px-2 py-1 text-right">Price</th>
                  <th className="border border-black px-2 py-1 text-right">Discount</th>
                  <th className="border border-black px-2 py-1 text-right">Net</th>
                  <th className="border border-black px-2 py-1 text-left">Charged to</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-black px-2 py-1 font-mono text-xs">{l.code}</td>
                    <td className="border border-black px-2 py-1">{l.name}</td>
                    <td className="border border-black px-2 py-1 text-xs">{l.category}</td>
                    <td className="border border-black px-2 py-1 text-right">{l.qty}</td>
                    <td className="border border-black px-2 py-1 text-right">{l.unitPrice.toFixed(2)}</td>
                    <td className="border border-black px-2 py-1 text-right">{l.discountPct}%</td>
                    <td className="border border-black px-2 py-1 text-right">{lineNet(l).toFixed(2)}</td>
                    <td className="border border-black px-2 py-1 text-xs">{l.chargedTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex justify-end">
              <table className="text-sm">
                <tbody>
                  <tr><td className="pr-6">Gross</td><td className="text-right">{invoiceTotals.gross.toFixed(2)}</td></tr>
                  <tr><td className="pr-6">Discount</td><td className="text-right">-{invoiceTotals.discount.toFixed(2)}</td></tr>
                  <tr className="font-bold"><td className="pr-6">Net payable</td><td className="text-right">{invoiceTotals.net.toFixed(2)}</td></tr>
                  <tr><td className="pr-6">Paid</td><td className="text-right">{invoiceTotals.paid.toFixed(2)}</td></tr>
                  <tr className="font-bold"><td className="pr-6">Due</td><td className="text-right">{invoiceTotals.due.toFixed(2)}</td></tr>
                  <tr><td className="pr-6">Payer share</td><td className="text-right">{invoiceTotals.payerShare.toFixed(2)}</td></tr>
                </tbody>
              </table>
            </div>
            {invoice.approvedBy && (
              <p className="mt-2 text-xs">Discount approved by {invoice.approvedBy}.</p>
            )}
            {invoice.status === 'Cancelled' && (
              <p className="mt-2 border border-black px-2 py-1 text-sm font-bold">
                CANCELLED — {invoice.cancelledReason}{invoice.replacedBy ? ` Replacement: ${invoice.replacedBy}.` : ''}
              </p>
            )}
            <div className="mt-6 flex items-end justify-between text-xs">
              <BarCode value={invoice.number} height={32} />
              <div className="text-right">
                <div className="mb-1 h-10 w-48 border-b border-black" />
                <p>Cashier signature</p>
              </div>
            </div>
          </div>
        );

      case 'dispense-label': {
        const labelDrug = drugById(dispense.lines[0]?.drug.id ?? DRUGS[0].id) ?? DRUGS[0];
        const labelLine = dispense.lines[0];
        const batch = generateBatches(day).find((b) => b.id === labelLine?.batchId);
        const perDay =
          labelLine?.rxLine.frequency === 'Once daily'
            ? '1 time daily'
            : labelLine?.rxLine.frequency === 'Twice daily'
              ? '2 times daily'
              : labelLine?.rxLine.frequency === 'Three times a day'
                ? '3 times daily'
                : labelLine?.rxLine.frequency === 'Four times a day'
                  ? '4 times daily'
                  : labelLine?.rxLine.frequency ?? '';
        return (
          <div className="flex flex-col gap-3">
            {dispense.lines.slice(0, 3).map((line, i) => (
              <div key={line.id} className="h-[25mm] w-[50mm] border border-dashed border-black bg-white p-1 text-black">
                <div className="flex items-start justify-between">
                  <p className="truncate text-[10px] font-bold leading-tight">{dispense.patient.name}</p>
                  <p className="font-mono text-[8px] leading-tight">{dispense.patient.mrn}</p>
                </div>
                <p className="truncate text-[10px] font-semibold leading-tight">
                  {line.drug.brand} {line.drug.strength} · {line.drug.bengaliName}
                </p>
                <p className="text-[8px] leading-tight">
                  {line.rxLine.dose} · {line.rxLine.route} · {perDay} · {line.rxLine.durationDays} days
                </p>
                {i === 0 && (
                  <div className="mt-0.5 flex items-end justify-between">
                    <BarCode value={labelLine?.batchId ? (batch?.batchNo ?? line.drug.id) : line.drug.id} height={14} />
                    <p className="text-[7px]">Exp {batch?.expiry ?? '—'}</p>
                  </div>
                )}
              </div>
            ))}
            {dispense.lines.length === 0 && (
              <p className="text-sm text-black">Nothing on this prescription to label.</p>
            )}
          </div>
        );
      }

      case 'result-report':
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Laboratory report', report.specimenId)}
            <div className="mb-3 flex justify-between text-sm">
              <div>
                <p className="font-semibold">{report.patient.name} ({report.patient.nameBn})</p>
                <p className="font-mono text-xs">
                  {report.patient.mrn} · {report.patient.age}{report.patient.sex.slice(0, 1)} · {report.patient.phone}
                </p>
                <p className="text-xs">Payer: {report.patient.payer}{report.encounterId ? ` · ${report.encounterId}` : ' · walk-in'}</p>
              </div>
              <div className="text-right text-xs">
                <p>Specimen: {report.sample ?? report.modality}</p>
                <p>Collected: {report.collectedAt ?? '—'}</p>
                <p>Reported: {report.resultedAt ?? report.orderedAt}</p>
                <p>Verified: {report.verifiedAt ?? '—'} {report.verifiedBy ? `· ${report.verifiedBy}` : ''}</p>
              </div>
            </div>

            <h2 className="mb-1 border-b border-black pb-1 text-sm font-bold">{report.testName} ({report.testCode})</h2>

            {reportTest && reportTest.analytes.length > 0 ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-black px-2 py-1 text-left">Analyte</th>
                    <th className="border border-black px-2 py-1 text-right">Result</th>
                    <th className="border border-black px-2 py-1 text-left">Unit</th>
                    <th className="border border-black px-2 py-1 text-left">Reference range</th>
                    <th className="border border-black px-2 py-1 text-left">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {reportTest.analytes.map((a) => {
                    const value = report.results[a.key];
                    const flag = typeof value === 'number' ? flagValue(a, value) : 'text';
                    const critical = flagTone[flag] === 'critical';
                    return (
                      <tr key={a.key}>
                        <td className="border border-black px-2 py-1">{a.label}</td>
                        <td className={cx('border border-black px-2 py-1 text-right font-mono', critical && 'font-bold')}>
                          {value ?? '—'}
                        </td>
                        <td className="border border-black px-2 py-1">{a.unit}</td>
                        <td className="border border-black px-2 py-1 text-xs">
                          {a.low}–{a.high}
                          {a.criticalHigh !== undefined ? ` (critical ≥ ${a.criticalHigh})` : ''}
                          {a.criticalLow !== undefined ? ` (critical ≤ ${a.criticalLow})` : ''}
                        </td>
                        <td className={cx('border border-black px-2 py-1 text-xs', critical && 'font-bold')}>
                          {typeof value === 'number' ? flagLabel[flag] : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="border border-black px-2 py-2 text-sm">{report.report ?? 'No report text recorded.'}</p>
            )}

            {reportTest && reportTest.analytes.length > 0 && report.report && (
              <p className="mt-2 text-sm"><span className="text-xs">Note </span>{report.report}</p>
            )}

            {needsCallback(report) && (
              <p className="mt-3 border border-black px-2 py-1 text-sm font-bold">
                CRITICAL VALUE — the clinician was told
                {report.callback ? ` (${report.callback.toWhom}, ${report.callback.at}, read back)` : ' — call-back not yet recorded'}.
              </p>
            )}

            {report.rejection && (
              <p className="mt-3 border border-black px-2 py-1 text-sm">
                Sample rejected: {report.rejection.reason} ({report.rejection.by}, {report.rejection.at}). Recollection requested.
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
              <div className="col-span-2">
                <p>Method: {reportTest?.method ?? report.modality ?? '—'} · {' '}
                  Quality controls were in range at the time of reporting.</p>
                <p className="mt-1">
                  Check the specimen identifier against the patient before acting on this report. Values marked
                  critical must be confirmed by the clinician who ordered the test.
                </p>
              </div>
              <div>
                <p>Flag {flagLabel[worstFlag(report)]}</p>
                <BarCode value={report.specimenId} height={26} />
              </div>
            </div>

            <div className="mt-8 flex justify-between text-xs">
              <p>Printed {new Date().toLocaleString()} · Main Campus laboratory</p>
              <div className="text-right">
                <div className="mb-1 h-10 w-56 border-b border-black" />
                <p>{report.verifiedBy ?? 'Verifier signature & registration number'}</p>
              </div>
            </div>
          </div>
        );

      case 'purchase-order': {
        const supplier = supplierById(purchaseOrder.supplierId);
        const totals = poTotals(purchaseOrder);
        const packs = (units: number, packSize: number) => Math.round(units / packSize);
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Purchase order', purchaseOrder.id)}

            <div className="mb-3 grid grid-cols-2 gap-6 text-sm">
              <div>
                <p className="text-xs font-bold uppercase">Supplier</p>
                <p className="font-semibold">{supplier?.name}</p>
                <p className="text-xs">{supplier?.contact}</p>
                <p className="text-xs">Terms: {supplier?.terms}</p>
                <p className="text-xs">Lead time: {supplier?.leadTimeDays} days</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase">Deliver to</p>
                <p className="font-semibold">Main store — Goods receiving</p>
                <p className="text-xs">DiziHospital, Main Campus · open 08:00–16:00, Friday closed</p>
                <p className="mt-1 text-xs">
                  Order date <span className="font-mono">{purchaseOrder.createdAt}</span> · expected{' '}
                  <span className="font-mono">{purchaseOrder.expectedAt}</span>
                </p>
                <p className="text-xs">Raised by {purchaseOrder.raisedBy}</p>
              </div>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">#</th>
                  <th className="border border-black px-2 py-1 text-left">Item</th>
                  <th className="border border-black px-2 py-1 text-left">Pack</th>
                  <th className="border border-black px-2 py-1 text-right">Packs</th>
                  <th className="border border-black px-2 py-1 text-right">Units</th>
                  <th className="border border-black px-2 py-1 text-right">Unit cost</th>
                  <th className="border border-black px-2 py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrder.lines.map((line, i) => {
                  const item = inventory.items.find((x) => x.id === line.itemId);
                  return (
                    <tr key={line.itemId}>
                      <td className="border border-black px-2 py-1 text-xs">{i + 1}</td>
                      <td className="border border-black px-2 py-1">
                        {item?.name}
                        <span className="block text-[10px]">{item?.generic}</span>
                      </td>
                      <td className="border border-black px-2 py-1 text-xs">{item?.packUnit}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{packs(line.quantity, item?.packSize ?? 1)}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{line.quantity.toLocaleString()}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{line.unitCost}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{(line.quantity * line.unitCost).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-2 flex justify-between">
              <div className="max-w-[110mm] text-xs">
                <p className="font-bold">Conditions</p>
                <ul className="ml-4 list-disc">
                  <li>Every line must arrive with a batch number and an expiry date on the pack and on the delivery note.</li>
                  <li>Cold-chain items are accepted only with the temperature log for the journey.</li>
                  <li>Quantities are checked at the receiving bay; a short line is recorded against this order.</li>
                  <li>Controlled items: licence copy and the signed indent accompany this order.</li>
                </ul>
                {purchaseOrder.note && <p className="mt-1">Note: {purchaseOrder.note}</p>}
              </div>
              <div className="w-60 text-sm">
                <p className="flex justify-between"><span>Sub-total</span><span className="font-mono">{totals.subtotal.toLocaleString()}</span></p>
                <p className="flex justify-between"><span>Tax at {totals.vatRate} %</span><span className="font-mono">{totals.vat.toLocaleString()}</span></p>
                <p className="mt-1 flex justify-between border-t border-black pt-1 font-bold"><span>Total</span><span className="font-mono">৳{totals.total.toLocaleString()}</span></p>
                <p className="mt-1 text-[10px]">Tax treatment follows the supplier record; the supplier&apos;s invoice is the tax document, not this order.</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-8 text-xs">
              <div>
                <div className="mb-1 h-10 border-b border-black" />
                <p>Raised by · {purchaseOrder.raisedBy}</p>
              </div>
              <div>
                <div className="mb-1 h-10 border-b border-black" />
                <p>Approved by · store manager (above the value limit)</p>
              </div>
            </div>

            <div className="mt-4 flex items-end justify-between text-xs">
              <p>Printed {new Date().toLocaleString()} · this is an order, not a tax invoice</p>
              <BarCode value={purchaseOrder.id} height={26} />
            </div>
          </div>
        );
      }

      case 'specimen-label':
        return (
          <div className="flex gap-3">
            {[1, 2].map((n) => (
              <div key={n} className="h-[25mm] w-[50mm] border border-dashed border-black bg-white p-1 text-black">
                <p className="truncate text-[10px] font-bold leading-tight">{appointment?.patient.name}</p>
                <p className="font-mono text-[9px] leading-tight">
                  {appointment?.patient.mrn} · {appointment?.patient.age}{appointment?.patient.sex.slice(0, 1)}
                </p>
                <BarCode value={`${specimenId}${n === 2 ? '-2' : ''}`} height={22} />
              </div>
            ))}
          </div>
        );

      case 'id-card':
        return (
          <div className="flex items-start gap-4">
            <div className="relative h-[54mm] w-[86mm] rounded-lg border border-black bg-white p-3 text-black">
              <p className="text-[10px] uppercase tracking-wide">Shaheed Suhrawardy General Hospital</p>
              <p className="mt-1 text-base font-bold">{patient.name}</p>
              <p className="text-xs">{patient.nameBn}</p>
              <p className="font-mono mt-2 text-sm">{patient.mrn}</p>
              <p className="text-[10px]">{patient.age} · {patient.sex} · {patient.phone}</p>
              <div className="absolute bottom-3 right-3">
                <BarCode value={patient.mrn} height={26} />
              </div>
              {patient.allergies && <p className="absolute bottom-1 left-3 text-[9px] font-bold">ALLERGY: {patient.allergies}</p>}
            </div>
            <p className="max-w-40 text-xs">Dashed outline is the card cut line for a CR80 card printer.</p>
          </div>
        );

      case 'day-list':
        return (
          <div className="w-[297mm] bg-white p-6 text-black">
            {header('Appointment day list', new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {['Token', 'Time', 'Patient', 'MRN', 'Doctor', 'Room', 'Type', 'Priority', 'Status', 'Checked ✓'].map((h) => (
                    <th key={h} className="border border-black px-1.5 py-1 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="border border-black px-1.5 py-0.5 font-mono">{a.token}</td>
                    <td className="border border-black px-1.5 py-0.5 font-mono">{timeLabel(a.start)}</td>
                    <td className="border border-black px-1.5 py-0.5">{a.patient.name}</td>
                    <td className="border border-black px-1.5 py-0.5 font-mono">{a.patient.mrn}</td>
                    <td className="border border-black px-1.5 py-0.5">{doctorById(a.doctorId).name}</td>
                    <td className="border border-black px-1.5 py-0.5">{doctorById(a.doctorId).room}</td>
                    <td className="border border-black px-1.5 py-0.5">{a.type}</td>
                    <td className="border border-black px-1.5 py-0.5">{a.priority}</td>
                    <td className="border border-black px-1.5 py-0.5">{a.status}</td>
                    <td className="border border-black px-1.5 py-0.5" />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px]">Printed {new Date().toLocaleString()} · {appointments.length} appointments · desk copy</p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken p-4">
      {/* Paper-size specific rules: one document per page, no browser headers where the printer allows it. */}
      <style>{`@page { size: ${meta.page}; margin: 6mm; } @media print { .print-preview { padding: 0 !important; background: #fff !important; } .print-paper { box-shadow: none !important; border: 0 !important; margin: 0 !important; } }`}</style>

      {!known && (
        <div className="no-print mx-auto mb-4 max-w-4xl">
          <SafetyBanner severity="warning" title={`No template called “${doc}”`}>
            Showing the appointment slip instead. <Link href="/print" className="underline">See every print template</Link>.
          </SafetyBanner>
        </div>
      )}

      <div className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link href="/print"><Button size="sm" variant="ghost">← Back</Button></Link>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">
            {meta.title} <span className="text-sm font-normal text-text-tertiary">· {meta.paper}</span>
          </h1>
          <p className="text-xs text-text-secondary">{meta.note}</p>
        </div>
        {meta.param && query[meta.param as keyof typeof query] ? (
          <span className="font-numeric rounded-sm border border-border-default px-1.5 py-0.5 text-xs text-text-secondary">
            {meta.param}={query[meta.param as keyof typeof query]}
          </span>
        ) : (
          <Tooltip content={`Add ?${meta.param ?? 'id'}=… to print a real record instead of the sample.`}>
            <Button size="sm" variant="ghost">Which record?</Button>
          </Tooltip>
        )}
        <Button size="sm" variant="primary" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="no-print mx-auto mb-4 max-w-4xl">
        <SafetyBanner severity="info" title="Preview with sample data">
          Templates render from the same data modules the screens use, so a slip printed from a record matches what
          was on screen. Barcodes are drawn from the identifier itself until the laboratory module wires in a
          certified encoder (P4).
        </SafetyBanner>
      </div>

      <div className="print-preview flex justify-center overflow-auto pb-8">
        <div className="print-paper shadow-lg">{docContent()}</div>
      </div>
    </div>
  );
}
