'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Fingerprint, QrCode, RadioTower, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { SettingScreenView } from '@/components/SettingScreenView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { settingByKey } from '@/lib/admin';
import { staffDirectory, type HrStaff } from '@/lib/hr';
import { DEVICES, DEVICE_RULES, attendanceDay, type Device, type PunchKind } from '@/lib/attendance';

/* QR Code Attendance › Settings (P7) — the readers.
 *
 * One question decides this screen: what confirms the person standing in front of the reader. A QR code is a
 * printed secret on a wall, so it identifies the shift; the PIN, the fingerprint or the face is what identifies
 * the person, and the register records which one was used. Enrolling a reader is therefore a clinical decision
 * as much as a technical one, and the enrolment carries the location, the shift it serves and what it confirms.
 *
 * Enrolment is written through the branch settings operation — a reader at a satellite branch is a branch
 * setting, and the reader table is what every punch is placed in a building by.
 */

const KINDS: PunchKind[] = ['QR', 'Biometric', 'Face', 'Manual override'];

export default function QrAttendanceSettingsPage() {
  const day = todayIso();
  const setting = settingByKey('attendance.readers');
  const { queueWrite } = useShell();
  const { push } = useToast();
  const directory = useMemo(() => staffDirectory(day), [day]);
  const board = useMemo(() => attendanceDay(day, directory), [day, directory]);
  const [extra, setExtra] = useState<Device[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [draft, setDraft] = useState({ label: '', location: '', kind: 'QR' as PunchKind, confirms: 'PIN', shift: 'All shifts', note: '' });

  const devices = useMemo(() => [...extra, ...DEVICES], [extra]);
  const punchesToday = (id: string) => board.punches.filter((p) => p.deviceId === id).length;
  const peopleToday = (id: string) => new Set(board.punches.filter((p) => p.deviceId === id).map((p) => p.staffCode)).size;

  const enrol = () => {
    if (!draft.label.trim() || !draft.location.trim()) {
      push({ title: 'A reader needs a label and a location', description: 'The label is what the guard and the shift report call it; the location is what places a punch in a building when the reader is asked about months later.', tone: 'critical' });
      return;
    }
    const device: Device = {
      id: `DEV-NEW-${extra.length + 1}`,
      label: draft.label.trim(),
      location: draft.location.trim(),
      kind: draft.kind,
      branch: 'Main Campus',
      active: true,
      lastSeen: 'never — enrolled today',
      ...(draft.note.trim() ? { note: `${draft.note.trim()}${draft.shift === 'All shifts' ? '' : ` Serves the ${draft.shift.toLowerCase()} shift.`}` } : {}),
    };
    setExtra((list) => [device, ...list]);
    setEnrolling(false);
    const outcome = queueWrite(`Enrol reader ${device.label} at ${device.location} (${device.kind}, confirms with ${draft.confirms})`, {
      id: 'updateBranchSetting',
      recordId: `attendance.readers:${device.id}`,
      fields: { branch: 'Main Campus', key: 'attendance.readers', deviceId: device.id, label: device.label, location: device.location, kind: device.kind, confirms: draft.confirms },
    });
    setDraft({ label: '', location: '', kind: 'QR', confirms: 'PIN', shift: 'All shifts', note: '' });
    push({
      title: outcome.queued ? `${device.label} enrolled` : `${device.label} not enrolled on this device`,
      description: outcome.queued
        ? `The reader joins the branch’s list and every punch it takes is placed by its location. A reader nobody enrolled is a punch nobody can place in a building.`
        : `A reader is a branch setting and the branch settings operation is online-only${outcome.because ? `: ${outcome.because}` : ''}. The reader is not on the list until it reaches the server.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="qr-settings"
        subtitle={`${day} · ${devices.length} reader(s) enrolled at Main Campus · ${devices.filter((d) => d.active).length} reporting.`}
        actions={
          <>
            <Link href="/admin/attendance">
              <Button variant="ghost">Today’s punches</Button>
            </Link>
            <Button variant="primary" onClick={() => setEnrolling(true)}>
              <RadioTower className="size-4" aria-hidden /> Enrol a reader
            </Button>
          </>
        }
        waiting={devices.some((d) => !d.active) ? 'A reader that stops reporting makes an absence on the register that the person did not take. The enrolment list says which one, and the shift manager corrects the days it covered.' : undefined}
      />

      <AdminSiblings screenId="qr-settings" />

      <Panel title="The readers, and what each one confirms" actions={<span className="text-xs text-text-secondary">{devices.length} enrolled · branch setting</span>}>
        <ListView
          id="readers"
          caption="Enrolled attendance readers"
          rows={devices}
          rowId={(d) => d.id}
          emptyLabel="No readers are enrolled for this branch."
          columns={[
            { key: 'label', header: 'Reader', render: (d) => (<span><span className="font-medium">{d.label}</span>{d.note && <span className="block text-xs text-text-tertiary">{d.note}</span>}</span>) },
            { key: 'location', header: 'Where', hideBelow: 'md' },
            { key: 'kind', header: 'Kind', width: '9rem', render: (d) => (<span className="inline-flex items-center gap-1">{d.kind === 'Biometric' ? <Fingerprint className="size-3.5" aria-hidden /> : d.kind === 'Face' ? <RadioTower className="size-3.5" aria-hidden /> : <QrCode className="size-3.5" aria-hidden />}{d.kind}</span>) },
            { key: 'confirms', header: 'Confirms the person by', hideBelow: 'md', render: (d) => (d.kind === 'QR' ? 'PIN entered at the reader' : d.kind === 'Biometric' ? 'Fingerprint' : d.kind === 'Face' ? 'Face match' : 'Supervisor’s name and reason') },
            { key: 'punchesToday', header: 'Punches today', width: '9rem', align: 'right', numeric: true, render: (d) => String(punchesToday(d.id)) },
            { key: 'peopleToday', header: 'People today', width: '9rem', align: 'right', hideBelow: 'lg', numeric: true, render: (d) => String(peopleToday(d.id)) },
            { key: 'lastSeen', header: 'Last seen', width: '11rem', render: (d) => <span className={cx(d.active ? 'text-text-secondary' : 'text-safety-critical')}>{d.lastSeen}</span> },
            { key: 'state', header: 'State', width: '8rem', render: (d) => (d.active ? <span className="text-safety-success">reporting</span> : <span className="text-safety-critical">not reporting</span>) },
          ]}
        />
      </Panel>

      {devices.some((d) => !d.active) && (
        <SafetyBanner severity="critical" title="A reader is not reporting, and the register shows its people as unpaired">
          {devices.filter((d) => !d.active).map((d) => `${d.label} (last seen ${d.lastSeen})`).join(', ')}. The punches it took are still records: what is missing is the
          other half of the pair. The shift manager corrects those days through a manual override punch with their name against it, and the reader is fixed rather than
          quietly forgotten.
        </SafetyBanner>
      )}

      {setting && <SettingScreenView screen={setting} />}

      <Panel title="What a reader is allowed to decide, and what it is not" actions={<span className="text-xs text-text-secondary">{DEVICE_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {DEVICE_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Sheet
        open={enrolling}
        onClose={() => setEnrolling(false)}
        title="Enrol a reader"
        description="A reader is enrolled by the branch with its location and what it confirms. A punch nobody can place in a building is a claim, not a record."
        width="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnrolling(false)}>Cancel</Button>
            <Button variant="primary" onClick={enrol} disabled={!draft.label.trim() || !draft.location.trim()}>Enrol</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <FieldSection title="The reader" description="Where it is, and what it confirms about the person standing in front of it.">
            <TextField label="Label" name="reader-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} hint="What the guard and the shift report call it: “Maternity corridor reader”, “Back gate reader”." />
            <TextField label="Location" name="reader-location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} hint="A place in this building. Months later, the location is the only thing that tells a reviewer where a punch was taken." />
            <SelectField label="Kind" name="reader-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PunchKind })} options={KINDS.filter((k) => k !== 'Manual override').map((k) => ({ value: k, label: k }))} hint="QR, fingerprint or face. The hardware is the branch’s choice; what the register records is which check was used." />
            <SelectField label="Confirms the person by" name="reader-confirms" value={draft.confirms} onChange={(e) => setDraft({ ...draft, confirms: e.target.value })} options={['PIN', 'Fingerprint', 'Face match', 'Nothing — QR only'].map((k) => ({ value: k, label: k }))} hint="A QR code on a wall identifies the shift, not the person. “Nothing” is a setting a branch may choose, and the register then says plainly that the punch is a shift code." />
            <SelectField label="Shift it serves" name="reader-shift" value={draft.shift} onChange={(e) => setDraft({ ...draft, shift: e.target.value })} options={['All shifts', 'Morning', 'Evening', 'Night'].map((k) => ({ value: k, label: k }))} hint="A reader in a corridor serves whoever walks past it. One at a ward door serves the shift that door belongs to." />
            <TextAreaField label="Note" name="reader-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} hint="Anything the next person to look at this reader needs: a door that is locked at night, a corridor that is used by visitors after hours." rows={2} />
          </FieldSection>
          <Panel title="What happens next">
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>· The reader joins the branch’s list and the next punch it takes is placed by its location.</li>
              <li>· {board.punches.length} punch(es) were taken today across {devices.filter((d) => d.active).length} reader(s); the enrolment changes nothing about them.</li>
              <li>· Staff whose badge is not enrolled with the new reader are asked to use the reader at the door they normally use, rather than a punch being typed in.</li>
              <li>· {draft.confirms === 'Nothing — QR only' ? 'With nothing confirming the person, every punch from this reader is a shift code: the register will say so on each line, and a dispute about a late mark becomes a dispute about a wall.' : `Each punch is recorded as ${draft.kind.toLowerCase()} with ${draft.confirms.toLowerCase()} confirming the person.`}</li>
            </ul>
          </Panel>
        </div>
      </Sheet>
    </div>
  );
}
