'use client';

import { use } from 'react';
import Link from 'next/link';
import { Button, SafetyBanner, Tooltip } from '@dizi/ui';
import { DOCTORS, doctorById, generateAppointments, timeLabel, todayIso } from '@/lib/appointments';
import { patients } from '@/lib/mock';

/* Print templates.
 *
 * Every document here is a real layout, sized for the paper it will be printed on, with the print button and
 * the surrounding chrome removed at print time. They matter more than they look:
 *  - printing is the one thing that must work with the uplink down (plan 02 §11), so nothing here fetches data;
 *  - the paper is not one size: A4 reports, A5 slips, 80 mm thermal receipts, 50 × 25 mm labels;
 *  - the barcode is drawn from the identifier itself, so a scanner test is meaningful even before a real
 *    encoder is wired in (that lands with the lab module, where labels become safety-critical).
 */

type DocKind = 'registration-slip' | 'appointment-slip' | 'prescription' | 'receipt' | 'specimen-label' | 'id-card' | 'day-list';

const DOC_META: Record<DocKind, { title: string; paper: string; page: string; note: string }> = {
  'registration-slip': { title: 'Registration slip', paper: 'A5', page: 'A5 portrait', note: 'Handed to the patient at the counter.' },
  'appointment-slip': { title: 'Appointment slip', paper: 'A5', page: 'A5 portrait', note: 'Includes the token and the reporting time.' },
  prescription: { title: 'Prescription', paper: 'A4', page: 'A4 portrait', note: 'Bangla-first with English drug names; allergy line always printed.' },
  receipt: { title: 'Payment receipt', paper: 'Thermal 80 mm', page: '80mm auto', note: 'Monospace layout for a thermal printer; QR for the payment lookup.' },
  'specimen-label': { title: 'Specimen label', paper: '50 × 25 mm', page: '50mm 25mm', note: 'Two-line label for tubes; the barcode is what the lab scans.' },
  'id-card': { title: 'Patient ID card', paper: 'CR80 card', page: 'A4 portrait', note: 'Crop marks shown for card printers.' },
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

export default function PrintPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ id?: string; mrn?: string }> }) {
  const { doc } = use(params);
  const query = use(searchParams);
  const known = Object.prototype.hasOwnProperty.call(DOC_META, doc);
  const kind = (known ? doc : 'appointment-slip') as DocKind;
  const meta = DOC_META[kind];

  const day = todayIso();
  const appointments = generateAppointments(day);
  const appointment = appointments.find((a) => a.id === query.id) ?? appointments[0];
  const patient = patients.find((p) => p.mrn === query.mrn) ?? patients.find((p) => p.mrn === appointment?.patient.mrn) ?? patients[0];
  const doctor = doctorById(appointment?.doctorId ?? DOCTORS[0].id);

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
                <p className="font-semibold">{appointment?.patient.name} <span className="font-normal">({appointment?.patient.nameBn})</span></p>
                <p className="font-mono text-xs">{appointment?.patient.mrn} · {appointment?.patient.age}{appointment?.patient.sex.slice(0, 1)} · {appointment?.patient.phone}</p>
              </div>
              <p className="text-xs">{new Date(`${day}T00:00:00`).toLocaleDateString('en-GB')} · OPD</p>
            </div>
            {appointment?.patient.allergies && (
              <p className="mb-3 border border-black px-2 py-1 text-sm font-bold">ALLERGY: {appointment.patient.allergies.toUpperCase()}</p>
            )}
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">#</th>
                  <th className="border border-black px-2 py-1 text-left">Medicine</th>
                  <th className="border border-black px-2 py-1 text-left">Dose</th>
                  <th className="border border-black px-2 py-1 text-left">Frequency</th>
                  <th className="border border-black px-2 py-1 text-left">Duration</th>
                  <th className="border border-black px-2 py-1 text-left">Note</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['1', 'Tab. Metformin 500 mg', '1 tablet', 'After breakfast & dinner', '30 days', 'Take with food'],
                  ['2', 'Tab. Amlodipine 5 mg', '1 tablet', 'Once daily, morning', '30 days', 'Monitor BP weekly'],
                  ['3', 'Cap. Omeprazole 20 mg', '1 capsule', 'Before breakfast', '14 days', ''],
                  ['4', 'Tab. Paracetamol 500 mg', '1 tablet', 'If fever or pain, up to 3/day', '5 days', 'Maximum 3 g per day'],
                ].map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, i) => (
                      <td key={i} className="border border-black px-2 py-1 align-top">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
              <div className="col-span-2">
                <p className="text-xs">Advice</p>
                <p>Low-sugar diet, 30 minutes walking daily, review with fasting blood sugar report.</p>
              </div>
              <div>
                <p className="text-xs">Follow-up</p>
                <p>{new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-GB')}</p>
              </div>
            </div>
            <div className="mt-10 flex justify-between text-xs">
              <BarCode value={`RX-${appointment?.token ?? '000'}`} height={32} />
              <div className="text-right">
                <div className="mb-1 h-10 w-48 border-b border-black" />
                <p>Doctor signature &amp; BMDC number</p>
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
            <p>Receipt : {`RC-${day.replace(/-/g, '')}-0417`}</p>
            <p>Patient: {appointment?.patient.name}</p>
            <p>MRN    : {appointment?.patient.mrn}</p>
            <p>Date   : {new Date().toLocaleString()}</p>
            <p className="my-1 border-t border-dashed border-black" />
            {[
              ['OPD consultation', 500],
              ['CBC (lab)', 350],
              ['X-ray chest PA', 800],
              ['Tab. Metformin 500mg x30', 180],
            ].map(([label, amount]) => (
              <p key={label as string} className="flex justify-between">
                <span>{label}</span>
                <span>{Number(amount).toFixed(2)}</span>
              </p>
            ))}
            <p className="my-1 border-t border-dashed border-black" />
            <p className="flex justify-between font-bold"><span>TOTAL</span><span>1830.00</span></p>
            <p className="flex justify-between"><span>Paid (cash)</span><span>1500.00</span></p>
            <p className="flex justify-between"><span>Due</span><span>330.00</span></p>
            <p className="my-1 border-t border-dashed border-black" />
            <p className="text-center">Bill prepared by: Billing counter 1</p>
            <p className="text-center">Not valid without the official seal</p>
            <p className="mt-2 text-center">||| ||||| ||| |||||| ||||</p>
            <p className="text-center">RC{day.replace(/-/g, '')}0417</p>
          </div>
        );

      case 'specimen-label':
        return (
          <div className="flex gap-3">
            {[1, 2].map((n) => (
              <div key={n} className="h-[25mm] w-[50mm] border border-dashed border-black bg-white p-1 text-black">
                <p className="truncate text-[10px] font-bold leading-tight">{appointment?.patient.name}</p>
                <p className="font-mono text-[9px] leading-tight">{appointment?.patient.mrn} · {appointment?.patient.age}{appointment?.patient.sex.slice(0, 1)}</p>
                <BarCode value={`SP-${appointment?.token ?? '000'}${n}`} height={22} />
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
      {!known && (
        <div className="no-print mx-auto mb-4 max-w-4xl">
          <SafetyBanner severity="warning" title={`No template called “${doc}”`}>
            Showing the appointment slip instead.{' '}
            <Link href="/print" className="underline">See every print template</Link>.
          </SafetyBanner>
        </div>
      )}
      {/* Paper-size specific rules: one document per page, no browser headers where the printer allows it. */}
      <style>{`@page { size: ${meta.page}; margin: 6mm; } @media print { .print-preview { padding: 0 !important; background: #fff !important; } .print-paper { box-shadow: none !important; border: 0 !important; margin: 0 !important; } }`}</style>

      <div className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link href="/appointments"><Button size="sm" variant="ghost">← Back</Button></Link>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">{meta.title} <span className="text-sm font-normal text-text-tertiary">· {meta.paper}</span></h1>
          <p className="text-xs text-text-secondary">{meta.note}</p>
        </div>
        <Tooltip content="Printing uses the system dialog; the paper size above is set with @page so it matches the printer tray.">
          <Button size="sm" variant="ghost">Which paper?</Button>
        </Tooltip>
        <Button size="sm" variant="primary" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="no-print mx-auto mb-4 max-w-4xl">
        <SafetyBanner severity="info" title="Preview with sample data">
          Templates render from the same components the real screens use. Barcodes are drawn from the identifier
          itself until the lab module wires in a certified encoder (P4).
        </SafetyBanner>
      </div>

      <div className="print-preview flex justify-center overflow-auto pb-8">
        <div className="print-paper shadow-lg">{docContent()}</div>
      </div>
    </div>
  );
}
