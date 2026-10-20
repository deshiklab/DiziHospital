'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  FieldSection,
  KpiTile,
  Panel,
  SafetyBanner,
  Segmented,
  SelectField,
  Sheet,
  TextAreaField,
  TextField,
  cx,
  useToast,
} from '@dizi/ui';
import { CheckCircle2, FileUp, HardDrive, ShieldAlert, Tags, Undo2 } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  AUDIENCE_LABELS,
  CONTENT_ITEMS,
  CONTENT_TYPES,
  CONTENT_WAITING,
  SENSITIVE_FILE_NAME,
  checkShare,
  checkUpload,
  contentDigest,
  contentTypeByKey,
  expiringShares,
  itemById,
  openShares,
  sharesOf,
  type Audience,
  type ContentItem,
  type ContentShare,
} from '@/lib/content';

/* Upload / Share Content (P8) — the Download Centre’s writing side.
 *
 * Two decisions that the legacy screen merged into one button, and that are deliberately apart here:
 *
 *  1. **Uploading is storing a file**, and it happens on this node: the bytes land in the branch store and the row
 *     is queued with their hash. A file can therefore be uploaded, opened and shown to the ward with the uplink
 *     down — and a replay of the queued row cannot attach different bytes to it.
 *  2. **Sharing is a decision per recipient**, because a document leaves the hospital one person at a time. Each
 *     recipient is a row, an audience, an expiry and, when it is a patient, a clinician’s approval first.
 *
 * The screen also refuses file names that carry an MRN, a phone number or a diagnosis. A file name is copied into
 * an inbox, a download folder and a printout; the record keeps the identifier, the label does not.
 */

const STATUS_TONE: Record<ContentItem['status'], string> = {
  uploaded: 'text-safety-warning-text',
  approved: 'text-brand-700',
  shared: 'text-safety-success',
  returned: 'text-safety-critical-text',
  withdrawn: 'text-text-tertiary',
};

const STATUS_LABEL: Record<ContentItem['status'], string> = {
  uploaded: 'Waiting for approval',
  approved: 'Approved, not shared',
  shared: 'Shared',
  returned: 'Returned by the approver',
  withdrawn: 'Withdrawn',
};

interface Draft {
  title: string;
  fileName: string;
  mb: string;
  contentTypeKey: string;
  audience: Audience;
  tags: string;
  expiresOn: string;
  note: string;
}

interface ShareDraft {
  kind: ContentShare['recipientKind'];
  ref: string;
  name: string;
  expiresOn: string;
  note: string;
  notify: boolean;
}

