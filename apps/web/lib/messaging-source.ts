/* ------------------------------------------------------------------- where the messaging console's rows come from
 *
 * The outbound half of this module is now served by the hospital's own API (P0-403), so — exactly as the appointment
 * screens did (P0-402) — the question "whose rows are these?" is stated once, here, as an interface with two
 * implementations:
 *
 *   · **`apiSource`** — `services/api`: the seven contract operations, the per-channel consent, the quiet hours the
 *     service enforces, the delivery log with its failure alerting, and the templates the branch approved.
 *   · **`previewSource`** — the deterministic fixtures this screen was designed against, kept for exactly one job: a
 *     checkout, a design review or a corridor demo with no server running. It refuses with the *same* codes and the
 *     same sentence shapes (`dizi.consent-missing`, `dizi.quiet-hours`, `dizi.recipient-missing`), because a preview
 *     that lets a desk message somebody who never consented teaches the wrong reflex.
 *
 * Which one is live is a fact rather than a preference: `detectMessagingSource()` asks the API whether it is there and
 * the screen prints the answer. A desk that cannot tell "this is the branch's log" from "this is sample data" is a
 * desk that reads a preview row as evidence that somebody was told.
 *
 * The noticeboard half stays on `lib/messaging.ts`'s fixtures for now, and the screen says so: a notice is a record
 * this node keeps, the board's own operations are new in the same contract version, and moving them is the next
 * slice rather than something to pretend has happened.
 */

import type { Notice, NoticeSend, OutboundMessage } from '@dizi/contracts/client';
import { ApiProblem, attemptKey, probeApi } from './dizi-api';
import { CONSENTS, consentFor, type Channel } from './messaging';
import {
  NOTIFICATIONS,
  apiDeliveryLog,
  apiNotices,
  apiRecordReceipt,
  apiRetryDelivery,
  apiSendNotice,
  apiSendPatientMessage,
  apiTemplates,
  type DeliveryLog,
  type DeliveryRow,
  type TemplateRow,
} from './messaging-api';

/* The contract-facing pieces a screen or a harness needs beside the source: the refusal type, the contract's own
   rules and the two channels this node carries. Re-exported here so an importer has one module to reach for rather
   than two — the same shape `lib/appointments-source.ts` has. */
export { ApiProblem } from './dizi-api';
export { NOTIFICATIONS, OUTBOUND_CHANNELS, deskTime } from './messaging-api';
export type { DeliveryAlert, DeliveryLog, DeliveryRow, TemplateRow } from './messaging-api';

/** Which driver an unattempted preview send is recorded against. The word is the contract's, and the service uses
    the same one: `preview` means nothing left this node. */
const PREVIEW_DRIVER = 'preview';

export interface LogQuery {
  status?: DeliveryRow['status'];
  channel?: 'whatsapp' | 'email';
  topic?: string;
  since?: string;
  limit?: number;
}

/** A send as the sheet builds it: the patient, the wording, and where the wording came from. */
export interface MessageInput {
  channel: 'whatsapp' | 'email';
  mrn: string;
  /** The address **as the hospital holds it**, read from the consent the patient gave — never as typed at the desk. */
  to: string;
  body: string;
  templateKey?: string;
  /** The consent row that allows this channel. The service checks it again; the sheet must not be the only check. */
  consentRef?: string;
  relatedTo?: string;
}

export interface MessagingSource {
  readonly kind: 'api' | 'preview';
  /** The chip: one sentence a clerk can read, saying whose log this is. */
  readonly label: string;
  readonly because: string;
  log(query?: LogQuery): Promise<DeliveryLog>;
  templates(): Promise<TemplateRow[]>;
  notices(query?: { box?: 'inbox' | 'sent' | 'board'; unreadOnly?: boolean; priority?: 'normal' | 'urgent'; q?: string; page?: number; pageSize?: number }): Promise<{ rows: Notice[]; total: number; page: number; pageSize: number; asOf?: string }>;
  sendNotice(notice: NoticeSend): Promise<Notice>;
  receipt(id: string): Promise<{ noticeId: string; readAt: string }>;
  /** The one operation that puts words on a patient's telephone. Online-only, and it refuses rather than queues. */
  sendMessage(input: MessageInput): Promise<DeliveryRow>;
  retry(id: string): Promise<DeliveryRow>;
}

/* ----------------------------------------------------------------------------------------- the API source */

