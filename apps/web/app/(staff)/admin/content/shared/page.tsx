'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, cx, useToast } from '@dizi/ui';
import { BellOff, Clock, Eye, Link2, Undo2, UserRound } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  CONTENT_ITEMS,
  LAPSED_SERVICE_LINE,
  SHARES,
  contentTypeByKey,
  contentDigest,
  expiringShares,
  itemById,
  type ContentShare,
} from '@/lib/content';

/* Content Share List (P8) — who has what, until when, and whether they opened it.
 *
 * A share is a row, not a flag on a file. That is what makes the three things this screen does possible:
 *
 *  1. **Withdrawal is aimed at one person.** Taking a discharge summary back from a ward manager does not touch
 *     the patient’s own copy or the referring GP’s, and the withdrawal keeps a reason and a name. A withdrawn row
 *     is not deleted: a document that exists in somebody’s downloads folder is a fact the register has to hold.
 *  2. **A lapsed share is a state, not a silence.** The portal refuses it with `dizi.document-expired` and offers a
 *     fresh request rather than showing a clinical document the hospital has stopped standing behind.
 *  3. **Opening is recorded.** “Shared and never opened” is the number that says a share mechanism did not work —
 *     for a clinical document, an unopened share is the same as no share at all, and nobody finds out otherwise.
 */

const KIND_LABEL: Record<ContentShare['recipientKind'], string> = {
  staff: 'A member of staff',
  department: 'A department',
  role: 'A role',
  patient: 'A patient',
  public: 'The public',
};

const stateOf = (share: ContentShare, today: string): { label: string; tone: string; hint: string } => {
  if (share.revokedOn) return { label: 'Withdrawn', tone: 'text-text-tertiary', hint: `Withdrawn by ${share.revokedBy} on ${share.revokedOn}: ${share.revokeReason}` };
  if (share.expiresOn && share.expiresOn < today) return { label: 'Lapsed', tone: 'text-safety-warning-text', hint: 'The portal refuses a lapsed share and offers a fresh request.' };
  if (share.openCount === 0) return { label: 'Not opened', tone: 'text-safety-critical-text', hint: 'Shared and never opened: for a clinical document this is the same as not sharing it.' };
  return { label: 'Open', tone: 'text-safety-success', hint: `Opened ${share.openCount} time(s).` };
};

