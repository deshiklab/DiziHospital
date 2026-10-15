'use client';

import { useMemo, useState } from 'react';
import { Button, CheckboxField, FieldSection, Panel, SafetyBanner, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Eye, Plus, ShieldAlert, Tag } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { useShell } from '@/lib/shell';
import {
  CUSTOM_ENTITIES,
  CUSTOM_FIELDS,
  CUSTOM_FIELD_RULES,
  checkCustomField,
  type CustomFieldRow,
} from '@/lib/admin';
import type { Role } from '@/lib/shell';

/* Setup › Custom Fields (P7) — extra fields without a software release.
 *
 * The legacy product let anybody add a field to anything, which is where nine spellings of “another hospital” came
 * from. Here a field names its entity, its type, its validation and who may see the value, and the screen refuses
 * the four things that make a custom field unmaintainable: no label, a key that is not `entity.field`, a key that
 * already exists, and a picker with one option.
 *
 * A field is never deleted. Retiring it keeps it readable on the records it was stored on: the register still
 * resolves an old record, and the screen says where the value came from instead of showing a blank.
 */

const KINDS: CustomFieldRow['kind'][] = ['text', 'number', 'date', 'select', 'toggle', 'textarea'];
const ROLES: Role[] = ['receptionist', 'doctor', 'pharmacist', 'billing', 'admin'];

interface Draft {
  id: string | null;
  entity: string;
  key: string;
  label: string;
  kind: CustomFieldRow['kind'];
  required: boolean;
  options: string;
  shownIn: string;
  printed: boolean;
  visibleTo: Role[];
  help: string;
  active: boolean;
}

const emptyDraft = (): Draft => ({
  id: null,
  entity: 'Patient',
  key: 'patient.',
  label: '',
  kind: 'text',
  required: false,
  options: '',
  shownIn: '',
  printed: false,
  visibleTo: ['admin'],
  help: '',
  active: true,
});

