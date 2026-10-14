'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, SafetyBanner, SelectField, TextAreaField, TextField } from '@dizi/ui';
import { useShell } from '@/lib/shell';
import { todayIso } from '@/lib/appointments';
import { t } from '@/lib/nav';
import { patients } from '@/lib/mock';

/* Patient registration (legacy screen 001 — a 19-field modal).
 *
 * Design decisions taken here, straight from the plan:
 *  - five titled sections instead of one wall of 19 fields (02 §6 #2)
 *  - duplicate detection on the identity block *before* saving, not after (07 day-21 demo)
 *  - scanner-ready fields: the barcode scanner is a keyboard wedge, so focus lands on MRN/ID
 *  - offline: the form queues locally and says so, rather than claiming success (02 §11 rule 1)
 */
/** `YYYY-MM-DD HH:MM` — the stamp the outbox uses. Read when the write happens, never while rendering. */
const stampNow = (): string => {
  const now = new Date();
  return `${todayIso()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

export default function RegisterPatientPage() {
  const { syncEngine, sync } = useShell();
  const [values, setValues] = useState({
    name: '', nameBn: '', age: '', sex: '', phone: '', nationalId: '', address: '',
    guardianName: '', guardianPhone: '', payer: '', allergies: '', notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ queued: boolean; mrn: string; refused?: string } | null>(null);

  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  // Duplicate detection runs against the same fields the legacy system uses, plus national ID.
  const duplicates = values.phone.length >= 6
    ? patients.filter((p) => p.phone === values.phone || (values.nationalId && p.mrn.endsWith(values.nationalId.slice(-4)))).slice(0, 3)
    : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = 'Name is required';
    if (!values.age || Number(values.age) < 0 || Number(values.age) > 130) next.age = 'Enter an age between 0 and 130';
    if (!values.sex) next.sex = 'Select sex';
    if (!/^01[3-9]\d{8}$/.test(values.phone)) next.phone = 'Enter an 11-digit mobile number (01XXXXXXXXX)';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const mrn = `SH-${String(102_300 + patients.length).padStart(6, '0')}`;
    const offline = sync === 'queued' || sync === 'lanOnly';
    if (offline) {
      // P0-306: the screen names the operation, and the contract decides the entity, the conflict policy and the
      // kind of write. If the contract ever says registration cannot be queued, this screen says so rather than
      // queueing something the API will refuse when the uplink returns.
      const outcome = syncEngine.queueOperation('createPatient', {
        at: stampNow(),
        recordId: mrn,
        label: `Register ${values.name}`,
        fields: { name: values.name, phone: values.phone, sex: values.sex },
        actor: 'Reception',
        node: 'OPD desk',
      });
      if (!outcome.queued) {
        // Refused by the contract: nothing was queued and nothing was saved, so the screen says exactly that
        // instead of showing a success banner over a write that does not exist.
        setOutcome({ queued: false, mrn, refused: outcome.because });
        return;
      }
      setOutcome({ queued: true, mrn });
      return;
    }
    setOutcome({ queued: false, mrn });
  };

  if (outcome?.refused) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <SafetyBanner severity="critical" title="Not saved — this one cannot be queued offline">
          {outcome.refused} The provisional MRN <span className="font-numeric">{outcome.mrn}</span> was not issued and
          nothing was written.
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => setOutcome(null)}>Try again when the uplink is back</Button>
            <Link href="/patients">
              <Button variant="ghost">Back to patients</Button>
            </Link>
          </div>
        </SafetyBanner>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <SafetyBanner severity={outcome.queued ? 'warning' : 'success'} title={outcome.queued ? t('sync.savedHere', 'en') : t('sync.savedServer', 'en')}>
          {outcome.queued ? (
            <>
              {t('sync.savedHereNote', 'en')} The provisional MRN is <span className="font-numeric">{outcome.mrn}</span>; it will be
              confirmed by the server. Print the slip now — printing works offline.
            </>
          ) : (
            <>
              Patient registered with MRN <span className="font-numeric">{outcome.mrn}</span>.
            </>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="primary">Print registration slip</Button>
            <Button>Register another</Button>
            <Link href="/patients">
              <Button variant="ghost">Back to patients</Button>
            </Link>
          </div>
        </SafetyBanner>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Register patient</h1>
        <Link href="/patients">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      {duplicates.length > 0 && (
        <SafetyBanner severity="warning" title="This number is already registered" requiresAcknowledgement={false}>
          {duplicates.map((d) => (
            <span key={d.mrn} className="mr-3 font-numeric text-sm">
              {d.name} · {d.mrn} · {d.phone}
            </span>
          ))}
          <p className="mt-1 text-sm">Open the existing record instead of creating a duplicate.</p>
        </SafetyBanner>
      )}

      <FieldSection title="Identity" description="Scanned national ID fills name, date of birth and address where available.">
        <TextField label="Full name" name="name" value={values.name} onChange={set('name')} error={errors.name} required autoFocus />
        <TextField label="Name in Bangla" name="nameBn" value={values.nameBn} onChange={set('nameBn')} hint="Used on Bangla prescriptions and labels" />
        <TextField label="National ID / birth certificate" name="nationalId" value={values.nationalId} onChange={set('nationalId')} hint="Scan the document, or type it" />
        <TextField label="Age" name="age" value={values.age} onChange={set('age')} error={errors.age} required inputMode="numeric" />
        <SelectField
          label="Sex"
          name="sex"
          value={values.sex}
          onChange={set('sex')}
          error={errors.sex}
          required
          placeholder="Select"
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </FieldSection>

      <FieldSection title="Contact" description="Mobile number is the primary identifier for follow-up and results.">
        <TextField label="Mobile" name="phone" value={values.phone} onChange={set('phone')} error={errors.phone} hint="01XXXXXXXXX" required inputMode="tel" />
        <TextField label="Address" name="address" value={values.address} onChange={set('address')} className="md:col-span-2" />
      </FieldSection>

      <FieldSection title="Guardian / next of kin" description="Required for patients under 18 and for unconscious admissions.">
        <TextField label="Guardian name" name="guardianName" value={values.guardianName} onChange={set('guardianName')} />
        <TextField label="Guardian mobile" name="guardianPhone" value={values.guardianPhone} onChange={set('guardianPhone')} inputMode="tel" />
        <SelectField
          label="Payer"
          name="payer"
          value={values.payer}
          onChange={set('payer')}
          placeholder="Self pay"
          options={[
            { value: 'self', label: 'Self pay' },
            { value: 'corporate', label: 'Corporate' },
            { value: 'insurance', label: 'Insurance' },
            { value: 'govt', label: 'Government scheme' },
          ]}
        />
      </FieldSection>

      <FieldSection title="Clinical flags" description="Allergies recorded here appear on every screen that touches this patient.">
        <TextField label="Known allergies" name="allergies" value={values.allergies} onChange={set('allergies')} hint="Comma separated; leave blank if none known" className="md:col-span-2" />
        <TextAreaField label="Notes" name="notes" value={values.notes} onChange={set('notes')} className="md:col-span-3" />
      </FieldSection>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary">
          Save patient
        </Button>
        <Button type="button" variant="ghost">
          Save &amp; register another
        </Button>
        <p className="text-sm text-text-tertiary">
          {sync === 'live' ? 'Saved to the hospital server.' : `Connection: ${sync} — the record will be saved on this device first.`}
        </p>
      </div>
    </form>
  );
}
