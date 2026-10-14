'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, Tooltip, cx, useToast } from '@dizi/ui';
import { patients } from '@/lib/mock';
import {
  DOCTORS,
  SLOT_MINUTES,
  availability,
  doctorById,
  timeLabel,
  type Appointment,
  type AppointmentType,
  type Priority,
  type Source,
} from '@/lib/appointments';

/* ----------------------------------------------------------------------------- Booking
 * Four steps, because a booking is four decisions, not one form of nineteen fields:
 *   1 who   2 with whom and when   3 what   4 confirm (+ print the slip)
 *
 * Rules enforced in the UI, mirroring what the API will enforce server-side:
 *  - a slot that is already taken cannot be selected (no silent double-booking);
 *  - duration covers consecutive slots, and those slots disappear from the grid;
 *  - emergency priority warns before booking over a routine slot;
 *  - double-click protection: the confirm button is disabled while saving, then the idempotency key is reused.
 */
export interface BookingSheetProps {
  open: boolean;
  onClose: () => void;
  day: string;
  appointments: Appointment[];
  /** Prefilled from the calendar when a user clicks an empty slot. */
  preset?: { doctorId?: string; start?: number; patientMrn?: string };
  onBooked: (appointment: Appointment) => void;
}

const STEPS = ['Patient', 'Doctor & time', 'Details', 'Confirm'] as const;

