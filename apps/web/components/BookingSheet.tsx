'use client';

import { useEffect, useState } from 'react';
import { Button, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { patients } from '@/lib/mock';
import { DOCTORS, doctorById, shiftDays, timeLabel, todayIso, type Appointment, type AppointmentType, type Priority, type Source } from '@/lib/appointments';
import type { SlotDayView } from '@/lib/appointments-api';
import type { BookingInput } from '@/lib/appointments-source';

/* ----------------------------------------------------------------------------- Booking
 * Four steps, because a booking is four decisions, not one form of nineteen fields:
 *   1 who   2 with whom and when   3 what   4 confirm (+ print the slip)
 *
 * Where the rules live now: the *numbers* are the contract's (`x-dizi-scheduling` — the step, the window, the horizon,
 * the closed day) and the *grid* is the source's (`loadSlots`, which returns the slot list together with the doctor's
 * claim size). A slot that is taken cannot be selected, and if one is taken while the sheet is open the refusal arrives
 * as `dizi.slot-taken` with the times that *are* free — offered here rather than making the desk guess.
 *
 * The patient search is still the preview register (`lib/mock.ts`): the registration screens move to the API in their
 * own slice. The MRN this sheet sends is checked by the server either way, so a number nobody carries is refused by the
 * service and the sentence lands in the form rather than being trusted by it.
 */

export interface BookingSheetProps {
  open: boolean;
  onClose: () => void;
  day: string;
  /** Prefilled from the calendar when a user clicks an empty slot, or from a portal request being approved. */
  preset?: { doctorId?: string; start?: number; patientMrn?: string };
  /** One doctor's grid for one day, from whichever source is live. */
  loadSlots: (day: string, doctorId: string) => Promise<SlotDayView>;
  onSubmit: (input: BookingInput) => Promise<Appointment>;
  onBooked: (appointment: Appointment) => void;
  /** The honest line about where this booking will be written. */
  note: string;
}

const STEPS = ['Patient', 'Doctor & time', 'Details', 'Confirm'] as const;

export function BookingSheet({ open, onClose, day, preset, loadSlots, onSubmit, onBooked, note }: BookingSheetProps) {
  const { push } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [sheetDay, setSheetDay] = useState(day);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientMrn, setPatientMrn] = useState<string | null>(preset?.patientMrn ?? null);
  const [doctorId, setDoctorId] = useState(preset?.doctorId ?? DOCTORS[0].id);
  const [start, setStart] = useState<number | null>(preset?.start ?? null);
  const [type, setType] = useState<AppointmentType>('New');
  const [priority, setPriority] = useState<Priority>('Routine');
  const [source, setSource] = useState<Source>('Walk-in');
  const [reason, setReason] = useState('');

  const [grid, setGrid] = useState<SlotDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offered, setOffered] = useState<Array<{ day: string; minutes: number }>>([]);

  // Reset the flow every time the sheet opens, and honour whatever the calendar prefilled.
  useEffect(() => {
    if (!open) return;
    setStep(preset?.start !== undefined ? 2 : 0);
    setSheetDay(day);
    setPatientMrn(preset?.patientMrn ?? null);
    setDoctorId(preset?.doctorId ?? DOCTORS[0].id);
    setStart(preset?.start ?? null);
    setType('New');
    setPriority('Routine');
    setSource('Walk-in');
    setReason('');
    setPatientQuery('');
    setError(null);
    setOffered([]);
  }, [open, day, preset?.start, preset?.doctorId, preset?.patientMrn]);

  /* The grid comes from the source, so what the sheet offers is what the service will accept — including a closed day,
     which is drawn as the reason it is closed rather than as twenty greyed-out buttons. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGrid(null);
    loadSlots(sheetDay, doctorId)
      .then((answer) => {
        if (live) setGrid(answer);
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : 'That grid could not be read.');
      });

    return () => {
      live = false;
    };
  }, [open, sheetDay, doctorId, loadSlots]);

  const patient = patients.find((p) => p.mrn === patientMrn) ?? null;
  const doctor = doctorById(doctorId);
  const steps = Math.max(1, grid?.claimStarts ?? doctor.capacity);

  const results = patientQuery.length >= 2
    ? patients
        .filter((p) => p.name.toLowerCase().includes(patientQuery.toLowerCase()) || p.mrn.toLowerCase().includes(patientQuery.toLowerCase()) || p.phone.includes(patientQuery))
        .slice(0, 7)
    : [];

  /* A start is blocked when any slot the consultation would claim is taken. The claim covers consecutive steps, which
     is why this checks a range rather than a point. */
  const step_minutes = grid?.slotMinutes ?? 15;
  const needed = Array.from({ length: steps }, (_, i) => (start ?? 0) + i * step_minutes);
  const taken = needed
    .map((minute) => grid?.slots.find((slot) => slot.minutes === minute))
    .filter((slot): slot is NonNullable<typeof slot> => slot !== undefined && slot.state === 'booked');
  const blocked = start !== null && taken.length > 0;
  const canNext = step === 0 ? patientMrn !== null : step === 1 ? start !== null && !blocked && grid?.open === true : true;

  const confirm = async () => {
    if (patientMrn === null || start === null) return;
    setSaving(true);
    setError(null);
    setOffered([]);

    try {
      const appointment = await onSubmit({ mrn: patientMrn, doctorId, day: sheetDay, start, type, priority, source, reason });
      onBooked(appointment);
      push({ title: `Booked ${appointment.token} — ${patient?.name ?? patientMrn}`, description: `${timeLabel(start)} with ${doctor.name} · ${doctor.room}`, tone: 'success' });
      onClose();
    } catch (failure) {
      /* A taken slot is not a failure to explain away: the refusal names who holds it and offers the times that are
         free, and those are buttons here rather than a sentence the desk has to write down. */
      const problem = failure as { detail?: string; message?: string; alternatives?: Array<{ day: string; minutes: number }> };
      setError(problem.detail ?? problem.message ?? 'The booking could not be written.');
      setOffered(problem.alternatives ?? []);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={saving}
      title="Book an appointment"
      description={`${doctor.department} · ${doctor.name} · ${doctor.room}`}
      width="lg"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <ol className="mr-auto flex items-center gap-2 text-xs text-text-tertiary" aria-label="Booking progress">
            {STEPS.map((s, i) => (
              <li key={s} className={cx('flex items-center gap-1', i === step && 'font-semibold text-brand-600')}>
                <span
                  aria-current={i === step ? 'step' : undefined}
                  className={cx('font-numeric inline-grid size-5 place-items-center rounded-full border', i <= step ? 'border-brand-500 text-brand-600' : 'border-border-default')}
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
      <div className="flex flex-col gap-4">
        {error !== null && (
          <SafetyBanner severity="warning" title="The booking was refused">
            {error}
            {offered.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {offered.map((alternative) => (
                  <Button
                    key={`${alternative.day}-${alternative.minutes}`}
                    size="sm"
                    onClick={() => {
                      setSheetDay(alternative.day);
                      setStart(alternative.minutes);
                      setStep(1);
                      setError(null);
                      setOffered([]);
                    }}
                  >
                    {timeLabel(alternative.minutes)} · {alternative.day}
                  </Button>
                ))}
              </div>
            )}
          </SafetyBanner>
        )}

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <TextField
              label="Find the patient"
              name="patient-search"
              value={patientQuery}
              onChange={(e) => setPatientQuery(e.target.value)}
              hint="Name, Bangla name, MRN or mobile number. The search reads the preview register until the patients screens are cut over; the server checks the MRN when you confirm."
              autoFocus
            />
            <div className="flex flex-col gap-1">
              {results.map((p) => (
                <button
                  key={p.mrn}
                  type="button"
                  onClick={() => setPatientMrn(p.mrn)}
                  className={cx(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-left',
                    patientMrn === p.mrn ? 'border-brand-500 bg-brand-50' : 'border-border-subtle hover:bg-surface-sunken',
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="font-numeric block text-xs text-text-tertiary">
                      {p.mrn} · {p.phone}
                    </span>
                  </span>
                  <span className="text-xs text-text-secondary">
                    {p.age} · {p.sex}
                  </span>
                </button>
              ))}
            </div>
            {patient !== null && (
              <p className="text-sm text-text-secondary">
                Booking for <span className="font-medium">{patient.name}</span>{' '}
                <span className="font-numeric">({patient.mrn})</span>.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <SelectField
              label="Doctor"
              name="booking-doctor"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setStart(null);
              }}
              options={DOCTORS.map((d) => ({ value: d.id, label: `${d.name} — ${d.department} (${d.room})` }))}
            />

            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="Day"
                name="booking-day"
                type="date"
                value={sheetDay}
                onChange={(e) => {
                  setSheetDay(e.target.value);
                  setStart(null);
                }}
              />
              <div className="flex gap-1">
                <Button size="sm" onClick={() => { setSheetDay(shiftDays(sheetDay, -1)); setStart(null); }} aria-label="Previous day">
                  ‹
                </Button>
                <Button size="sm" onClick={() => { setSheetDay(todayIso()); setStart(null); }}>
                  Today
                </Button>
                <Button size="sm" onClick={() => { setSheetDay(shiftDays(sheetDay, 1)); setStart(null); }} aria-label="Next day">
                  ›
                </Button>
              </div>
              <span className="text-xs text-text-tertiary">{note}</span>
            </div>

            {grid === null && <p className="text-sm text-text-secondary">Reading the slots…</p>}

            {grid !== null && !grid.open && (
              <SafetyBanner severity="info" title="The clinic is closed that day">
                {grid.closedBecause ?? 'Choose another day.'}
              </SafetyBanner>
            )}

            {grid !== null && grid.open && (
              <div>
                <p className="mb-1 text-sm font-medium text-text-secondary">
                  Slots every {grid.slotMinutes} minutes, {grid.room}
                </p>
                <div className="flex flex-wrap gap-1">
                  {grid.slots.map((slot) => {
                    const holds = needed.includes(slot.minutes);
                    return (
                      <button
                        key={slot.minutes}
                        type="button"
                        disabled={slot.state === 'booked'}
                        onClick={() => setStart(slot.minutes)}
                        title={slot.state === 'booked' ? `Taken — ${slot.token ?? ''}` : `${steps} slot(s) from ${timeLabel(slot.minutes)}`}
                        className={cx(
                          'font-numeric rounded-md border px-2 py-1 text-xs',
                          slot.state === 'booked'
                            ? 'cursor-not-allowed border-border-subtle bg-surface-sunken text-text-tertiary'
                            : start === slot.minutes
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : holds
                                ? 'border-brand-300 bg-brand-50'
                                : 'border-border-subtle hover:bg-surface-sunken',
                        )}
                      >
                        {timeLabel(slot.minutes)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  A {doctor.department} consultation claims {steps} × {grid.slotMinutes} minutes, so the whole block has to be free.
                </p>
              </div>
            )}

            {blocked && (
              <SafetyBanner severity="warning" title="That block is not free">
                {taken[0]?.token !== undefined
                  ? `Token ${taken[0].token} holds one of these slots. Pick a start before it, or one after the block it covers.`
                  : 'One of the slots in this block is taken. Pick another start.'}
              </SafetyBanner>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <Segmented
              name="booking-type"
              label="Type"
              value={type}
              onChange={setType}
              options={[
                { value: 'New', label: 'New' },
                { value: 'Follow-up', label: 'Follow-up' },
                { value: 'Report review', label: 'Report review' },
                { value: 'Procedure', label: 'Procedure' },
              ]}
            />
            <Segmented
              name="booking-priority"
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'Routine', label: 'Routine' },
                { value: 'Urgent', label: 'Urgent' },
                { value: 'Emergency', label: 'Emergency' },
              ]}
            />
            {priority === 'Emergency' && (
              <SafetyBanner severity="critical" title="Emergency booking">
                This takes the next free slot, not the one selected. Send the patient to the duty doctor first if they are not
                stable.
              </SafetyBanner>
            )}
            <SelectField
              label="Where the booking came from"
              name="booking-source"
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              options={[
                { value: 'Walk-in', label: 'Walk-in — at the desk' },
                { value: 'Phone', label: 'Phone' },
                { value: 'Online portal', label: 'Online portal' },
                { value: 'Follow-up', label: 'Follow-up of an earlier visit' },
              ]}
            />
            <TextAreaField
              label="Reason for the visit"
              name="booking-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              hint="In the patient's own words. It is what the doctor reads first."
            />
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['Patient', patient?.name ?? '—'],
                ['MRN', patientMrn ?? '—'],
                ['Doctor', `${doctor.name} · ${doctor.department}`],
                ['Room', grid?.room ?? doctor.room],
                ['Day', sheetDay],
                ['Time', start === null ? '—' : `${timeLabel(start)} (${steps * step_minutes} min)`],
                ['Type', type],
                ['Priority', priority],
                ['Source', source],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-border-subtle pb-1">
                  <dt className="text-text-secondary">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <SafetyBanner severity="info" title="What happens when you confirm">
              {note}
            </SafetyBanner>
            {reason.trim() !== '' && (
              <div>
                <p className="text-sm font-medium text-text-secondary">Reason</p>
                <p className="text-base">{reason}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
