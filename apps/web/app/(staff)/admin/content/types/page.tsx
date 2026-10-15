'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { Archive, FileType2, Plus, ShieldCheck, Tags } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  AUDIENCE_LABELS,
  CONTENT_ITEMS,
  CONTENT_TYPES,
  checkContentType,
  type Audience,
  type ContentType,
} from '@/lib/content';

/* Content Type (P8) — the taxonomy the whole Download Centre hangs from.
 *
 * A content type is four decisions in one row, and each one is a rule somewhere else in the module:
 *
 *   - **the default audience** decides whether a share button is offered at all;
 *   - **whether approval is required** decides whether a patient sees a file before a clinician has read it;
 *   - **the retention period** decides when a share lapses, which is what the portal refuses with
 *     `dizi.document-expired` rather than showing an old document;
 *   - **whether it is active** decides whether new files may be filed under it — retiring a type never touches the
 *     files already under it, which is why retiring is a warning and not a delete.
 *
 * Two of the refusals are the ones that keep the taxonomy honest: a key is lower-case words because old uploads
 * point at it, and a patient-facing type has to require approval, because the alternative is a share button that
 * puts the first draft of a discharge summary in front of a patient.
 */

const AUDIENCE_ORDER: Audience[] = ['internal', 'patients', 'public'];

interface Draft {
  key: string;
  label: string;
  description: string;
  audienceDefault: Audience;
  requiresApproval: boolean;
  retentionDays: string;
  maxMb: string;
  active: boolean;
}

const blank = (): Draft => ({ key: '', label: '', description: '', audienceDefault: 'internal', requiresApproval: false, retentionDays: '0', maxMb: '10', active: true });

