<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Support\Carbon;

/**
 * The delivery log, and the one operation that writes to it after something has failed.
 *
 * `attempt()` is the only place a message leaves this node, and every caller goes through it — the outbound send, the
 * retry a person presses, and the worker that drains the outbox. That is deliberate: the points worth writing down
 * about a message are the same whoever sends it, and a second path is how one of them ends up recording attempts in a
 * shape the log does not understand.
 *
 * What this class will not do is pretend. A send is recorded by the driver that carried it (`preview` means it left
 * nothing), a refusal by policy is recorded as `suppressed` with the code that refused it, and a gateway that did not
 * answer is recorded as `failed` with the gateway's own words *before* the 502 goes back to the desk. A screen may
 * print a sentence; the log is what the hospital can point at afterwards.
 */
final class Deliveries
{
    /** How many rows one page of the log may hold, whatever the query string asks for. */
    public const MAX_LIMIT = 200;

    /** The default page: enough to see a bad morning, small enough to read at a desk. */
    public const DEFAULT_LIMIT = 50;

    public function __construct(
        private readonly NotificationCatalogue $catalogue,
        private readonly SendsMessages $senders,
        private readonly Ledger $ledger,
    ) {}

    /** How many attempts one channel gets before a person has to decide — `x-dizi-notifications.retry.attempts`. */
    public function allowedAttempts(): int
    {
        return (int) ($this->catalogue->retry()['attempts'] ?? 3);
    }

    /** Which driver is in force per channel, as the page states it at the top. */
    public function drivers(): array
    {
        $drivers = [];

        foreach (array_keys($this->catalogue->channels()) as $channel) {
            /* `none` is a real answer and the honest one: this deployment configured no driver for that channel, so
               every send on it is refused. Reporting the preview driver there would suggest messages were being
               rendered when they were not even attempted. */
            $drivers[$channel] = $this->senders->carries($channel) ? $this->senders->driver($channel) : 'none';
        }

        return $drivers;
    }

    /**
     * The log, newest first, with the two things a reader needs above it: which driver is in force, and whether a
     * channel is failing rather than unlucky.
     *
     * @return array{rows: list<array<string, mixed>>, asOf: string, driver: array<string, string>, alerts: list<array<string, mixed>>, counts: array<string, int>}
     */
    public function page(?string $status, ?string $channel, ?string $topic, ?string $since, ?int $limit): array
    {
        $builder = Delivery::query();

        if ($status !== null && $status !== '') {
            $builder->where('status', $status);
        }

        if ($channel !== null && $channel !== '') {
            $builder->where('channel', $channel);
        }

        if ($topic !== null && $topic !== '') {
            $builder->where('topic', $topic);
        }

        if ($since !== null && $since !== '') {
            $builder->where('at', '>=', Carbon::parse($since)->utc());
        }

        $rows = $builder
            ->orderByDesc('at')
            ->orderByDesc('id')
            ->limit($limit !== null && $limit > 0 ? min($limit, self::MAX_LIMIT) : self::DEFAULT_LIMIT)
            ->get();

        $attempts = $this->allowedAttempts();
        $counts = [];

        $serialised = $rows->map(static function (Delivery $delivery) use ($attempts, &$counts): array {
            $counts[(string) $delivery->status] = ($counts[(string) $delivery->status] ?? 0) + 1;

            return $delivery->toApiArray($attempts);
        })->all();

        return [
            'rows' => array_values($serialised),
            'asOf' => ApiTime::iso(ApiTime::now()),
            'driver' => $this->drivers(),
            'alerts' => $this->alerts(),
            /* How many of the rows returned are in each status. A status with no rows is absent rather than zero,
               because "no failures today" and "the failure column is empty" look the same in a table and are not the
               same sentence. */
            'counts' => $counts,
        ];
    }

