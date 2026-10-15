'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, FieldSection, KpiTile, Panel, SafetyBanner, Segmented, SelectField, Sheet, TextAreaField, TextField, cx, useToast } from '@dizi/ui';
import { BellRing, Megaphone, ShieldAlert, Smartphone } from 'lucide-react';
import { AdminHeader, AdminSiblings } from '@/components/AdminShell';
import { ListView } from '@/components/ListView';
import { todayIso } from '@/lib/appointments';
import { useShell } from '@/lib/shell';
import {
  CHANNELS,
  CONSENTS,
  MESSAGING_WAITING,
  NOTICES,
  QUIET_HOURS,
  RECEIPTS,
  TEMPLATES,
  audiences,
  channelSpec,
  checkNotice,
  checkOutbound,
  consentFor,
  messagingDigest,
  receiptsFor,
  unreadBy,
  type Channel,
  type Notice,
  type NoticeReceipt,
  type Priority,
} from '@/lib/messaging';

/* Messaging (P8) — the noticeboard, which is a record, and the outbound channels, which are not.
 *
 * The screen is deliberately two sheets rather than one, because the two things share nothing but a word:
 *
 *  - a notice is written on this node, read from the branch replica, receipted when somebody opens it, and it
 *    works with the uplink down — which is when notices matter most, because the thing that has gone wrong is
 *    usually the uplink;
 *  - an SMS leaves the hospital through somebody else's gateway, cannot be recalled, and needs a consent on the
 *    patient's file before it is allowed to exist at all. The contract declares it online-only for that reason,
 *    and this screen refuses it locally rather than showing a tick it cannot stand behind.
 *
 * The numbers on the KPIs come from the staff register: “all staff nurses” is the sixty-two people who exist, and a
 * role nobody holds shows zero instead of quietly sending to nobody.
 */

const MINE = { code: 'EMP-1042', name: 'R. Howlader' };

const STATUS_TONE: Record<Notice['status'], string> = {
  delivered: 'text-safety-success',
  sent: 'text-brand-700',
  queued: 'text-text-secondary',
  failed: 'text-safety-critical-text',
  cancelled: 'text-text-tertiary',
};

const STATUS_LABEL: Record<Notice['status'], string> = {
  delivered: 'Read by most',
  sent: 'Handed over',
  queued: 'Queued',
  failed: 'Failed',
  cancelled: 'Not sent',
};

