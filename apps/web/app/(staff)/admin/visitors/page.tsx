'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { BadgeCheck, ClipboardList, DoorOpen, IdCard, ShieldAlert } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  BADGE_KINDS,
  MAX_VISITORS_PER_PATIENT,
  OVERDUE_GRACE_MIN,
  PURPOSES,
  VISITING_HOURS,
  VISITOR_RULES,
  VISIT_AREAS,
  areaById,
  checkVisitor,
  nextPassNo,
  overduePasses,
  purposeByCode,
  visitorDay,
  type BadgeKind,
  type VisitorCheck,
  type VisitorPass,
} from '@/lib/visitors';

/* Front Office (P7) — the gate.
 *
 * The register a security guard is held to answers one question: who is in the building, and who let them in. So
 * every pass names a host by name, carries the areas its badge may not reach, and stays open until somebody signs
 * it out. The screen's top line is the overdue passes, because an open pass is the only fact here that somebody
 * has to act on today.
 *
 * The pass is issued through `openVisitorPass` and closed through `closeVisitorPass`, both queued: the gate has
 * one reader and no time, and a pass that waits for the uplink is a queue at the door.
 */

const VIEWS: Array<{ label: string; keep: (p: VisitorPass) => boolean; hint: string }> = [
  { label: 'Everybody', keep: () => true, hint: 'Every pass issued today, in the order the gate wrote them.' },
  { label: 'In the building', keep: (p) => p.state === 'In', hint: 'Issued and not signed out. The list an incident is answered from.' },
  { label: 'Overdue', keep: (p) => p.state === 'Overdue', hint: `Still open more than ${OVERDUE_GRACE_MIN} minutes past the time on the pass. Somebody walks to the ward and finds out.` },
  { label: 'Signed out', keep: (p) => p.state === 'Out', hint: 'Closed properly, with the name of the guard who signed it.' },
  { label: 'Contractors & vendors', keep: (p) => p.badgeKind === 'Contractor' || p.badgeKind === 'Vendor', hint: 'In the building with tools or samples, and the plant room or the store counts them out.' },
  { label: 'Deliveries', keep: (p) => p.badgeKind === 'Delivery', hint: 'Goods received at the store or left at the gate. A delivery walked to a ward is stock that never existed.' },
  { label: 'Attendants', keep: (p) => p.badgeKind === 'Patient attendant', hint: 'The one badge that runs for days: named on the bed by the ward, valid as long as the admission.' },
  { label: 'No ID checked', keep: (p) => p.idChecked.kind === 'Not checked', hint: 'Where nothing was checked, the register says so, and says what was done instead. A blank is the one thing it will not hold.' },
];

interface Draft {
  name: string;
  mobile: string;
  organisation: string;
  purpose: string;
  hostCode: string;
  hostName: string;
  badgeKind: BadgeKind;
  idKind: string;
  idNumber: string;
  vehicle: string;
  itemsIn: string;
  escorts: string;
  accompanying: string;
  validUntil: string;
  note: string;
}

const draftFor = (day: string): Draft => ({
  name: '',
  mobile: '',
  organisation: '',
  purpose: 'VST-WARD',
  hostCode: '',
  hostName: '',
  badgeKind: 'Visitor',
  idKind: 'NID',
  idNumber: '',
  vehicle: '',
  itemsIn: '',
  escorts: '',
  accompanying: '',
  validUntil: `${day} 18:30`,
  note: '',
});

