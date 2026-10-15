'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Fingerprint, RadioTower, RefreshCcw, ShieldAlert, QrCode } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import { staffDirectory, type HrStaff } from '@/lib/hr';
import {
  DEVICE_RULES,
  LATE_GRACE_MIN,
  MAX_STINT_HOURS,
  PUNCH_KINDS,
  attendanceDay,
  checkPunch,
  type PunchCheck,
  type PunchKind,
} from '@/lib/attendance';

/* QR Code Attendance › Attendance (P7) — today as the readers saw it.
 *
 * The staff attendance register (a sub-screen of this one) is the month; this screen is the shift. It answers four
 * questions in the order a shift manager asks them: who is in, who is late, whose stint is still open, and what
 * happens when a reader is down. A correction here is a *manual override punch* with a supervisor's name and a
 * reason, passed through the same `checkPunch` the reader uses — so the register refuses a second out at 09:00 for
 * exactly the reason the door would have.
 */

export default function QrAttendancePage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const directory = useMemo(() => staffDirectory(day), [day]);
  const board = useMemo(() => attendanceDay(day, directory), [day, directory]);
  const [override, setOverride] = useState(false);
  const [draft, setDraft] = useState({ staffCode: '', state: 'Out' as 'In' | 'Out', time: '15:20', deviceId: board.devices[0]?.id ?? '', kind: 'Manual override' as PunchKind, supervisor: '', reason: '' });

  const staff: HrStaff | undefined = directory.find((s) => s.code === draft.staffCode);
  const device = board.devices.find((d) => d.id === draft.deviceId) ?? board.devices[0];
  const lastPunch = board.punches.filter((p) => p.staffCode === draft.staffCode).sort((a, b) => b.time.localeCompare(a.time))[0];
  const check: PunchCheck = useMemo(
    () =>
      checkPunch({
        staff,
        at: `${day} ${draft.time}`,
        device,
        kind: draft.kind,
        state: draft.state,
        ...(lastPunch ? { last: lastPunch } : {}),
        dayIso: day,
      }),
    [staff, device, draft, lastPunch, day],
  );

  const open = board.rows.filter((r) => r.open);
  const late = board.rows.filter((r) => r.lateMinutes > 0);
  const unpaired = board.punches.filter((p) => p.state === 'In' && !board.punches.some((q) => q.staffCode === p.staffCode && q.state === 'Out'));
  const offline = board.devices.filter((d) => !d.active);
  const readersWorking = board.devices.filter((d) => d.active).length;

  const record = () => {
    const fresh = checkPunch({ staff, at: `${day} ${draft.time}`, device, kind: draft.kind, state: draft.state, ...(lastPunch ? { last: lastPunch } : {}), dayIso: day });
    if (!fresh.ok) {
      push({ title: `The reader would refuse this punch — ${fresh.code}`, description: fresh.problem ?? '', tone: 'critical' });
      return;
    }
    if (!draft.supervisor.trim() || !draft.reason.trim()) {
      push({ title: 'A manual override carries a name and a reason', description: 'A punch nobody can be asked about is not evidence, and this one is standing in for a reader that did not record it.', tone: 'critical' });
      return;
    }
    const outcome = queueWrite(`${draft.kind} ${draft.state.toLowerCase()} for ${staff?.name ?? draft.staffCode} at ${draft.time}, recorded by ${draft.supervisor.trim()}`, {
      id: 'recordAttendancePunch',
      recordId: `${day}:${draft.staffCode}:${draft.state}`,
      fields: { staffCode: draft.staffCode, at: `${day} ${draft.time}`, state: draft.state, kind: draft.kind, deviceId: device?.id ?? '', verifiedBy: draft.supervisor.trim(), reason: draft.reason.trim() },
    });
    setOverride(false);
    push({
      title: outcome.queued ? `Punch recorded for ${staff?.name ?? draft.staffCode}` : 'Punch not queued',
      description: outcome.queued
        ? `It reaches the register when the queue drains, and the register holds the supervisor’s name beside it. The original punch, if there was one, stays where it is — a correction is a second record, never an edit.`
        : `This write does not queue here${outcome.because ? `: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="qr-attendance"
        subtitle={`${day} · ${readersWorking} of ${board.devices.length} readers reporting · the day as the readers saw it, not as a shift sheet remembers it.`}
        actions={
          <>
            <Link href="/admin/attendance/settings">
              <Button variant="ghost">
                <RadioTower className="size-4" aria-hidden /> Readers
              </Button>
            </Link>
            <Link href="/admin/staff/attendance">
              <Button variant="ghost">Month register</Button>
            </Link>
            <Button variant="primary" onClick={() => { setDraft({ staffCode: '', state: 'Out', time: '15:20', deviceId: board.devices[0]?.id ?? '', kind: 'Manual override', supervisor: '', reason: '' }); setOverride(true); }}>
              <RefreshCcw className="size-4" aria-hidden /> Correct a punch
            </Button>
          </>
        }
        waiting={offline.length ? `${offline.map((d) => d.label).join(', ')} has not reported since yesterday. Everyone punched in on it shows as unpaired until the day is corrected, and the payroll reads the register, not the reader.` : undefined}
      />

      <AdminSiblings screenId="qr-attendance" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Rostered" value={String(board.stats.rostered)} definition="Everyone the roster expects today at this branch, from the staff register rather than from a separate list." asOf={day} />
        <KpiTile label="Present" value={String(board.stats.present)} definition="Punched in with both halves of the stint recorded, or with the stint still open and the person still in the building." asOf={day} />
        <KpiTile label="Late" value={String(board.stats.late)} definition={`Past ${LATE_GRACE_MIN} minutes after the shift start. The register records the minutes rather than a tick, because three late marks are half a day.`} asOf={day} footnote={late.length ? late.map((r) => `${r.name} +${r.lateMinutes}`).join(', ') : undefined} />
        <KpiTile label="Absent" value={String(board.stats.absent)} definition="Rostered, no punch, no leave. The register refuses to call it a half day on its own: an absence is named as an exception and the shift manager answers for it." asOf={day} />
        <KpiTile label="Open stints" value={String(open.length)} definition="Punched in and not out. An open stint is somebody in the building — the readers cannot tell it apart from a forgotten punch, so the day screen shows it rather than guessing." asOf={day} footnote={open.length ? open.map((r) => r.name).join(', ') : undefined} />
        <KpiTile label="Unpaired" value={String(unpaired.length)} definition="An in with no matching out, which is what a reader that dies mid-shift leaves behind. The register names those days; it never writes a half day by itself." asOf={day} />
        <KpiTile label="Overtime" value={`${Math.floor(board.stats.overtimeMinutes / 60)}h ${board.stats.overtimeMinutes % 60}m`} definition="Counted in half hours from the first one, and approved before it is paid. The reader supplies the minutes; a person supplies the approval." asOf={day} footnote={board.stats.corrected ? `${board.stats.corrected} corrected today` : undefined} />
      </div>

      {board.stats.lateDevices > 0 && (
        <SafetyBanner severity="warning" title={`${board.stats.lateDevices} reader(s) not reporting`}>
          <ul className="list-disc space-y-1 pl-5">
            {offline.map((d) => (
              <li key={d.id}>
                <span className="font-medium">{d.label}</span> — last seen {d.lastSeen}. {d.note ?? 'Punches from a reader that is down are claims, not records: use the reader at the same door or correct the day.'}
              </li>
            ))}
          </ul>
        </SafetyBanner>
      )}

      <Panel title="The readers" actions={<Link href="/admin/attendance/settings" className="text-xs underline">Where they are and what they confirm</Link>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {board.devices.map((d) => (
            <div key={d.id} className={cx('rounded-md border px-3 py-2 text-sm', d.active ? 'border-border-subtle' : 'border-safety-critical/40 bg-safety-critical/5')}>
              <p className="flex items-center gap-1.5 font-medium text-text-primary">
                {d.kind === 'Biometric' ? <Fingerprint className="size-3.5" aria-hidden /> : d.kind === 'Face' ? <RadioTower className="size-3.5" aria-hidden /> : <QrCode className="size-3.5" aria-hidden />}
                {d.label}
              </p>
              <p className="text-text-secondary">{d.location}</p>
              <p className={cx('text-xs', d.active ? 'text-text-tertiary' : 'text-safety-critical')}>
                {d.kind} · last seen {d.lastSeen} {d.active ? '' : '— not reporting'}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Today, person by person" actions={<span className="text-xs text-text-secondary">{board.rows.length} rostered · {board.punches.length} punches</span>}>
        <ListView
          id="attendance-today"
          caption={`Attendance for ${day}`}
          rows={board.rows}
          rowId={(r) => r.staffCode}
          onRowClick={(r) => { setDraft({ staffCode: r.staffCode, state: 'Out', time: '15:20', deviceId: board.devices[0]?.id ?? '', kind: 'Manual override', supervisor: '', reason: '' }); setOverride(true); }}
          emptyLabel="Nobody is rostered today."
          columns={[
            { key: 'name', header: 'Name', render: (r) => (<span><span className="font-medium">{r.name}</span><span className="font-numeric block text-xs text-text-tertiary">{r.staffCode} · {r.designation}</span></span>) },
            { key: 'shift', header: 'Shift', width: '7rem' },
            { key: 'inAt', header: 'In', width: '6rem', render: (r) => <span className="font-numeric">{r.inAt ?? '—'}</span> },
            { key: 'outAt', header: 'Out', width: '6rem', render: (r) => <span className="font-numeric">{r.outAt ?? (r.open ? 'still in' : '—')}</span> },
            { key: 'hours', header: 'Hours', width: '6rem', align: 'right', numeric: true, render: (r) => (r.hours ? r.hours.toFixed(1) : '—') },
            { key: 'state', header: 'State', width: '8.5rem', render: (r) => (<span className={cx('font-medium', r.state === 'Present' ? 'text-safety-success' : r.state === 'Late' ? 'text-safety-warning' : r.state === 'Absent' ? 'text-safety-critical' : 'text-text-secondary')}>{r.state}</span>) },
            { key: 'lateMinutes', header: 'Late', width: '5.5rem', align: 'right', hideBelow: 'md', render: (r) => (r.lateMinutes ? `+${r.lateMinutes}m` : '') },
            { key: 'otMinutes', header: 'OT', width: '5.5rem', align: 'right', hideBelow: 'md', render: (r) => (r.otMinutes ? `${r.otMinutes}m` : '') },
            { key: 'punchKind', header: 'Reader', hideBelow: 'lg', render: (r) => r.punchKind ?? (r.state === 'Absent' ? 'no punch' : '—') },
          ]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="The punches, in the order the readers took them" actions={<span className="text-xs text-text-secondary">latest first</span>}>
          <ol className="space-y-1 text-sm">
            {board.punches.slice(-24).reverse().map((p) => (
              <li key={p.id} className="flex items-baseline gap-2 border-b border-border-subtle/60 py-1">
                <span className="font-numeric text-text-secondary">{p.time}</span>
                <span className={cx('rounded-sm px-1 text-xs', p.state === 'In' ? 'bg-safety-success/10 text-safety-success' : 'bg-surface-sunken text-text-secondary')}>{p.state}</span>
                <span className="font-medium text-text-primary">{p.staffName}</span>
                <span className="text-xs text-text-tertiary">{p.deviceLabel} · {p.kind}{p.lateMinutes ? ` · +${p.lateMinutes}m` : ''}</span>
              </li>
            ))}
            {board.punches.length === 0 && <li className="text-text-secondary">No punches today.</li>}
          </ol>
        </Panel>

        <Panel title="How a punch becomes a register line" actions={<span className="text-xs text-text-secondary">the QR check-in flow</span>}>
          <ol className="space-y-2 text-sm">
            {[
              ['The reader reads the shift code', 'The code is printed and stuck on a wall beside the reader, so it identifies the shift rather than the person. Anybody could photograph it.'],
              ['The person confirms who they are', `A PIN or a fingerprint. The register records which check was used, because “QR” on its own is a shift, not a person.`],
              ['The punch opens or closes a stint', `Two punches inside ${60} seconds are one punch. An in with no out is unpaired and stays visible until somebody corrects it.`],
              ['The register takes the day as it comes', `${LATE_GRACE_MIN} minutes of grace, then the minutes are recorded. Under ${4} hours is a half day; nobody is in this building for ${MAX_STINT_HOURS} hours.`],
              ['When a reader is down, a person corrects it', 'A manual override punch carries the supervisor’s name and a reason, and it is a second record rather than an edit. The original punch stays where it is.'],
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
      </div>

      <Panel title="What the readers and the register refuse" actions={<span className="text-xs text-text-secondary">{DEVICE_RULES.length} rules</span>}>
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

      {/* ---------------------------------------------------------------------------------------- a correction */}
      <Sheet
        open={override}
        onClose={() => setOverride(false)}
        title="Record a punch by hand"
        description="What a shift manager does when a reader is down, or when somebody’s out was never taken. The reader’s own verdict is checked first."
        width="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('mr-auto text-xs', check.ok ? 'text-safety-success' : 'text-safety-critical')}>
              {check.ok ? (check.code === 'manual' ? 'The reader would accept this as a manual override.' : 'The reader would accept this punch.') : `The reader would refuse this — ${check.code}.`}
            </span>
            <Button variant="ghost" onClick={() => setOverride(false)}>Cancel</Button>
            <Button variant="primary" onClick={record} disabled={!check.ok || !draft.supervisor.trim() || !draft.reason.trim()}>
              Record the punch
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <SafetyBanner
            severity={check.ok ? (check.code === 'manual' ? 'warning' : 'success') : 'critical'}
            title={check.ok ? (check.code === 'manual' ? 'A manual override: name and reason are both required' : 'The reader would take this punch') : `Refused — ${check.code}`}
          >
            {check.ok ? check.hint ?? 'The punch opens or closes a stint and the register holds it beside the reader’s own punches.' : `${check.problem ?? ''} ${check.hint ?? ''}`}
          </SafetyBanner>

          <FieldSection title="The punch" description="Read through the same checks the reader applies at the door.">
            <SelectField
              label="Person"
              name="punch-staff"
              value={draft.staffCode}
              onChange={(e) => setDraft({ ...draft, staffCode: e.target.value })}
              options={[{ value: '', label: 'Choose from the staff register' }, ...board.rows.map((r) => ({ value: r.staffCode, label: `${r.staffCode} · ${r.name} (${r.shift})` }))]}
              hint="Somebody on today’s roster. A punch for a person who is not rostered is a question about the roster, not about the reader."
            />
            <SelectField label="In or out" name="punch-state" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value as 'In' | 'Out' })} options={[{ value: 'In', label: 'In — opens a stint' }, { value: 'Out', label: 'Out — closes it' }]} hint="An out with no in pairs nothing, which the reader refuses and this screen refuses for the same reason." />
            <TextField label="Time" name="punch-time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} hint="The time the punch happened, as the supervisor read it from the person’s own account — not the time it is being typed." />
            <SelectField label="Reader" name="punch-device" value={draft.deviceId} onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })} options={board.devices.map((d) => ({ value: d.id, label: `${d.label} (${d.kind})${d.active ? '' : ' — not reporting'}` }))} hint="The reader this punch belongs to. A punch from a reader that is down is refused. The other reader at the same door is the answer." />
            <SelectField label="Kind" name="punch-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PunchKind })} options={PUNCH_KINDS.map((k) => ({ value: k, label: k }))} hint="Manual override is the honest label for a punch a person typed. It carries a name and a reason, which is what makes it checkable." />
            <TextField label="Supervisor" name="punch-supervisor" value={draft.supervisor} onChange={(e) => setDraft({ ...draft, supervisor: e.target.value })} hint="Who decided this. The person whose pay depends on the day can then ask a question about a name rather than about a number that changed." />
            <TextAreaField label="Reason" name="punch-reason" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} hint="What happened, in a sentence: the HDU reader was down from 21:14, the person was in the theatre the whole night, the badge was not read at the gate." rows={2} />
          </FieldSection>

          <Panel title="What the register will hold">
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>· {staff ? `${staff.name} (${staff.code})` : 'The person chosen'} at {draft.time}, recorded as a {draft.kind.toLowerCase()} punch from {device?.label ?? 'the reader'}.</li>
              <li>· The supervisor’s name and reason are stored with it. The register counts corrections by person, which is how a branch notices a door whose reader is always down.</li>
              <li>· {lastPunch ? `The last punch today was ${lastPunch.state.toLowerCase()} at ${lastPunch.time} on ${lastPunch.deviceLabel}.` : 'There is no punch today for this person, so an in would open the first stint of the day.'}</li>
              <li>· An in without an out stays unpaired at the end of the day. It is not a half day and it is not an absence: it is a day the shift manager answers for.</li>
              <li>· Payroll reads this register, so the correction has to be in before the month closes on the day-25 cut-off.</li>
            </ul>
          </Panel>
        </div>
      </Sheet>
    </div>
  );
}
