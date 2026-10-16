<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Support\Collection;

/**
 * The transactional outbox: what this node has decided somebody should be told, written in the same transaction as the
 * thing that decided it.
 *
 * `raise()` is called from inside another module's write — a booking, a payment, a released result — and the row it
 * writes commits with that write or not at all. That is the whole value of the pattern, and it is why this is a table
 * and not a queue client: a booking that commits and a confirmation that is lost is a patient who was told to expect a
 * message, and no amount of retrying a broker fixes a transaction that already closed.
 *
 * **Nothing raises an event yet.** The records that do — a paid invoice, a released result, a shelf below its
 * re-order level — belong to the billing, diagnostics and pharmacy modules, which this slice does not build. What is
 * here is the mechanism and its proof: `tests/Feature/NotificationOutboxTest.php` raises events through this method,
 * drains them, and checks every outcome the catalogue describes, including the ones that are not "sent".
 *
 * The drain is deliberately suspicious of its own data. A template with a value missing is a refusal
 * (`dizi.template-incomplete`) rather than a message with a gap in it, an event that is not notifiable is recorded as
 * suppressed with the catalogue's own reason, and a patient with no consent for any of the declared channels is a
 * suppressed row naming the channel that had nobody to write to. Every one of those is visible in the delivery log,
 * which is the difference between a quiet hole and a message that did not go.
 */
final class Outbox
{
    public function __construct(
        private readonly NotificationCatalogue $catalogue,
        private readonly Deliveries $deliveries,
        private readonly SendsMessages $senders,
        private readonly Ledger $ledger,
    ) {}