export default function SetupCustomFieldsPage() {
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [rows, setRows] = useState<CustomFieldRow[]>(CUSTOM_FIELDS);
  const [entity, setEntity] = useState<string>('All entities');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState<CustomFieldRow | null>(null);
  const [retireNote, setRetireNote] = useState('');

  const visible = useMemo(() => (entity === 'All entities' ? rows : rows.filter((r) => r.entity === entity)), [rows, entity]);
  const byEntity = useMemo(() => CUSTOM_ENTITIES.map((e) => ({ entity: e, count: rows.filter((r) => r.entity === e).length, active: rows.filter((r) => r.entity === e && r.active).length })), [rows]);

  const check = useMemo(
    () =>
      checkCustomField(rows, {
        entity: draft.entity,
        key: draft.key,
        label: draft.label,
        kind: draft.kind,
        options: draft.options.split(',').map((o) => o.trim()).filter(Boolean),
        visibleTo: draft.visibleTo,
      }),
    [rows, draft],
  );

  const save = () => {
    const parsedOptions = draft.options.split(',').map((o) => o.trim()).filter(Boolean);
    const fresh = checkCustomField(rows, { entity: draft.entity, key: draft.key, label: draft.label, kind: draft.kind, options: parsedOptions, visibleTo: draft.visibleTo });
    if (!fresh.ok) {
      push({ title: `The register refuses this field — ${fresh.problem}`, description: fresh.hint ?? '', tone: 'critical' });
      return;
    }
    if (!draft.shownIn.trim()) {
      push({ title: 'Name where the field appears', description: 'A field with no screen against it is a field nobody fills in, and the first place it shows up is a report that reads as blank.', tone: 'critical' });
      return;
    }
    const row: CustomFieldRow = {
      id: draft.id ?? `cf-new-${rows.length + 1}`,
      entity: draft.entity,
      key: draft.key.trim(),
      label: draft.label.trim(),
      kind: draft.kind,
      required: draft.required,
      options: parsedOptions,
      shownIn: draft.shownIn.trim(),
      printed: draft.printed,
      visibleTo: draft.visibleTo,
      help: draft.help.trim() || 'No help text: whoever fills this in is guessing what it wants.',
      order: draft.id ? (rows.find((r) => r.id === draft.id)?.order ?? rows.length + 1) : rows.length + 1,
      active: draft.active,
      lastChange: { at: '2026-10-15 10:40', by: 'Hospital admin', what: draft.id ? 'Edited' : 'Added' },
    };
    setRows((list) => (draft.id ? list.map((r) => (r.id === draft.id ? row : r)) : [...list, row]));
    setEditing(false);
    const outcome = queueWrite(`Custom field ${row.key} on ${row.entity}${row.required ? ' (required)' : ''}, visible to ${row.visibleTo.join(', ')}`, {
      id: 'savePlatformSetting',
      recordId: 'platform.custom-fields',
      fields: { key: 'platform.custom-fields', scope: 'hospital-wide', fieldKey: row.key, entity: row.entity, kind: row.kind, required: row.required ? 'yes' : 'no', visibleTo: row.visibleTo.join(',') },
    });
    push({
      title: outcome.queued ? `${row.label} ${draft.id ? 'updated' : 'added'}` : `${row.label} not saved on this device`,
      description: outcome.queued
        ? `${row.shownIn} will show it once the field store reaches the server.${row.printed ? ' It prints on the documents that carry the entity.' : ''}`
        : `The field store is hospital-wide and this write is online-only${outcome.because ? `: ${outcome.because}` : ''}.`,
      tone: outcome.queued ? 'success' : 'warning',
    });
    setDraft(emptyDraft());
  };

  const retire = () => {
    if (!retiring) return;
    if (!retireNote.trim()) {
      push({ title: 'Retiring a field needs a reason', description: 'The note is what the next administrator reads when the field stops appearing, and it is what the register keeps when somebody asks why a value is missing.', tone: 'critical' });
      return;
    }
    setRows((list) => list.map((r) => (r.id === retiring.id ? { ...r, active: false, help: `${r.help} Retired: ${retireNote.trim()}`, lastChange: { at: '2026-10-15 10:40', by: 'Hospital admin', what: `Retired — ${retireNote.trim()}` } } : r)));
    const outcome = queueWrite(`Retire the custom field ${retiring.key} — ${retireNote.trim()}`, {
      id: 'savePlatformSetting',
      recordId: 'platform.custom-fields',
      fields: { key: 'platform.custom-fields', scope: 'hospital-wide', fieldKey: retiring.key, active: 'no', reason: retireNote.trim() },
    });
    push({
      title: `${retiring.label} retired`,
      description: `It stops appearing on ${retiring.shownIn.toLowerCase()}, and the values already stored stay readable: a register that forgets an old record is a register nobody can audit.${outcome.queued ? '' : ` Not queued: ${outcome.because}.`}`,
      tone: outcome.queued ? 'success' : 'warning',
    });
    setRetiring(null);
    setRetireNote('');
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="setup-custom-fields"
        subtitle={`${rows.length} field(s) across ${CUSTOM_ENTITIES.length} entities · ${rows.filter((r) => r.active).length} active, ${rows.filter((r) => !r.active).length} retired and still readable.`}
        actions={
          <Button variant="primary" onClick={() => { setDraft(emptyDraft()); setEditing(true); }}>
            <Plus className="size-4" aria-hidden /> Add a field
          </Button>
        }
        waiting="Values stored in a retired field stay on the record. What the field cannot do any more is appear on a new form, and that is the whole of what retiring means."
      />

      <AdminSiblings screenId="setup-custom-fields" />

      <Panel title="By entity" actions={<span className="text-xs text-text-secondary">eight entities carry custom fields</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {byEntity.map((e) => (
            <button
              key={e.entity}
              type="button"
              aria-pressed={entity === e.entity}
              onClick={() => setEntity(entity === e.entity ? 'All entities' : e.entity)}
              className={cx('rounded-md border px-3 py-2 text-left text-sm', entity === e.entity ? 'border-brand-500 bg-brand-50' : 'border-border-subtle hover:bg-surface-sunken')}
            >
              <span className="block font-medium text-text-primary">{e.entity}</span>
              <span className="block text-xs text-text-tertiary">
                <span className="font-numeric">{e.active}</span> active · <span className="font-numeric">{e.count - e.active}</span> retired
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={entity === 'All entities' ? 'Every custom field' : `Custom fields on ${entity}`} actions={<span className="text-xs text-text-secondary">{visible.length} row(s)</span>}>
        <ListView
          id="custom-fields"
          caption="Custom fields"
          rows={visible}
          rowId={(r) => r.id}
          onRowClick={(r) => {
            setDraft({
              id: r.id,
              entity: r.entity,
              key: r.key,
              label: r.label,
              kind: r.kind,
              required: r.required,
              options: r.options.join(', '),
              shownIn: r.shownIn,
              printed: r.printed,
              visibleTo: r.visibleTo,
              help: r.help,
              active: r.active,
            });
            setEditing(true);
          }}
          emptyLabel="No custom fields on this entity."
          columns={[
            { key: 'key', header: 'Key', width: '15rem', render: (r) => (<span><span className="font-numeric">{r.key}</span><span className="block text-xs text-text-tertiary">{r.entity}</span></span>) },
            { key: 'label', header: 'Label', render: (r) => (<span className={cx('font-medium', !r.active && 'text-text-tertiary line-through')}>{r.label}</span>) },
            { key: 'kind', header: 'Type', width: '7.5rem', hideBelow: 'md' },
            { key: 'required', header: 'Required', width: '7rem', hideBelow: 'md', render: (r) => (r.required ? 'yes' : '—') },
            { key: 'options', header: 'Values', hideBelow: 'lg', render: (r) => (r.options.length ? r.options.join(', ') : '—') },
            { key: 'shownIn', header: 'Shown in', hideBelow: 'lg', render: (r) => <span className="text-text-secondary">{r.shownIn}</span> },
            { key: 'printed', header: 'Printed', width: '6.5rem', hideBelow: 'lg', render: (r) => (r.printed ? 'yes' : '—') },
            { key: 'visibleTo', header: 'Who may see it', render: (r) => <span className="text-xs">{r.visibleTo.join(', ')}</span> },
            { key: 'state', header: 'State', width: '7rem', render: (r) => (<span className={r.active ? 'text-safety-success' : 'text-text-tertiary'}>{r.active ? 'active' : 'retired'}</span>) },
          ]}
        />
      </Panel>

      <Panel title="What a custom field is not allowed to be" actions={<span className="text-xs text-text-secondary">{CUSTOM_FIELD_RULES.length} rules</span>}>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {CUSTOM_FIELD_RULES.map((rule) => (
            <li key={rule.title} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-start gap-1.5 font-medium text-text-primary">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden /> {rule.title}
              </p>
              <p className="text-text-secondary">{rule.because}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="History, as the register keeps it" actions={<Tag className="size-4 text-text-tertiary" aria-hidden />}>
        <ul className="space-y-2 text-sm">
          {[...rows].sort((a, b) => b.lastChange.at.localeCompare(a.lastChange.at)).slice(0, 6).map((r) => (
            <li key={r.id} className="rounded-md border border-border-subtle px-3 py-2">
              <p className="font-medium text-text-primary">
                <span className="font-numeric">{r.key}</span> — {r.lastChange.what}
              </p>
              <p className="text-xs text-text-secondary">
                {r.lastChange.at} · {r.lastChange.by}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-tertiary">
          Every change is kept with who made it and when. A custom field is the one part of the record that changes shape without a release, so it is the part that needs the
          most history.
        </p>
      </Panel>

      {/* ------------------------------------------------------------------------------------------ add or edit */}
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title={draft.id ? `Custom field — ${draft.label || draft.key}` : 'Add a custom field'}
        description="Fifteen things to decide. The key is an identity on every record it is stored on; the label is what the person filling it in reads."
        width="xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={cx('mr-auto text-xs', check.ok ? 'text-safety-success' : 'text-safety-critical')}>
              {check.ok ? 'The field store would accept this.' : check.problem}
            </span>
            {draft.id && (
              <Button variant="ghost" onClick={() => setRetiring(rows.find((r) => r.id === draft.id) ?? null)}>
                Retire this field
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!check.ok || !draft.shownIn.trim()}>
              {draft.id ? 'Save the field' : 'Add the field'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <SafetyBanner severity={check.ok ? 'success' : 'critical'} title={check.ok ? 'Nothing to refuse' : 'The field store would refuse this'}>
            {check.ok
              ? 'The key is well formed and unique, the entity is one of the eight, the label is set for the people who will read it, and the field names who may see the value.'
              : `${check.problem} ${check.hint ?? ''}`}
          </SafetyBanner>

          <FieldSection title="What the field is" description="The key is written on every record it is stored on; the label is what somebody reads.">
            <SelectField label="Entity" name="cf-entity" value={draft.entity} onChange={(e) => setDraft({ ...draft, entity: e.target.value, key: `${e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12)}.` })} options={CUSTOM_ENTITIES.map((e) => ({ value: e, label: e }))} hint="Which record the value belongs to. A field on the wrong entity is a field nothing fills in." />
            <TextField label="Key" name="cf-key" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} hint="`entity.field` in lower case — `patient.occupation`. Changing it later migrates every record it is stored on." />
            <TextField label="Label" name="cf-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} hint="What the ward reads on the form and the report header." />
            <SelectField label="Type" name="cf-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CustomFieldRow['kind'] })} options={KINDS.map((k) => ({ value: k, label: k }))} hint="A list beats free text wherever the value feeds a report: that is the lesson the referral-source field was converted for." />
            <TextField label="Values (comma separated)" name="cf-options" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} hint="Required for a list or a switch, and at least two of them: a picker with one option is a checkbox that lies about being a choice." />
            <CheckboxField label="Required" name="cf-required" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} hint="Only where a record without it is incomplete. A required field on a screen somebody uses in a hurry is how a form gets filled with dashes." />
          </FieldSection>

          <FieldSection title="Where it appears, and to whom" description="A field with no screen is a field nobody fills in.">
            <TextField label="Shown in" name="cf-shownin" value={draft.shownIn} onChange={(e) => setDraft({ ...draft, shownIn: e.target.value })} hint="The screens and registers that will show it, named rather than implied." />
            <CheckboxField label="Prints on the document" name="cf-printed" checked={draft.printed} onChange={(e) => setDraft({ ...draft, printed: e.target.checked })} hint="A printed value has to be one the family may read, which is not the same as one the ward may read." />
            <SelectField
              label="Who may see the value"
              name="cf-roles"
              value={draft.visibleTo.join(',')}
              onChange={(e) => setDraft({ ...draft, visibleTo: e.target.value.split(',') as Role[] })}
              options={[1, 2, 3].map((n) => ({ value: ROLES.slice(0, n + 1).join(','), label: ROLES.slice(0, n + 1).join(', ') }))}
              hint="At least one role. A field nobody may read is a field that will be filled with anything, and a field everybody may read is how a ward starts collecting what it should not."
            />
            <TextAreaField label="Help text" name="cf-help" value={draft.help} onChange={(e) => setDraft({ ...draft, help: e.target.value })} hint="One sentence under the field on the form: what it wants and what it must not become." rows={2} />
          </FieldSection>

          <Panel title="Roles and what they will see">
            <ul className="space-y-1 text-sm">
              {ROLES.map((role) => (
                <li key={role} className="flex items-center gap-2">
                  <Eye className={cx('size-3.5', draft.visibleTo.includes(role) ? 'text-safety-success' : 'text-text-tertiary')} aria-hidden />
                  <span className={draft.visibleTo.includes(role) ? 'text-text-primary' : 'text-text-tertiary'}>
                    {role}
                    {draft.visibleTo.includes(role) ? ` — sees the value on ${draft.shownIn.trim() || 'the screens named above'}` : ' — does not see the field at all'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-tertiary">
              Visibility is enforced on read as well as on write: a field hidden from a role is absent from its API responses, not merely hidden in the interface.
            </p>
          </Panel>
        </div>
      </Sheet>

      {/* --------------------------------------------------------------------------------------------- retiring */}
      <Sheet
        open={Boolean(retiring)}
        onClose={() => { setRetiring(null); setRetireNote(''); }}
        title={retiring ? `Retire ${retiring.label}` : 'Retire a field'}
        description="Retiring stops the field appearing on new forms. It does not delete a single value already stored."
        width="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setRetiring(null); setRetireNote(''); }}>Keep it active</Button>
            <Button variant="primary" onClick={retire} disabled={!retireNote.trim()}>Retire the field</Button>
          </div>
        }
      >
        {retiring && (
          <div className="space-y-3">
            <SafetyBanner severity="warning" title="Values already stored stay readable">
              {retiring.key} holds values on {retiring.entity.toLowerCase()} records. The register keeps them and shows where they came from: the field disappears from the form,
              never from the record.
            </SafetyBanner>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ['Field', `${retiring.label} (${retiring.key})`],
                ['Shown in', retiring.shownIn],
                ['Printed', retiring.printed ? 'yes' : 'no'],
                ['Visible to', retiring.visibleTo.join(', ')],
                ['Last change', `${retiring.lastChange.at} · ${retiring.lastChange.by} · ${retiring.lastChange.what}`],
                ['Other fields on this entity', String(rows.filter((r) => r.entity === retiring.entity && r.id !== retiring.id && r.active).length)],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <TextAreaField label="Why it is being retired" name="cf-retire" value={retireNote} onChange={(e) => setRetireNote(e.target.value)} hint="Kept in the field’s history. This sentence is what somebody reads in two years when they ask why a value is missing." rows={2} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