export default function ContentTypesPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [types, setTypes] = useState<ContentType[]>(CONTENT_TYPES);
  const [view, setView] = useState('In use');
  const [editing, setEditing] = useState<ContentType | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);

  const fileCount = (key: string) => CONTENT_ITEMS.filter((i) => i.contentTypeKey === key).length;

  const rows = useMemo(() => {
    if (view === 'Retired') return types.filter((t) => !t.active);
    if (view === 'Patient-facing') return types.filter((t) => t.audienceDefault !== 'internal');
    if (view === 'In use') return types.filter((t) => t.active);
    return types;
  }, [types, view]);

  const check = useMemo(
    () =>
      checkContentType(
        { key: draft.key.trim(), label: draft.label.trim(), audienceDefault: draft.audienceDefault, requiresApproval: draft.requiresApproval, retentionDays: Number(draft.retentionDays || 0), active: draft.active },
        { types, items: CONTENT_ITEMS },
      ),
    [draft, types],
  );

  const openEdit = (type: ContentType) => {
    setEditing(type);
    setCreating(true);
    setDraft({
      key: type.key,
      label: type.label,
      description: type.description,
      audienceDefault: type.audienceDefault,
      requiresApproval: type.requiresApproval,
      retentionDays: String(type.retentionDays),
      maxMb: String(type.maxMb),
      active: type.active,
    });
  };

  const save = () => {
    if (!check.ok) {
      push({ title: `The type is refused — ${check.reasons[0].code}`, description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const next: ContentType = {
      key: draft.key.trim(),
      label: draft.label.trim(),
      description: draft.description.trim(),
      audienceDefault: draft.audienceDefault,
      requiresApproval: draft.requiresApproval,
      retentionDays: Number(draft.retentionDays || 0),
      maxMb: Number(draft.maxMb || 0),
      active: draft.active,
    };
    setTypes((list) => (editing ? list.map((t) => (t.key === editing.key ? next : t)) : [...list, next]));
    const wrote = creating && !editing
      ? queueWrite(`Add content type ${next.key} (${next.label})`, { id: 'createContentType', recordId: next.key, fields: { key: next.key, label: next.label, audience: next.audienceDefault, approval: String(next.requiresApproval), retention: next.retentionDays } })
      : queueWrite(`Edit content type ${next.key} (${next.label})`, { id: 'updateContentType', recordId: next.key, fields: { label: next.label, audience: next.audienceDefault, approval: String(next.requiresApproval), retention: next.retentionDays, active: String(next.active) } });
    const retired = editing?.active && !next.active;
    setCreating(false);
    setEditing(null);
    setDraft(blank());
    push({
      title: retired ? `${next.label} retired` : editing ? `${next.label} saved` : `${next.label} added`,
      description: retired
        ? `${fileCount(next.key)} file(s) stay filed under it, readable, and nothing new can be filed under it. That is the difference between retiring a type and deleting one: a deleted type takes the hospital’s own history with it.`
        : `${AUDIENCE_LABELS[next.audienceDefault].label}, ${next.requiresApproval ? 'approval required' : 'no approval'}${next.retentionDays ? `, shares lapse after ${next.retentionDays} days` : ', shares stay open until withdrawn'}. ${check.warnings.length ? `Noted: ${check.warnings.map((w) => w.message).join(' ')}` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const active = types.filter((t) => t.active);
  const patientFacing = types.filter((t) => t.audienceDefault !== 'internal');
  const approvedTypes = types.filter((t) => t.requiresApproval);

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="content-type"
        subtitle={`${types.length} types · ${active.length} in use · ${patientFacing.length} can reach a patient · ${approvedTypes.length} require an approver.`}
        actions={
          <>
            <Link href="/admin/content/upload">
              <Button variant="ghost">Download Centre</Button>
            </Link>
            <Link href="/admin/content/shared">
              <Button variant="ghost">Share list</Button>
            </Link>
            <Button variant="primary" onClick={() => { setEditing(null); setDraft(blank()); setCreating(true); }}>
              <Plus className="size-4" aria-hidden /> Add a content type
            </Button>
          </>
        }
        waiting={types.some((t) => !t.active && fileCount(t.key) > 0) ? `${types.filter((t) => !t.active).length} retired type(s) still carry files. They are readable for as long as the retention rule says, and the upload dialog no longer offers them.` : undefined}
      />

      <AdminSiblings screenId="content-type" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="Types" value={String(types.length)} definition="Every type the Download Centre knows, retired ones included. A taxonomy is kept whole so that an old file can still say what it was." asOf={day} />
        <KpiTile label="In use" value={String(active.length)} definition="Types the upload dialog offers. Retiring one removes it from the dialog and from nothing else." asOf={day} />
        <KpiTile label="Patient-facing" value={String(patientFacing.length)} definition="Types whose default audience is a patient or the public. Each of them is the reason a file cannot be shared before a clinician has read it." asOf={day} />
        <KpiTile label="Needs an approver" value={String(approvedTypes.length)} definition="Types where the file is stored first and released second. The alternative is a share button that puts the first draft of a clinical document in front of a patient." asOf={day} />
        <KpiTile label="Biggest file allowed" value={`${Math.max(...types.map((t) => t.maxMb))} MB`} definition="The largest single file any type carries. Imaging is the reason: a CT series is tens of megabytes and a report is a few hundred kilobytes." asOf={day} />
        <KpiTile label="Files filed" value={String(CONTENT_ITEMS.length)} definition="Items across every type, which is what a retirement is weighed against — the number of files that would be orphaned by a delete." asOf={day} />
      </div>

      <SafetyBanner severity="info" title="A type is four decisions, and three of them are rules somewhere else">
        <p>
          The audience decides whether a share is offered; the approval flag decides whether a patient sees a file before a clinician has read it; the
          retention period decides when a share lapses, which the portal refuses with <span className="font-numeric">dizi.document-expired</span> rather than
          showing a document the hospital has stopped standing behind. A type is not a label — it is the rule that four other screens obey.
        </p>
      </SafetyBanner>

      <Panel
        title="The types"
        actions={
          <Segmented
            label="Which types"
            name="type-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'In use', label: `In use (${active.length})` },
              { value: 'All', label: `All (${types.length})` },
              { value: 'Patient-facing', label: `Patient-facing (${patientFacing.length})` },
              { value: 'Retired', label: `Retired (${types.length - active.length})` },
            ]}
          />
        }
      >
        <ListView
          id="content-types"
          caption="Content types in the Download Centre"
          rows={rows}
          rowId={(row) => row.key}
          onRowClick={(row) => openEdit(row)}
          rowActions={(row) => [
            { label: row.active ? 'Edit' : 'Edit and re-activate', onSelect: () => openEdit(row) },
            ...(row.active ? [{ label: 'Retire the type', onSelect: () => openEdit({ ...row, active: false }) }] : []),
          ]}
          columns={[
            { key: 'key', header: 'Key', width: '11rem', render: (row) => <span className="font-numeric text-xs">{row.key}</span> },
            { key: 'label', header: 'Type', render: (row) => <span className="block"><span className="block">{row.label}</span><span className="line-clamp-1 block text-xs text-text-tertiary">{row.description}</span></span> },
            { key: 'audience', header: 'Default audience', width: '11rem', render: (row) => <span className={cx(row.audienceDefault === 'internal' ? 'text-text-secondary' : 'text-brand-700')}>{AUDIENCE_LABELS[row.audienceDefault].label}</span> },
            { key: 'approval', header: 'Approver', width: '9rem', render: (row) => (row.requiresApproval ? <span className="text-safety-success">required</span> : <span className="text-text-tertiary">not required</span>) },
            { key: 'retention', header: 'Shares lapse', width: '9rem', render: (row) => (row.retentionDays ? `after ${row.retentionDays} days` : 'until withdrawn') },
            { key: 'maxMb', header: 'Max size', width: '6.5rem', numeric: true, render: (row) => `${row.maxMb} MB` },
            { key: 'files', header: 'Files', width: '5rem', numeric: true, render: (row) => String(fileCount(row.key)) },
            { key: 'active', header: 'State', width: '7rem', render: (row) => (row.active ? <span className="text-safety-success">in use</span> : <span className="text-text-tertiary">retired</span>) },
          ]}
        />
      </Panel>

      <Sheet
        open={creating}
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? `Edit ${editing.label}` : 'Add a content type'}
        description="Four decisions: who may see it by default, whether an approver has to release it, how long a share stays open, and how big a file it carries."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">
              {check.ok ? 'A key is never rewritten once a file points at it.' : `${check.reasons.length} refusal(s) — nothing is saved until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!check.ok}>
              <ShieldCheck className="size-4" aria-hidden /> {editing ? 'Save the type' : 'Add the type'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The type is refused — ${check.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {check.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {check.ok && check.warnings.length > 0 && (
            <SafetyBanner severity="warning" title="Saved, with something the register notes">
              <ul className="list-disc space-y-1 pl-5">
                {check.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="What it is called" description="The key is the identity old uploads point at; the label is what a person filing a file at 22:00 has to understand.">
            <TextField label="Key" name="key" value={draft.key} onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))} hint="Lower-case words joined by dashes, e.g. discharge-summary. Rewriting a key orphans every file filed under it." required />
            <TextField label="Label" name="label" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} hint="What the upload dialog shows. Two types with one label is how a hospital ends up with half its reports in each." required />
            <TextField label="Maximum file size (MB)" name="maxMb" value={draft.maxMb} onChange={(e) => setDraft((d) => ({ ...d, maxMb: e.target.value }))} inputMode="numeric" hint="A patient on mobile data is why this exists; a CT series is why it is not small." />
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField label="What this type is for" name="description" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={2} hint="One or two sentences. It appears in the upload dialog beside the type, which is where a filing mistake is prevented." />
            </div>
          </FieldSection>

          <FieldSection title="What it decides" description="The audience sets the default; the approval flag is what stops a first draft reaching a patient.">
            <SelectField
              label="Default audience"
              name="audienceDefault"
              value={draft.audienceDefault}
              onChange={(e) => setDraft((d) => ({ ...d, audienceDefault: e.target.value as Audience }))}
              options={AUDIENCE_ORDER.map((a) => ({ value: a, label: AUDIENCE_LABELS[a].label }))}
              hint={AUDIENCE_LABELS[draft.audienceDefault].because}
            />
            <SelectField
              label="Approver"
              name="requiresApproval"
              value={draft.requiresApproval ? 'yes' : 'no'}
              onChange={(e) => setDraft((d) => ({ ...d, requiresApproval: e.target.value === 'yes' }))}
              options={[{ value: 'yes', label: 'A clinician releases it before a patient sees it' }, { value: 'no', label: 'No approval' }]}
              hint="Required for any type whose default audience is a patient or the public — the sheet refuses the combination where it is not."
            />
            <TextField label="Shares lapse after (days)" name="retentionDays" value={draft.retentionDays} onChange={(e) => setDraft((d) => ({ ...d, retentionDays: e.target.value }))} inputMode="numeric" hint="0 to 730. Zero means until withdrawn, which is right for internal files and wrong for anything a patient reads." />
            <SelectField
              label="State"
              name="active"
              value={draft.active ? 'active' : 'retired'}
              onChange={(e) => setDraft((d) => ({ ...d, active: e.target.value === 'active' }))}
              options={[{ value: 'active', label: 'In use' }, { value: 'retired', label: 'Retired — no new files' }]}
              hint="Retiring a type keeps every file already filed under it readable, and takes it out of the upload dialog. Nothing is deleted."
            />
          </FieldSection>

          {editing && (
            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-medium text-text-primary">
                <Archive className="size-3.5" aria-hidden /> {fileCount(editing.key)} file(s) filed under this type
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                {CONTENT_ITEMS.filter((i) => i.contentTypeKey === editing.key)
                  .slice(0, 4)
                  .map((i) => (
                    <li key={i.id} className="font-numeric">
                      {i.ref} · {i.title}
                    </li>
                  ))}
                {fileCount(editing.key) > 4 && <li>and {fileCount(editing.key) - 4} more</li>}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                Every one of them keeps this type for as long as it is kept, which is why retiring is a warning rather than a delete: a type is the only
                thing that still says what an old file was.
              </p>
            </div>
          )}

          <p className="flex items-center gap-1 text-xs text-text-tertiary">
            <Tags className="size-3.5" aria-hidden /> Types are hospital-wide: every branch reads the same taxonomy, so a file filed at Uttara is found at
            Main Campus under the same label.
          </p>
          <p className="flex items-center gap-1 text-xs text-text-tertiary">
            <FileType2 className="size-3.5" aria-hidden /> The label is what the upload dialog shows; the key is what the contract, the audit entry and the
            share list carry.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