export default function ContentShareListPage() {
  const day = todayIso();
  const { queueWrite } = useShell();
  const { push } = useToast();
  const [shares, setShares] = useState<ContentShare[]>(SHARES);
  const [view, setView] = useState('Open');
  const [query, setQuery] = useState('');
  const [withdrawing, setWithdrawing] = useState<ContentShare | null>(null);
  const [reason, setReason] = useState('');

  const digest = useMemo(() => contentDigest(CONTENT_ITEMS, shares, day), [shares, day]);
  const expiring = useMemo(() => expiringShares(shares, day, 30), [shares, day]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shares
      .filter((s) =>
        view === 'Open'
          ? !s.revokedOn && !(s.expiresOn && s.expiresOn < day)
          : view === 'Not opened'
            ? !s.revokedOn && s.openCount === 0
            : view === 'Lapsed'
              ? !s.revokedOn && Boolean(s.expiresOn && s.expiresOn < day)
              : view === 'Withdrawn'
                ? Boolean(s.revokedOn)
                : view === 'To patients'
                  ? s.recipientKind === 'patient' || s.recipientKind === 'public'
                  : true,
      )
      .filter((s) => {
        if (!q) return true;
        const item = itemById(s.itemId);
        return s.recipientName.toLowerCase().includes(q) || s.recipientRef.toLowerCase().includes(q) || (item?.title.toLowerCase().includes(q) ?? false) || (item?.ref.toLowerCase().includes(q) ?? false);
      })
      .sort((a, b) => (b.sharedOn + b.id).localeCompare(a.sharedOn + a.id));
  }, [shares, view, query, day]);

  const withdraw = () => {
    if (!withdrawing) return;
    if (reason.trim().length < 12) {
      push({ title: 'A withdrawal needs a reason', description: 'It goes on the record with your name against it. “Wrong patient” and “the report was revised” are different failures, and the reason is what the audit reads.', tone: 'critical' });
      return;
    }
    const item = itemById(withdrawing.itemId);
    setShares((list) => list.map((s) => (s.id === withdrawing.id ? { ...s, revokedOn: day, revokedBy: 'R. Howlader', revokeReason: reason.trim() } : s)));
    const wrote = queueWrite(`Withdraw ${item?.ref ?? withdrawing.itemId} from ${withdrawing.recipientName}`, {
      id: 'revokeContentShare',
      recordId: `${item?.ref ?? withdrawing.itemId}/${withdrawing.id}`,
      fields: { item: item?.ref ?? withdrawing.itemId, share: withdrawing.id, recipient: withdrawing.recipientName, reason: reason.trim() },
    });
    setWithdrawing(null);
    setReason('');
    push({
      title: `Withdrawn from ${withdrawing.recipientName}`,
      description: `The other recipients keep their copy: a share is one row per person, so a withdrawal is aimed at the person it is about. The portal refuses this row from now on.${wrote.queued ? '' : ` Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="content-share-list"
        subtitle={`${shares.length} share rows · ${digest.openShares} open · ${digest.neverOpened} never opened · ${digest.lapsed} lapsed.`}
        actions={
          <>
            <Link href="/admin/content/upload">
              <Button variant="ghost">Download Centre</Button>
            </Link>
            <Link href="/admin/content/types">
              <Button variant="ghost">Content types</Button>
            </Link>
          </>
        }
        waiting={digest.neverOpened ? `${digest.neverOpened} share(s) nobody has opened. For a clinical document an unopened share is the same as no share at all — the recipient should be told in person, not by a second share.` : undefined}
      />

      <AdminSiblings screenId="content-share-list" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <KpiTile label="Share rows" value={String(shares.length)} definition="One row per recipient. This is people, not documents: the same discharge summary shared with eight people is eight rows, and each can be withdrawn alone." asOf={day} />
        <KpiTile label="Open" value={String(digest.openShares)} definition="Rows that still work. A lapsed row is not deleted — it is refused in the portal, which is the difference between a patient being told and a patient assuming." asOf={day} />
        <KpiTile label="Never opened" value={String(digest.neverOpened)} definition="Shared, not withdrawn, not lapsed, and nobody opened it. The number that says the sharing worked on paper and not in practice." asOf={day} footnote={digest.neverOpened ? 'name them and telephone instead' : undefined} />
        <KpiTile label="To patients" value={String(digest.patientShares)} definition="Open shares held by the patient they are about. A patient share is a share to one MRN — never to a group, a family or an address." asOf={day} />
        <KpiTile label="To the public" value={String(digest.publicShares)} definition="Open shares on the website and the portal’s public pages. These carry no patient identifiers at all, because they are read by people who are not patients." asOf={day} />
        <KpiTile label="Lapsed" value={String(digest.lapsed)} definition="Past their expiry and still on the register. The portal refuses them, so the desk sees this list before a patient discovers a document is gone." asOf={day} />
        <KpiTile label="Lapsing in 30 days" value={String(expiring.length)} definition="About to lapse. Extending one that is still clinically true costs a press; a patient who finds their report gone telephones the department instead." asOf={day} />
      </div>

      {expiring.length > 0 && (
        <SafetyBanner severity="info" title={`${expiring.length} share(s) lapse within 30 days`}>
          <p>
            {expiring.slice(0, 3).map((s) => `${s.recipientName} loses ${itemById(s.itemId)?.ref ?? s.itemId} on ${s.expiresOn}`).join(' · ')}
            {expiring.length > 3 ? ` and ${expiring.length - 3} more` : ''}. {LAPSED_SERVICE_LINE}
          </p>
        </SafetyBanner>
      )}

      <Panel
        title="The share list"
        actions={
          <Segmented
            label="Which shares"
            name="share-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Open', label: `Open (${shareCount(shares, day).open})` },
              { value: 'Not opened', label: `Not opened (${shareCount(shares, day).notOpened})` },
              { value: 'Lapsed', label: `Lapsed (${shareCount(shares, day).lapsed})` },
              { value: 'Withdrawn', label: `Withdrawn (${shareCount(shares, day).withdrawn})` },
              { value: 'To patients', label: 'To patients' },
              { value: 'Everything', label: `Everything (${shares.length})` },
            ]}
          />
        }
      >
        <ListView
          id="content-share-list"
          caption={`Shares made from the Download Centre`}
          rows={rows}
          rowId={(row) => row.id}
          onRowClick={(row) => (row.revokedOn ? undefined : setWithdrawing(row))}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Recipient, MRN, file reference or title' }}
          rowActions={(row) => [
            ...(row.revokedOn ? [] : [{ label: 'Withdraw this share', onSelect: () => setWithdrawing(row) }]),
            { label: 'Open the file', onSelect: () => push({ title: `${itemById(row.itemId)?.ref ?? row.itemId} opened`, description: 'The file itself is in the Download Centre; opening it from here is recorded against the same row as any other opening.', tone: 'info' }) },
          ]}
          columns={[
            { key: 'item', header: 'File', render: (row) => { const item = itemById(row.itemId); return <span className="block"><span className="block">{item?.title ?? row.itemId}</span><span className="font-numeric block text-xs text-text-tertiary">{item?.ref} · {contentTypeByKey(item?.contentTypeKey ?? '')?.label ?? '—'}</span></span>; } },
            { key: 'recipient', header: 'Recipient', render: (row) => <span className="block"><span className="flex items-center gap-1">{row.recipientKind === 'patient' ? <UserRound className="size-3.5" aria-hidden /> : row.recipientKind === 'public' ? <Link2 className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}{row.recipientName}</span><span className="font-numeric block text-xs text-text-tertiary">{row.recipientRef}</span></span> },
            { key: 'kind', header: 'Kind', width: '8.5rem', hideBelow: 'lg', render: (row) => KIND_LABEL[row.recipientKind] },
            { key: 'shared', header: 'Shared', width: '7.5rem', render: (row) => <span className="font-numeric">{row.sharedOn}</span>, sortable: true },
            { key: 'expires', header: 'Until', width: '7.5rem', render: (row) => (row.expiresOn ? <span className="font-numeric">{row.expiresOn}</span> : <span className="text-text-tertiary">until withdrawn</span>) },
            { key: 'opens', header: 'Opened', width: '6rem', numeric: true, render: (row) => (row.openCount === 0 ? <span className="text-safety-critical-text">never</span> : <span className="flex items-center justify-end gap-1"><Eye className="size-3.5" aria-hidden />{row.openCount}</span>) },
            { key: 'state', header: 'State', width: '8rem', render: (row) => { const st = stateOf(row, day); return <span className={cx('font-medium', st.tone)} title={st.hint}>{st.label}</span>; } },
            { key: 'notified', header: 'Told', width: '7rem', hideBelow: 'xl', render: (row) => (row.notified ? 'internal notice' : <span className="text-text-tertiary">not told</span>) },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="What each kind of recipient means">
          <ul className="space-y-2 text-xs text-text-secondary">
            <li>
              <span className="font-medium text-text-primary">A patient</span> — one MRN. The portal shows it to that patient and to nobody else, including
              relatives who are also patients.
            </li>
            <li>
              <span className="font-medium text-text-primary">A department or a role</span> — expands to the people in it when the queued row drains. A
              department that gains a member tomorrow has the file; a member who leaves this afternoon loses it.
            </li>
            <li>
              <span className="font-medium text-text-primary">The public</span> — the website and the portal’s public pages. No patient identifiers, ever,
              because the audience is people who are not this hospital’s patients.
            </li>
            <li className="flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden /> <span className="font-medium text-text-primary">An expiry</span> — the hospital’s own statement
              about how long a document is worth sharing, and the reason the portal can refuse a lapsed copy rather than leave it up.
            </li>
          </ul>
        </Panel>
        <Panel title="Withdrawing a share">
          <p className="text-xs text-text-secondary">
            A withdrawal is an append: it writes who withdrew the share, when and why, and it never deletes the row or the file. Three consequences, all
            deliberate:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-text-secondary">
            <li>The recipient’s copy in their downloads folder is out of the hospital’s reach, so the record says the document existed rather than pretending it did not.</li>
            <li>The portal refuses the row from the moment the node writes it, and names the department to ask for a fresh copy.</li>
            <li>An auditor can tell the difference between a share that was never made and one that was made and taken back.</li>
          </ul>
        </Panel>
      </div>

      <Sheet
        open={Boolean(withdrawing)}
        onClose={() => setWithdrawing(null)}
        title={withdrawing ? `Withdraw the share with ${withdrawing.recipientName}` : 'Withdraw a share'}
        description="The row is appended with your name and the reason; the file itself is untouched."
        width="md"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-tertiary">{reason.trim().length < 12 ? 'A reason is required — at least a sentence.' : 'The other recipients keep their own rows.'}</span>
            <Button variant="ghost" onClick={() => setWithdrawing(null)}>Cancel</Button>
            <Button variant="primary" onClick={withdraw} disabled={reason.trim().length < 12}>
              <Undo2 className="size-4" aria-hidden /> Withdraw
            </Button>
          </>
        }
      >
        {withdrawing && (
          <div className="space-y-3">
            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <p className="text-sm font-medium text-text-primary">{itemById(withdrawing.itemId)?.title}</p>
              <p>
                {KIND_LABEL[withdrawing.recipientKind]} · {withdrawing.recipientName} (<span className="font-numeric">{withdrawing.recipientRef}</span>) ·
                shared {withdrawing.sharedOn} · opened {withdrawing.openCount} time(s)
              </p>
              <p className="mt-1">{stateOf(withdrawing, day).hint}</p>
            </div>
            <FieldSection title="Why" description="This sentence is what the audit reads, and the recipient’s next telephone call is answered from it.">
              <div className="md:col-span-2 xl:col-span-3">
                <TextAreaField
                  label="Reason"
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  hint="“Wrong patient”, “the report was revised”, “the patient asked us to take it down” — different failures, different fixes."
                  required
                />
              </div>
            </FieldSection>
            <SelectField
              label="Tell the recipient"
              name="tell"
              value="notice"
              onChange={() => undefined}
              options={[
                { value: 'notice', label: 'Send an internal notice explaining it' },
                { value: 'none', label: 'Do not notify — I will speak to them' },
              ]}
              hint="Notifying matters most when the file was opened: a document someone has already read does not disappear because a row changed."
            />
            {withdrawing.recipientKind === 'patient' && (
              <SafetyBanner severity="warning" title="This is a patient’s copy">
                <p>
                  Withdrawing a patient’s share is visible to them the next time they open the portal: the document is gone and the message says it has
                  lapsed. If it was withdrawn because it was wrong, say so in the portal feedback thread as well — a patient who is told the report was
                  withdrawn will trust the next one more, not less.
                </p>
              </SafetyBanner>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** The counts the chips show, computed once rather than four times in the render. */
function shareCount(shares: ContentShare[], today: string) {
  return {
    open: shares.filter((s) => !s.revokedOn && !(s.expiresOn && s.expiresOn < today)).length,
    notOpened: shares.filter((s) => !s.revokedOn && s.openCount === 0).length,
    lapsed: shares.filter((s) => !s.revokedOn && Boolean(s.expiresOn && s.expiresOn < today)).length,
    withdrawn: shares.filter((s) => Boolean(s.revokedOn)).length,
  };
}
