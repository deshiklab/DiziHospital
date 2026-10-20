'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  KpiTile,
  Panel,
  Segmented,
  Sheet,
  Tabs,
  cx,
  useToast,
  type Column,
} from '@dizi/ui';
import { CalendarClock, ClipboardCheck, Users } from 'lucide-react';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  COMPETENCIES,
  HANDOVER_MIN,
  MAX_CONSECUTIVE_NIGHTS,
  MIN_REST_HOURS,
  SHIFT_WINDOW,
  dutyDay,
  onFloor,
  requiredNurses,
  requiredSkills,
  restCheck,
  type Competency,
  type CoverageLine,
  type DutyRole,
  type HandoverItem,
  type Shift,
  type StaffMember,
} from '@/lib/duty';

/* Duty roster and handover (legacy screens 051/052 — the printed roster and the corridor handover — replaced)
 * — the P5 sub-screen.
 *
 * A roster is arithmetic before it is a conversation, and this screen does the arithmetic: coverage against the
 * ratio each ward was built for, the skill each shift must have, rest between shifts, consecutive nights, and
 * whether handover was actually taken. A gap is a number with a ward, a shift and a skill on it.
 *
 * The doctor's round screen lives at /round and reads the same roster, because who is on the floor decides who
 * sees which patient at 08:00.
 *
 * Preview: the roster is synthetic and nothing survives a reload. The rules do.
 */

const TONE_TEXT: Record<string, string> = {
  critical: 'text-safety-critical',
  warning: 'text-safety-warning',
  info: 'text-brand-600',
  success: 'text-safety-success',
  neutral: 'text-text-secondary',
};

const BAND_CHIP: Record<HandoverItem['band'], string> = {
  Emergency: 'bg-safety-critical/10 text-safety-critical',
  Escalate: 'bg-safety-warning/10 text-safety-warning',
  Watch: 'bg-brand-50 text-brand-700',
  Routine: 'bg-surface-sunken text-text-secondary',
};

const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];