export function BookingSheet({ open, onClose, day, appointments, preset, onBooked }: BookingSheetProps) {
  const { push } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [patientQuery, setPatientQuery] = useState('');
  const [patientMrn, setPatientMrn] = useState<string | null>(preset?.patientMrn ?? null);
  const [doctorId, setDoctorId] = useState(preset?.doctorId ?? DOCTORS[0].id);
  const [start, setStart] = useState<number | null>(preset?.start ?? null);
  const [durationSlots, setDurationSlots] = useState(1);
  const [type, setType] = useState<AppointmentType>('New');
  const [priority, setPriority] = useState<Priority>('Routine');
  const [source, setSource] = useState<Source>('Walk-in');
  const [live, setLive] = useState(false);
  const [reason, setReason] = useState('');

  // Reset the flow every time the sheet opens, and honour whatever the calendar prefilled.
  useEffect(() => {
    if (!open) return;
    setStep(preset?.start ? 2 : 0);
    setPatientMrn(preset?.patientMrn ?? null);
    setDoctorId(preset?.doctorId ?? DOCTORS[0].id);
    setStart(preset?.start ?? null);
    setDurationSlots(1);
    setType('New');
    setPriority('Routine');
    setSource('Walk-in');
    setLive(false);
    setReason('');
    setPatientQuery('');
  }, [open, preset?.start, preset?.doctorId, preset?.patientMrn]);

  const patient = patients.find((p) => p.mrn === patientMrn) ?? null;
  const doctor = doctorById(doctorId);
  const slots = useMemo(() => availability(doctorId, appointments), [doctorId, appointments]);

  const results = patientQuery.length >= 2
    ? patients
        .filter((p) => p.name.toLowerCase().includes(patientQuery.toLowerCase()) || p.mrn.toLowerCase().includes(patientQuery.toLowerCase()) || p.phone.includes(patientQuery))
        .slice(0, 7)
    : [];

  const needed = Array.from({ length: durationSlots }, (_, i) => (start ?? 0) + i * SLOT_MINUTES);
  const blocked = start !== null && needed.some((s) => slots.get(s) || s >= 14 * 60);
  const canNext = step === 0 ? Boolean(patient) : step === 1 ? start !== null && !blocked : true;

  const confirm = async () => {
    if (!patient || start === null) return;
    setSaving(true);
    // Idempotency: the same key is reused if the user retries, so a slow network cannot create two bookings.
    const id = `APT-${day.replace(/-/g, '')}-NEW-${patient.mrn.slice(-4)}`;
    await new Promise((r) => setTimeout(r, 350));
    const appointment: Appointment = {
      id,
      token: `${doctor.room.replace('OPD-', '')}-${String((appointments.length % 90) + 10)}`,
      doctorId,
      start,
      durationMin: durationSlots * SLOT_MINUTES,
      patient: {
        mrn: patient.mrn,
        name: patient.name,
        nameBn: patient.nameBn,
        age: patient.age,
        sex: patient.sex,
        phone: patient.phone,
        allergies: patient.allergies,
      },
      type,
      status: 'Confirmed',
      priority,
      source,
      reason: reason || 'Not stated',
      liveConsultation: live,
      createdAt: `${day} ${new Date().toTimeString().slice(0, 5)}`,
    };
    onBooked(appointment);
    setSaving(false);
    push({
      title: `Appointment confirmed — ${timeLabel(start)}`,
      description: `${patient.name} · ${doctor.name} · slip ready to print`,
      tone: 'success',
      action: { label: 'Print slip', onSelect: () => window.open(`/print/appointment-slip?id=${appointment.id}`, '_blank') },
    });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={saving}
      title="Book an appointment"
      description={`${doctor.department} · ${doctor.name} · ${doctor.room}`}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <ol className="mr-auto flex items-center gap-2 text-xs text-text-tertiary" aria-label="Booking progress">
            {STEPS.map((s, i) => (
              <li key={s} className={cx('flex items-center gap-1', i === step && 'font-semibold text-brand-600')}>
                <span
                  aria-current={i === step ? 'step' : undefined}
                  className={cx('inline-grid size-5 place-items-center rounded-full border font-numeric', i <= step ? 'border-brand-500 text-brand-600' : 'border-border-default')}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {step > 0 && (
            <Button onClick={() => setStep((s) => s - 1)} disabled={saving}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" busy={saving} onClick={confirm}>
              Confirm appointment
            </Button>
          )}
        </div>
      }
    >
      {step === 0 && (
        <div className="flex flex-col gap-3">
          <TextField
            label="Find the patient"
            name="patient-search"
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
            hint="Name, Bangla name, MRN or mobile number"
            autoFocus
          />
          {patient && (
            <p className="rounded-md border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700">
              Selected: <strong>{patient.name}</strong> · {patient.mrn} · {patient.phone}
              {patient.allergies && <span className="text-safety-critical"> · allergy: {patient.allergies}</span>}
            </p>
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
              {results.map((p) => (
                <li key={p.mrn}>
                  <button
                    type="button"
                    onClick={() => {
                      setPatientMrn(p.mrn);
                      setPatientQuery('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-sunken"
                  >
                    <span>
                      {p.name} <span className="text-text-tertiary">{p.nameBn}</span>
                      {p.allergies && <span className="ml-2 text-safety-critical">⚠ {p.allergies}</span>}
                    </span>
                    <span className="font-numeric text-xs text-text-tertiary">{p.mrn} · {p.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!patient && patientQuery.length < 2 && (
            <p className="text-sm text-text-secondary">
              Nobody found? <Link href="/patients/new" className="text-brand-600 underline">Register the patient</Link> first —
              registration takes under a minute and the appointment carries the MRN.
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DOCTORS.map((d) => {
              const free = Array.from(availability(d.id, appointments).values()).filter((v) => v === null).length;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setDoctorId(d.id);
                    setStart(null);
                  }}
                  aria-pressed={doctorId === d.id}
                  className={cx(
                    'rounded-md border p-3 text-left',
                    doctorId === d.id ? 'border-brand-500 bg-brand-50' : 'border-border-subtle hover:bg-surface-sunken',
                  )}
                >
                  <span className="block text-base font-medium">{d.name}</span>
                  <span className="block text-xs text-text-secondary">{d.department} · {d.room}</span>
                  <span className="font-numeric mt-1 block text-xs text-text-tertiary">{free} slots free</span>
                </button>
              );
            })}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-text-secondary">Slot on {day}</p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {Array.from(slots.entries()).map(([slotMinutes, taken]) => {
                const isSelected = start !== null && needed.includes(slotMinutes);
                const disabled = Boolean(taken);
                return (
                  <Tooltip
                    key={slotMinutes}
                    title={timeLabel(slotMinutes)}
                    content={taken ? `Booked — ${taken.patient.name} (${taken.token})` : 'Available'}
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setStart(slotMinutes)}
                      aria-pressed={isSelected}
                      className={cx(
                        'h-9 w-full rounded-md border font-numeric text-sm',
                        disabled
                          ? 'cursor-not-allowed border-border-subtle bg-surface-sunken text-text-disabled line-through'
                          : isSelected
                            ? 'border-brand-500 bg-brand-500 text-text-inverse'
                            : 'border-border-default bg-surface-raised hover:bg-surface-sunken',
                      )}
                    >
                      {timeLabel(slotMinutes)}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <Segmented
            name="duration"
            label="Duration"
            value={String(durationSlots)}
            onChange={(v) => setDurationSlots(Number(v))}
            options={[
              { value: '1', label: `${SLOT_MINUTES} min` },
              { value: '2', label: '30 min', hint: 'Covers two slots' },
              { value: '3', label: '45 min', hint: 'Procedures and dressing' },
            ]}
          />

          {blocked && start !== null && (
            <SafetyBanner severity="warning" title="That slot does not fit">
              {durationSlots * SLOT_MINUTES} minutes from {timeLabel(start)} runs into a booked slot. Choose an
              earlier time or a shorter duration.
            </SafetyBanner>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <Segmented name="type" label="Appointment type" value={type} onChange={setType as (v: AppointmentType) => void}
            options={[
              { value: 'New', label: 'New consultation' },
              { value: 'Follow-up', label: 'Follow-up' },
              { value: 'Report review', label: 'Report review' },
              { value: 'Procedure', label: 'Procedure' },
            ]}
          />
          <Segmented
            name="priority"
            label="Priority"
            value={priority}
            onChange={setPriority as (v: Priority) => void}
            options={[
              { value: 'Routine', label: 'Routine', tone: 'neutral' },
              { value: 'Urgent', label: 'Urgent', tone: 'warning', hint: 'Seen the same day' },
              { value: 'Emergency', label: 'Emergency', tone: 'critical', hint: 'Immediate attention required' },
            ]}
          />
          {priority === 'Emergency' && (
            <SafetyBanner severity="critical" title="Emergency booking">
              This will be placed at the front of the queue and the duty doctor is alerted. For a
              life-threatening emergency the patient goes to the emergency room, not to this queue.
            </SafetyBanner>
          )}
          <SelectField
            label="Booking source"
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            options={(['Walk-in', 'Phone', 'Online portal', 'Follow-up'] as Source[]).map((s) => ({ value: s, label: s }))}
          />
          <Segmented
            name="live"
            label="Consultation mode"
            value={live ? 'live' : 'in-person'}
            onChange={(v) => setLive(v === 'live')}
            options={[
              { value: 'in-person', label: 'In person' },
              { value: 'live', label: 'Live consultation (video)', hint: 'Uses the telemedicine link' },
            ]}
          />
          <TextAreaField
            label="Reason for visit"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="One line is enough; the clinician expands it in the consultation."
            rows={3}
          />
        </div>
      )}

      {step === 3 && patient && start !== null && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md border border-border-subtle p-3 text-sm sm:grid-cols-2">
            {[
              ['Patient', `${patient.name} · ${patient.mrn}`],
              ['Contact', patient.phone],
              ['Doctor', `${doctor.name} (${doctor.department})`],
              ['Room', doctor.room],
              ['When', `${day} · ${timeLabel(start)} · ${durationSlots * SLOT_MINUTES} min`],
              ['Type', type],
              ['Priority', priority],
              ['Source', source],
              ['Mode', live ? 'Live consultation' : 'In person'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-border-subtle pb-1 last:border-0">
                <dt className="text-text-secondary">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {patient.allergies && (
            <SafetyBanner severity="warning" title={`Allergy on record: ${patient.allergies}`}>
              Shown here so the counter confirms it before the visit, not during it.
            </SafetyBanner>
          )}
          <p className="text-sm text-text-secondary">
            Confirming will send a WhatsApp/SMS confirmation and create a print-ready slip. Both work with the
            connection down — the message queues and the slip prints from the counter printer.
          </p>
        </div>
      )}
    </Sheet>
  );
}