export default function MessagingPage() {
  const day = todayIso();
  const { queueWrite, sync } = useShell();
  /** Whether this desk believes it can reach the cloud right now. The engine's own state is the only honest source for it. */
  const cloudReachable = sync === 'live' || sync === 'syncing';
  const { push } = useToast();
  const [notices, setNotices] = useState<Notice[]>(NOTICES);
  const [receipts, setReceipts] = useState<NoticeReceipt[]>(RECEIPTS);
  const [view, setView] = useState('Board');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [messaging, setMessaging] = useState(false);

  const people = useMemo(() => audiences(day), [day]);
  const digest = useMemo(() => messagingDigest(notices, CONSENTS), [notices]);

  /* ---- the noticeboard draft ------------------------------------------------------------------- */

  const [draft, setDraft] = useState({ subject: '', body: '', priority: 'normal' as Priority, audienceRef: 'role:Staff nurse', relatedTo: '', channel: 'board' as Channel });
  const noticeVerdict = useMemo(
    () => checkNotice(draft, { today: day, nowMinute: 9 * 60 + 40, audiences: people, notices, receipts, cloudReachable }),
    [draft, day, people, notices, receipts, cloudReachable],
  );

  /* ---- the patient message draft -------------------------------------------------------------- */

  const [outbound, setOutbound] = useState({ channel: 'sms' as Channel, patientMrn: '', patientName: '', phone: '', body: '', template: '', attachments: 0 });
  const outboundConsent = consentFor(outbound.patientMrn, outbound.channel, CONSENTS);
  const outboundVerdict = useMemo(
    () =>
      checkOutbound(
        { ...outbound, consent: outboundConsent },
        { today: day, nowMinute: 21 * 60 + 40, audiences: people, notices, receipts, cloudReachable },
      ),
    [outbound, outboundConsent, day, people, notices, receipts, cloudReachable],
  );

  const sendNotice = () => {
    if (!noticeVerdict.ok) {
      push({ title: `The notice was not sent — ${noticeVerdict.reasons[0].code}`, description: noticeVerdict.reasons[0].message, tone: 'critical' });
      return;
    }
    const audience = people.find((a) => `${a.kind}:${a.ref}` === draft.audienceRef);
    const id = `nt-new-${notices.length + 1}`;
    const row: Notice = {
      id,
      channel: draft.channel,
      priority: draft.priority,
      audience: draft.audienceRef,
      audienceLabel: audience?.label ?? draft.audienceRef,
      subject: draft.subject.trim(),
      body: draft.body.trim(),
      fromCode: MINE.code,
      fromName: MINE.name,
      sentAt: `${day} 09:40`,
      status: 'queued',
      recipientCount: audience?.members.length ?? 0,
      readCount: 0,
      relatedTo: draft.relatedTo.trim(),
    };
    setNotices((list) => [row, ...list]);
    const wrote = queueWrite(`Send “${row.subject}” to ${row.audienceLabel}`, {
      id: 'sendNotice',
      recordId: id,
      fields: { notice: id, audience: row.audience, recipients: row.recipientCount, priority: row.priority, channel: row.channel, subject: row.subject },
    });
    setComposing(false);
    setDraft({ subject: '', body: '', priority: 'normal', audienceRef: draft.audienceRef, relatedTo: '', channel: 'board' });
    push({
      title: `Notice queued for ${row.recipientCount} ${row.recipientCount === 1 ? 'person' : 'people'}`,
      description: `It is written on this node and read from the branch replica, so it reaches its people whether or not the uplink is up — which is when a notice usually matters. ${
        noticeVerdict.warnings.length ? `Noted: ${noticeVerdict.warnings.map((w) => w.message).join(' ')} ` : ''
      }${wrote.queued ? 'Receipts come back as each person opens it.' : `Refused by the contract: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const sendMessage = () => {
    if (!outboundVerdict.ok) {
      push({ title: `Nothing was sent — ${outboundVerdict.reasons[0].code}`, description: outboundVerdict.reasons[0].message, tone: 'critical' });
      return;
    }
    const id = `nt-new-${notices.length + 1}`;
    const row: Notice = {
      id,
      channel: outbound.channel,
      priority: 'normal',
      audience: `patient:${outbound.patientMrn}`,
      audienceLabel: `${outbound.patientName} (${outbound.patientMrn})`,
      subject: outbound.template || 'Patient message',
      body: outbound.body.trim(),
      fromCode: MINE.code,
      fromName: MINE.name,
      sentAt: `${day} 21:40`,
      status: 'queued',
      recipientCount: 1,
      readCount: 0,
      relatedTo: outbound.patientMrn,
    };
    setNotices((list) => [row, ...list]);
    const wrote = queueWrite(`Message ${outbound.patientName} by ${channelSpec(outbound.channel).label}`, {
      id: 'sendPatientMessage',
      recordId: id,
      fields: { notice: id, channel: outbound.channel, patient: outbound.patientMrn, template: outbound.template || null, segments: Math.ceil(outbound.body.length / 160) },
    });
    setMessaging(false);
    push({
      title: wrote.queued ? 'Handed to the gateway' : 'Not sent — and the message says so rather than showing a tick',
      description: wrote.queued
        ? 'Delivery is reported by the gateway; until it reports, the row says “handed over” and not “delivered”, because the hospital cannot verify what it cannot see.'
        : `${wrote.because} There is no gateway configured in this build either — the vendor addon needs a Twilio or Meta business account, which is a commercial arrangement rather than code. The consent check, the attachment refusal and the quiet hours are all real, so the day the account exists the messages inherit the rules. ${
            outboundVerdict.warnings.length ? `Noted: ${outboundVerdict.warnings.map((w) => w.message).join(' ')}` : ''
          }`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const recordReceipt = (notice: Notice) => {
    if (receiptsFor(notice.id, receipts).some((r) => r.staffCode === MINE.code)) {
      push({ title: 'You have already receipted this notice', description: 'dizi.duplicate-operation — a replay is not a second read, and the row keeps the first time.', tone: 'warning' });
      return;
    }
    setReceipts((list) => [{ noticeId: notice.id, staffCode: MINE.code, staffName: MINE.name, readAt: `${day} 09:41`, deviceNodeId: 'DHK-01' }, ...list]);
    setNotices((list) => list.map((n) => (n.id === notice.id ? { ...n, readCount: n.readCount + 1 } : n)));
    const wrote = queueWrite(`Read receipt — “${notice.subject}”`, { id: 'recordNoticeReceipt', recordId: `${notice.id}:${MINE.code}`, fields: { notice: notice.id, staff: MINE.code, node: 'DHK-01' } });
    push({
      title: 'Receipt recorded',
      description: `A receipt is a record rather than a courtesy: it is what the hospital points at when it asks whether somebody was told. ${wrote.queued ? '' : `Not queued: ${wrote.because}.`}`,
      tone: wrote.queued ? 'success' : 'warning',
    });
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = notices.filter((n) => {
      if (view === 'Board') return channelSpec(n.channel).kind === 'record';
      if (view === 'Urgent') return n.priority === 'urgent';
      if (view === 'Not read by everyone') return channelSpec(n.channel).kind === 'record' && n.status !== 'cancelled' && n.readCount < n.recipientCount;
      if (view === 'Outbound') return channelSpec(n.channel).kind === 'outbound';
      if (view === 'Refused') return Boolean(n.refusedReason);
      return true;
    });
    return filtered.filter((n) => !q || n.subject.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.fromName.toLowerCase().includes(q));
  }, [notices, view, query]);

  const selectedAudience = people.find((a) => `${a.kind}:${a.ref}` === draft.audienceRef);

  return (
    <div className="space-y-3">
      <AdminHeader
        screenId="messaging"
        subtitle={`${day} · ${digest.notices} notices on the board · ${digest.urgent} urgent, ${digest.unreadUrgent} not yet read by everyone · ${digest.outboundSent} patient messages handed over, ${digest.outboundRefused} refused before sending.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setMessaging(true)}>
              <Smartphone className="size-4" aria-hidden /> Patient message
            </Button>
            <Button variant="primary" onClick={() => setComposing(true)}>
              <Megaphone className="size-4" aria-hidden /> Write a notice
            </Button>
          </>
        }
        waiting={digest.unreadUrgent ? `${digest.unreadUrgent} urgent notice(s) have not been opened by everyone they were sent to. The screen shows who is missing rather than a percentage, because “94% read” is not an answer to “was the night team told?”` : undefined}
      />

      <AdminSiblings screenId="messaging" />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiTile label="On the board" value={String(digest.notices)} definition="Notices written on this node, whether or not they have drained. The board is a record and works with the uplink down, which is when most notices are written." asOf={day} />
        <KpiTile label="Urgent, not read by all" value={String(digest.unreadUrgent)} definition="Urgent notices with at least one recipient who has not opened them. Read from the receipts, one row per person per notice, appended and never edited." asOf={day} footnote={digest.unreadUrgent ? 'the missing names are listed' : 'everyone has opened them'} />
        <KpiTile label="Opened" value={`${Math.round(digest.readRate * 100)}%`} definition="Opened of delivered, across the notices on the board. A rate rather than a promise: the register cannot know whether somebody read it, only that they opened it." asOf={day} />
        <KpiTile label="Patient messages" value={String(digest.outboundSent)} definition="Handed to a gateway. The row says “handed over” and never “delivered” until the gateway reports it, because the hospital cannot verify what it cannot see." asOf={day} />
        <KpiTile label="Refused before sending" value={String(digest.outboundRefused)} definition="Messages the consent check, the attachment rule or the quiet hours stopped. Each row carries the sentence the sender saw, so the refusal is auditable rather than remembered." asOf={day} />
        <KpiTile label="Consents on file" value={String(digest.consents)} definition="Patients with consent for at least one channel. Withdrawn consents stay as rows rather than being deleted: the hospital has to be able to show when consent ended." asOf={day} footnote={`${digest.withdrawnConsents} withdrawn and kept`} />
      </div>

      <Panel
        title="The register"
        actions={
          <Segmented
            label="Which notices"
            name="notice-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'Board', label: `Board (${notices.filter((n) => channelSpec(n.channel).kind === 'record').length})` },
              { value: 'Urgent', label: `Urgent (${digest.urgent})` },
              { value: 'Not read by everyone', label: `Unread (${digest.unreadUrgent})` },
              { value: 'Outbound', label: `Patient (${notices.filter((n) => channelSpec(n.channel).kind === 'outbound').length})` },
              { value: 'Refused', label: `Refused (${notices.filter((n) => n.refusedReason).length})` },
            ]}
          />
        }
      >
        <ListView
          id="notice-register"
          caption="Notices and patient messages"
          rows={rows}
          rowId={(row) => row.id}
          quickSearch={{ value: query, onChange: setQuery, placeholder: 'Subject, text or sender' }}
          rowActions={(row) => [
            ...(row.status !== 'cancelled' && row.channel === 'board' ? [{ label: 'Record that I have read it', onSelect: () => recordReceipt(row) }] : []),
            { label: 'Who has not opened it', onSelect: () => push({ title: `${row.recipientCount - row.readCount} of ${row.recipientCount} have not opened “${row.subject}”`, description: row.refusedReason ? row.refusedReason : 'The register shows names, not a percentage: a notice that eight people have not seen is eight telephone calls, and the list is what makes them possible.', tone: 'info' }) },
            { label: 'Why it says what it says', onSelect: () => push({ title: `${channelSpec(row.channel).label} — ${channelSpec(row.channel).worksOffline ? 'a record on this node' : 'a message through a gateway'}`, description: channelSpec(row.channel).needs, tone: 'info' }) },
          ]}
          columns={[
            {
              key: 'subject',
              header: 'Notice',
              render: (row) => (
                <span className="block">
                  <span className="block font-medium">{row.priority === 'urgent' && <BellRing className="mr-1 inline size-3.5 text-safety-critical-text" aria-hidden />}{row.subject}</span>
                  <span className="line-clamp-1 block text-xs text-text-tertiary">{row.body}</span>
                </span>
              ),
            },
            { key: 'audience', header: 'To', width: '15rem', render: (row) => <span className="block"><span className="block">{row.audienceLabel}</span><span className="font-numeric block text-xs text-text-tertiary">{row.recipientCount} {row.recipientCount === 1 ? 'recipient' : 'recipients'}</span></span> },
            { key: 'channel', header: 'Channel', width: '9rem', hideBelow: 'lg', render: (row) => <span className="block"><span className="block">{channelSpec(row.channel).label}</span><span className="block text-xs text-text-tertiary">{channelSpec(row.channel).worksOffline ? 'works offline' : 'online only'}</span></span> },
            { key: 'status', header: 'State', width: '9rem', render: (row) => <span className={cx('font-medium', STATUS_TONE[row.status])} title={row.refusedReason || undefined}>{STATUS_LABEL[row.status]}</span> },
            { key: 'read', header: 'Opened', width: '8rem', hideBelow: 'lg', render: (row) => <span className="font-numeric">{row.readCount}/{row.recipientCount}</span> },
            { key: 'from', header: 'From', width: '10rem', hideBelow: 'xl', render: (row) => <span className="block"><span className="block">{row.fromName}</span><span className="font-numeric block text-xs text-text-tertiary">{row.sentAt}</span></span> },
            { key: 'refused', header: 'Why refused', hideBelow: 'xl', render: (row) => (row.refusedReason ? <span className="line-clamp-2 text-text-critical">{row.refusedReason}</span> : <span className="text-text-tertiary">—</span>) },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Two kinds of message, and the difference">
          <ul className="space-y-2 text-xs text-text-secondary">
            {CHANNELS.map((spec) => (
              <li key={spec.channel} className="rounded-md border border-border-subtle px-3 py-2">
                <p className="flex items-center gap-1 text-sm font-medium text-text-primary">
                  {spec.worksOffline ? <Megaphone className="size-3.5" aria-hidden /> : <Smartphone className="size-3.5" aria-hidden />}
                  {spec.label}
                  <span className={cx('ml-1 text-xs font-normal', spec.worksOffline ? 'text-brand-700' : 'text-safety-warning-text')}>{spec.worksOffline ? 'a record' : 'outbound'}</span>
                </p>
                <p className="mt-0.5">{spec.needs}</p>
                <p className="mt-0.5 text-text-tertiary">{spec.refusedBy}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Quiet hours and the rules around a patient message">
          <p className="text-xs text-text-secondary">{QUIET_HOURS.note}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text-secondary">
            <li>SMS and WhatsApp are separate consents. Patients regularly give one and not the other, and the screen asks for the one it needs rather than for “permission to message”.</li>
            <li>Nothing carries an attachment. A clinical document goes through the Download Centre, where the share can be withdrawn and the opening is recorded.</li>
            <li>No diagnosis in the text: an SMS sits unencrypted on a handset that may be shared. The message says the report is ready and the portal holds the report.</li>
            <li>The number is the one the patient gave the hospital, never one typed into this sheet — a mistyped digit sends somebody else’s appointment to a stranger.</li>
            <li>The operation is <span className="font-numeric">online-only</span> in the contract: a queued message is one the hospital believes it sent and cannot verify.</li>
          </ul>
          <div className="mt-2 rounded-md border border-border-subtle px-3 py-2">
            <p className="flex items-center gap-1 text-xs font-medium text-text-primary">
              <ShieldAlert className="size-3.5" aria-hidden /> Templates
            </p>
            <ul className="mt-1 space-y-1 text-xs text-text-secondary">
              {TEMPLATES.map((t) => (
                <li key={t.key}>
                  <span className="font-medium text-text-primary">{t.label}</span> — <span className="text-text-tertiary">{t.when}.</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <Panel title="What this screen is waiting for">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
          {MESSAGING_WAITING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-tertiary">
          The patient portal is the channel that exists today: it needs no consent beyond the patient signing in, it cannot reach the wrong number, and the report
          stays in the hospital until the patient opens it. See <Link className="underline" href="/admin/content/shared">Shared content</Link> for what a patient can
          already see.
        </p>
      </Panel>

      {/* ---------------------------------------------------------------- the noticeboard sheet */}
      <Sheet
        open={composing}
        onClose={() => setComposing(false)}
        title="Write a notice"
        description="Written on this node, read from the branch replica, receipted when somebody opens it."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {noticeVerdict.ok ? `Will go to ${noticeVerdict.recipients.length} ${noticeVerdict.recipients.length === 1 ? 'person' : 'people'}.` : `${noticeVerdict.reasons.length} thing(s) to fix before this can be sent.`}
            </span>
            <Button variant="ghost" onClick={() => setComposing(false)}>Close</Button>
            <Button variant="primary" onClick={sendNotice} disabled={!noticeVerdict.ok}>
              <Megaphone className="size-4" aria-hidden /> Send the notice
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!noticeVerdict.ok && (
            <SafetyBanner severity="critical" title={`This notice will not be sent — ${noticeVerdict.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {noticeVerdict.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {noticeVerdict.ok && noticeVerdict.warnings.length > 0 && (
            <SafetyBanner severity="info" title="Worth knowing before you send it">
              <ul className="list-disc space-y-1 pl-5">
                {noticeVerdict.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="The notice" description="What it is about, and what somebody is meant to do about it.">
            <TextField label="Subject" name="subject" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} hint="Read in a list on a phone between patients." required />
            <SelectField
              label="How important"
              name="priority"
              value={draft.priority}
              onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Priority }))}
              options={[
                { value: 'normal', label: 'Normal — read when you get to it' },
                { value: 'urgent', label: 'Urgent — read before the next task' },
              ]}
            />
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField label="The notice" name="body" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} rows={5} hint="Name an MRN and never a clinical detail: the board is read by the whole hospital, including people with no part in the care." required />
            </div>
          </FieldSection>

          <FieldSection title="Who it goes to" description="Counted from the staff register rather than typed, so “all staff nurses” is the number of people who exist.">
            <SelectField
              label="Audience"
              name="audience"
              value={draft.audienceRef}
              onChange={(e) => setDraft((d) => ({ ...d, audienceRef: e.target.value }))}
              options={people.map((a) => ({ value: `${a.kind}:${a.ref}`, label: `${a.label} — ${a.members.length}` }))}
              hint={selectedAudience && selectedAudience.members.length === 0 ? 'Nobody holds this role at this branch today. The notice is refused rather than sent to nobody.' : 'The number beside each audience is the register, not an estimate.'}
            />
            <SelectField
              label="Channel"
              name="channel"
              value={draft.channel}
              onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value as Channel }))}
              options={[
                { value: 'board', label: 'Noticeboard — a record, works offline' },
                { value: 'push', label: 'Push to the staff app — also a record' },
              ]}
              hint="Patient messages are a separate sheet: they leave the hospital and need a consent first."
            />
            <TextField label="Reference" name="relatedTo" value={draft.relatedTo} onChange={(e) => setDraft((d) => ({ ...d, relatedTo: e.target.value }))} hint="Optional: an MRN, an incident number or a roster. An identifier is fine; a diagnosis is not." />
          </FieldSection>

          <div className="rounded-md border border-border-subtle px-3 py-2 text-xs">
            <p className="font-medium text-text-primary">{noticeVerdict.recipients.length} {noticeVerdict.recipients.length === 1 ? 'person' : 'people'} will be interrupted by this</p>
            <p className="mt-0.5 text-text-secondary">
              {noticeVerdict.recipients.slice(0, 8).map((p) => `${p.name} (${p.code})`).join(' · ')}
              {noticeVerdict.recipients.length > 8 ? ` and ${noticeVerdict.recipients.length - 8} more` : ''}
              {noticeVerdict.recipients.length === 0 ? 'Nobody — see the refusal above.' : ''}
            </p>
            <p className="mt-1 text-text-tertiary">
              Urgent is for something somebody has to act on before their next task. The distinction is not how loudly it matters, it is whether it is safe to read later.
            </p>
          </div>
        </div>
      </Sheet>

      {/* ---------------------------------------------------------------- the patient message sheet */}
      <Sheet
        open={messaging}
        onClose={() => setMessaging(false)}
        title="Message a patient"
        description="SMS, WhatsApp or email — outbound, unrecallable, and only with a consent on file."
        width="lg"
        busy={false}
        footer={
          <>
            <span className="mr-auto text-xs text-text-tertiary">
              {outboundVerdict.ok ? 'The consent is on file and the number came from the record.' : `${outboundVerdict.reasons.length} thing(s) to fix before this can be sent.`}
            </span>
            <Button variant="ghost" onClick={() => setMessaging(false)}>Close</Button>
            <Button variant="primary" onClick={sendMessage} disabled={!outboundVerdict.ok}>
              <Smartphone className="size-4" aria-hidden /> Send it
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!outboundVerdict.ok && (
            <SafetyBanner severity="critical" title={`Nothing will be sent — ${outboundVerdict.reasons[0].code}`}>
              <ul className="list-disc space-y-1 pl-5">
                {outboundVerdict.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}
          {outboundVerdict.warnings.length > 0 && (
            <SafetyBanner severity="info" title="Before you send it">
              <ul className="list-disc space-y-1 pl-5">
                {outboundVerdict.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </SafetyBanner>
          )}

          <FieldSection title="Who, and by what" description="The consent, the number and the audit entry are all keyed on the MRN.">
            <SelectField
              label="Channel"
              name="out-channel"
              value={outbound.channel}
              onChange={(e) => setOutbound((o) => ({ ...o, channel: e.target.value as Channel }))}
              options={CHANNELS.filter((c) => c.kind === 'outbound').map((c) => ({ value: c.channel, label: c.label }))}
              hint={outboundConsent ? `Consent on file: ${outboundConsent.agreedOn}, ${outboundConsent.how.toLowerCase()}.` : 'SMS and WhatsApp are separate consents — a patient with one is not a patient with the other.'}
            />
            <SelectField
              label="Patient"
              name="out-patient"
              value={outbound.patientMrn}
              onChange={(e) => {
                const found = [
                  { mrn: 'SH-102355', name: 'Fatema Begum', phone: '01711 884 210' },
                  { mrn: 'SH-102388', name: 'Shahidul Islam', phone: '01911 204 556' },
                  { mrn: 'SH-102397', name: 'Jahangir Alam', phone: '01819 336 004' },
                  { mrn: 'SH-102402', name: 'Kamrul Hossain', phone: '01521 770 118' },
                  { mrn: 'SH-102341', name: 'Rafiqul Hasan', phone: '01755 641 902' },
                ].find((p) => p.mrn === e.target.value);
                setOutbound((o) => ({ ...o, patientMrn: e.target.value, patientName: found?.name ?? '', phone: found?.phone ?? '' }));
              }}
              options={[
                { value: '', label: 'Choose a patient…' },
                { value: 'SH-102355', label: 'Fatema Begum — SMS and email consented' },
                { value: 'SH-102388', label: 'Shahidul Islam — SMS consented' },
                { value: 'SH-102397', label: 'Jahangir Alam — SMS consented, not WhatsApp' },
                { value: 'SH-102402', label: 'Kamrul Hossain — WhatsApp consented' },
                { value: 'SH-102341', label: 'Rafiqul Hasan — consent withdrawn in August' },
              ]}
            />
            <TextField label="Number on the record" name="out-phone" value={outbound.phone} onChange={() => undefined} readOnly hint="Read-only on purpose: the number comes from the patient’s record, never from this sheet." />
            <SelectField
              label="Template"
              name="out-template"
              value={outbound.template}
              onChange={(e) => {
                const t = TEMPLATES.find((x) => x.key === e.target.value);
                setOutbound((o) => ({ ...o, template: t?.label ?? '', body: t ? t.body.replace('{hospital}', 'Dizi Hospital').replace('{date}', '22 October').replace('{time}', '11:00').replace('{doctor}', 'Dr. R. Akter').replace('{desk}', '02 9876 540').replace('{panel}', 'the ultrasound') : o.body }));
              }}
              options={[{ value: '', label: 'Write it by hand…' }, ...TEMPLATES.map((t) => ({ value: t.key, label: t.label }))]}
              hint="Templates are approved once, carry the number to call, and cannot be edited in a hurry at 23:00."
            />
          </FieldSection>

          <FieldSection title="The message" description="What it is about and what to do next — and no clinical detail, because an SMS sits on a handset that may be shared.">
            <div className="md:col-span-2 xl:col-span-3">
              <TextAreaField label="Text" name="out-body" value={outbound.body} onChange={(e) => setOutbound((o) => ({ ...o, body: e.target.value }))} rows={4} hint={`${outbound.body.length} characters${outbound.channel === 'sms' ? ` · ${Math.ceil(outbound.body.length / 160)} SMS segment(s)` : ''}`} required />
            </div>
            <SelectField
              label="Attach the report"
              name="out-attach"
              value={String(outbound.attachments)}
              onChange={(e) => setOutbound((o) => ({ ...o, attachments: Number(e.target.value) }))}
              options={[
                { value: '0', label: 'No attachment — a link to the portal instead' },
                { value: '1', label: 'Attach the PDF (refused — see the refusal above)' },
              ]}
              hint="A clinical document goes through the Download Centre, where the share can be withdrawn and the opening is recorded. An email cannot un-share anything."
            />
          </FieldSection>

          <div className="rounded-md border border-border-subtle px-3 py-2 text-xs">
            <p className="font-medium text-text-primary">What the patient gets, and what the hospital can prove afterwards</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
              <li>The message carries the hospital’s name and the number to call; an unsigned message from an unknown number is read as a scam, and patients are right to treat it that way.</li>
              <li>The receipt from the gateway is the only evidence of delivery. Until it arrives the row says “handed over”, and if the gateway refuses, the row says why rather than showing a tick.</li>
              <li>Nothing here is queued. The contract makes the send online-only: a queued message is one the hospital believes it sent and cannot verify.</li>
              <li>The consent is recorded against the MRN with the date and how it was taken. Withdrawal is a new row, not a deletion.</li>
            </ul>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