export default function UploadContentPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [extra, setExtra] = useState<ContentItem[]>([]);
  const [shares, setShares] = useState<ContentShare[]>([]);
  const [view, setView] = useState('All');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState<ContentItem | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: '', fileName: '', mb: '', contentTypeKey: 'report', audience: 'patients', tags: '', expiresOn: '', note: '' });
  const [shareDraft, setShareDraft] = useState<ShareDraft>({ kind: 'patient', ref: '', name: '', expiresOn: '', note: '', notify: true });

  const items = useMemo(() => [...extra, ...CONTENT_ITEMS], [extra]);
  const allShares = useMemo(() => [...shares, ...openShares()], [shares]);
  const digest = useMemo(() => contentDigest(items, allShares, day), [items, allShares, day]);
  const expiring = useMemo(() => expiringShares(allShares, day, 30), [allShares, day]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (view === 'Waiting for approval' ? i.status === 'uploaded' : view === 'Returned' ? i.status === 'returned' : view === 'Patient-facing' ? i.audience !== 'internal' : view === 'Internal' ? i.audience === 'internal' : true))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q)))
      .sort((a, b) => b.uploadedOn.localeCompare(a.uploadedOn));
  }, [items, view, query]);

  const type = contentTypeByKey(draft.contentTypeKey);

  const check = useMemo(
    () =>
      checkUpload(
        { title: draft.title, fileName: draft.fileName, mb: Number(draft.mb || 0), contentTypeKey: draft.contentTypeKey, audience: draft.audience, tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean), expiresOn: draft.expiresOn, note: draft.note },
        { items, types: CONTENT_TYPES, today: day, approverAvailable: true },
      ),
    [draft, items, day],
  );

  const recipients = useMemo(
    () => (shareDraft.ref.trim() ? [{ kind: shareDraft.kind, ref: shareDraft.ref.trim(), name: shareDraft.name.trim() || shareDraft.ref.trim() }] : []),
    [shareDraft],
  );

  const shareCheck = useMemo(
    () => (sharing ? checkShare(sharing, recipients, { items, types: CONTENT_TYPES, today: day, approverAvailable: true, shares: allShares }) : null),
    [sharing, recipients, items, allShares, day],
  );

  const upload = () => {
    if (!check.ok) {
      push({ title: `The upload is refused — ${check.reasons[0].code}`, description: check.reasons[0].message, tone: 'critical' });
      return;
    }
    const n = extra.length + 1;
    const item: ContentItem = {
      id: `dc-new-${n}`,
      ref: `DC-2026-${String(200 + n).padStart(4, '0')}`,
      title: draft.title.trim(),
      fileName: draft.fileName.trim(),
      mb: Number(draft.mb || 0),
      mimeType: draft.fileName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      contentTypeKey: draft.contentTypeKey,
      audience: draft.audience,
      tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      ownerCode: 'EMP-1042',
      ownerName: 'R. Howlader',
      department: 'Medical records',
      sha256: `sha256:${'0'.repeat(8)}${Math.abs(draft.fileName.length * 7919).toString(16).padStart(8, '0')}${'f'.repeat(24)}`,
      status: 'uploaded',
      uploadedOn: day,
      expiresOn: draft.expiresOn || null,
      shareCount: 0,
      openCount: 0,
    };
    setExtra((list) => [item, ...list]);
    setUploading(false);
    const wrote = queueWrite(`Upload ${item.ref} — ${item.title}`, {
      id: 'uploadContent',
      recordId: item.ref,
      fields: { ref: item.ref, title: item.title, fileName: item.fileName, mb: item.mb, type: item.contentTypeKey, audience: item.audience, sha256: item.sha256, nodeId: 'DHK-01' },
    });
    setDraft({ title: '', fileName: '', mb: '', contentTypeKey: 'report', audience: 'patients', tags: '', expiresOn: '', note: '' });
    push({
      title: `${item.ref} stored on this node`,
      description: `The bytes are here now; the row drains with their hash, which is what stops a replay from attaching different bytes to it. ${
        type?.requiresApproval && item.audience !== 'internal'
          ? 'It cannot be shared outside the hospital until an approver releases it — the screen will say so on the share sheet.'
          : 'The audience is internal, so the ward can open it as soon as it appears in the Download Centre.'
      } ${check.warnings.length ? `Noted: ${check.warnings.map((w) => w.message).join(' ')}` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (check.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const share = () => {
    if (!sharing || !shareCheck) return;
    if (!shareCheck.ok) {
      push({ title: `The share is refused — ${shareCheck.reasons[0].code}`, description: shareCheck.reasons[0].message, tone: 'critical' });
      return;
    }
    const n = shares.length + 1;
    const row: ContentShare = {
      id: `sh-new-${n}`,
      itemId: sharing.id,
      recipientKind: shareDraft.kind,
      recipientRef: shareDraft.ref.trim(),
      recipientName: shareDraft.name.trim() || shareDraft.ref.trim(),
      sharedByCode: 'EMP-1042',
      sharedOn: day,
      expiresOn: shareDraft.expiresOn || null,
      note: shareDraft.note.trim(),
      notified: shareDraft.notify,
      openCount: 0,
      revokedOn: null,
      revokedBy: null,
      revokeReason: '',
    };
    setShares((list) => [row, ...list]);
    setExtra((list) => list.map((i) => (i.id === sharing.id ? { ...i, status: 'shared', shareCount: i.shareCount + 1 } : i)));
    const wrote = queueWrite(`Share ${sharing.ref} with ${row.recipientName}`, {
      id: 'shareContent',
      recordId: sharing.ref,
      fields: { ref: sharing.ref, recipients: `${row.recipientKind}:${row.recipientRef}`, expiresOn: row.expiresOn, notify: String(row.notified), note: row.note },
    });
    setSharing(null);
    setShareDraft({ kind: 'patient', ref: '', name: '', expiresOn: '', note: '', notify: true });
    push({
      title: `${sharing.ref} shared with ${row.recipientName}`,
      description: `One row per recipient, so it can be taken back from this person without touching the others. ${
        row.notified ? 'The recipient is told through the internal noticeboard — the channel that works with the uplink down.' : 'No notification: they will find it in the share list.'
      } ${shareCheck.warnings.length ? `Noted: ${shareCheck.warnings.map((w) => w.message).join(' ')}` : ''}${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? (shareCheck.warnings.length ? 'warning' : 'success') : 'warning',
    });
  };

  const approve = (target: ContentItem, decision: 'approved' | 'returned') => {
    const note = decision === 'returned' ? 'The audited figures in the appendix are from August, not September. Re-export before sharing.' : '';
    setExtra((list) => list.map((i) => (i.id === target.id ? { ...i, status: decision, approvedBy: 'Dr. S. Chowdhury', approvedOn: `${day} 11:40`, returnedNote: note || i.returnedNote } : i)));
    const wrote = queueWrite(`${decision === 'approved' ? 'Approve' : 'Return'} ${target.ref} — ${target.title}`, {
      id: 'approveContentItem',
      recordId: target.ref,
      fields: { ref: target.ref, decision, note },
    });
    push({
      title: decision === 'approved' ? `${target.ref} approved` : `${target.ref} returned`,
      description:
        decision === 'approved'
          ? `The approver’s name and the time are on the item. This is an online-only act: it is what the portal and the website read from, and an approval that exists only in a queue is one the approver believes is published.${wrote.queued ? '' : ` Refused here: ${wrote.because}.`}`
          : 'Returned with the reason attached to the item, so the uploader sees what to change rather than only that their file was not approved.',
      tone: wrote.queued ? (decision === 'approved' ? 'success' : 'warning') : 'critical',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="content-upload"
        subtitle={`${day} · ${digest.items} items · ${digest.storeMb} MB on this node · ${digest.awaitingApproval} waiting for an approver.`}
        actions={
          <>
            <Link href="/admin/content/types">
              <Button variant="ghost">Content types</Button>
            </Link>
            <Link href="/admin/content/shared">
              <Button variant="ghost">Share list</Button>
            </Link>
            <Button variant="primary" onClick={() => setUploading(true)}>
              <FileUp className="size-4" aria-hidden /> Upload a file
            </Button>
          </>
        }
        waiting={digest.returned ? `${digest.returned} file(s) returned by an approver and not yet re-uploaded. A returned file is still in the Download Centre, marked, so the ward does not keep handing out the version that was refused.` : undefined}
      />

      <AdminSiblings screenId="content-upload" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Files" value={String(digest.items)} definition="Everything in the Download Centre, internal and patient-facing. The store is this branch’s, so the count is the count on this node and the cloud reconciles it." asOf={day} />
        <KpiTile label="Store used" value={`${digest.storeMb} MB`} definition="Bytes held on this node. Imaging is why this figure matters: a CT series is 40 MB and a discharge summary is 400 kB, and the retention rule is what stops the store growing forever." asOf={day} />
        <KpiTile label="Waiting for an approver" value={String(digest.awaitingApproval)} definition="Uploaded and not released. Anything patient-facing waits here, and the share sheet refuses to move it on — a clinical document reaches a patient after a clinician has read it." asOf={day} footnote={digest.awaitingApproval ? 'nothing patient-facing moves until it is released' : undefined} />
        <KpiTile label="Returned" value={String(digest.returned)} definition="Sent back with a reason. A returned file is not deleted: the ward still sees it, marked, which is safer than a document that vanishes from the list while copies circulate." asOf={day} />
        <KpiTile label="Open shares" value={String(digest.openShares)} definition="Rows where somebody outside the file’s owner can see it. Each recipient is a row, so this is people rather than documents." asOf={day} />
        <KpiTile label="Never opened" value={String(digest.neverOpened)} definition="Shared and not opened. For a clinical document this is the number that says a share mechanism did not work — and it is why the share list records openings at all." asOf={day} footnote={digest.neverOpened ? 'the share list names them' : undefined} />
        <KpiTile label="Lapsing in 30 days" value={String(expiring.length)} definition="Shares whose expiry is inside a month. Extending the ones that still matter beats discovering a lapsed share in the portal, where the patient is told the document is no longer available." asOf={day} />
      </div>

      {expiring.length > 0 && (
        <SafetyBanner severity="info" title={`${expiring.length} share(s) lapse within 30 days`}>
          <p>
            {expiring
              .slice(0, 4)
              .map((s) => `${itemById(s.itemId)?.ref ?? s.itemId} → ${s.recipientName} on ${s.expiresOn}`)
              .join(' · ')}
            {expiring.length > 4 ? ` and ${expiring.length - 4} more` : ''}. A lapsed share is refused in the portal with `dizi.document-expired` and the patient is
            offered a fresh request — which is better than showing a clinical document the hospital has stopped standing behind, and worse than
            extending the ones that are still clinically true.
          </p>
        </SafetyBanner>
      )}

      <Panel
        title="The Download Centre"
        actions={
          <Segmented
            label="Which files"
            name="content-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'All', label: `All (${items.length})` },
              { value: 'Waiting for approval', label: `Waiting (${digest.awaitingApproval})` },
              { value: 'Returned', label: `Returned (${digest.returned})` },
              { value: 'Patient-facing', label: 'Patient-facing' },
              { value: 'Internal', label: 'Internal' },
            ]}
          />
        }
      >
        <ListView
          id="content-items"
          caption={`Files in the Download Centre on ${day}`}
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => setSharing(row)}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Title, file name, reference or tag' }}
          rowActions={(row) => [
            { label: 'Share with somebody', onSelect: () => setSharing(row) },
            ...(row.status === 'uploaded'
              ? [
                  { label: 'Approve', onSelect: () => approve(row, 'approved') },
                  { label: 'Return with a reason', onSelect: () => approve(row, 'returned') },
                ]
              : []),
            { label: 'Copy the reference', onSelect: () => push({ title: `${row.ref} copied`, description: 'A telephone call quotes the reference rather than describing the file, which is how the wrong document gets sent.', tone: 'info' }) },
          ]}
          columns={[
            { key: 'ref', header: 'Ref', width: '9rem', render: (row) => <span className="font-numeric text-xs">{row.ref}</span> },
            { key: 'title', header: 'File', render: (row) => <span className="block"><span className="block">{row.title}</span><span className="block text-xs text-text-tertiary">{row.fileName} · {row.mb} MB</span></span> },
            { key: 'type', header: 'Type', width: '9rem', hideBelow: 'lg', render: (row) => contentTypeByKey(row.contentTypeKey)?.label ?? row.contentTypeKey },
            { key: 'audience', header: 'Audience', width: '10rem', render: (row) => <span className={cx(row.audience === 'internal' ? 'text-text-secondary' : 'text-brand-700')}>{AUDIENCE_LABELS[row.audience].label}</span> },
            { key: 'status', header: 'Status', width: '11rem', render: (row) => <span className={cx('font-medium', STATUS_TONE[row.status])}>{STATUS_LABEL[row.status]}</span> },
            { key: 'shares', header: 'Shares', width: '6rem', numeric: true, render: (row) => String(row.shareCount) },
            { key: 'opens', header: 'Opened', width: '6rem', numeric: true, hideBelow: 'lg', render: (row) => String(row.openCount) },
            { key: 'owner', header: 'Uploaded by', hideBelow: 'xl', render: (row) => `${row.ownerName} · ${row.department}` },
            { key: 'date', header: 'Uploaded', width: '7.5rem', hideBelow: 'lg', render: (row) => <span className="font-numeric">{row.uploadedOn}</span>, sortable: true },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="The three audiences" actions={<span className="text-xs text-text-secondary">{CONTENT_TYPES.length} types</span>}>
          <ul className="space-y-2">
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((key) => (
              <li key={key} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="text-sm font-medium text-text-primary">{AUDIENCE_LABELS[key].label}</p>
                <p className="text-xs text-text-secondary">Who sees it: {AUDIENCE_LABELS[key].who}</p>
                <p className="text-xs text-text-tertiary">{AUDIENCE_LABELS[key].because}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="What this screen is waiting for">
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
            {CONTENT_WAITING.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-tertiary">
            The rule the file name check enforces: a name carrying an MRN, a phone number or a diagnosis is refused
            (<span className="font-numeric">{SENSITIVE_FILE_NAME.source.slice(0, 34)}…</span>) because a file name is copied into inboxes and download folders.
          </p>
        </Panel>
      </div>

      <Sheet
        open={uploading}
        onClose={() => setUploading(false)}
        title="Upload a file"
        description="The bytes are stored on this node; the row carries the hash and drains when the uplink returns."
        width="xl"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">
              {check.ok
                ? `This node holds ${digest.storeMb} MB today${type ? ` and ${type.label} may carry ${type.maxMb} MB per file` : ''}.`
                : `${check.reasons.length} refusal(s) — the file is not stored until they are answered.`}
            </span>
            <Button variant="ghost" onClick={() => setUploading(false)}>Cancel</Button>
            <Button variant="primary" onClick={upload} disabled={!check.ok}>
              <HardDrive className="size-4" aria-hidden /> Store and queue
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!check.ok && (
            <SafetyBanner severity="critical" title={`The upload is refused — ${check.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {check.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {check.ok && check.warnings.length > 0 && (
            <SafetyBanner severity="warning" title="Stored, with something the register notes">
              <ul className="list-disc space-y-1 pl-5">
                {check.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="The file" description="What it is, and what it is called. The name is checked because it travels further than the file.">
            <TextField label="Title" name="title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} hint="What a colleague would search for, e.g. “Chest X-ray report — A. Siddika”." required />
            <TextField label="File name" name="fileName" value={draft.fileName} onChange={(e) => setDraft((d) => ({ ...d, fileName: e.target.value }))} hint="As it will be stored and downloaded. An MRN, a phone number or a diagnosis in here is refused." required />
            <TextField label="Size (MB)" name="mb" value={draft.mb} onChange={(e) => setDraft((d) => ({ ...d, mb: e.target.value }))} inputMode="decimal" hint={type ? `${type.label} carries up to ${type.maxMb} MB. A patient on mobile data is why the limit exists.` : 'Choose a type first.'} />
            <SelectField
              label="Content type"
              name="contentTypeKey"
              value={draft.contentTypeKey}
              onChange={(e) => {
                const next = contentTypeByKey(e.target.value);
                setDraft((d) => ({ ...d, contentTypeKey: e.target.value, audience: next?.audienceDefault ?? d.audience }));
              }}
              options={CONTENT_TYPES.filter((t) => t.active).map((t) => ({ value: t.key, label: `${t.label}${t.requiresApproval ? ' — needs an approver' : ''}` }))}
              hint={type?.description}
            />
            <TextField label="Tags" name="tags" value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} hint="Comma separated. The Download Centre is searched by tag more than by title." />
            <TextField label="Available until" name="expiresOn" value={draft.expiresOn} onChange={(e) => setDraft((d) => ({ ...d, expiresOn: e.target.value }))} placeholder="YYYY-MM-DD" hint={type && type.retentionDays > 0 ? `${type.label} keeps shares open for ${type.retentionDays} days by default.` : 'Empty means until it is withdrawn, which only suits internal files.'} />
          </FieldSection>

          <FieldSection title="Who may see it" description="The audience decides the approval path, the expiry default and whether a share button is offered at all.">
            <SelectField
              label="Audience"
              name="audience"
              value={draft.audience}
              onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value as Audience }))}
              options={(Object.keys(AUDIENCE_LABELS) as Audience[]).map((k) => ({ value: k, label: AUDIENCE_LABELS[k].label }))}
              hint={AUDIENCE_LABELS[draft.audience].because}
            />
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField label="Note for the approver" name="note" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} rows={2} hint="Optional, and it is the sentence the approver reads first. Say what the file is for rather than repeating the title." />
            </div>
          </FieldSection>

          {type?.requiresApproval && draft.audience !== 'internal' && (
            <SafetyBanner severity="info" title="This file goes into the approval queue">
              <p>
                {type.label} files reach patients after a clinician has released them. The upload is stored and visible to staff immediately, and the share
                sheet refuses a patient-facing share until it is approved — <span className="font-numeric">dizi.content-not-approved</span> is the refusal the
                desk sees if they try.
              </p>
            </SafetyBanner>
          )}
        </div>
      </Sheet>

      <Sheet
        open={Boolean(sharing)}
        onClose={() => setSharing(null)}
        title={sharing ? `Share ${sharing.ref}` : 'Share'}
        description="One recipient is one row: a document is taken back from a person, not from everybody at once."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">
              {shareCheck && !shareCheck.ok ? `${shareCheck.reasons.length} refusal(s) — the share is not written.` : 'Each recipient becomes its own row, with its own expiry and its own withdrawal.'}
            </span>
            <Button variant="ghost" onClick={() => setSharing(null)}>Cancel</Button>
            <Button variant="primary" onClick={share} disabled={!shareCheck?.ok}>
              <CheckCircle2 className="size-4" aria-hidden /> Share
            </Button>
          </>
        }
      >
        {sharing && shareCheck && (
          <div className="space-y-3">
            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <p className="text-sm font-medium text-text-primary">{sharing.title}</p>
              <p>
                {contentTypeByKey(sharing.contentTypeKey)?.label} · {AUDIENCE_LABELS[sharing.audience].label} · {sharing.fileName} ·{' '}
                <span className="font-numeric">{sharing.sha256.slice(0, 22)}…</span>
              </p>
              <p className="mt-1">
                Already shared with {sharesOf(sharing.id).filter((s) => !s.revokedOn).length + shares.filter((s) => s.itemId === sharing.id).length} recipient(s);
                opened {sharing.openCount + shares.filter((s) => s.itemId === sharing.id).reduce((n, s) => n + s.openCount, 0)} time(s).
              </p>
            </div>

            {!shareCheck.ok && (
              <SafetyBanner severity="critical" title={`The share is refused — ${shareCheck.reasons[0].code}`}>
                <ul className="list-disc space-y-1 pl-5">
                  {shareCheck.reasons.map((r) => (
                    <li key={r.code}>{r.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}
            {shareCheck.ok && shareCheck.warnings.length > 0 && (
              <SafetyBanner severity="warning" title="Shared, with something the register notes">
                <ul className="list-disc space-y-1 pl-5">
                  {shareCheck.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </SafetyBanner>
            )}

            <FieldSection title="Who gets it" description="A patient share is a share to one MRN; a department or a role expands to the people in it when the queue drains.">
              <SelectField
                label="Recipient kind"
                name="kind"
                value={shareDraft.kind}
                onChange={(e) => setShareDraft((d) => ({ ...d, kind: e.target.value as ContentShare['recipientKind'] }))}
                options={[
                  { value: 'patient', label: 'A patient (by MRN)' },
                  { value: 'staff', label: 'One member of staff' },
                  { value: 'department', label: 'A department' },
                  { value: 'role', label: 'A role, across the hospital' },
                  { value: 'public', label: 'The public — portal and website' },
                ]}
              />
              <TextField label="Recipient" name="recipientRef" value={shareDraft.ref} onChange={(e) => setShareDraft((d) => ({ ...d, ref: e.target.value }))} hint={shareDraft.kind === 'patient' ? 'The MRN, e.g. SH-102388. A name is refused: a share goes to a record, not to a person who sounds right.' : shareDraft.kind === 'public' ? 'The website reference: website.' : 'A staff id, a department code or a role name.'} required />
              <TextField label="Shown as" name="recipientName" value={shareDraft.name} onChange={(e) => setShareDraft((d) => ({ ...d, name: e.target.value }))} hint="How the share list names them, so a withdrawal can be aimed at the right row." />
              <TextField label="Available until" name="shareExpires" value={shareDraft.expiresOn} onChange={(e) => setShareDraft((d) => ({ ...d, expiresOn: e.target.value }))} placeholder="YYYY-MM-DD" hint="A lapsed share is refused in the portal rather than quietly shown." />
              <SelectField label="Tell them" name="notify" value={shareDraft.notify ? 'yes' : 'no'} onChange={(e) => setShareDraft((d) => ({ ...d, notify: e.target.value === 'yes' }))} options={[{ value: 'yes', label: 'Send an internal notice' }, { value: 'no', label: 'No notification — they will find it' }]} hint="Internal notices work with the uplink down. A patient is told through the portal, never by an outbound channel they have not consented to." />
              <TextField label="Note" name="shareNote" value={shareDraft.note} onChange={(e) => setShareDraft((d) => ({ ...d, note: e.target.value }))} hint="Optional. It is what the recipient reads beside the file." />
            </FieldSection>

            <div className="rounded-md border border-border-subtle px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-medium text-text-primary">
                <ShieldAlert className="size-3.5" aria-hidden /> What happens when this goes wrong
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                A share to the wrong MRN is withdrawn, not deleted: the withdrawal keeps a reason and the name of the person who did it, and the portal
                refuses the lapsed copy rather than showing it. If a patient-facing file has not been approved, this sheet will not write the share at
                all — the refusal is <span className="font-numeric">dizi.content-not-approved</span> and the fix is the approver’s screen, not a second share.
              </p>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
