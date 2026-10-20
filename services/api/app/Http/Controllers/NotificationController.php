<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ReadsQueryStrings;
use App\Modules\Identity\Actor;
use App\Modules\Messaging\Consent;
use App\Modules\Messaging\Deliveries;
use App\Modules\Messaging\Delivery;
use App\Modules\Messaging\Notice;
use App\Modules\Messaging\NoticeRecipient;
use App\Modules\Messaging\Notices;
use App\Modules\Registration\Register;
use App\Support\ProblemException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * `/notifications` — the hospital's own board, and everything that left the building.
 *
 * Two things live behind this one resource and they are deliberately not the same thing:
 *
 *  · **The board** (`GET`/`POST /notifications`, receipts) is internal. It never leaves the building, it is written to
 *    the branch's own table, and it is the channel a ward uses at 3 a.m.
 *  · **The log** (`GET /notifications/deliveries`, the retry) is what went outside. Every attempt is a row, every row
 *    names the driver that carried it, and `preview` on a row means nothing left this node — which is the sentence the
 *    contract repeats and the reason this file does not summarise the log into a count.
 *
 * As with the other controllers, there is no rule in this file: it reads the request, refuses a query string it cannot
 * read, asks the module, and writes the answer. The one thing it does that the module does not is the cross-module
 * read — a patient is checked through *registration's* own seam, because messaging a patient this hospital has no
 * record of is a typo at the desk, and the place to catch it is before the message leaves rather than after.
 */
final class NotificationController
{
    use ReadsQueryStrings;

    /** A message written by hand has no event behind it, and the log says so rather than reusing an event's name. */
    private const DIRECT_TOPIC = 'direct';

    public function __construct(
        private readonly Notices $notices,
        private readonly Deliveries $deliveries,
        private readonly Register $register,
    ) {}

    /** The board, one page at a time — `listNotifications`. */
    public function index(Request $request): JsonResponse
    {
        $box = $this->word($request, 'box');

        if ($box !== null && ! in_array($box, Notice::BOXES, true)) {
            throw $this->malformed('box', 'Must be one of: '.implode(', ', Notice::BOXES));
        }

        $priority = $this->word($request, 'priority');

        if ($priority !== null && ! in_array($priority, Notice::PRIORITIES, true)) {
            throw $this->malformed('priority', 'Must be one of: '.implode(', ', Notice::PRIORITIES));
        }

        $page = $this->integer($request->query('page'), 1);

        if ($page < 1) {
            throw $this->malformed('page', 'Must be a whole number of pages, from 1');
        }

        $pageSize = $this->integer($request->query('pageSize'), 20);

        if ($pageSize < 1 || $pageSize > Notices::MAX_PAGE_SIZE) {
            throw $this->malformed('pageSize', 'Must be between 1 and '.Notices::MAX_PAGE_SIZE);
        }

        return new JsonResponse($this->notices->page(
            box: $box,
            unreadOnly: $this->truthy($request->query('unreadOnly')),
            priority: $priority,
            q: $this->word($request, 'q'),
            page: $page,
            pageSize: $pageSize,
            actor: app(Actor::class),
        ));
    }