export const apiSource: MessagingSource = {
  kind: 'api',
  label: 'Live — this branch’s messages, served by the hospital server',
  because:
    'Every send goes through the contract’s own operation, the consent is checked per channel, the quiet hours are enforced by the service rather than by this screen, and every attempt — sent, failed or suppressed — is a row in the delivery log.',

  async log(query) {
    return apiDeliveryLog(query);
  },

  async templates() {
    return apiTemplates();
  },

  async notices(query) {
    return apiNotices(query);
  },

  async sendNotice(notice) {
    return apiSendNotice(notice, attemptKey());
  },

  async receipt(id) {
    return apiRecordReceipt(id, attemptKey());
  },

  async sendMessage(input) {
    const message: OutboundMessage = {
      channel: input.channel,
      to: input.to,
      patientMrn: input.mrn,
      body: input.body,
      templateKey: input.templateKey,
      /* The contract requires the consent reference; the service refuses with `dizi.consent-missing` if it names a
         consent that does not cover this address, and that refusal is the *second* check rather than the only one. */
      consentRef: input.consentRef ?? 'consent-not-recorded',
      relatedTo: input.relatedTo,
    };

    return apiSendPatientMessage(message, attemptKey());
  },

  async retry(id) {
    return apiRetryDelivery(id, attemptKey());
  },
};

/* ------------------------------------------------------------------------------------- the preview source */

/**
 * The preview's log, built from the contract's own events.
 *
 * It is generated rather than typed out one row at a time so that the preview cannot drift from the contract: an event
 * added to `x-dizi-notifications` appears here on the next render, with the template the contract names. What the
 * fixtures add is the *shape of a bad morning* — one message the gateway refused three times in a row (which is
 * exactly what `x-dizi-notifications.alerting` calls a channel that is not delivering), one the quiet hours or a
 * missing consent suppressed, and two that went.
 *
 * **The driver on every row is `preview`, including the failed ones**, because that is the truth about this machine:
 * nothing left it. A row that named `meta-cloud` would be a preview claiming a gateway it never spoke to, and the
 * first person to read the log would have to work out which rows were real. The refusal's own words are kept — they
 * are what a real failure looks like — and the row says they are a sample.
 */
const previewLog: DeliveryRow[] = [];

/** An attempt, as the log would hold it. `provider` is always the preview driver here; see above. */
function previewRow(over: Partial<DeliveryRow> & Pick<DeliveryRow, 'id' | 'topic' | 'channel' | 'template' | 'status' | 'at'>): DeliveryRow {
  const at = over.at;

  return {
    meaning: NOTIFICATIONS.events[over.topic]?.means ?? '',
    language: 'bn',
    mrn: '',
    to: '',
    provider: PREVIEW_DRIVER,
    errorCode: '',
    detail: '',
    attempt: 1,
    when: at.slice(0, 16).replace('T', ' '),
    retryable: false,
    patientFacing: Boolean(NOTIFICATIONS.events[over.topic]?.consent),
    ...over,
  };
}

function previewRows(): DeliveryRow[] {
  if (previewLog.length > 0) return previewLog;

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const booking = NOTIFICATIONS.events['appointment.booked'];
  const refused = 'A sample of a gateway refusal: when a real driver carries this event, the row keeps the gateway’s own words exactly as they arrived, and the patient has not been told. ';

  previewLog.push(
    /* One message, three attempts, most recent first — the sequence an appendix looks like when a channel is down. */
    previewRow({ id: 'dl-preview-1', topic: 'appointment.booked', channel: 'whatsapp', template: booking?.template ?? 'appointment-booked', status: 'failed', attempt: 3, at: ago(4), errorCode: 'dizi.unavailable', detail: `${refused}Attempt 3 of ${NOTIFICATIONS.retry.attempts} (Spoken to the gateway: recipient not in allowed list — the business account is still in its test mode). The chat is now closed: the retries are used up, and a person decides what happens next.`, mrn: 'SH-102355', to: '*****678' }),
    previewRow({ id: 'dl-preview-2', topic: 'appointment.booked', channel: 'whatsapp', template: booking?.template ?? 'appointment-booked', status: 'failed', attempt: 2, at: ago(9), errorCode: 'dizi.unavailable', detail: `${refused}The backoff before this try was ${NOTIFICATIONS.retry.backoffSeconds[0]} seconds, which is what keeps a gateway that is down from being hammered by a morning’s events.`, retryable: true, mrn: 'SH-102355', to: '*****678' }),
    previewRow({ id: 'dl-preview-3', topic: 'appointment.booked', channel: 'whatsapp', template: booking?.template ?? 'appointment-booked', status: 'failed', attempt: 1, at: ago(12), errorCode: 'dizi.unavailable', detail: `${refused}This is the attempt the desk saw fail.`, retryable: true, mrn: 'SH-102355', to: '*****678' }),
    /* A suppression: a policy decision rather than a fault of the channel, which is why it is not one of the three. */
    previewRow({ id: 'dl-preview-4', topic: 'appointment.booked', channel: 'whatsapp', template: booking?.template ?? 'appointment-booked', status: 'suppressed', at: ago(16), errorCode: 'dizi.consent-missing', detail: 'No consent for WhatsApp on this patient’s file. A suppression is not a failure of the channel, and it is not counted towards the alert above: what has to change is the consent, not the button.', mrn: 'SH-102397', to: '' }),
    previewRow({ id: 'dl-preview-5', topic: 'patient.registered', channel: 'whatsapp', template: NOTIFICATIONS.events['patient.registered']?.template ?? 'patient-registered', status: 'sent', at: ago(21), detail: 'Handed over. The preview driver rendered this message, recorded what it would have sent and touched no network — so this row is not evidence that anybody was told.', mrn: 'SH-102398', to: '*****402' }),
    previewRow({ id: 'dl-preview-6', topic: 'invoice.paid', channel: 'email', template: NOTIFICATIONS.events['invoice.paid']?.template ?? 'invoice-paid', status: 'sent', at: ago(28), detail: 'Handed over. The row says “handed over” and not “delivered”: the hospital cannot verify what it cannot see, and delivery receipts arrive by a webhook this service has no endpoint for yet.', mrn: 'SH-102388', to: '*****388' }),
    previewRow({ id: 'dl-preview-7', topic: 'result.released', channel: 'email', template: NOTIFICATIONS.events['result.released']?.template ?? 'result-released', status: 'delivered', at: ago(41), detail: 'The provider reported the message delivered. In this preview nothing was actually delivered — the state is here so the log’s vocabulary is complete on screen.', mrn: 'SH-102341', to: '*****341' }),
  );

  return previewLog;
}