    /**
     * Write an event, inside the caller's transaction.
     *
     * @param  array<string, string>  $values  the template's values as they were at the moment the event happened
     *
     * @throws ProblemException when the topic is not one this node notices, or is deliberately not notifiable
     */
    public function raise(string $topic, ?string $mrn, array $values, Actor $actor): OutboxEvent
    {
        if (! $this->catalogue->knows($topic)) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'This node does not notice that event',
                422,
                'The contract’s `x-dizi-notifications.events` carries no event named `'.$topic.'`, so there is no wording this node could say it in. A producer that raises an event nobody has written is a message that would be invented at drain time, and this refuses it while the writer is still on the line.',
            );
        }

        if (! $this->catalogue->isNotifiable($topic)) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That event is deliberately not notifiable',
                422,
                '`'.$topic.'` is in the catalogue and sends nothing, on purpose — the contract says why beside it. Raising it would create an event whose only possible outcome is a suppression, and the honest place for that decision is the producer: tell the patient in person, or write a notice to the board.',
            );
        }

        return OutboxEvent::query()->create([
            'id' => OutboxEvent::newId(),
            'topic' => $topic,
            'mrn' => $mrn,
            'values' => $values,
            'state' => 'pending',
            'attempts' => 0,
            'within_minutes' => $this->catalogue->withinMinutes($topic),
            /* Due now. The promise in the catalogue is a deadline, not a delay: "within five minutes" is what the desk
               is told, and it is measured from the event rather than from whenever a worker happened to run. */
            'due_at' => ApiTime::now(),
            'node' => $actor->node,
            'origin' => $actor->branch,
            'created_by' => $actor->id,
        ]);
    }

    /**
     * The events that are due, oldest first.
     *
     * @return Collection<int, OutboxEvent>
     */
    public function due(int $limit = 50, ?string $topic = null): Collection
    {
        return OutboxEvent::query()
            ->where('state', 'pending')
            ->where('due_at', '<=', ApiTime::now())
            ->when($topic !== null && $topic !== '', fn ($query) => $query->where('topic', $topic))
            ->orderBy('due_at')
            ->orderBy('id')
            ->limit(max(1, $limit))
            ->get();
    }

    /** How many events are waiting, for a screen that has to be able to say "three messages are still to go". */
    public function pending(): int
    {
        return OutboxEvent::query()->where('state', 'pending')->count();
    }

    /**
     * Send what is due, and say what happened to each one.
     *
     * @return array{attempted: int, sent: int, suppressed: int, failed: int, quiet: int, late: int}
     */
    public function drain(int $limit = 50, ?string $topic = null): array
    {
        $counts = ['attempted' => 0, 'sent' => 0, 'suppressed' => 0, 'failed' => 0, 'quiet' => 0, 'late' => 0];
        $attempts = $this->deliveries->allowedAttempts();

        foreach ($this->due($limit, $topic) as $event) {
            $counts['attempted']++;

            if ($event->isLate()) {
                $counts['late']++;
            }

            $counts[$this->deliverOne($event, $attempts)]++;
        }

        return $counts;
    }

    /**
     * One event: choose a channel, render the wording, send it, and record what happened.
     *
     * @return string which count the caller should add to: `sent`, `suppressed`, `failed` or `quiet`
     */
    private function deliverOne(OutboxEvent $event, int $attempts): string
    {
        $topic = (string) $event->topic;
        $template = $this->catalogue->templateFor($topic);
        $channels = $this->declaredChannels($topic);
        $values = $this->values($event);

        if ($template === null || $channels === []) {
            return $this->suppress($event, 'dizi.template-incomplete', '`'.$topic.'` is in the catalogue and carries no template, so there is nothing to say. The contract says why beside it.');
        }

        $patientFacing = $this->isPatientFacing($topic);
        $channel = $patientFacing
            ? $this->channelWithAConsent($channels, (string) $event->mrn)
            : $this->staffChannel($channels);

        if ($channel === null) {
            /* No consent on any declared channel, or no mailbox for a staff notification. Recorded as a suppression
               with the code that says which: a patient who never agreed is not a channel that is down, and the event
               is not retried into the same refusal every five minutes. */
            $code = $patientFacing ? 'dizi.consent-missing' : 'dizi.recipient-missing';
            $detail = $patientFacing
                ? 'No consent stands for '.($event->mrn ?? 'this patient').' on any channel the catalogue declares ('.implode(', ', $channels).'). Consent is per channel and per address, and a message that has already left cannot be recalled, so nothing was sent.'
                : 'This deployment has no staff address for '.implode(', ', $channels).', so a notification about `'.$topic.'` has nowhere to go. Set one in Setup rather than letting a store keeper find out from an empty shelf.';

            $this->recordSuppression($event, $channels[0], $template, $patientFacing, $values, $code, $detail);

            return $this->finish($event, 'suppressed', $code);
        }

        $consent = $patientFacing ? Consent::inForceFor((string) $event->mrn, $channel) : null;
        $to = $consent?->address ?? (string) config('dizi.messaging.staff_address');

        if ($to === '') {
            $code = $patientFacing ? 'dizi.consent-missing' : 'dizi.recipient-missing';
            $detail = $patientFacing
                ? 'The consent on record for '.($event->mrn ?? 'this patient').' on `'.$channel.'` carries no address, and an address invented at send time is a message to nobody.'
                : 'This deployment has no staff address for `'.$channel.'` configured, so a notification about `'.$topic.'` has nowhere to go.';

            $this->recordSuppression($event, $channel, $template, $patientFacing, $values, $code, $detail);

            return $this->finish($event, 'suppressed', $code);
        }

        /* One language for now, and the reason is not laziness: `patients` carries no language field, and until it
           does, every message goes in the branch's first language. The English wording is in the registry for the day
           the record can say "English", and the portal's Bangla-first rule is the same decision. */
        $language = 'bn';
        $wording = $this->catalogue->wording((string) $template, $channel, $language);
        $missing = $this->unfilledPlaceholders($wording['subject'].' '.$wording['body'], $values);

        if ($missing !== []) {
            /* Rule three of the catalogue: a placeholder with no value refuses the delivery rather than sending a
               sentence with a hole in it. `{{day}}` reaching a patient is worse than no message. */
            $names = implode(', ', array_map(static fn (string $name): string => '{{'.$name.'}}', $missing));
            $them = count($missing) === 1 ? 'it' : 'them';

            $this->recordSuppression(
                $event,
                $channel,
                $template,
                $patientFacing,
                $values,
                'dizi.template-incomplete',
                'The wording for `'.$template.'` uses '.$names.' and the event `'.$topic.'` carried no value for '.$them
                .'. Nothing was sent: a message with a gap in it is worse than no message, and the placeholder names the record that was supposed to fill it.',
            );

            return $this->finish($event, 'suppressed', 'dizi.template-incomplete');
        }

        try {
            $delivery = $this->deliveries->attempt([
                'topic' => $topic,
                'eventId' => (string) $event->id,
                'mrn' => $event->mrn,
                'channel' => $channel,
                'template' => (string) $template,
                'language' => $language,
                'to' => $to,
                'subject' => $wording['subject'],
                'body' => $this->fill($wording['body'], $values),
                'patientFacing' => $patientFacing,
                'attempt' => (int) $event->attempts + 1,
            ], $this->actor($event), 'message.notify');
        } catch (ProblemException $refused) {
            /* The gateway refused. The failed attempt is already in the log — `Deliveries::attempt` writes it before
               rethrowing — and what is decided here is whether this event gets another try: backoff while attempts
               remain, failed when they do not. */
            $event->attempts = (int) $event->attempts + 1;
            $event->last_error = $refused->type;

            if ((int) $event->attempts >= $attempts) {
                $event->state = 'failed';
                $event->save();

                return 'failed';
            }

            $event->due_at = ApiTime::now()->addSeconds($this->backoffFor((int) $event->attempts));
            $event->save();

            return 'failed';
        }

        if ($delivery->status === 'suppressed') {
            $code = (string) $delivery->error_code;

            /* Quiet hours are the one suppression that is not a decision: the message is due again when the window
               closes, and the event stays pending until then. Everything else — no consent, no address, an unapproved
               template — is a decision, and retrying it in five minutes would produce the same refusal and a second
               row saying so. */
            if ($code === 'dizi.quiet-hours') {
                $event->attempts = 0;
                $event->due_at = $this->deliveries->quietHoursClose(ApiTime::now()) ?? ApiTime::now()->addHour();
                $event->last_error = $code;
                $event->save();

                return 'quiet';
            }

            return $this->finish($event, 'suppressed', $code);
        }

        $event->state = 'sent';
        $event->attempts = (int) $event->attempts + 1;
        $event->save();

        return 'sent';
    }

    /** Close an event out with a state and the code that explains it. */
    private function finish(OutboxEvent $event, string $state, string $code): string
    {
        $event->state = $state;
        $event->last_error = $code;
        $event->save();

        return $state;
    }

    /**
     * Write a suppressed attempt through the delivery path, so the log tells one story whichever way a message did not
     * go out.
     *
     * @param  array<string, string>  $values
     */
    private function recordSuppression(
        OutboxEvent $event,
        string $channel,
        ?string $template,
        bool $patientFacing,
        array $values,
        string $code,
        string $detail,
    ): void {
        $wording = $template !== null && $this->senders->carries($channel)
            ? $this->catalogue->wording($template, $channel, 'bn')
            : ['subject' => null, 'body' => null];

        $this->deliveries->attempt([
            'topic' => (string) $event->topic,
            'eventId' => (string) $event->id,
            'mrn' => $event->mrn,
            'channel' => $channel,
            'template' => (string) ($template ?? ''),
            'language' => 'bn',
            /* No address was used, so the row carries none rather than a placeholder that would read as a hidden
               number: `to` is masked, and a mask over nothing is a lie about what was known. */
            'to' => '',
            'subject' => $wording['subject'],
            'body' => $this->render($wording['body'], $values),
            'patientFacing' => $patientFacing,
            'attempt' => (int) $event->attempts + 1,
            'suppress' => ['code' => $code, 'detail' => $detail],
        ], $this->actor($event), 'message.notify');
    }

    /** The event's own node and author: a message that goes out because of a booking belongs to the node that took it. */
    private function actor(OutboxEvent $event): Actor
    {
        return new Actor(
            id: (string) $event->created_by,
            name: (string) $event->created_by,
            role: '',
            branch: (string) $event->origin,
            node: (string) $event->node,
        );
    }

    /** @return array<string, string> */
    private function values(OutboxEvent $event): array
    {
        $values = $event->values;

        return is_array($values) ? array_map(static fn ($value): string => (string) $value, $values) : [];
    }

    /** The channels the catalogue declares for one event, in its own order. */
    private function declaredChannels(string $topic): array
    {
        $event = $this->catalogue->events()[$topic] ?? [];

        return is_array($event) && is_array($event['channels'] ?? null) ? array_values($event['channels']) : [];
    }

    private function isPatientFacing(string $topic): bool
    {
        $event = $this->catalogue->events()[$topic] ?? [];

        return is_array($event) && ($event['consent'] ?? false) === true;
    }

    /** The first declared channel the patient has a standing consent for. */
    private function channelWithAConsent(array $channels, string $mrn): ?string
    {
        foreach ($channels as $channel) {
            if ($this->senders->carries($channel) && Consent::inForceFor($mrn, (string) $channel) !== null) {
                return (string) $channel;
            }
        }

        return null;
    }

    /** The first declared channel this node can carry, for a notification that goes to the hospital's own mailboxes. */
    private function staffChannel(array $channels): ?string
    {
        foreach ($channels as $channel) {
            if ($this->senders->carries($channel)) {
                return (string) $channel;
            }
        }

        return null;
    }

    /** The backoff for an attempt that has just failed — `x-dizi-notifications.retry.backoffSeconds`. */
    private function backoffFor(int $attempt): int
    {
        $backoff = $this->catalogue->retry()['backoffSeconds'] ?? [];
        $seconds = is_array($backoff) ? ($backoff[max(0, $attempt - 1)] ?? null) : null;

        return is_int($seconds) && $seconds > 0 ? $seconds : 300;
    }

    /**
     * The placeholders the values do not fill.
     *
     * @param  array<string, string>  $values
     * @return list<string>
     */
    private function unfilledPlaceholders(string $text, array $values): array
    {
        preg_match_all('/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/', $text, $matches);

        return array_values(array_filter(
            array_unique($matches[1] ?? []),
            static fn (string $name): bool => ! array_key_exists($name, $values) || trim((string) $values[$name]) === '',
        ));
    }

    /** @param array<string, string> $values */
    private function fill(string $text, array $values): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/',
            static fn (array $match): string => (string) ($values[$match[1]] ?? ''),
            $text,
        );
    }

    /**
     * The same, but null when a value is missing.
     *
     * A suppression row's body shows what would have gone; if the event could not fill it, the row says nothing rather
     * than showing a sentence with `{{day}}` still in it, which reads as a rendering bug and hides the real one.
     *
     * @param  array<string, string>  $values
     */
    private function render(?string $text, array $values): ?string
    {
        if ($text === null || $text === '') {
            return null;
        }

        return $this->unfilledPlaceholders($text, $values) === [] ? $this->fill($text, $values) : null;
    }
}