    /** Write a notice to the board — `sendNotice`. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'to' => ['required', 'array', 'min:1', 'max:50'],
            'to.*.kind' => ['required', 'in:'.implode(',', NoticeRecipient::KINDS)],
            'to.*.ref' => ['required', 'string', 'max:64'],
            'to.*.name' => ['nullable', 'string', 'max:120'],
            'subject' => ['required', 'string', 'min:3', 'max:200'],
            'body' => ['required', 'string', 'min:3', 'max:4000'],
            'priority' => ['nullable', 'in:'.implode(',', Notice::PRIORITIES)],
            'because' => ['nullable', 'string', 'max:500'],
            'relatedTo' => ['nullable', 'string', 'max:64'],
            /* When the notice was written on the node that could not reach the cloud. The board's own time is kept so
               that a notice written during an outage does not appear to have been written when the uplink came back. */
            'at' => ['nullable', 'date'],
        ]);

        $notice = $this->notices->send($data + [
            'sentAt' => is_string($data['at'] ?? null) ? Carbon::parse($data['at'])->utc() : null,
        ], app(Actor::class));

        return new JsonResponse($notice->toApiArray(), 201);
    }

    /** Record that somebody has read a notice — `recordNoticeReceipt`. */
    public function receipts(string $id): JsonResponse
    {
        return new JsonResponse(
            $this->notices->receipt($this->notices->find($id), app(Actor::class))->toApiArray(),
            201,
        );
    }

    /**
     * Message one patient, now — `sendPatientMessage`.
     *
     * Online-only by contract, and the refusals are the point of it: a patient this hospital has no record of, a
     * channel no consent stands for, a number that is not the one the consent was given for, or a gateway that did not
     * answer. Each one is a sentence the desk can act on, and every one of them is a row in the delivery log before
     * the answer goes back.
     */
    public function outbound(Request $request): JsonResponse
    {
        $actor = app(Actor::class);
        $data = $request->validate([
            'channel' => ['required', 'in:'.implode(',', Delivery::CHANNELS)],
            'to' => ['required', 'string', 'max:190'],
            'body' => ['required', 'string', 'min:1', 'max:2000'],
            'patientMrn' => ['required', 'string', 'max:32'],
            'templateKey' => ['nullable', 'string', 'max:64'],
            'consentRef' => ['required', 'string', 'max:64'],
            'relatedTo' => ['nullable', 'string', 'max:64'],
        ]);

        $mrn = (string) $data['patientMrn'];

        try {
            $this->register->find($mrn);
        } catch (ModelNotFoundException) {
            throw ProblemException::of(
                'dizi.forbidden',
                'That patient is not on this hospital’s record',
                403,
                'No patient on this node carries the MRN `'.$mrn.'`, so there is nobody to message. A message is sent to the patient on the record and never to a number typed into a dialog — that is the whole reason this operation is online-only.',
            );
        }

        $channel = (string) $data['channel'];
        $consent = Consent::inForceFor($mrn, $channel);

        if ($consent === null) {
            throw ProblemException::of(
                'dizi.consent-missing',
                'There is no consent for that channel',
                409,
                'No consent stands for `'.$mrn.'` on `'.$channel.'`. Consent is per channel and per address, and a message that has already left cannot be recalled — offer the printed copy, or record the consent the patient gives you and send it then.',
                ['channel' => $channel, 'consentStands' => false],
            );
        }

        if ($consent->ref !== (string) $data['consentRef']) {
            throw ProblemException::of(
                'dizi.consent-missing',
                'There is no consent for that channel',
                409,
                'The consent quoted (`'.$data['consentRef'].'`) is not one this patient has for `'.$channel.'`. The one on record is `'.$consent->ref.'`, given on '.($consent->granted_at?->format('Y-m-d') ?? 'an unknown date').'. A send is refused rather than written against a consent nobody gave.',
                ['channel' => $channel, 'consentRef' => $consent->ref],
            );
        }

        if (! $consent->covers((string) $data['to'])) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'This message is addressed to something other than the address the consent was given for ('.Delivery::mask((string) $consent->address).'). A message goes to the address on the record and not to one typed into a dialog — a mistyped number is a stranger reading a hospital’s message about somebody else.',
                ['errors' => [['field' => 'to', 'message' => 'Does not match the address this consent covers', 'code' => 'dizi.validation-failed']]],
            );
        }

        $delivery = $this->deliveries->attempt([
            'topic' => self::DIRECT_TOPIC,
            'eventId' => null,
            'mrn' => $mrn,
            'channel' => $channel,
            'template' => (string) ($data['templateKey'] ?? 'manual'),
            'language' => 'bn',
            'to' => (string) $consent->address,
            'subject' => null,
            'body' => (string) $data['body'],
            /* A message to a patient is what quiet hours are about. */
            'patientFacing' => true,
        ], $actor, 'message.send');

        return new JsonResponse($delivery->toApiArray($this->deliveries->allowedAttempts()), 201);
    }

    /** The delivery log — `listNotificationDeliveries`. */
    public function deliveries(Request $request): JsonResponse
    {
        $status = $this->word($request, 'status');

        if ($status !== null && ! in_array($status, Delivery::STATUSES, true)) {
            throw $this->malformed('status', 'Must be one of: '.implode(', ', Delivery::STATUSES));
        }

        $channel = $this->word($request, 'channel');

        if ($channel !== null && ! in_array($channel, Delivery::CHANNELS, true)) {
            throw $this->malformed('channel', 'Must be one of: '.implode(', ', Delivery::CHANNELS));
        }

        $since = $this->word($request, 'since');
        $limit = $this->integer($request->query('limit'), Deliveries::DEFAULT_LIMIT);

        if ($limit < 1 || $limit > Deliveries::MAX_LIMIT) {
            throw $this->malformed('limit', 'Must be between 1 and '.Deliveries::MAX_LIMIT);
        }

        return new JsonResponse($this->deliveries->page(
            status: $status,
            channel: $channel,
            topic: $this->word($request, 'topic'),
            since: $since,
            limit: $limit,
        ));
    }

    /** The wording, and which events are deliberately quiet — `listNotificationTemplates`. */
    public function templates(): JsonResponse
    {
        return new JsonResponse($this->deliveries->templates());
    }

    /** Send one failed attempt again — `retryNotificationDelivery`. */
    public function retry(string $id): JsonResponse
    {
        return new JsonResponse(
            $this->deliveries->retry($this->deliveries->find($id), app(Actor::class))->toApiArray($this->deliveries->allowedAttempts()),
            201,
        );
    }

    /** A query word, or null when it was not sent. */
    private function word(Request $request, string $name): ?string
    {
        $value = $request->query($name);

        return is_string($value) && $value !== '' ? $value : null;
    }

    /** A query flag, read the way a link spells it. */
    private function truthy(mixed $value): bool
    {
        return is_string($value) && in_array(mb_strtolower($value), ['1', 'true', 'yes'], true);
    }
}