export default function FrontOfficePage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [extra, setExtra] = useState<VisitorPass[]>([]);
  const [view, setView] = useState('Everybody');
  const [query, setQuery] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFor(day));

  const grid = useMemo(() => visitorDay(day, extra), [day, extra]);
  const rows = useMemo(() => {
    const active = VIEWS.find((v) => v.label === view) ?? VIEWS[0];
    const q = query.trim().toLowerCase();
    return grid.passes
      .filter(active.keep)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.passNo.toLowerCase().includes(q) || p.mobile.includes(q) || p.hostName.toLowerCase().includes(q) || p.organisation.toLowerCase().includes(q))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }, [grid.passes, view, query]);

  const record = selected ? grid.passes.find((p) => p.id === selected) ?? null : null;
  const overdue = useMemo(() => overduePasses(grid.passes, `${day} 15:10`), [grid.passes, day]);

  const check: VisitorCheck = useMemo(
    () =>
      checkVisitor({
        ...draft,
        nowIso: `${day} 15:10`,
        day: grid.passes,
      }),
    [draft, day, grid.passes],
  );

  const purpose = purposeByCode(draft.purpose);
  const areas = purpose?.areas ?? [];

  const issue = () => {
    const fresh = checkVisitor({ ...draft, nowIso: `${day} 15:10`, day: grid.passes });
    if (!fresh.ok) {
      push({ title: `The gate refuses this pass — ${fresh.reasons[0].code}`, description: fresh.reasons[0].message, tone: 'critical' });
      return;
    }
    const pass: VisitorPass = {
      id: `vp-new-${extra.length + 1}`,
      passNo: nextPassNo(day, grid.passes),
      name: draft.name.trim(),
      mobile: draft.mobile.trim(),
      organisation: draft.organisation.trim(),
      purpose: draft.purpose,
      hostCode: draft.hostCode.trim(),
      hostName: draft.hostName.trim() || 'Gate — sent to the desk',
      badgeKind: draft.badgeKind,
      areas,
      issuedAt: `${day} 15:10`,
      validUntil: draft.validUntil,
      state: 'In',
      signedOutAt: null,
      signedOutBy: null,
      idChecked: {
        kind: draft.idKind as VisitorPass['idChecked']['kind'],
        number: draft.idNumber.trim() ? `${draft.idNumber.trim().slice(0, 4)}•••••${draft.idNumber.trim().slice(-2)}` : '',
        note: draft.idKind === 'Not checked' ? draft.note.trim() || 'Nothing presented; recorded at the gate' : 'Photograph compared at the gate',
      },
      vehicle: draft.vehicle.trim(),
      itemsIn: draft.itemsIn.trim(),
      itemsOut: '',
      escorts: draft.escorts.trim(),
      accompanying: draft.accompanying.trim(),
      note: draft.note.trim(),
      issuedBy: 'Gate 1 — R. Howlader',
    };
    setExtra((list) => [pass, ...list]);
    setIssuing(false);
    const outcome = queueWrite(`Pass ${pass.passNo}: ${pass.name} → ${pass.hostName} (${pass.badgeKind})`, {
      id: 'openVisitorPass',
      recordId: pass.passNo,
      fields: { passNo: pass.passNo, host: pass.hostCode, badgeKind: pass.badgeKind, areas: areas.join(','), validUntil: pass.validUntil, idChecked: pass.idChecked.kind },
    });
    setDraft(draftFor(day));
    push({
      title: outcome.queued ? `${pass.passNo} issued` : `${pass.passNo} printed, not queued`,
      description: outcome.queued
        ? `The badge prints at the gate and the pass reaches the gate register when the queue drains.${fresh.warnings.length ? ` ${fresh.warnings.length} thing(s) the register records and passes on.` : ''}`
        : `The visitor register is written on the branch’s own device${outcome.because ? `, and this write cannot queue here: ${outcome.because}` : ''}. The paper badge is still the badge.`,
      tone: outcome.queued ? (fresh.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const close = (pass: VisitorPass) => {
    setExtra((list) => list.map((p) => (p.id === pass.id ? { ...p, state: 'Out', signedOutAt: `${day} 15:10`, signedOutBy: 'Gate 1 — R. Howlader' } : p)));
    setSelected(null);
    const outcome = queueWrite(`Sign out ${pass.passNo} (${pass.name})`, {
      id: 'closeVisitorPass',
      recordId: pass.passNo,
      fields: { passNo: pass.passNo, signedOutBy: 'Gate 1 — R. Howlader', itemsOut: pass.itemsOut || null },
    });
    const late = pass.validUntil < `${day} 15:10`;
    push({
      title: `${pass.passNo} signed out`,
      description: late
        ? `Closed ${Math.round((new Date(`${day}T15:10:00Z`).getTime() - new Date(`${pass.validUntil.replace(' ', 'T')}:00Z`).getTime()) / 60000)} minutes past the time on the pass. The register keeps the times as they happened; the exception is what the shift report reads.${outcome.queued ? '' : ` Not queued: ${outcome.because}.`}`
        : `In and out with the guard’s name against it.${outcome.queued ? ' Queued for the cloud.' : ` Not queued: ${outcome.because}.`}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="front-office"
        subtitle={`${day} · ${grid.passes.length} pass(es) issued · ${grid.stats.inBuilding} still in the building.`}
        actions={
          <>
            <Link href="/admin/setup/visitors">
              <Button variant="ghost">Visiting rules</Button>
            </Link>
            <Link href="/print/visitor-badge">
              <Button variant="ghost">
                <BadgeCheck className="size-4" aria-hidden /> Badge stock
              </Button>
            </Link>
            <Button variant="primary" onClick={() => { setDraft(draftFor(day)); setIssuing(true); }}>
              <DoorOpen className="size-4" aria-hidden /> Issue a pass
            </Button>
          </>
        }
        waiting={overdue.length ? `${overdue.length} pass(es) open past the time on the badge: ${overdue.map((p) => p.name).join(', ')}. The shift manager walks to the ward.` : undefined}
      />

      <AdminSiblings screenId="front-office" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Issued today" value={String(grid.stats.issued)} definition="Every pass the gate wrote today, including the ones that never entered the building: a delivery left at the gate is still a record." asOf={day} />
        <KpiTile label="In the building" value={String(grid.stats.inBuilding)} definition="Issued and not signed out. This is the number an incident is answered from, which is why it is only counted from closed passes." asOf={day} />
        <KpiTile label="Overdue" value={String(grid.stats.overdue)} definition={`Still open more than ${OVERDUE_GRACE_MIN} minutes past the time on the pass. The one line on this screen somebody has to act on today.`} asOf={day} footnote={grid.stats.overdue ? `${grid.stats.overdue} to find today` : undefined} />
        <KpiTile label="Signed out" value={String(grid.stats.signedOut)} definition="Closed by a named guard. A pass closed with nobody’s name against it is an assumption dressed as a record." asOf={day} />
        <KpiTile label="Contractors & deliveries" value={`${grid.stats.contractors} / ${grid.stats.deliveries}`} definition="Tools and goods, separated from relatives. A contractor with a toolbox and a delivery rider are two different risks, and the badge kind is what tells them apart." asOf={day} />
        <KpiTile label="Attendants" value={String(grid.stats.attendants)} definition="The one badge that runs for days: the ward names the attendant on the bed, and the pass is valid as long as the admission." asOf={day} />
        <KpiTile label="No ID checked" value={String(grid.stats.notChecked)} definition="Where nothing was presented, the register says so and says what was done instead. A blank cell here is the one thing it will not hold." asOf={day} footnote={grid.stats.notChecked ? 'recorded as not checked, with what was done instead' : undefined} />
      </div>

      {overdue.length > 0 && (
        <SafetyBanner severity="critical" title={`${overdue.length} pass(es) open past the hour on the badge`}>
          <ul className="list-disc space-y-1 pl-5">
            {overdue.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.passNo} · {p.name}</span> — {purposeByCode(p.purpose)?.label ?? p.purpose}, seen by {p.hostName}, valid until {p.validUntil}.{' '}
                {p.mobile ? `Reachable on ${p.mobile}.` : 'No number on the pass, which is the case this rule exists for.'}
              </li>
            ))}
          </ul>
        </SafetyBanner>
      )}

      <Panel title="The gate register" actions={<span className="text-xs text-text-secondary">{VISIT_AREAS.length}-area model · {rows.length} of {grid.passes.length} rows</span>}>
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.label}
              type="button"
              aria-pressed={view === v.label}
              onClick={() => setView(v.label)}
              title={v.hint}
              className={cx('rounded-full border px-2 py-0.5 text-xs', view === v.label ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken')}
            >
              {v.label} <span className="font-numeric">{grid.passes.filter(v.keep).length}</span>
            </button>
          ))}
        </div>
        <ListView
          id="visitor-register"
          caption={`Visitor passes for ${day}`}
          rows={rows}
          rowId={(p) => p.id}
          onRowClick={(p) => setSelected(p.id)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Name, pass number, mobile, host or organisation' }}
          emptyLabel="No passes match this view."
          columns={[
            { key: 'passNo', header: 'Pass', width: '8rem', render: (p) => <span className="font-numeric">{p.passNo}</span> },
            { key: 'name', header: 'Visitor', render: (p) => (<span><span className="font-medium">{p.name}</span><span className="block text-xs text-text-tertiary">{p.mobile}{p.organisation ? ` · ${p.organisation}` : ''}</span></span>) },
            { key: 'badgeKind', header: 'Badge', width: '9rem', render: (p) => <span className={cx(p.badgeKind === 'Contractor' || p.badgeKind === 'Vendor' ? 'text-safety-warning' : 'text-text-primary')}>{p.badgeKind}</span> },
            { key: 'purpose', header: 'Purpose', hideBelow: 'md', render: (p) => purposeByCode(p.purpose)?.label ?? p.purpose },
            { key: 'hostName', header: 'Seen by', render: (p) => (<span><span>{p.hostName}</span><span className="font-numeric block text-xs text-text-tertiary">{p.hostCode}</span></span>) },
            { key: 'areas', header: 'Areas', hideBelow: 'lg', render: (p) => p.areas.map((a) => areaById(a)?.label ?? a).join(', ') },
            { key: 'issuedAt', header: 'In', width: '7rem', render: (p) => <span className="font-numeric">{p.issuedAt.slice(11)}</span> },
            { key: 'validUntil', header: 'Valid until', width: '10rem', hideBelow: 'md', render: (p) => <span className="font-numeric">{p.validUntil.slice(5)}</span> },
            { key: 'state', header: 'State', width: '7rem', render: (p) => (<span className={cx('font-medium', p.state === 'In' ? 'text-safety-success' : p.state === 'Overdue' ? 'text-safety-critical' : 'text-text-secondary')}>{p.state === 'Out' ? `Out ${p.signedOutAt?.slice(11) ?? ''}` : p.state}</span>) },
          ]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Visiting hours as the wards keep them" actions={<Link href="/admin/setup/visitors" className="text-xs underline">Change them</Link>}>
          <ul className="space-y-2 text-sm">
            {VISITING_HOURS.map((h) => (
              <li key={h.wardId} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="font-medium text-text-primary">{h.ward}</p>
                <p className="font-numeric text-text-secondary">Morning {h.morning} · Evening {h.evening}</p>
                <p className="text-xs text-text-tertiary">{h.note}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="What the gate refuses, and why" actions={<span className="text-xs text-text-secondary">{VISITOR_RULES.length} rules</span>}>
          <ul className="space-y-2 text-sm">
            {VISITOR_RULES.map((rule) => (
              <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-start gap-1.5 font-medium text-text-primary">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
                </p>
                <p className="text-text-secondary">{rule.because}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* ------------------------------------------------------------------------------------------- issue a pass */}
      <Sheet
        open={issuing}
        onClose={() => setIssuing(false)}
        title={`Issue a pass — ${nextPassNo(day, grid.passes)}`}
        description="Eighteen fields on the pass; fourteen are typed here and the rest are derived from the purpose, the badge kind and the gate."
        width="xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('mr-auto text-xs', check.ok ? 'text-safety-success' : 'text-safety-critical')}>
              {check.ok ? (check.warnings.length ? `${check.warnings.length} thing(s) the register records and passes on.` : 'The gate would accept this pass.') : `${check.reasons.length} refusal(s) — the first is below.`}
            </span>
            <Button variant="ghost" onClick={() => setIssuing(false)}>Cancel</Button>
            <Button variant="primary" onClick={issue} disabled={!check.ok}>
              <IdCard className="size-4" aria-hidden /> Issue and print the badge
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <SafetyBanner severity={check.ok ? (check.warnings.length ? 'warning' : 'success') : 'critical'} title={check.ok ? (check.warnings.length ? 'Recorded, and passed on' : 'Nothing to refuse') : check.reasons[0].code}>
            {check.ok ? (
              check.warnings.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {check.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : (
                <>A name, a number to reach them on, a host by name, a purpose that decides the areas, and identification recorded as what was checked rather than as a tick.</>
              )
            ) : (
              check.reasons[0].message
            )}
          </SafetyBanner>

          <FieldSection title="Who is at the door" description="Recorded after an emergency has been taken in, never before it.">
            <TextField label="Name" name="visit-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} hint="As the visitor gives it, and as the badge will print it." />
            <TextField label="Mobile" name="visit-mobile" value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} hint="How the ward reaches them when the visit cannot happen, and how a contact is traced afterwards." />
            <TextField label="Organisation" name="visit-org" value={draft.organisation} onChange={(e) => setDraft({ ...draft, organisation: e.target.value })} hint="For a contractor, a delivery or a representative: the company behind the person at the door." />
            <TextField label="Vehicle registration" name="visit-vehicle" value={draft.vehicle} onChange={(e) => setDraft({ ...draft, vehicle: e.target.value })} hint="Read by the barrier at the back gate, and counted at shift change. Left empty when they walked in." />
            <TextField label="Patient or file number" name="visit-accompanying" value={draft.accompanying} onChange={(e) => setDraft({ ...draft, accompanying: e.target.value })} hint="Needed to collect a report, and used to count how many people are with one patient." />
          </FieldSection>

          <FieldSection title="Why they are here, and who they are seeing" description="The purpose decides the areas; the host is who the guard names when asked.">
            <SelectField label="Purpose" name="visit-purpose" value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} options={PURPOSES.map((p) => ({ value: p.code, label: p.label }))} hint={purpose ? purpose.note : 'The reason decides the areas and whether a host is needed.'} />
            <SelectField
              label="Badge kind"
              name="visit-badge"
              value={draft.badgeKind}
              onChange={(e) => setDraft({ ...draft, badgeKind: e.target.value as BadgeKind })}
              options={BADGE_KINDS.map((k) => ({ value: k, label: k }))}
              hint="Visitor, patient attendant, contractor, vendor or delivery. The badge prints the areas it may not reach, because the door is busy."
            />
            <TextField label="Host employee number" name="visit-host" value={draft.hostCode} onChange={(e) => setDraft({ ...draft, hostCode: e.target.value })} hint="The staff member being seen, or the department that asked for the visit. “Management” is not a host." />
            <TextField label="Host name" name="visit-hostname" value={draft.hostName} onChange={(e) => setDraft({ ...draft, hostName: e.target.value })} hint="Printed on the badge so the ward knows who was expected." />
            <TextField label="Valid until" name="visit-valid" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} hint="A pass without an end is a key. An attendant’s pass is the only one that runs into days, and the ward names them on the bed." />
            <TextField label="Escorted by" name="visit-escorts" value={draft.escorts} onChange={(e) => setDraft({ ...draft, escorts: e.target.value })} hint="Who from the hospital walks with them, for a plant room, a mortuary or a theatre-adjacent visit." />
          </FieldSection>

          <FieldSection title="Identification, as checked" description="“Checked” is not a fact; what was checked is.">
            <SelectField
              label="Identification"
              name="visit-idkind"
              value={draft.idKind}
              onChange={(e) => setDraft({ ...draft, idKind: e.target.value })}
              options={['NID', 'Passport', 'Company ID', 'Hospital ID', 'Not checked'].map((k) => ({ value: k, label: k }))}
              hint="A contractor or a representative is identified by their company and their own ID; a delivery needs the rider identified or the reason written down."
            />
            <TextField label="Number" name="visit-idnumber" value={draft.idNumber} onChange={(e) => setDraft({ ...draft, idNumber: e.target.value })} hint="Stored masked: the register needs to know which document was seen, not to hold a copy of it." />
            <TextField label="Items in" name="visit-itemsin" value={draft.itemsIn} onChange={(e) => setDraft({ ...draft, itemsIn: e.target.value })} hint="Toolboxes, cylinders, samples, a bag of clothes. The gate is where a hospital’s stock leaves, so both directions are recorded." />
            <TextAreaField label="Note" name="visit-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} hint="What was agreed at the gate in words: who took the delivery, which ward was rung, why nothing was checked." rows={2} />
          </FieldSection>

          <Panel title="The badge this will print">
            <div className="rounded-md border border-dashed border-border-default bg-surface-sunken p-3 text-sm">
              <p className="text-lg font-semibold text-text-primary">{draft.name || 'Visitor name'}</p>
              <p className="text-text-secondary">{purpose?.label ?? 'Purpose'} · {draft.badgeKind}</p>
              <p className="text-text-secondary">Seen by {draft.hostName || draft.hostCode || '—'}</p>
              <p className="font-numeric text-text-secondary">Valid until {draft.validUntil}</p>
              <p className="mt-1 text-xs font-medium text-safety-critical">
                May not enter: {VISIT_AREAS.filter((a) => !a.allows.includes(draft.badgeKind) || !areas.includes(a.id)).map((a) => a.label).join(', ')}
              </p>
              {areas.length > 0 && <p className="mt-1 text-xs text-text-tertiary">May reach: {areas.map((a) => areaById(a)?.label ?? a).join(', ')}</p>}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
              <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Up to {MAX_VISITORS_PER_PATIENT} people with one patient at a time is what the ward can hold; beyond that the bay becomes a corridor and the ward sends one back down.
            </p>
          </Panel>
        </div>
      </Sheet>

      {/* ------------------------------------------------------------------------------------------------ one pass */}
      <Sheet
        open={Boolean(record)}
        onClose={() => setSelected(null)}
        title={record ? `${record.passNo} — ${record.name}` : 'Pass'}
        description={record ? `${record.badgeKind} · ${purposeByCode(record.purpose)?.label ?? record.purpose} · issued ${record.issuedAt}` : undefined}
        width="lg"
        footer={
          record && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/print/visitor-badge">
                <Button variant="ghost">Reprint the badge</Button>
              </Link>
              {record.state !== 'Out' ? (
                <Button variant="primary" onClick={() => close(record)}>
                  Sign out at the gate
                </Button>
              ) : (
                <span className="self-center text-xs text-text-secondary">
                  Signed out {record.signedOutAt} by {record.signedOutBy}.
                </span>
              )}
            </div>
          )
        }
      >
        {record && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['Mobile', record.mobile],
                ['Organisation', record.organisation || '—'],
                ['Host', `${record.hostName} · ${record.hostCode}`],
                ['Areas', record.areas.map((a) => areaById(a)?.label ?? a).join(', ')],
                ['Issued', record.issuedAt],
                ['Valid until', record.validUntil],
                ['Identification', `${record.idChecked.kind}${record.idChecked.number ? ` · ${record.idChecked.number}` : ''}`],
                ['What was checked', record.idChecked.note || '—'],
                ['Vehicle', record.vehicle || '—'],
                ['Items in', record.itemsIn || 'nothing recorded'],
                ['Items out', record.itemsOut || (record.state === 'Out' ? 'nothing recorded' : 'not yet out')],
                ['Escorted by', record.escorts || '—'],
                ['Patient or file', record.accompanying || '—'],
                ['State', record.state === 'Out' ? `signed out at ${record.signedOutAt}` : record.state === 'Overdue' ? 'open past the hour on the badge' : 'in the building'],
                ['Issued by', record.issuedBy],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {record.state === 'Overdue' && (
              <SafetyBanner severity="critical" title="Open past the hour on the badge">
                The person is either still in the building, or left without signing out — and the register cannot tell the two apart, which
                is why the shift manager walks to the ward rather than closing the pass at the end of the shift.
              </SafetyBanner>
            )}
            {record.idChecked.kind === 'Not checked' && (
              <SafetyBanner severity="warning" title="Nothing was checked at the gate">
                {record.idChecked.note || 'Recorded as nothing presented, with no note about what was done instead.'} The register keeps this as a
                fact rather than as a blank, because a gate that claims to check everybody is a gate nobody audits.
              </SafetyBanner>
            )}
            {record.itemsIn && !record.itemsOut && record.state !== 'Out' && (
              <SafetyBanner severity="warning" title="Items in, nothing out yet">
                {record.itemsIn} — the plant room or the store counts this person out at the end of the shift, and the gate record is what it
                counts against.
              </SafetyBanner>
            )}
            {record.note && <p className="text-text-secondary">{record.note}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