/** A refusal shaped exactly like the API's, so the screen has one kind of refusal to render. */
function previewRefusal(code: string, title: string, detail: string, status = 422): ApiProblem {
  return new ApiProblem(code, title, status, detail);
}

export const previewSource: MessagingSource = {
  kind: 'preview',
  label: 'Preview — sample messages, nothing sent, nothing written',
  because:
    'The hospital server is not reachable from this browser, so this is the deterministic sample the screen was designed against. It refuses with the contract’s own codes, and the driver on every row is the preview driver: a log of preview rows is not evidence that anybody was told.',

  async log(query) {
    const rows = previewRows().filter(
      (row) =>
        (query?.status === undefined || row.status === query.status) &&
        (query?.channel === undefined || row.channel === query.channel) &&
        (query?.topic === undefined || row.topic === query.topic),
    );

    return {
      rows: query?.limit === undefined ? rows : rows.slice(0, query.limit),
      asOf: new Date().toISOString(),
      /* Two channels, two drivers, and the word the contract uses: nothing is carried out of this machine. */
      driver: { ...Object.fromEntries(Object.keys(NOTIFICATIONS.channels).map((channel) => [channel, PREVIEW_DRIVER])) },
      /* The alarm the acceptance line asks for: three failures inside the hour is a channel that is not delivering,
         and the log says so above the rows rather than leaving it to be noticed. */
      alerts: rows.some((row) => row.status === 'failed')
        ? [
            {
              channel: 'whatsapp',
              failures: rows.filter((row) => row.status === 'failed').length,
              since: new Date(Date.now() - 60 * 60_000).toISOString(),
              because: NOTIFICATIONS.alerting.note,
            },
          ]
        : [],
      counts: rows.reduce<Record<string, number>>((all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }), {}),
    };
  },

  async templates() {
    const rows: TemplateRow[] = [];
    for (const [event, template] of Object.entries(NOTIFICATIONS.templates)) {
      const meaning = NOTIFICATIONS.events[event]?.means ?? '';
      for (const [channel, wording] of Object.entries(template)) {
        const nested = typeof wording === 'object' && 'subject' in wording && 'body' in wording;
        for (const language of ['bn', 'en'] as const) {
          rows.push({
            event,
            meaning,
            template: event,
            channel: channel as 'whatsapp' | 'email',
            language,
            subject: nested ? (wording as { subject: Record<string, string> }).subject[language] : '',
            body: nested ? (wording as { body: Record<string, string> }).body[language] : (wording as Record<string, string>)[language],
            placeholders: [],
            /* No Meta business account exists here, so nothing has been approved by anybody: the preview says
               `pending` rather than borrowing the word the gateway would use once a template really is approved. */
            approval: channel === 'email' ? 'not-required' : 'pending',
            enabled: NOTIFICATIONS.events[event]?.template !== null,
          });
        }
      }
    }

    return rows;
  },

  async notices() {
    return { rows: [], total: 0, page: 1, pageSize: 25 };
  },

  async sendNotice() {
    throw previewRefusal(
      'dizi.offline-not-allowed',
      'The noticeboard is served by the hospital server',
      'This browser is not talking to the hospital server, so there is no board to write to. Nothing was sent, and nothing was queued on this device: a notice written into a preview is a notice nobody will read.',
      503,
    );
  },

  async receipt() {
    throw previewRefusal('dizi.offline-not-allowed', 'Not recorded', 'A read receipt is a record; nothing here can write one.', 503);
  },

  async sendMessage(input) {
    /* The two checks the service makes, made here with the same codes — so the preview refuses what the service
       refuses, in the same words, instead of demonstrating a send that could not happen. */
    const consent = consentFor(input.mrn, input.channel as Channel, CONSENTS);
    if (consent === undefined) {
      throw previewRefusal(
        'dizi.consent-missing',
        'There is no consent for that channel',
        `Nothing was sent: this patient has not consented to ${input.channel === 'email' ? 'e-mail' : 'WhatsApp'}, and the two are separate consents. Offer the portal or the printed copy — sending first and asking afterwards cannot be undone.`,
        409,
      );
    }

    const at = new Date().toISOString();
    const row: DeliveryRow = {
      id: `dl-preview-new-${previewLog.length + 1}`,
      /* The service records a message written at the desk under its own topic — `direct` — rather than under an event
         that did not happen: no booking caused this, a person did. */
      topic: 'direct',
      meaning: 'A message written at the desk and sent to the address the patient’s own consent covers.',
      channel: input.channel,
      template: input.templateKey ?? '—',
      language: 'bn',
      mrn: input.mrn,
      to: `*****${input.to.replace(/\D/g, '').slice(-3)}`,
      status: 'sent',
      provider: PREVIEW_DRIVER,
      errorCode: '',
      detail: 'The preview driver rendered this message and touched no network — it is recorded here so the screens have a shape to render, and it is not evidence that anybody was told.',
      attempt: 1,
      at,
      when: at.slice(0, 16).replace('T', ' '),
      retryable: false,
      patientFacing: true,
    };
    previewLog.unshift(row);

    return row;
  },

  async retry(id) {
    const row = previewRows().find((candidate) => candidate.id === id);
    if (row === undefined) throw previewRefusal('dizi.not-found', 'Not in this log', `This preview holds no delivery ${id}.`, 404);

    /* The three answers the service gives, in the service's own order: a suppression is refused with the code that
       suppressed it, an attempt that went out is a duplicate, and a failure with its attempts used is a 422. */
    if (row.status === 'suppressed') {
      throw previewRefusal(
        row.errorCode === '' ? 'dizi.validation-failed' : row.errorCode,
        'That send was refused, not failed',
        `This attempt was refused by policy and not by the channel${row.detail === '' ? '.' : `: ${row.detail}`} Retrying it would send the message the refusal exists to prevent — pressing retry does not create consent, and it does not close the quiet hours.`,
        409,
      );
    }

    if (row.status !== 'failed') {
      throw previewRefusal('dizi.duplicate-operation', 'That message has already gone', `This attempt is ${row.status} and the message has already left, so sending it again would tell the patient the same thing twice.`, 409);
    }

    if (row.attempt >= NOTIFICATIONS.retry.attempts) {
      throw previewRefusal(
        'dizi.validation-failed',
        'That message has used its attempts',
        `This attempt is number ${row.attempt} of ${NOTIFICATIONS.retry.attempts}, and the channel has had them all. The log keeps every try with the gateway’s own words, and the patient has not been told — the desk sends the printed copy, or somebody fixes the channel and a fresh message is written.`,
        422,
      );
    }

    const next: DeliveryRow = {
      ...row,
      id: `${id}-r${row.attempt + 1}`,
      status: 'sent',
      attempt: row.attempt + 1,
      errorCode: '',
      detail: 'Retried from the delivery log. The preview driver recorded the attempt and touched no network; the attempt above it stays exactly as it was, because an attempt is a fact about a moment.',
      retryable: false,
      at: new Date().toISOString(),
    };
    next.when = next.at.slice(0, 16).replace('T', ' ');
    previewLog.unshift(next);

    return next;
  },

};

/* ------------------------------------------------------------------------------------------ which one is live */

export interface MessagingSourceState {
  source: MessagingSource;
  /** What the screen says about it, in one sentence. */
  note: string;
}

let detected: Promise<MessagingSourceState> | null = null;

/**
 * Ask the API whether it is there. Once per session: the answer changes only when somebody starts or stops the
 * service, and probing on every screen would put a request in front of every render.
 */
export function detectMessagingSource(): Promise<MessagingSourceState> {
  if (detected !== null) return detected;

  detected = probeApi().then(({ reachable, because }) => {
    if (reachable) return { source: apiSource, note: apiSource.because };

    return { source: previewSource, note: `${because} ${previewSource.because}` };
  });

  return detected;
}

/** Forget the probe. Used by the screens' “try again” and by the test harness, which drives both sources. */
export function resetMessagingProbe(): void {
  detected = null;
}
