'use client';

import { use, useEffect, useState } from 'react';
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
import { birthDeathDay } from '@/lib/birthdeath';
import { allowancesFor, monthDays, monthOf, payrollLine, staffDirectory, type PayrollAttendance } from '@/lib/hr';
import { REGISTER_CODES, attendanceRegister, payrollAttendance, type RegisterCode } from '@/lib/attendance';
import { purposeByCode, visitorDay } from '@/lib/visitors';
import { BED_CHARGE, generateInpatient, wardName } from '@/lib/ward';

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
  | 'discharge-summary'
  | 'id-card'
  | 'day-list'
  /* P7 — the people, the registers and the branches. Added when the administration hub shipped: a printing
     settings screen whose templates cannot be opened is a list of promises. */
  | 'birth-record'
  | 'death-record'
  | 'payslip'
  | 'attendance-sheet'
  | 'visitor-badge'
  | 'imaging-report';

const DOC_META: Record<DocKind, { title: string; paper: string; page: string; note: string; param?: string }> = {
  'registration-slip': { title: 'Registration slip', paper: 'A5', page: 'A5 portrait', note: 'Handed to the patient at the counter.', param: 'mrn' },
  'appointment-slip': { title: 'Appointment slip', paper: 'A5', page: 'A5 portrait', note: 'Includes the token and the reporting time.', param: 'id' },
  prescription: { title: 'Prescription', paper: 'A4', page: 'A4 portrait', note: 'Bangla advice, allergies and the doctor’s signature.', param: 'enc' },
  receipt: { title: 'Payment receipt', paper: 'Thermal 80 mm', page: '80mm auto', note: 'Monospace layout for a thermal printer.', param: 'inv' },
  invoice: { title: 'Invoice', paper: 'A4', page: 'A4 portrait', note: 'The full bill for the patient, the payer or the file.', param: 'inv' },
  'dispense-label': { title: 'Medicine label', paper: '50 × 25 mm', page: '50mm 25mm', note: 'Applied to the pack: four doses a day, in Bangla and English.', param: 'dsp' },
  'result-report': { title: 'Laboratory report', paper: 'A4', page: 'A4 portrait', note: 'Reference ranges, flags and the verifier’s name.', param: 'spec' },
  'purchase-order': { title: 'Purchase order', paper: 'A4', page: 'A4 portrait', note: 'Sent to the supplier; the store keeps the copy that was ordered.', param: 'po' },
  'discharge-summary': { title: 'Discharge summary', paper: 'A4', page: 'A4 portrait', note: 'The document the patient carries home: course, condition, medicines and the follow-up date.', param: 'dsc' },
  'specimen-label': { title: 'Specimen label', paper: '50 × 25 mm', page: '50mm 25mm', note: 'Two-line label for tubes; the barcode is what the lab scans.', param: 'spec' },
  'id-card': { title: 'Patient ID card', paper: 'CR80 card', page: 'A4 portrait', note: 'Crop marks shown for card printers.', param: 'mrn' },
  'day-list': { title: 'Appointment day list', paper: 'A4 landscape', page: 'A4 landscape', note: 'What the desk prints at the start of a shift.' },
  'birth-record': { title: 'Birth record', paper: 'A4', page: 'A4 portrait', note: 'The hospital’s own record of a birth. The civil certificate is the corporation’s, and this print says so.', param: 'reg' },
  'death-record': { title: 'Death record', paper: 'A4', page: 'A4 portrait', note: 'Cause of death in the three-part form, with the certificate state and the police referral where there is one.', param: 'reg' },
  payslip: { title: 'Payslip', paper: 'A5', page: 'A5 portrait', note: 'Every deduction printed with the rule that produced it, and the attendance the month was paid on.', param: 'emp' },
  'attendance-sheet': { title: 'Attendance sheet', paper: 'A4 landscape', page: 'A4 landscape', note: 'The month as a matrix for a shift manager to sign, with the exceptions named underneath.', param: 'month' },
  'visitor-badge': { title: 'Visitor badge', paper: 'Thermal 80 mm', page: '80mm auto', note: 'Prints the areas the visitor may not enter on the badge itself, because the door is busy.', param: 'pass' },
  'imaging-report': { title: 'Imaging report', paper: 'A4', page: 'A4 portrait', note: 'Findings and impression, with the radiologist who reported it.', param: 'spec' },
};

