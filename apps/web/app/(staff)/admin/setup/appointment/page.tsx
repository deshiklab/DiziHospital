'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Button, Panel, SafetyBanner } from '@dizi/ui';
import { CalendarClock, Info } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { SettingScreenView } from '@/components/SettingScreenView';
import { settingByKey } from '@/lib/admin';
import { todayIso } from '@/lib/appointments';
import { addDays } from '@/lib/calendar';

/* Setup › Appointment (P7) — the rules the online booking page obeys.
 *
 * The page is the one screen in the product with no member of staff in front of it, so every rule it has must be
 * configuration rather than code: how far ahead it offers, how close to the slot it closes, how many bookings one
 * patient may hold, and what happens when somebody does not turn up. The preview below is worked out from the
 * settings *as they are on the screen*, which is the only way an administrator can see what they changed.
 *
 * Nothing here books anything. A branch that offers telemedicine slots before the patient portal exists is
 * promising a link somebody would have to send by hand, and the setting says so where it is turned on.
 */

export default function SetupAppointmentPage() {
  const day = todayIso();
  const setting = settingByKey('appointment.online');

  const value = (key: string, fallback: number | string | boolean) => setting?.fields.find((f) => f.key === key)?.value ?? fallback;
  const slotMinutes = Number(value('slotMinutes', 15));
  const daysAhead = Number(value('daysAhead', 14));
  const cutoffMinutes = Number(value('cutoffMinutes', 120));
  const perPatient = Number(value('perPatient', 2));
  const noShowAfter = Number(value('noShowFlagAfter', 15));

  const window = useMemo(() => {
    const lastBookable = addDays(day, daysAhead);
    const slotsPerHour = Math.round(60 / slotMinutes);
    const chamberStart = 9 * 60;
    const chamberEnd = 13 * 60;
    const slots = Array.from({ length: Math.floor((chamberEnd - chamberStart) / slotMinutes) }, (_, i) => {
      const minutes = chamberStart + i * slotMinutes;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    });
    return { lastBookable, slotsPerHour, slots };
  }, [day, daysAhead, slotMinutes]);

  const selfBookCutoff = (slot: string) => {
    const minutes = Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5)) - cutoffMinutes;
    const hh = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
    const mm = ((minutes % 60) + 60) % 60;
    const dayShift = minutes < 0 ? 'the day before' : 'the same morning';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${dayShift}`;
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="setup-appointment"
        subtitle="What the patient-facing booking page may do, and what it must refuse — the one screen in the product with nobody in front of it."
        actions={
          <>
            <Link href="/appointments">
              <Button variant="ghost">See the day list</Button>
            </Link>
            <Link href="/queue">
              <Button variant="ghost">See the queue</Button>
            </Link>
          </>
        }
      />

      <AdminSiblings screenId="setup-appointment" />

      <div className="rounded-lg border border-border-subtle bg-surface-default p-4">
        <p className="flex items-start gap-2 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
          <span>
            With these settings, a patient booking online on <span className="font-numeric">{day}</span> may book up to{' '}
            <span className="font-numeric font-medium">{window.lastBookable}</span> — {daysAhead} days ahead — against a grid of{' '}
            <span className="font-numeric">{slotMinutes}</span>-minute slots, <span className="font-numeric">{window.slotsPerHour}</span> an hour. They may hold{' '}
            <span className="font-numeric">{perPatient}</span> live booking(s). The desk marks a no-show <span className="font-numeric">{noShowAfter}</span> minutes after the slot.
          </span>
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="A morning chamber, as the page offers it" actions={<span className="text-xs text-text-secondary">derived from the slot length</span>}>
          <p className="mb-2 text-xs text-text-secondary">
            The last self-service booking minute is {cutoffMinutes} minutes before the slot. Inside that window the desk books, because at that point somebody has to answer the phone.
          </p>
          <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
            {window.slots.map((slot) => (
              <li key={slot} className="rounded-md border border-border-subtle px-2 py-1">
                <span className="font-numeric font-medium">{slot}</span>
                <span className="block text-xs text-text-tertiary">book by {selfBookCutoff(slot)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-tertiary">
            A slot is offered against the doctor’s published roster. Beyond that the page offers nothing rather than offering something the branch cannot confirm.
          </p>
        </Panel>

        <Panel title="What the page refuses, and what it says" actions={<span className="text-xs text-text-secondary">the patient’s words, not the system’s</span>}>
          <ul className="space-y-2 text-sm">
            {[
              [`More than ${perPatient} live bookings`, `“You already have ${perPatient} appointment(s) booked. Please attend one or cancel it before booking another.” A cap published on the page is predictable; a refusal at the desk is not.`],
              [`A slot inside ${cutoffMinutes} minutes`, '“This slot is too soon to book online. Please call the desk, or choose a later time.” The desk can see the queue; the page cannot.'],
              [`A date beyond ${daysAhead} days`, '“Bookings open 14 days ahead. The clinic’s schedule for that date is not published yet.” A booking beyond the roster is a promise somebody has to break later.'],
              [`A phone number that is not there`, '“A mobile number is needed so the clinic can reach you if the doctor is called away.” The one thing the desk cannot fix after the fact.'],
              [`Five minutes after the slot`, `“Your appointment is still held. If you cannot attend, mark it cancelled — you will not be charged.” The no-show flag exists to make the list honest, not to charge anybody.`],
            ].map(([title, line]) => (
              <li key={title} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">{title}</p>
                <p className="text-text-secondary">{line}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {String(value('telemedicine', false)) === 'true' && (
        <SafetyBanner severity="warning" title="Telemedicine slots are bookable online">
          The patient portal arrives in P8. Until then an online video slot is a link somebody sends by hand, and the branch is promising a room it cannot open. The setting is
          on and the reason to turn it off is written here rather than in a meeting note.
        </SafetyBanner>
      )}

      {setting && <SettingScreenView screen={setting} />}

      <Panel title="What has to be true for these rules to hold" actions={<Info className="size-4 text-text-tertiary" aria-hidden />}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>· The roster is published at least as far ahead as the page offers: otherwise a confirmed booking is one the branch has to move.</li>
          <li>· The nurse-led and consultant clinics share one slot grid, so a patient who books either one holds one slot rather than two.</li>
          <li>· The queue reads the same serial the page issued, so the patient who booked at midnight is in the queue in the order they booked.</li>
          <li>· A cancelled booking releases its slot immediately. A slot held by a patient who has cancelled is a slot the desk cannot give to anybody at the counter.</li>
        </ul>
      </Panel>
    </div>
  );
}