export default function DutyPage() {
  const { sync, syncEngine } = useShell();
  const { push } = useToast();
  const day = todayIso();

  const [roster, setRoster] = useState(() => dutyDay(day));
  const [tab, setTab] = useState('coverage');
  const [shift, setShift] = useState<Shift>('Evening');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [handoverOpen, setHandoverOpen] = useState<string | null>(null);

  const person = roster.staff.find((s) => s.id === staffId) ?? null;
  const item = roster.handover.find((h) => h.patient === handoverOpen) ?? null;
  const rosterableStaff = useMemo(
    () => roster.staff.filter((s) => s.role.includes('nurse') || s.role === 'Midwife' || s.role === 'Consultant' || s.role === 'Registrar' || s.role === 'Intern'),
    [roster.staff],
  );

  const takeHandover = (h: HandoverItem, by: string) => {
    setRoster((r) => ({
      ...r,
      handover: r.handover.map((x) => (x.patient === h.patient ? { ...x, takenBy: by, at: `${day}T14:${String(5 + r.handover.indexOf(h) * 4).padStart(2, '0')}` } : x)),
      stats: { ...r.stats, handoversTaken: r.stats.handoversTaken + (h.takenBy ? 0 : 1), handoversPending: Math.max(0, r.stats.handoversPending - (h.takenBy ? 0 : 1)) },
    }));
    push({ title: `Handover taken for ${h.patient.split(' · ')[0]} by ${by}. The sick patients are first, which is why this one was at the top.`, tone: 'success' });
  };

  const coverageColumns: Array<Column<CoverageLine>> = [
    { key: 'ward', header: 'Ward', width: '170px', render: (l) => l.ward.name },
    { key: 'shift', header: 'Shift', width: '120px', render: (l) => `${l.shift} · ${SHIFT_WINDOW[l.shift].start}–${SHIFT_WINDOW[l.shift].end}` },
    { key: 'required', header: 'Built for', numeric: true, align: 'right', width: '90px' },
    { key: 'present', header: 'On the roster', numeric: true, align: 'right', width: '110px' },
    { key: 'gap', header: 'Gap', numeric: true, align: 'right', width: '110px', render: (l) => (
      <span className={cx('font-medium', l.gap > 0 ? TONE_TEXT.critical : TONE_TEXT.success)}>{l.gap > 0 ? `short ${l.gap}` : 'covered'}</span>
    ) },
    { key: 'missingSkills', header: 'Skill on the shift', width: '260px', render: (l) => (
      l.missingSkills.length === 0
        ? <span className={TONE_TEXT.success}>every required skill is held</span>
        : <span className={cx('font-medium', TONE_TEXT.warning)}>missing {l.missingSkills.join(', ')}</span>
    ) },
    { key: 'seniorPresent', header: 'Seniors', width: '190px', render: (l) => (
      <span className={cx(l.seniorPresent ? TONE_TEXT.success : TONE_TEXT.warning)}>
        {l.seniorPresent ? 'senior nurse' : 'no senior nurse'}
        {l.doctorPresent ? ' · doctor' : ' · no doctor'}
      </span>
    ) },
  ];

  const staffColumns: Array<Column<StaffMember>> = [
    { key: 'name', header: 'Name', width: '150px' },
    { key: 'role', header: 'Designation', width: '150px' },
    { key: 'wardId', header: 'Home ward', hideBelow: 'md', width: '120px', render: (s) => s.wardId === 'float' ? 'float' : s.wardId },
    { key: 'weekHours', header: 'Hours this week', numeric: true, align: 'right', width: '130px', render: (s) => (
      <span className={cx(s.weekHours >= 48 ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{s.weekHours} h</span>
    ) },
    { key: 'nightsInARow', header: 'Nights in a row', numeric: true, align: 'right', width: '130px', render: (s) => (
      <span className={cx(s.nightsInARow >= MAX_CONSECUTIVE_NIGHTS ? TONE_TEXT.warning : TONE_TEXT.neutral)}>{s.nightsInARow}</span>
    ) },
    { key: 'competencies', header: 'Competencies', hideBelow: 'lg', render: (s) => s.competencies.join(' · ') },
    { key: 'phone', header: 'Phone', hideBelow: 'xl', width: '150px' },
    { key: 'onLeave', header: 'Leave', width: '150px', render: (s) => s.onLeave ? <span className={TONE_TEXT.neutral}>{s.onLeave.kind}</span> : <span className="text-text-tertiary">—</span> },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <CalendarClock className="size-5 text-brand-600" aria-hidden />
            Duty roster
          </h1>
          <p className="text-sm text-text-secondary">
            Coverage, skills and handover for {day}. {syncEngine.summary.pending > 0 ? `${syncEngine.summary.pending} entr${syncEngine.summary.pending === 1 ? 'y' : 'ies'} waiting to sync.` : 'Everything is synced.'}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="On duty now" value={String(roster.stats.onDuty)} definition={`People rostered on the ${shift.toLowerCase()} shift (${SHIFT_WINDOW[shift].start}–${SHIFT_WINDOW[shift].end}), doctors and nurses together.`} asOf={day} />
        <KpiTile label="Nurses on the floor" value={String(roster.stats.nursesOnDuty)} definition="Nurses and midwives, the population the ward nursing ratio is about." asOf={day} />
        <KpiTile label="Coverage gaps" value={String(roster.stats.gaps)} definition="Ward-shifts today where nurses on the roster are below what the ward was built for. A gap counts once per ward and shift." asOf={day} />
        <KpiTile label="Skills missing" value={String(roster.stats.missingSkills)} definition="Ward-shifts missing a required competency — ACLS, a controlled-drug witness, neonatal resuscitation. A fourth nurse without the skill does not close this gap." asOf={day} />
        <KpiTile label="Handover taken" value={`${roster.stats.handoversTaken} / ${roster.handover.length}`} definition="Handovers recorded as taken by the incoming shift; the rest are verbally outstanding and are listed sick-patient-first." asOf={day} />
        <KpiTile label="Rest-rule conflicts" value={String(roster.stats.restBlocks)} definition={`Roster lines the rules refuse: under ${MIN_REST_HOURS} hours of rest, more than ${MAX_CONSECUTIVE_NIGHTS} consecutive nights, or over 48 hours in the week.`} asOf={day} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'coverage', label: 'Coverage', count: roster.stats.gaps || undefined },
          { id: 'handover', label: 'Handover', count: roster.stats.handoversPending || undefined },
          { id: 'people', label: 'People', count: roster.staff.length },
          { id: 'rules', label: 'The rules' },
        ]}
      />

      {tab === 'coverage' && (
        <div className="space-y-3">
          <Panel
            title="Coverage against what each ward was built for"
            actions={
              <Segmented
                name="duty-shift"
                label="Shift"
                value={shift}
                onChange={(v) => setShift(v as Shift)}
                options={SHIFTS.map((s) => ({ value: s, label: `${s} · ${SHIFT_WINDOW[s].start}–${SHIFT_WINDOW[s].end}` }))}
              />
            }
          >
            <ListView
              id="duty-coverage"
              caption="Coverage against the ward ratio, by ward for the selected shift"
              rows={roster.coverage.filter((l) => l.shift === shift)}
              columns={coverageColumns}
              rowId={(l) => `${l.ward.id}-${l.shift}`} />
            <p className="mt-2 text-sm text-text-secondary">
              The figure is the ward’s own nursing ratio applied to its bed count, plus one for the in-charge. It is a
              rule of thumb with a number beside it: if the ward is wrong about the ratio, the roster is wrong with it,
              which is why the ratio is a master record and not a comment.
            </p>
          </Panel>

          <Panel title={`Who is on the floor — ${shift}`}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {roster.coverage.filter((l) => l.shift === shift).map((line) => (
                <li key={line.ward.id} className={cx('rounded-md border px-3 py-2 text-sm', line.gap > 0 || line.missingSkills.length > 0 ? 'border-safety-warning/40 bg-safety-warning/5' : 'border-border-subtle')}>
                  <p className="font-medium text-text-primary">{line.ward.name}</p>
                  <ul className="mt-1 space-y-0.5 text-text-secondary">
                    {onFloor(roster, line.ward.id, shift).map((a) => {
                      const s = roster.staff.find((x) => x.id === a.staffId);
                      if (!s) return null;
                      return (
                        <li key={a.id} className="flex items-center justify-between gap-2">
                          <span>
                            {s.name}
                            <span className="ml-2 text-xs text-text-tertiary">{a.covering}</span>
                          </span>
                          <button type="button" onClick={() => setStaffId(s.id)} className="inline-flex min-h-6 items-center px-1 text-xs underline">
                            details
                          </button>
                        </li>
                      );
                    })}
                    {onFloor(roster, line.ward.id, shift).length === 0 && <li className="text-text-tertiary">Nobody rostered — a gap with a name, not a shrug.</li>}
                  </ul>
                  {line.missingSkills.length > 0 && (
                    <p className={cx('mt-1 text-xs font-medium', TONE_TEXT.warning)}>No {line.missingSkills.join(' or ')} on this shift.</p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          {roster.conflicts.length > 0 && (
            <Panel title="Roster lines the rules refuse" actions={<span className="text-xs text-text-secondary">Shown to whoever builds tomorrow’s roster, not to the person affected at 06:50</span>}>
              <ul className="space-y-2 text-sm">
                {roster.conflicts.map((c) => (
                  <li key={c.assignmentId} className="rounded-md border border-safety-critical/40 bg-safety-critical/5 px-3 py-2">
                    <span className="font-medium text-text-primary">{c.name}.</span> <span className="text-text-secondary">{c.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {tab === 'handover' && (
        <div className="space-y-3">
          <Panel
            title="Shift handover — sick patients first"
            actions={<span className="text-xs text-text-secondary">{HANDOVER_MIN} minutes of overlap; the incoming shift takes it before the outgoing one leaves</span>}
          >
            <ul className="space-y-2">
              {roster.handover.map((h) => (
                <li key={h.patient} className={cx('rounded-md border px-3 py-2', h.takenBy ? 'border-border-subtle' : 'border-safety-warning/40 bg-safety-warning/5')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', BAND_CHIP[h.band])}>{h.band}</span>
                      <span className="font-medium text-text-primary">{h.patient}</span>
                      <span className="text-xs text-text-tertiary">{h.wardName} · from {h.fromShift}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {h.takenBy
                        ? <span className={cx('text-xs', TONE_TEXT.success)}>taken by {h.takenBy} at {h.at?.slice(11)}</span>
                        : <Button variant="ghost" onClick={() => takeHandover(h, 'S. Akter (evening)')}>Take handover</Button>}
                      <Button variant="ghost" onClick={() => setHandoverOpen(h.patient)}>Read the SBAR</Button>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">{h.sbar.situation}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Why the order is the way it is">
            <p className="text-sm text-text-secondary">
              The list is sorted by band, not by bed number: an <span className="font-medium text-safety-critical">Emergency</span> patient
              is handed over person-to-person with a full SBAR, an <span className="font-medium text-safety-warning">Escalate</span> patient
              is read out with the trigger to watch for, and a stable patient is confirmed rather than discussed. Handing over in bed
              order is how the deteriorating patient in bed A-07 gets two sentences while a discharge gets a paragraph.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'people' && (
        <Panel title="Everybody rostered today" actions={<span className="text-xs text-text-secondary">{rosterableStaff.length} clinical staff · {roster.stats.onLeave} on leave</span>}>
          <ListView id="duty-staff" caption="Everybody rostered today" rows={roster.staff} columns={staffColumns} rowId={(s) => s.id} onRowClick={(s) => setStaffId(s.id)} />
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="space-y-3">
          <Panel title="What the roster refuses">
            <ul className="space-y-2 text-sm">
              <li><span className="font-medium text-text-primary">{MIN_REST_HOURS} hours between shifts.</span> <span className="text-text-secondary">A night shift ending at 08:00 cannot be followed by a morning shift starting at 08:00. The screen computes the gap and refuses the line rather than leaving it to somebody’s memory of the day before.</span></li>
              <li><span className="font-medium text-text-primary">{MAX_CONSECUTIVE_NIGHTS} consecutive nights.</span> <span className="text-text-secondary">A fourth night is where the errors cluster; the roster flags the person and the shift.</span></li>
              <li><span className="font-medium text-text-primary">48 hours in the week.</span> <span className="text-text-secondary">Beyond that it is overtime, and overtime needs a signature rather than a shrug.</span></li>
              <li><span className="font-medium text-text-primary">The skill, not just the body.</span> <span className="text-text-secondary">A shift is short if nobody on it can witness a controlled drug, run a ventilator or resuscitate a newborn. The requirement comes from what the ward does.</span></li>
              <li><span className="font-medium text-text-primary">Leave is a roster fact.</span> <span className="text-text-secondary">A person on leave is not available, and the screen says so before somebody is called at home.</span></li>
            </ul>
          </Panel>
          <Panel title="Skills each ward must have on every shift">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Required skills per ward</caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Ward</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Nurses needed</th>
                    <th scope="col" className="py-1.5 font-medium">Skills required on the shift</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.coverage.filter((l) => l.shift === 'Evening').map((l) => (
                    <tr key={l.ward.id} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{l.ward.name}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{requiredNurses(l.ward)} ({l.ward.nurseRatio})</td>
                      <td className="py-1.5 text-text-secondary">{requiredSkills(l.ward, 'Evening').join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">Competencies the roster understands: {COMPETENCIES.join(' · ')}.</p>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------- staff sheet */}
      <Sheet
        open={Boolean(person)}
        onClose={() => setStaffId(null)}
        title={person ? person.name : 'Staff'}
        description={person ? `${person.role} · ${person.phone}` : undefined}
        footer={
          person && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  const check = restCheck(person, 'Night', { shift: 'Evening', dayIso: day });
                  push({ title: check.ok ? `${person.name} can take the night shift: the rest rule is satisfied.` : `Refused — ${check.problem}`, tone: check.ok ? 'success' : 'critical' });
                }}
              >
                Can they take tonight’s night shift?
              </Button>
            </div>
          )
        }
      >
        {person && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Home ward</dt><dd className="font-medium">{person.wardId}</dd></div>
              <div><dt className="text-xs text-text-secondary">Hours this week</dt><dd className="font-medium tabular-nums">{person.weekHours} h</dd></div>
              <div><dt className="text-xs text-text-secondary">Nights in a row</dt><dd className="font-medium tabular-nums">{person.nightsInARow} of {MAX_CONSECUTIVE_NIGHTS}</dd></div>
              <div><dt className="text-xs text-text-secondary">Leave</dt><dd className="font-medium">{person.onLeave ? `${person.onLeave.kind} (${person.onLeave.from} → ${person.onLeave.to})` : 'none recorded'}</dd></div>
            </dl>
            <div>
              <p className="text-xs text-text-secondary">Competencies held</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {(person.competencies as Competency[]).map((c) => (
                  <li key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Today’s assignments</p>
              <ul className="mt-1 space-y-1">
                {roster.assignments.filter((a) => a.staffId === person.id).map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5">
                    <span>{a.shift} · {SHIFT_WINDOW[a.shift].start}–{SHIFT_WINDOW[a.shift].end} · {a.wardId}</span>
                    <span className={cx('text-xs', a.handoverAt ? TONE_TEXT.success : TONE_TEXT.warning)}>{a.handoverAt ? `handover taken ${a.handoverAt.slice(11)}` : 'handover pending'}</span>
                  </li>
                ))}
                {roster.assignments.every((a) => a.staffId !== person.id) && <li className="text-text-tertiary">Not rostered today — leave, rest day, or covering elsewhere.</li>}
              </ul>
            </div>
            <p className="text-xs text-text-tertiary">
              Hours and nights are the roster’s own arithmetic; the person is told what the roster thinks so a correction
              can be made before the shift rather than after it.
            </p>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------------- SBAR sheet */}
      <Sheet
        open={Boolean(item)}
        onClose={() => setHandoverOpen(null)}
        title={item ? `Handover — ${item.patient.split(' · ')[0]}` : 'Handover'}
        description={item ? `${item.wardName} · from the ${item.fromShift} shift · ${item.band}` : undefined}
        footer={
          item && !item.takenBy && (
            <div className="flex justify-end">
              <Button onClick={() => { takeHandover(item, 'S. Akter (evening)'); setHandoverOpen(null); }}>Take handover</Button>
            </div>
          )
        }
      >
        {item && (
          <ol className="space-y-2 text-sm">
            {([['Situation', item.sbar.situation], ['Background', item.sbar.background], ['Assessment', item.sbar.assessment], ['Recommendation', item.sbar.recommendation]] as const).map(([label, text]) => (
              <li key={label} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
                <p className="text-text-primary">{text}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-text-tertiary">
          SBAR is used because it puts the recommendation last, where a tired nurse can act on it — and because a
          structure that everybody uses is a structure nobody has to explain at 14:00.
        </p>
      </Sheet>

      <p className="text-xs text-text-tertiary">
        Related screens: <Link href="/ward" className="underline">the ward board</Link> shows the patients this roster cares for,{' '}
        <Link href="/round" className="underline">the doctor’s round</Link> reads who is on the floor, and{' '}
        <Link href="/setup" className="underline">Setup</Link> holds the wards and their ratios.
      </p>
    </div>
  );
}