/**
 * The stamp on every document: the moment it was printed.
 *
 * The clock is read *after* mount on purpose. A wall clock printed by the server and again by the browser is the
 * one thing on these pages that can differ between the two, and a template that reforms itself mid-hydration is
 * worse than a template whose stamp appears a moment late — the paper is already coming out of the printer by
 * then, and a page that re-renders as it prints is a page with two dates on it.
 */
function PrintStamp() {
  const [at, setAt] = useState('');
  useEffect(() => setAt(new Date().toLocaleString()), []);
  return <>{at || '—'}</>;
}

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
  searchParams: Promise<{ id?: string; mrn?: string; enc?: string; inv?: string; dsp?: string; spec?: string; po?: string; dsc?: string; reg?: string; emp?: string; month?: string; pass?: string }>;
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

  const inpatient = generateInpatient(day);
  const discharge =
    inpatient.discharges.find((d) => d.id === query.dsc) ??
    inpatient.discharges.find((d) => d.mrn === query.mrn) ??
    inpatient.discharges[0];
  const dischargeBed = inpatient.beds.find((b) => b.id === discharge?.bedId);

  const specimenId = query.spec ?? `SP-${appointment?.token ?? '000'}1`;

  /* The P7 documents read the same modules the administration screens read, which is what makes a payslip print
     match the payroll screen it was generated from. */
  const vital = birthDeathDay(day);
  const birth = vital.births.find((b) => b.registerNo === query.reg) ?? vital.births[0];
  const death = vital.deaths.find((d) => d.registerNo === query.reg) ?? vital.deaths[0];
  const directory = staffDirectory(day);
  const staff = directory.find((s) => s.code === query.emp) ?? directory.find((s) => s.code === 'EMP-1002') ?? directory[0];
  const payrollMonth = query.month ? `${query.month}-01`.slice(0, 7) : monthOf(day);
  const register = attendanceRegister(payrollMonth, directory);
  const attendanceFor: PayrollAttendance =
    payrollAttendance(register)[staff.code] ?? { staffCode: staff.code, workedDays: 0, absentDays: 0, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, lateMarks: 0, overtimeHours: 0, holidays: 0, daysInMonth: monthDays(payrollMonth).length };
  const payslip = payrollLine(staff, attendanceFor);
  const visitorPass = visitorDay(day).passes.find((p) => p.passNo === query.pass) ?? visitorDay(day).passes[0];
  const imagingOrder = diagnosticOrders.find((o) => o.testCode !== undefined && testByCode(o.testCode)?.kind === 'imaging' && o.report) ?? diagnosticOrders.find((o) => testByCode(o.testCode)?.kind === 'imaging') ?? diagnosticOrders[0];
  const imagingTest = testByCode(imagingOrder.testCode);

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
              <div className="col-span-2"><dt className="text-xs">Registered</dt><dd><PrintStamp /></dd></div>
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
            <p>Date   : <PrintStamp /></p>
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
              <p>Printed <PrintStamp /> · Main Campus laboratory</p>
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
              <p>Printed <PrintStamp /> · this is an order, not a tax invoice</p>
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

      case 'discharge-summary': {
        const d = discharge;
        const bedClass = dischargeBed?.class ?? 'General';
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Discharge summary', `${wardName(d.wardId)} · ${d.bedId.replace(/^\w+-/, '')}`)}
            <div className="grid grid-cols-4 gap-x-4 gap-y-1 border-b border-black pb-2 text-xs">
              <div><p className="font-semibold">Patient</p><p>{d.name}</p></div>
              <div><p className="font-semibold">MRN</p><p className="font-mono">{d.mrn}</p></div>
              <div><p className="font-semibold">Age / sex</p><p>{d.age} · {d.sex}</p></div>
              <div><p className="font-semibold">Consultant</p><p>{d.consultantName}</p></div>
              <div><p className="font-semibold">Admitted</p><p className="font-mono">{d.admittedAt}</p></div>
              <div><p className="font-semibold">Discharged</p><p className="font-mono">{d.dischargedAt}</p></div>
              <div><p className="font-semibold">Stay</p><p>{d.stayedDays} day(s)</p></div>
              <div><p className="font-semibold">Bed class</p><p>{bedClass} · {BED_CHARGE[bedClass].toLocaleString()} Taka/day</p></div>
            </div>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Diagnosis</h2>
              <p className="text-sm">{d.diagnosis.code} · {d.diagnosis.label}</p>
              {d.procedures && d.procedures.length > 0 && (
                <p className="mt-1 text-xs">Procedures: {d.procedures.join(' · ')}</p>
              )}
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Type of discharge</h2>
              <p className="text-sm">{d.type}</p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Course in hospital</h2>
              <p className="text-sm leading-relaxed">{d.summary.course}</p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Findings and investigations</h2>
              <p className="text-sm leading-relaxed">{d.summary.findings}</p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Treatment given</h2>
              <p className="text-sm leading-relaxed">{d.summary.treatment}</p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Condition on discharge</h2>
              <p className="text-sm">{d.summary.condition}</p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Medicines to continue</h2>
              {d.medications.length === 0 ? (
                <p className="text-sm">None prescribed at discharge — the patient was referred onward.</p>
              ) : (
                <table className="mt-1 w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {['Medicine', 'Dose', 'Route', 'Frequency', 'Days', 'Quantity', 'What to tell the patient'].map((h) => (
                        <th key={h} className="border border-black px-1.5 py-1 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.medications.map((m) => (
                      <tr key={m.id}>
                        <td className="border border-black px-1.5 py-0.5">
                          <span className="font-medium">{m.brand}</span> {m.strength}
                          <span className="block text-[10px]">{m.generic} · {m.form}</span>
                        </td>
                        <td className="border border-black px-1.5 py-0.5 font-mono">{m.dose}</td>
                        <td className="border border-black px-1.5 py-0.5">{m.route}</td>
                        <td className="border border-black px-1.5 py-0.5">{m.frequency}</td>
                        <td className="border border-black px-1.5 py-0.5 font-mono">{m.durationDays}</td>
                        <td className="border border-black px-1.5 py-0.5 font-mono">{m.quantity}</td>
                        <td className="border border-black px-1.5 py-0.5">{m.instructions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-1 text-[10px]">
                A medicine stopped in hospital is not on this list on purpose: the discharge list is what the patient
                takes home, and anything meant to stop would be an instruction, not a prescription.
              </p>
            </section>

            <section className="mt-3">
              <h2 className="text-sm font-bold">Follow-up</h2>
              <p className="text-sm">
                {d.followUpDays ? `Come back in ${d.followUpDays} day(s)` : 'No routine follow-up booked'}
                {d.followUpWith ? ` · ${d.followUpWith} · OPD, Main Campus` : ''}
              </p>
              <p className="mt-1 text-sm">{d.summary.adviceBn}</p>
            </section>

            {!d.bill.settled && (
              <section className="mt-3 border border-black p-2">
                <h2 className="text-sm font-bold">Bill outstanding</h2>
                <p className="text-sm">
                  {d.bill.due.toLocaleString()} Taka was outstanding when the patient left.
                  {d.bill.invoiceId ? ` Invoice ${d.bill.invoiceId}.` : ' No invoice was raised.'}
                </p>
              </section>
            )}

            <div className="mt-6 flex justify-between text-xs">
              <div>
                <p className="border-t border-black pt-1">Prepared by · {d.preparedBy}</p>
              </div>
              <div>
                <p className="border-t border-black pt-1">Countersigned · {d.countersignedBy ?? 'Consultant'}</p>
              </div>
              <div>
                <p className="border-t border-black pt-1">Patient or attendant</p>
              </div>
            </div>
            <p className="mt-2 text-[10px]">Printed <PrintStamp /> · patient copy · bring this sheet to every follow-up</p>
          </div>
        );
      }

      case 'birth-record':
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Birth record', birth ? `Register no. ${birth.registerNo}` : 'No birth recorded today')}
            {!birth ? (
              <p className="text-sm">No birth was recorded on {day}. The register prints an empty form rather than a sample: a record with somebody else’s baby on it is worse than a blank one.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p><span className="font-semibold">Mother:</span> {birth.mother.name} ({birth.mother.mrn})</p>
                    <p><span className="font-semibold">Age:</span> {birth.mother.age} years</p>
                    <p><span className="font-semibold">Gravida / para:</span> {birth.gravidaPara}</p>
                    <p><span className="font-semibold">Ward and bed:</span> {birth.wardId} · {birth.bedId}</p>
                    <p><span className="font-semibold">Delivered by:</span> {birth.attendedBy}</p>
                  </div>
                  <div>
                    <p><span className="font-semibold">Date and time of birth:</span> {birth.at}</p>
                    <p><span className="font-semibold">Gestation:</span> {birth.gestationWeeks} weeks</p>
                    <p><span className="font-semibold">Delivery:</span> {birth.type}</p>
                    <p><span className="font-semibold">Outcome:</span> {birth.outcome}</p>
                    <p><span className="font-semibold">Sex and weight:</span> {birth.sex} · {birth.weightGrams} g</p>
                  </div>
                </div>
                <section className="mt-3 text-xs">
                  <p className="font-semibold">Newborn</p>
                  <p>Apgar {birth.apgar.oneMin} at one minute, {birth.apgar.fiveMin} at five.{birth.outcome === 'Stillbirth' ? ' A stillbirth carries no Apgar score, which is the register’s own rule: the score is what a living baby is assessed by.' : ''}</p>
                  <p>Vitamin K {birth.vitaminKGiven ? 'given' : 'not given'} · BCG {birth.bcgGiven ? 'given' : 'not given'}{birth.firstFeedAt ? ` · first feed ${birth.firstFeedAt.slice(11)}` : ' · first feed not recorded'}</p>
                  {birth.complications.length > 0 && <p><span className="font-semibold">Labour:</span> {birth.complications.join(' · ')}</p>}
                </section>
                <section className="mt-3 border border-black p-2 text-xs">
                  <p className="font-semibold">Civil registration: {birth.civil.state}{birth.civil.number ? ` — ${birth.civil.number}` : ''}</p>
                  <p>This is the hospital’s own record of the birth. The birth certificate is issued by the city corporation’s registrar, and this document is what the family takes there.</p>
                </section>
                {birth.note && <p className="mt-3 text-xs">{birth.note}</p>}
              </>
            )}
            <p className="mt-4 text-[10px]">Printed <PrintStamp /> · {birth ? birth.registerNo : 'blank form'} · hospital copy</p>
          </div>
        );

      case 'death-record':
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Death record', death ? `Register no. ${death.registerNo}` : 'No death recorded today')}
            {!death ? (
              <p className="text-sm">No death was recorded on {day}. The register prints an empty form rather than a sample.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p><span className="font-semibold">Name:</span> {death.patient?.name ?? 'Not registered'} {death.patient ? `(${death.patient.mrn})` : ''}</p>
                    <p><span className="font-semibold">Age and sex:</span> {death.patient ? `${death.patient.age} years · ${death.patient.sex}` : '—'}</p>
                    <p><span className="font-semibold">Came in as:</span> {death.kind}</p>
                    <p><span className="font-semibold">Ward:</span> {death.wardId ?? 'not admitted'}</p>
                    <p><span className="font-semibold">Date and time of death:</span> {death.at}</p>
                  </div>
                  <div>
                    <p><span className="font-semibold">Immediate cause:</span> {death.cause.immediate || 'not stated'}</p>
                    <p><span className="font-semibold">Antecedent cause:</span> {death.cause.antecedent || '—'}</p>
                    <p><span className="font-semibold">Underlying cause:</span> {death.cause.underlying || '—'}</p>
                    <p><span className="font-semibold">ICD:</span> {death.cause.icd || '—'}</p>
                    <p><span className="font-semibold">Manner:</span> {death.manner}</p>
                  </div>
                </div>
                <section className="mt-3 text-xs">
                  <p className="font-semibold">Certification</p>
                  <p>{death.certifiedBy ? `Certified by ${death.certifiedBy}${death.certifiedAt ? ` at ${death.certifiedAt}` : ''}.` : 'Not yet certified: the register refuses to print a certificate for a death without a cause on it.'} {death.certificateNo ? `Certificate no. ${death.certificateNo}.` : ''}</p>
                  {death.police && <p><span className="font-semibold">Referred to police:</span> {death.police.station}, informed {death.police.referredAt}.{death.postMortemReferred ? ' Post-mortem referred.' : ''}</p>}
                </section>
                <section className="mt-3 border border-black p-2 text-xs">
                  <p className="font-semibold">Release of the body: {death.releasedAt ? `${death.releasedAt} → ${death.releasedTo}` : 'still with the hospital'}</p>
                  <p><span className="font-semibold">Civil registration: {death.civil.state}{death.civil.number ? ` — ${death.civil.number}` : ''}</span></p>
                  <p>This is the hospital’s record. The death certificate is issued by the city corporation’s registrar; a death that is never filed is invisible to every district statistic, including the ones that decide where a maternity unit is built.</p>
                </section>
                {death.note && <p className="mt-3 text-xs">{death.note}</p>}
              </>
            )}
            <p className="mt-4 text-[10px]">Printed <PrintStamp /> · {death ? death.registerNo : 'blank form'} · hospital copy</p>
          </div>
        );

      case 'payslip':
        return (
          <div className="w-[148mm] bg-white p-4 text-black">
            {header('Payslip', `${monthOf(`${payrollMonth}-01`)} · ${staff.code}`)}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <p className="text-sm font-bold">{staff.name}</p>
                <p>{staff.designation} · {staff.departmentId}</p>
                <p>Joined {staff.joined} · {staff.employment}</p>
              </div>
              <div className="text-right">
                <p>Grade {staff.gradeCode} · basic {staff.basic.toLocaleString('en-IN')}</p>
                <p>{staff.bank?.verified ? `Bank ${staff.bank.bank} · ${staff.bank.masked}` : 'Bank details not verified — paid by hand'}</p>
                <p>{staff.wardId ? `Ward ${staff.wardId}` : 'Non-clinical'}</p>
              </div>
            </div>
            <table className="mt-3 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="border border-black px-1 py-0.5 text-left">Earnings</th>
                  <th className="border border-black px-1 py-0.5 text-right">Taka</th>
                  <th className="border border-black px-1 py-0.5 text-left">Deductions</th>
                  <th className="border border-black px-1 py-0.5 text-right">Taka</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(payslip.earnings.length, payslip.deductions.length) }).map((_, i) => {
                  const earning = payslip.earnings[i];
                  const deduction = payslip.deductions[i];
                  return (
                    <tr key={i}>
                      <td className="border border-black px-1 py-0.5">{earning ? `${earning.label}` : ''}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{earning ? earning.amount.toLocaleString('en-IN') : ''}</td>
                      <td className="border border-black px-1 py-0.5">{deduction ? `${deduction.label}` : ''}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{deduction ? deduction.amount.toLocaleString('en-IN') : ''}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="border border-black px-1 py-0.5 font-semibold">Gross</td>
                  <td className="border border-black px-1 py-0.5 text-right font-mono font-semibold">{payslip.gross.toLocaleString('en-IN')}</td>
                  <td className="border border-black px-1 py-0.5 font-semibold">Total deductions</td>
                  <td className="border border-black px-1 py-0.5 text-right font-mono font-semibold">{payslip.deductionsTotal.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td className="border border-black px-1 py-0.5 font-bold" colSpan={2}>Net payable</td>
                  <td className="border border-black px-1 py-0.5 font-bold text-right font-mono" colSpan={2}>{payslip.net.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
            <section className="mt-2 text-[10px]">
              <p className="font-semibold">The month the salary was paid on</p>
              <p>
                Worked {attendanceFor.workedDays} · paid leave {attendanceFor.paidLeaveDays} · unpaid {attendanceFor.unpaidLeaveDays} · absent {attendanceFor.absentDays} · half days {attendanceFor.halfDays} ·
                late marks {attendanceFor.lateMarks} · overtime {attendanceFor.overtimeHours} h · holidays {attendanceFor.holidays} of {attendanceFor.daysInMonth} days.
              </p>
              <p className="mt-1">Every deduction above is a rule, not a decision: {allowancesFor(staff).map((a) => a.label).join(', ')} are the allowances the grade carries, and the attendance figures are the register’s own.</p>
              <p className="mt-1">Employer cost {payslip.employerCost.toLocaleString('en-IN')} including the hospital’s provident fund share and group insurance.</p>
              {payslip.notes.length > 0 && <ul className="mt-1 list-disc pl-4">{payslip.notes.map((n, i) => (<li key={i}>{n}</li>))}</ul>}
            </section>
            <p className="mt-3 text-[9px]">Printed <PrintStamp /> · computer generated · queries to HR within 30 days</p>
          </div>
        );

      case 'attendance-sheet': {
        const codes = Object.keys(REGISTER_CODES) as RegisterCode[];
        return (
          <div className="w-[297mm] bg-white p-4 text-black">
            {header('Attendance sheet', `${register.month} · Main Campus · ${register.rows.length} on the register`)}
            <table className="w-full border-collapse text-[8px]">
              <thead>
                <tr>
                  <th className="border border-black px-0.5 py-0.5 text-left">Code</th>
                  <th className="border border-black px-0.5 py-0.5 text-left">Name</th>
                  {register.days.map((d) => (
                    <th key={d} className="border border-black px-0 py-0.5">{Number(d.slice(8, 10))}</th>
                  ))}
                  <th className="border border-black px-0.5 py-0.5">OT</th>
                </tr>
              </thead>
              <tbody>
                {register.rows.map((row) => (
                  <tr key={row.staffCode}>
                    <td className="border border-black px-0.5 font-mono">{row.staffCode}</td>
                    <td className="border border-black px-0.5">{row.name}</td>
                    {row.days.map((d) => (
                      <td key={d.day} className="border border-black px-0 text-center font-mono" title={REGISTER_CODES[d.code].label}>{d.code}</td>
                    ))}
                    <td className="border border-black px-0.5 text-right font-mono">{row.summary.otHours ? row.summary.otHours.toFixed(1) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <section className="mt-2 text-[9px]">
              <p className="font-semibold">Codes</p>
              <p>{codes.map((c) => `${c} — ${REGISTER_CODES[c].label}`).join(' · ')}</p>
              <p className="mt-1 font-semibold">Exceptions this month ({register.exceptions.length})</p>
              {register.exceptions.length === 0 ? (
                <p>None. Every day is a punch, a leave record or a weekly off.</p>
              ) : (
                <ul className="mt-0.5 list-disc pl-4">
                  {register.exceptions.slice(0, 24).map((e, i) => (<li key={i}>{e.day} · {e.name} — {e.text}</li>))}
                </ul>
              )}
              <p className="mt-1">
                {register.stats.staff} people · {register.stats.presentDays} present days · {register.stats.absentDays} absent · {register.stats.leaveDays} leave · {register.stats.unpaidDays} unpaid ·
                {register.stats.lateMarks} late marks · {register.stats.halfDays} half days · {register.stats.otHours} overtime hours.
              </p>
              <p className="mt-1">A punch is never edited: every correction on this sheet is a second record naming the supervisor and the reason, and the payroll reads the register rather than the reader.</p>
              <div className="mt-4 flex justify-between">
                <p>Shift manager ______________________</p>
                <p>HR ______________________</p>
                <p>Date ______________________</p>
              </div>
            </section>
            <p className="mt-2 text-[8px]">Printed <PrintStamp /> · {register.month} · signature copy</p>
          </div>
        );
      }

      case 'visitor-badge':
        return (
          <div className="w-[76mm] bg-white p-3 font-mono text-black">
            <p className="text-[9px] uppercase tracking-wide">Shaheed Suhrawardy General Hospital</p>
            <p className="mt-1 text-sm font-bold uppercase">{visitorPass?.name ?? 'Visitor'}</p>
            <p className="text-[10px]">{visitorPass ? purposeByCode(visitorPass.purpose)?.label ?? visitorPass.purpose : '—'}</p>
            <p className="mt-1 text-[11px] font-bold">{visitorPass?.passNo ?? 'VP-2026-0000'}</p>
            <p className="text-[10px]">Seen by: {visitorPass?.hostName ?? '—'} ({visitorPass?.hostCode ?? '—'})</p>
            <p className="text-[10px]">Issued {visitorPass?.issuedAt ?? '—'} · valid until {visitorPass?.validUntil ?? '—'}</p>
            <p className="mt-2 border-t border-dashed border-black pt-1 text-[9px] font-bold uppercase">May not enter</p>
            <p className="text-[9px]">
              {visitorPass && visitorPass.badgeKind === 'Delivery'
                ? 'Any ward, laboratory or theatre area. Deliveries are received at the store.'
                : 'Theatre suite, HDU and the laboratory bench area. Escorted areas are named at the gate.'}
            </p>
            {visitorPass && visitorPass.areas.length > 0 && <p className="mt-1 text-[9px]">May reach: {visitorPass.areas.join(', ')}</p>}
            <p className="mt-2 text-[8px]">Wear this badge where it can be seen. Return it at the gate on the way out — an open pass is somebody the guard has to find.</p>
            <div className="mt-2 flex justify-center">
              <BarCode value={visitorPass?.passNo ?? 'VP-2026-0000'} height={26} />
            </div>
          </div>
        );

      case 'imaging-report': {
        const radiologyPatient = patients.find((p) => p.mrn === imagingOrder.patient.mrn) ?? patients[0];
        return (
          <div className="w-[210mm] bg-white p-6 text-black">
            {header('Imaging report', `${imagingTest?.modality ?? 'Imaging'} · ${imagingOrder.id}`)}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p><span className="font-semibold">Patient:</span> {imagingOrder.patient.name} ({imagingOrder.patient.mrn})</p>
                <p><span className="font-semibold">Age and sex:</span> {radiologyPatient.age} · {radiologyPatient.sex}</p>
                <p><span className="font-semibold">Referred by:</span> {imagingOrder.encounterId ?? 'Out-patient clinic'}</p>
              </div>
              <div>
                <p><span className="font-semibold">Study:</span> {imagingTest?.name ?? imagingOrder.testCode}</p>
                <p><span className="font-semibold">Ordered:</span> {imagingOrder.orderedAt}</p>
                <p><span className="font-semibold">Reported:</span> {imagingOrder.resultedAt ?? '—'}</p>
              </div>
            </div>
            <section className="mt-4 text-xs">
              <p className="font-semibold">Findings</p>
              <p className="mt-1 whitespace-pre-line">{imagingOrder.report ?? 'No report text was recorded against this study.'}</p>
            </section>
            <section className="mt-4 border border-black p-2 text-xs">
              <p className="font-semibold">Impression</p>
              <p className="mt-1">{imagingOrder.report ? 'Stated in the findings above. The impression is on its own line on every report: it is the part clinicians read.' : 'No impression recorded. A study released without one is a picture, not a report.'}</p>
            </section>
            <section className="mt-4 text-xs">
              <p className="font-semibold">Reported by</p>
              <p>{imagingOrder.verifiedBy ?? imagingOrder.resultedBy ?? 'Not yet verified. A report without a verifier is a printout, not a report.'}</p>
              {imagingOrder.callback && (
                <p className="mt-2 border border-black p-2">
                  <span className="font-semibold">Critical finding — called back:</span> {imagingOrder.callback.toWhom} at {imagingOrder.callback.at}, by {imagingOrder.callback.by}.{imagingOrder.callback.readBack ? ' Read back and confirmed.' : ' NOT read back.'} {imagingOrder.callback.note ?? ''}
                </p>
              )}
            </section>
            <p className="mt-4 text-[10px]">Printed <PrintStamp /> · {imagingOrder.id} · this report is one page of the patient’s record</p>
          </div>
        );
      }

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
            <p className="mt-2 text-[10px]">Printed <PrintStamp /> · {appointments.length} appointments · desk copy</p>
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