    /**
     * The templates as this branch has them, and the catalogue behind them.
     *
     * A template no event names is not listed: the registry answers "what is this node saying, and in what words", and
     * a wording nothing sends is not part of that answer.
     *
     * @return array{rows: list<array<string, mixed>>, events: list<array<string, mixed>>, asOf: string}
     */
    public function templates(): array
    {
        $events = $this->catalogue->events();
        $templates = $this->catalogue->templates();

        /* template key → the topic it is said in. */
        $topics = [];
        foreach ($events as $topic => $event) {
            $template = is_array($event) ? ($event['template'] ?? null) : null;
            if (is_string($template) && $template !== '') {
                $topics[$template] = (string) $topic;
            }
        }

        $rows = [];
        foreach ($templates as $key => $channels) {
            if (! isset($topics[$key]) || ! is_array($channels)) {
                continue;
            }

            foreach ($channels as $channel => $wording) {
                foreach (Delivery::LANGUAGES as $language) {
                    $rows[] = [
                        'event' => $topics[$key],
                        'template' => (string) $key,
                        'channel' => (string) $channel,
                        'language' => $language,
                        'subject' => $this->subjectOf($wording, $language),
                        'body' => $this->bodyOf($wording, $language),
                        'placeholders' => $this->placeholdersOf($wording, $language),
                        /* WhatsApp templates are approved by Meta per account, and there is no such account behind
                           this repository: `pending` is the honest state, and the contract says it refuses a send
                           with its own sentence. An e-mail needs nobody's approval. */
                        'approval' => $channel === 'whatsapp' ? 'pending' : 'not-required',
                        'enabled' => true,
                    ];
                }
            }
        }

        $catalogue = [];
        foreach ($events as $topic => $event) {
            $event = is_array($event) ? $event : [];
            $channels = is_array($event['channels'] ?? null) ? array_values($event['channels']) : [];

            $catalogue[] = [
                'topic' => (string) $topic,
                'template' => is_string($event['template'] ?? null) ? $event['template'] : null,
                'channels' => $channels,
                /* The events that send nothing are in this list on purpose: what a node notices is part of what a
                   reader has to be able to see, and an event that is deliberately quiet says so in `means`. */
                'notifiable' => $channels !== [],
                'means' => (string) ($event['means'] ?? ''),
            ];
        }

        return ['rows' => $rows, 'events' => $catalogue, 'asOf' => ApiTime::iso(ApiTime::now())];
    }

    /** @throws ProblemException when there is no such attempt on this node */
    public function find(string $id): Delivery
    {
        $delivery = Delivery::query()->find($id);

        if ($delivery === null) {
            throw ProblemException::of(
                'dizi.not-found',
                'Not found here',
                404,
                'This node has no delivery `'.$id.'`. Attempts are written where the message was sent from; a delivery made at another branch appears here when that branch drains.',
            );
        }

        return $delivery;
    }

