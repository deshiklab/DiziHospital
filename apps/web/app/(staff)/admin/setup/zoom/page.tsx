'use client';

import Link from 'next/link';
import { Button, Panel, SafetyBanner } from '@dizi/ui';
import { Info, Lock, Video } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { SettingScreenView } from '@/components/SettingScreenView';
import { settingByKey } from '@/lib/admin';
import { todayIso } from '@/lib/appointments';

/* Setup › Zoom Setting (P7) — telemedicine rooms.
 *
 * A telemedicine room is a consultation, so the two settings that matter are not the account number and not the
 * recording format: they are the waiting room and the passcode. Without them the second appointment hears the
 * first, and a link without a passcode reaches a WhatsApp group. Both defaults here are the safe ones and both
 * say why.
 *
 * The consent sentence is a setting rather than a checkbox, because a recorded room needs the patient's consent
 * on the record beside it — the module that writes that record is the audit ledger, and a recording without a
 * consent beside it is an incident rather than a file.
 */

export default function SetupZoomPage() {
  const day = todayIso();
  const setting = settingByKey('zoom.telemedicine');
  const field = (key: string) => setting?.fields.find((f) => f.key === key);
  const consentLine = String(field('consentLine')?.value ?? '');
  const autoRecord = String(field('autoRecord')?.value ?? 'Off');
  const waitingRoom = String(field('waitingRoom')?.value ?? 'true') === 'true';
  const passcode = String(field('passwordRequired')?.value ?? 'true') === 'true';
  const maxMinutes = Number(field('maxMinutes')?.value ?? 20);

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="setup-zoom"
        subtitle="The account the branch joins with, what is recorded, and what the patient is told before the room opens."
        actions={
          <>
            <Link href="/appointments">
              <Button variant="ghost">Appointment list</Button>
            </Link>
            <Link href="/admin/setup/appointment">
              <Button variant="ghost">Booking rules</Button>
            </Link>
          </>
        }
      />

      <AdminSiblings screenId="setup-zoom" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="What the patient sees, in order" actions={<span className="text-xs text-text-secondary">before the room opens</span>}>
          <ol className="space-y-2 text-sm">
            {[
              ['A link, sent once', 'The link goes out with the appointment reminder on the route the patient chose. It is a room, not a meeting invitation: it works on a phone browser without an account.'],
              [passcode ? 'A passcode, asked for before the room' : 'No passcode — the link is the room', passcode ? 'The patient types the six digits from the same message as the link. A forwarded link without the code opens a lobby rather than a consultation.' : 'With no passcode, anybody holding the forwarded link can join. The screen leaves the setting off only because the branch chose it, and it says so on every room’s record.'],
              [waitingRoom ? 'A waiting room, with the doctor’s name on it' : 'Straight into the room', waitingRoom ? 'The second patient cannot hear the first. They wait where the room can see them, which is the difference between a queue and an overheard consultation.' : 'Without a waiting room the next appointment hears the previous consultation. That is a confidentiality incident and not a settings problem.'],
              [autoRecord === 'Off' ? 'Nothing recorded' : autoRecord === 'With consent recorded' ? 'Recorded only if they agree' : 'Recorded always', autoRecord === 'Off' ? 'The room is not recorded at all, and the consultation record is what the clinician writes afterwards.' : `${consentLine} ${autoRecord === 'Always' ? 'Recording always is a branch decision and the ledger holds the consent beside the file — where there is no consent, the file is an incident.' : 'The consent is stored with the recording, in the ledger, before the file is written.'}`],
              [`The room closes after ${maxMinutes} minutes`, 'A telemedicine slot is shorter than a physical one. The room closing is what ends it, rather than the next patient knocking or the clinician deciding.'],
            ].map(([title, because], i) => (
              <li key={title} className="flex gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 font-numeric text-xs text-brand-700">{i + 1}</span>
                <span>
                  <span className="block font-medium text-text-primary">{title}</span>
                  <span className="block text-text-secondary">{because}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="How the room behaves while it runs" actions={<Video className="size-4 text-text-tertiary" aria-hidden />}>
          <ul className="space-y-2 text-sm">
            {[
              ['Participants', `${Number(field('maxParticipants')?.value ?? 3)} — the patient, the clinician, and whoever the patient brings. An interpreter is one of the three rather than a fourth.`],
              ['Interpreters', String(field('interpreterNotes')?.value ?? '') || 'No guidance recorded for interpreters, which is how two branches end up running the same room differently.'],
              ['Mute on entry', String(field('muteOnEntry')?.value ?? 'true') === 'true' ? 'On. An unmuted join turns a quiet room into a waiting hall.' : 'Off. Every join is heard by everyone already in the room.'],
              ['Chat', String(field('chat')?.value ?? 'true') === 'true' ? 'On, and part of the consultation record. It is used for an address, a prescription number or a spelling.' : 'Off. Nothing is typed, so nothing is in the record — which is the point, and also the cost.'],
              ['Screen sharing', String(field('screenShare')?.value ?? 'true') === 'true' ? 'Available, and off by default inside the room: it is how a report is shown and also how a whole desktop is shown by accident.' : 'Off. The clinician reads the report out rather than putting it on the screen.'],
              ['Default host', String(field('hostEmail')?.value ?? '') || 'not set — a room with no host is a lobby with a clinician’s name on it'],
            ].map(([title, because]) => (
              <li key={title} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">{title}</p>
                <p className="text-text-secondary">{because}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {(!waitingRoom || !passcode) && (
        <SafetyBanner severity="critical" title="A confidentiality setting is off">
          {!waitingRoom && !passcode
            ? 'There is no waiting room and no passcode: anybody with the link joins a consultation, and the next appointment may hear the previous one.'
            : !waitingRoom
              ? 'The waiting room is off, so a patient joining early sits in the same room as the consultation in progress.'
              : 'There is no passcode, so a forwarded link is a consultation anybody may join.'}{' '}
          Both defaults are the safe ones, and the branch record says who turned them off and when.
        </SafetyBanner>
      )}

      {autoRecord !== 'Off' && (
        <SafetyBanner severity="warning" title={`Recording is set to “${autoRecord}”`}>
          Every recorded room needs the patient’s consent stored beside the recording in the ledger. The sentence below is what they hear or read before the room opens, and it is
          the branch’s words rather than the software’s.
          <blockquote className="mt-1 border-l-2 border-brand-300 pl-2 italic">{consentLine}</blockquote>
        </SafetyBanner>
      )}

      {setting && <SettingScreenView screen={setting} />}

      <Panel title="What has to be true before a room is opened" actions={<Lock className="size-4 text-text-tertiary" aria-hidden />}>
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>· The account identifier lives here and the secret lives in the key store: a screen that shows a secret is a screen that leaks one in a screenshot.</li>
          <li>· A room is opened for an appointment that exists, against a clinician who is rostered. A room opened by hand is a consultation with no record behind it.</li>
          <li>· The consultation note is written into the same clinical record as a physical visit, so a follow-up reads the telemedicine visit and the chamber visit in one list.</li>
          <li>· A patient who cannot join is recorded as an attempted consultation rather than a no-show: a failed connection is not the patient’s absence.</li>
          <li>· Nothing here sends anything. The portal that will carry the join link arrives in P8, and until then a room is opened from the appointment list by the desk.</li>
        </ul>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> The screen keeps the account identifier and never the secret; the rooms themselves are outside this build, which is why the setting says so at the point
          where somebody would turn telemedicine on for {day}.
        </p>
      </Panel>
    </div>
  );
}
