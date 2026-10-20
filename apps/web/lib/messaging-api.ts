/* ------------------------------------------------------------------------ the messaging wire, not the screen
 *
 * P0-403's screens were written against `lib/messaging.ts` — a noticeboard, a per-channel consent, quiet hours and a
 * refusal for each rule — while the service that owns those facts did not exist. It does now (`services/api`), so this
 * module is the other half of that handover: it speaks the contract's seven operations and hands the screens the same
 * shapes they already render.
 *
 * Three things here are worth more than the code around them:
 *
 *   1. **The channel list is the contract's.** `x-dizi-notifications.channels` names the two channels this node
 *      carries, and both the send sheet and the log read it. A screen that offers a channel no driver carries is a
 *      screen offering a send that cannot happen — which is why `sms` is not in this vocabulary even though it is in
 *      the noticeboard's (a notice is a record; the board and push have no driver to need).
 *   2. **Quiet hours, retries and alerting are read, not restated.** `21:00–08:00`, three attempts with a 30 s / 300 s
 *      / 1800 s backoff, and "three failures on one channel inside an hour" all live in the contract, and a screen
 *      that typed them out a second time would be the second copy of a rule.
 *   3. **`preview` is a fact the log states.** A row carried by the preview driver means nothing left this node, and
 *      the page says so above the rows rather than leaving a reader to infer it from the word.
 *
 * The transport is `lib/dizi-api.ts`: the contract's paths, a refusal as a value, and the idempotency key the
 * operation's own metadata asks for.
 */

import {
  operations,
  type Notice,
  type NoticeSend,
  type NotificationDelivery,
  type NotificationDeliveryPage,
  type NotificationTemplate,
  type NotificationTemplatePage,
  type OutboundMessage,
} from '@dizi/contracts/client';
import capabilities from '@dizi/contracts/capabilities.json';
import { call } from './dizi-api';

/** The contract's own rules for this node: the events, the wording, the two channels, and what happens when a
    message cannot be sent. Nothing here is invented, and nothing here is restated by hand. */
export const NOTIFICATIONS = capabilities.notifications as unknown as {
  description: string;
  configuredIn: string;
  channels: Record<string, { driver: string; carries: string; needs: string; refusedBy: string }>;
  events: Record<string, { means: string; template: string | null; channels: string[]; withinMinutes: number; consent: boolean }>;
  templates: Record<string, Record<string, { bn: string; en: string } | { subject: { bn: string; en: string }; body: { bn: string; en: string } }>>;
  quietHours: { from: string; to: string; note: string };
  retry: { attempts: number; backoffSeconds: number[]; note: string };
  alerting: { consecutiveFailures: number; windowMinutes: number; note: string };
  rules: string[];
};

/** The channels this node carries, in the order the contract declares them. `whatsapp` and `email` today. */
export const OUTBOUND_CHANNELS = Object.keys(NOTIFICATIONS.channels) as Array<'whatsapp' | 'email'>;

/** The channel a row can be in, including the two the noticeboard uses — a record needs no driver. */
export type WireChannel = 'board' | 'push' | 'whatsapp' | 'email';

/** The branch's clock, for printing an instant as the desk reads it. The zone is the branch's, never the browser's. */
const BRANCH_ZONE = (capabilities.scheduling as unknown as { timezone: string }).timezone;

/** `2026-10-16T09:12:00+00:00` → `16 Oct, 15:12`, in the branch's zone. Local time is not a detail here: a delivery
    log read in the wrong zone turns "we sent it at nine" into "we sent it at three". */