    /**
     * Send one failed attempt again, as the next row.
     *
     * The refusal is the interesting half. An attempt that went out cannot be un-sent, and retrying it would tell the
     * patient twice about one appointment; a suppression was a *decision* — no consent, no address, quiet hours — and
     * pressing retry does not create consent. So both are a 409 that carries the attempt as it stands, and the only
     * thing that may be retried is a failure with attempts left, which is a 422 when there are none.
     */
    public function retry(Delivery $delivery, Actor $actor): Delivery
    {
        $attempts = $this->allowedAttempts();
        $status = (string) $delivery->status;
        $asItStands = $delivery->toApiArray($attempts);

        if (in_array($status, Delivery::SUPPRESSIONS, true)) {
            throw ProblemException::of(
                (string) ($delivery->error_code ?? 'dizi.validation-failed'),
                'That send was refused, not failed',
                409,
                'This attempt was refused by policy and not by the channel'.($delivery->detail !== null ? ': '.$delivery->detail : '.')
                .' Retrying it would send the message the refusal exists to prevent — pressing retry does not create consent, and it does not close the quiet hours. The attempt is returned as it stands.',
                ['attempt' => $asItStands],
            );
        }

        /* Anything that is neither a failure nor a suppression is an attempt that has not finished — `queued` is the
           only one left in the contract's vocabulary, and retrying it would race the attempt already in flight. */
        if (! in_array($status, Delivery::RETRYABLE_FROM, true)) {
            throw ProblemException::of(
                'dizi.duplicate-operation',
                'That message has already gone',
                409,
                'This attempt is '.$status.' and the message has already left, so sending it again would tell the patient the same thing twice. The attempt is returned as it stands.',
                ['attempt' => $asItStands],
            );
        }

        if ((int) $delivery->attempt >= $attempts) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That message has used its attempts',
                422,
                'This attempt is number '.$delivery->attempt.' of '.$attempts.', and the channel has had them all. The log keeps every try with the gateway’s own words, and the patient has not been told — the desk sends the printed copy, or somebody fixes the channel and a fresh message is written.',
                ['attempt' => $asItStands],
            );
        }

        return $this->attempt([
            'topic' => (string) $delivery->topic,
            'eventId' => $delivery->event_id,
            'mrn' => $delivery->mrn,
            'channel' => (string) $delivery->channel,
            'template' => (string) $delivery->template,
            'language' => (string) $delivery->language,
            'to' => (string) $delivery->to_address,
            'subject' => $delivery->subject,
            /* The sentence as it was, and not the refusal's own words: a retry repeats the message, and a second
               wording invented at retry time is a message the branch never approved. */
            'body' => (string) $delivery->body,
            'patientFacing' => (bool) $delivery->patient_facing,
            'attempt' => (int) $delivery->attempt + 1,
        ], $actor, 'message.retry');
    }

    /**
     * One attempt, recorded whatever happens to it.
     *
     * The order is the point: the row is written (or, for a gateway failure, written *then* the refusal thrown) so that
     * a channel that is down is a visible run of failed rows rather than a silence, and so that the sentence the desk
     * reads and the sentence the log keeps are the same one.
     *
     * @param  array<string, mixed>  $input
     *
     * @throws ProblemException 502 when the gateway refused or could not be reached; the failed attempt is recorded first
     */
    public function attempt(array $input, Actor $actor, string $action): Delivery
    {
        $now = ApiTime::now();
        $patientFacing = (bool) ($input['patientFacing'] ?? false);

        $attributes = [
            'id' => Delivery::newId(),
            'event_id' => $input['eventId'] ?? null,
            'topic' => (string) $input['topic'],
            'channel' => (string) $input['channel'],
            'template' => (string) ($input['template'] ?? ''),
            'language' => (string) ($input['language'] ?? 'bn'),
            'mrn' => $input['mrn'] ?? null,
            'to_address' => (string) $input['to'],
            'subject' => is_string($input['subject'] ?? null) ? $input['subject'] : null,
            'body' => (string) ($input['body'] ?? ''),
            'attempt' => (int) ($input['attempt'] ?? 1),
            'patient_facing' => $patientFacing,
            'at' => $now,
            'node' => $actor->node,
            'origin' => $actor->branch,
            'created_by' => $actor->id,
        ];

        /* A suppression decided before the driver is reached: no consent, nobody to write to, a value the wording needs
           and the event did not carry. It is a row with the code that refused it rather than a silence, and it is not
           retryable — nothing failed, and pressing retry does not create consent. */
        $suppress = $input['suppress'] ?? null;

        if (is_array($suppress)) {
            return $this->record($attributes + [
                'status' => 'suppressed',
                'provider' => $this->drivers()[(string) $input['channel']] ?? 'none',
                'error_code' => (string) $suppress['code'],
                'detail' => (string) $suppress['detail'],
            ], $actor, $action);
        }

        $quiet = $patientFacing ? $this->quietHoursRefusal($now) : null;

        if ($quiet !== null) {
            /* Not sent and not dropped: the row says suppressed, says which policy refused it, and says when it is
               due again. A message that vanished silently at 23:40 would look exactly like one nobody wrote. */
            $delivery = $this->record($attributes + [
                'channel' => (string) $input['channel'],
                'status' => 'suppressed',
                'provider' => $this->drivers()[(string) $input['channel']] ?? 'none',
                'error_code' => 'dizi.quiet-hours',
                'detail' => $quiet,
            ], $actor, $action);

            return $delivery;
        }

        try {
            $sent = $this->senders->send(
                (string) $input['channel'],
                (string) $input['to'],
                $input['subject'] ?? null,
                (string) $input['body'],
                (string) ($input['template'] ?? ''),
            );

            return $this->record($attributes + [
                'status' => 'sent',
                'provider' => $sent['provider'],
                'provider_message_id' => $sent['messageId'],
                'detail' => $sent['provider'] === 'preview'
                    ? 'Rendered by the preview driver: the wording, the address and the values are on this row, and nothing left this node.'
                    : null,
            ], $actor, $action);
        } catch (ProblemException $refused) {
            /* The failed attempt is written before the refusal travels, so the desk's screen and the log agree about
               what happened: the log is what the hospital points at, and "the gateway was down" is a fact about the
               channel that three failures in an hour should reveal rather than a sentence somebody saw once. */
            $this->record($attributes + [
                'status' => 'failed',
                'provider' => $this->drivers()[(string) $input['channel']] ?? 'none',
                'error_code' => $refused->type,
                'detail' => $refused->getMessage(),
            ], $actor, $action);

            throw $refused;
        }
    }

    /**
     * Channels that are failing rather than unlucky.
     *
     * `x-dizi-notifications.alerting` is the rule: this many failures inside this window, counted per channel.
     * Suppressions are not failures — a policy refusal is not a channel that is down — and a success in the window is
     * not "clearing" anything, because the count is of failures and a channel that half-works is still half-broken.
     *
     * @return list<array<string, mixed>>
     */
    public function alerts(): array
    {
        $alerting = $this->catalogue->alerting();
        $threshold = (int) ($alerting['consecutiveFailures'] ?? 3);
        $window = ApiTime::now()->subMinutes((int) ($alerting['windowMinutes'] ?? 60));
        $alerts = [];

        foreach (array_keys($this->catalogue->channels()) as $channel) {
            $failures = Delivery::query()
                ->where('channel', $channel)
                ->where('status', 'failed')
                ->where('at', '>=', $window)
                ->orderBy('at')
                ->get();

            if ($failures->count() < $threshold) {
                continue;
            }

            $alerts[] = [
                'channel' => $channel,
                'failures' => $failures->count(),
                'since' => ApiTime::iso($failures->first()?->at),
                'because' => $failures->count().' attempts on '.$channel.' failed between '.ApiTime::iso($failures->first()?->at)
                    .' and now, which is a channel that is not delivering rather than '.$failures->count().' unlucky patients. Nothing is queued behind it: every message that did not go is in this log with the gateway’s own words, and the desk can print what it cannot send.',
            ];
        }

        return $alerts;
    }

    /**
     * When a message may be sent again, or null when the branch is awake.
     *
     * Read on the branch's own clock — `x-dizi-scheduling.timezone` — because 21:00 means nine in the evening where the
     * patient is. Returned in UTC, because that is what is stored: an instant is one moment wherever it is read, and
     * the branch's reading of it is derived rather than written down twice.
     *
     * The outbox uses this to schedule a suppressed event for the hour the window closes, which is the contract's own
     * sentence about quiet hours: "not sent and not dropped — due again at the hour the window closes".
     */
    public function quietHoursClose(Carbon $at): ?Carbon
    {
        $hours = $this->catalogue->quietHours();
        $local = $at->copy()->setTimezone($this->catalogue->timezone());
        $minute = ((int) $local->hour) * 60 + (int) $local->minute;
        $from = self::minuteOf((string) ($hours['from'] ?? '21:00'));
        $to = self::minuteOf((string) ($hours['to'] ?? '08:00'));

        $inside = $from > $to
            ? ($minute >= $from || $minute < $to)
            : ($minute >= $from && $minute < $to);

        if (! $inside) {
            return null;
        }

        /* The window closes at `to`: today if it is still before dawn, tomorrow if the evening has just started. */
        $closes = $minute >= $from
            ? $local->copy()->addDay()->setTime(intdiv($to, 60), $to % 60)
            : $local->copy()->setTime(intdiv($to, 60), $to % 60);

        return $closes->utc();
    }

    /**
     * The quiet-hours refusal, or null when the branch is awake.
     *
     * The sentence says when the message is due again rather than only that it was not sent: the desk's next question
     * is always "so when does it go?", and the answer is already known here.
     */
    public function quietHoursRefusal(Carbon $at): ?string
    {
        $closes = $this->quietHoursClose($at);

        if ($closes === null) {
            return null;
        }

        $hours = $this->catalogue->quietHours();
        $zone = $this->catalogue->timezone();
        $local = $at->copy()->setTimezone($zone);
        $shuts = $closes->copy()->setTimezone($zone);

        return 'It is '.$local->format('H:i').' in '.$zone.', inside the quiet hours ('.($hours['from'] ?? '').'–'.($hours['to'] ?? '').'). '
            .'A message that arrives at night wakes a household for something that could have waited, so nothing was sent and nothing was dropped: this attempt is recorded as suppressed and it is due again at '
            .$shuts->format('H:i').' on '.$shuts->format('Y-m-d').'.';
    }

    /** Write the attempt and put it in the ledger, in one transaction. */
    private function record(array $attributes, Actor $actor, string $action): Delivery
    {
        $delivery = Delivery::query()->create($attributes);

        $this->ledger->append(
            $actor->node,
            $actor->id,
            $action,
            'message.delivery',
            (string) $delivery->id,
            [],
            $delivery->toApiArray($this->allowedAttempts()),
        );

        return $delivery;
    }

    /** `HH:MM` as minutes from midnight, with a refusal rather than a guess when it is not one. */
    private static function minuteOf(string $clock): int
    {
        if (preg_match('/^(\d{2}):(\d{2})$/', $clock, $parts) !== 1) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The messaging catalogue is missing',
                503,
                'The quiet hours are `'.$clock.'`, which is not a time of day, so this node cannot tell whether it is allowed to message a patient. It sends nothing rather than guessing.',
            );
        }

        return ((int) $parts[1]) * 60 + (int) $parts[2];
    }

    /** The subject of one wording, when the channel has one. */
    private function subjectOf(mixed $wording, string $language): ?string
    {
        $subject = is_array($wording) ? ($wording['subject'][$language] ?? null) : null;

        return is_string($subject) ? $subject : null;
    }

    /** The body of one wording: an e-mail's `body`, or a WhatsApp template's single piece of text. */
    private function bodyOf(mixed $wording, string $language): string
    {
        if (! is_array($wording)) {
            return '';
        }

        $body = $wording['body'][$language] ?? ($wording[$language] ?? null);

        return is_string($body) ? $body : '';
    }

    /**
     * The placeholders one wording uses, in the order they appear.
     *
     * Read out of the wording rather than declared beside it, because the two would drift: this is what the screen
     * shows a person editing the template, and what the drain refuses a message for when a value is missing.
     *
     * @return list<string>
     */
    private function placeholdersOf(mixed $wording, string $language): array
    {
        preg_match_all('/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/', $this->subjectOf($wording, $language).' '.$this->bodyOf($wording, $language), $matches);

        return array_values(array_unique($matches[1] ?? []));
    }
}
