'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, CheckboxField, FieldSection, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { ShieldAlert, DoorOpen, Clock } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { SettingScreenView } from '@/components/SettingScreenView';
import { useShell } from '@/lib/shell';
import { settingByKey } from '@/lib/admin';
import { PURPOSES, VISITING_HOURS, VISIT_AREAS, VISITOR_RULES } from '@/lib/visitors';

/* Setup › Front Office (P7) — the two lists the gate reads.
 *
 * A visitor purpose and a visiting hour are configuration, and both are read at a door by somebody who cannot
 * ask a question. So each row here says what it opens: which areas a purpose reaches, which badge kinds it
 * allows, and which ward keeps which hour. The legacy screen was two free-text lists, which is why its visitor
 * register had nine purposes that meant “meeting”.
 *
 * The purpose list is written as a branch setting: the same hospital keeps different hours at a satellite, and a
 * single hospital-wide list would either close Uttara’s evenings or open Main Campus’s.
 */

const BADGE_KINDS = ['Visitor', 'Patient attendant', 'Contractor', 'Vendor', 'Delivery'];

export default function SetupFrontOfficePage() {
  const setting = settingByKey('front.visitors');
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [extra, setExtra] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: '', labelBn: '', needsHost: true, areas: [] as string[], badges: ['Visitor', 'Patient attendant'] as string[], note: '' });

  const purposes = useMemo(
    () => [...PURPOSES, ...extra.map((label) => ({ code: `VST-NEW-${label.replace(/\W+/g, '').slice(0, 8).toUpperCase()}`, label, needsHost: true, areas: [] as string[], note: 'Added as a branch purpose. It opens the areas chosen when it was added and nothing else.' }))],
    [extra],
  );

  const chosenAreas = draft.areas.length ? draft.areas : VISIT_AREAS.filter((a) => a.allows.some((k) => draft.badges.includes(k))).map((a) => a.id);
  const blocked = VISIT_AREAS.filter((a) => !chosenAreas.includes(a.id));

  const save = () => {
    if (!draft.label.trim()) {
      push({ title: 'A purpose needs a name', description: 'It is what the guard reads out of the list at the door, and what the register prints beside the pass months later.', tone: 'critical' });
      return;
    }
    if (draft.areas.length === 0) {
      push({ title: 'Choose the areas this purpose reaches', description: 'A purpose with no areas is a badge that opens whatever the guard feels it should. The badge prints the areas as a list precisely so that nobody has to decide at the door.', tone: 'critical' });
      return;
    }
    setExtra((list) => [...list, draft.label.trim()]);
    setEditing(null);
    const outcome = queueWrite(`Add the visitor purpose “${draft.label.trim()}” reaching ${draft.areas.length} area(s)`, {
      id: 'updateBranchSetting',
      recordId: 'front.visitors.purposes',
      fields: { branch: 'Main Campus', key: 'front.visitors.purposes', label: draft.label.trim(), needsHost: draft.needsHost ? 'yes' : 'no', areas: draft.areas.join(','), badges: draft.badges.join(',') },
    });
    push({
      title: outcome.queued ? `“${draft.label.trim()}” added` : 'Purpose not added on this device',
      description: outcome.queued
        ? `The gate’s list is a branch setting and it is queued. The badge prints “May not enter: ${blocked.map((a) => a.label).join(', ')}”.`
        : `Visiting rules are a branch setting and the branch settings operation is online-only${outcome.because ? `: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
    setDraft({ label: '', labelBn: '', needsHost: true, areas: [], badges: ['Visitor', 'Patient attendant'], note: '' });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="setup-front-office"
        subtitle="What a visitor may come for, what they must show, and the hours each ward keeps — the two lists the gate reads."
        actions={
          <>
            <Link href="/admin/visitors">
              <Button variant="ghost">
                <DoorOpen className="size-4" aria-hidden /> Today’s gate register
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setEditing('new')}>Add a purpose</Button>
          </>
        }
      />

      <AdminSiblings screenId="setup-front-office" />

      <Panel title="Visitor purposes" actions={<span className="text-xs text-text-secondary">{purposes.length} purpose(s) · each one names the areas it reaches</span>}>
        <ListView
          id="visitor-purposes"
          caption="What a visitor may come for"
          rows={purposes}
          rowId={(p) => p.code}
          onRowClick={(p) => {
            setEditing(p.code);
            setDraft({ label: p.label, labelBn: '', needsHost: p.needsHost, areas: p.areas, badges: VISIT_AREAS.filter((a) => p.areas.includes(a.id)).flatMap((a) => a.allows).slice(0, 3), note: p.note });
          }}
          emptyLabel="No purposes are configured: the gate has nothing to choose from."
          columns={[
            { key: 'code', header: 'Code', width: '11rem', render: (p) => <span className="font-numeric text-xs">{p.code}</span> },
            { key: 'label', header: 'Purpose', render: (p) => <span className="font-medium">{p.label}</span> },
            { key: 'needsHost', header: 'Host', width: '7.5rem', render: (p) => (p.needsHost ? 'required' : 'not required') },
            { key: 'areas', header: 'Reaches', hideBelow: 'md', render: (p) => (p.areas.length ? p.areas.map((a) => VISIT_AREAS.find((x) => x.id === a)?.label ?? a).join(', ') : 'not set') },
            { key: 'note', header: 'Why', hideBelow: 'lg', render: (p) => <span className="text-text-secondary">{p.note}</span> },
          ]}
        />
      </Panel>

      <Panel title="Visiting hours as the wards keep them" actions={<span className="text-xs text-text-secondary">{VISITING_HOURS.length} wards · the badge prints these</span>}>
        <ListView
          id="visiting-hours"
          caption="Visiting hours by ward"
          rows={VISITING_HOURS}
          rowId={(h) => h.wardId}
          emptyLabel="No ward visiting hours configured."
          columns={[
            { key: 'ward', header: 'Ward', render: (h) => <span className="font-medium">{h.ward}</span> },
            { key: 'morning', header: 'Morning', render: (h) => <span className="font-numeric">{h.morning}</span> },
            { key: 'evening', header: 'Evening', render: (h) => <span className="font-numeric">{h.evening}</span> },
            { key: 'note', header: 'Why these hours', hideBelow: 'md', render: (h) => <span className="text-text-secondary">{h.note}</span> },
          ]}
        />
        <p className="mt-2 flex items-start gap-1.5 text-xs text-text-tertiary">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Hours are enforced by the ward, not by the gate: a family that has come from another district at eight in the evening is
          admitted on the ward’s word, and the pass records who gave it.
        </p>
      </Panel>

      <Panel title="The areas, and who may reach them" actions={<span className="text-xs text-text-secondary">{VISIT_AREAS.length} areas</span>}>
        <div tabIndex={0} role="region" aria-label="Visiting hours table; scroll horizontally to read all columns" className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th className="py-1">Area</th>
                {BADGE_KINDS.map((k) => (
                  <th key={k} className="py-1 text-center">{k}</th>
                ))}
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {VISIT_AREAS.map((a) => (
                <tr key={a.id} className="border-b border-border-subtle/60">
                  <td className="py-1 font-medium">{a.label}</td>
                  {BADGE_KINDS.map((k) => (
                    <td key={k} className="py-1 text-center">
                      {a.allows.includes(k as never) ? <span className="text-safety-success">✓</span> : <span className="text-text-tertiary">·</span>}
                    </td>
                  ))}
                  <td className="py-1 text-xs text-text-secondary">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-tertiary">An empty row is the theatre corridor: nobody holds a standing pass there, and the suite keeps its own list.</p>
      </Panel>

      {setting && <SettingScreenView screen={setting} />}

      <Panel title="What the gate refuses, and why" actions={<span className="text-xs text-text-secondary">{VISITOR_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
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

      <Sheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a visitor purpose' : `Visitor purpose — ${draft.label || 'edit'}`}
        description="A purpose is a sentence the guard reads out and a list of areas the badge prints. Both are configuration, and both are read at a door."
        width="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!draft.label.trim() || draft.areas.length === 0}>Save the purpose</Button>
          </div>
        }
      >
        <div className="space-y-3">
          {draft.areas.length === 0 && (
            <SafetyBanner severity="warning" title="No areas chosen yet">
              Until an area is chosen the badge has nothing to print. A badge that does not say where a visitor may not go leaves the decision at the door, with a guard,
              in front of a queue.
            </SafetyBanner>
          )}
          <FieldSection title="The purpose" description="What the gate calls it, and whether a host is needed.">
            <TextField label="Name" name="purpose-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} hint="The words the guard reads out: “Visiting a patient”, “Service or repair”, “Collecting a report”." />
            <TextField label="Bangla name" name="purpose-labelBn" value={draft.labelBn} onChange={(e) => setDraft({ ...draft, labelBn: e.target.value })} hint="Printed on the gate’s list and the badge, because most visitors read Bangla first." />
            <CheckboxField label="A host is required" name="purpose-host" checked={draft.needsHost} onChange={(e) => setDraft({ ...draft, needsHost: e.target.checked })} hint="A visitor with nobody to see is one the guard has no way to place in the building. A patient attending a clinic is the exception." />
            <SelectField
              label="Areas"
              name="purpose-areas"
              value={draft.areas[0] ?? ''}
              onChange={(e) => setDraft({ ...draft, areas: e.target.value ? Array.from(new Set([...draft.areas, e.target.value])) : draft.areas })}
              options={[{ value: '', label: 'Add an area…' }, ...VISIT_AREAS.filter((a) => !draft.areas.includes(a.id)).map((a) => ({ value: a.id, label: a.label }))]}
              hint="The areas the visitor may reach. Everything else prints on the badge as “may not enter”."
            />
            <TextAreaField label="Why this purpose exists" name="purpose-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} hint="The sentence the next administrator reads before changing it: what the purpose is for, and what it must not become." rows={2} />
          </FieldSection>

          {draft.areas.length > 0 && (
            <Panel title="Areas chosen" actions={<button type="button" className="text-xs underline" onClick={() => setDraft({ ...draft, areas: [] })}>Clear</button>}>
              <ul className="flex flex-wrap gap-1 text-sm">
                {draft.areas.map((id) => (
                  <li key={id} className="rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                    {VISIT_AREAS.find((a) => a.id === id)?.label ?? id}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="What the gate will refuse for this purpose">
            <ul className="space-y-1 text-sm">
              {!draft.label.trim() && <li className="text-safety-critical">No name: the guard has nothing to read out and the register nothing to print.</li>}
              {draft.areas.length === 0 && <li className="text-safety-critical">No areas: the badge cannot say where the visitor may not go.</li>}
              {draft.needsHost && <li className="text-text-secondary">A pass issued under it without a host is refused: the guard needs somebody to announce the visitor to.</li>}
              {blocked.length > 0 && <li className="text-text-secondary">The badge prints “may not enter: {blocked.map((a) => a.label).join(', ')}”.</li>}
              {draft.note.trim() === '' && <li className="text-safety-warning">No note: the next person to change this row has only the label to go on, which is how two purposes end up meaning “meeting”.</li>}
              {draft.areas.includes('theatre') && <li className="text-safety-critical">Theatre corridor has no standing pass for anybody: it is entered on the theatre’s own list.</li>}
            </ul>
          </Panel>

          <p className={cx('text-xs text-text-tertiary')}>
            Purposes are counted, not deleted: a retired purpose stops appearing at the gate and stays in the register, because the passes issued under it last year still have to
            be readable.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