export function deskTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  return new Intl.DateTimeFormat('en-GB', { timeZone: BRANCH_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(at).replace(',', '');
}

/* ----------------------------------------------------------------------------------- the delivery log */

export interface DeliveryRow {
  id: string;
  topic: string;
  /** What the event means, for a reader who does not have the contract open on the other screen. */
  meaning: string;
  channel: 'whatsapp' | 'email';
  template: string;
  language: 'bn' | 'en';
  mrn: string;
  /** Masked by the service: the last three characters only. A log full of numbers is a register in a second place. */
  to: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'suppressed';
  provider: string;
  errorCode: string;
  detail: string;
  attempt: number;
  at: string;
  when: string;
  retryable: boolean;
  /** Whether the event is about a patient at all. A store keeper's shelf is not a message to a household. */
  patientFacing: boolean;
}

export interface DeliveryAlert {
  channel: string;
  failures: number;
  since: string;
  because: string;
}

export interface DeliveryLog {
  rows: DeliveryRow[];
  asOf?: string;
  /** Which driver is in force per channel. `preview` means nothing left this node — and `none` means every send on
      that channel is refused rather than attempted. */
  driver: Record<string, string>;
  alerts: DeliveryAlert[];
  counts: Record<string, number>;
}

function toScreenDelivery(row: NotificationDelivery): DeliveryRow {
  const event = NOTIFICATIONS.events[row.topic];

  return {
    id: row.id,
    topic: row.topic,
    meaning: event?.means ?? 'An event this contract version does not describe.',
    channel: row.channel,
    template: row.template,
    language: row.language,
    mrn: typeof row.mrn === 'string' ? row.mrn : '',
    to: row.to,
    status: row.status,
    provider: row.provider,
    errorCode: typeof row.errorCode === 'string' ? row.errorCode : '',
    detail: typeof row.detail === 'string' ? row.detail : '',
    attempt: row.attempt,
    at: row.at,
    when: deskTime(row.at),
    retryable: row.retryable,
    patientFacing: Boolean(event?.consent),
  };
}

/** The log, most recent first. `status`, `channel`, `topic` and `since` are the four questions asked of it. */
export async function apiDeliveryLog(query: {
  status?: DeliveryRow['status'];
  channel?: 'whatsapp' | 'email';
  topic?: string;
  since?: string;
  limit?: number;
} = {}): Promise<DeliveryLog> {
  const page = await call<NotificationDeliveryPage>(operations.listNotificationDeliveries, { query });

  return {
    rows: page.rows.map(toScreenDelivery),
    asOf: page.asOf,
    driver: page.driver ?? {},
    alerts: page.alerts ?? [],
    counts: page.counts ?? {},
  };
}

/** One delivery, read back after a retry. */
export async function apiRetryDelivery(id: string, key: string): Promise<DeliveryRow> {
  return toScreenDelivery(await call<NotificationDelivery>(operations.retryNotificationDelivery, { at: [id], key }));
}

/** The message that left, read back after a send — the row the log will hold. */
export async function apiSendPatientMessage(input: OutboundMessage, key: string): Promise<DeliveryRow> {
  return toScreenDelivery(await call<NotificationDelivery>(operations.sendPatientMessage, { body: input, key }));
}

/* -------------------------------------------------------------------------------------- the templates */

export interface TemplateRow {
  event: string;
  meaning: string;
  template: string;
  channel: 'whatsapp' | 'email';
  language: 'bn' | 'en';
  subject: string;
  body: string;
  placeholders: string[];
  approval: 'not-required' | 'pending' | 'approved' | 'rejected';
  enabled: boolean;
}

async function apiTemplates(): Promise<TemplateRow[]> {
  const page = await call<NotificationTemplatePage>(operations.listNotificationTemplates);

  return page.rows.map((row: NotificationTemplate) => ({
    ...row,
    subject: typeof row.subject === 'string' ? row.subject : '',
    meaning: NOTIFICATIONS.events[row.event]?.means ?? '',
  }));
}

/* ------------------------------------------------------------------------------------- the noticeboard */

export interface BoardPage {
  rows: Notice[];
  total: number;
  page: number;
  pageSize: number;
  asOf?: string;
}

/** The board, the sent list or one person's inbox — `box` is the contract's own word for which. */
export async function apiNotices(query: {
  box?: 'inbox' | 'sent' | 'board';
  unreadOnly?: boolean;
  priority?: 'normal' | 'urgent';
  q?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<BoardPage> {
  return call<BoardPage>(operations.listNotifications, { query });
}

export async function apiSendNotice(notice: NoticeSend, key: string): Promise<Notice> {
  return call<Notice>(operations.sendNotice, { body: notice, key });
}

/** One person opening one notice. Appended, never edited — the hospital's only answer to "were you told?". */
export async function apiRecordReceipt(id: string, key: string): Promise<{ noticeId: string; readAt: string }> {
  return call<{ noticeId: string; readAt: string }>(operations.recordNoticeReceipt, { at: [id], key });
}

export { apiTemplates };
