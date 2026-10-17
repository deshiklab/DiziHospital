<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\ProblemException;

/**
 * The catalogue, read from the contract itself.
 *
 * Read once and cached in the instance: this is configuration, changed when a branch changes its wording in Setup
 * rather than per request. A missing or unreadable `x-dizi-notifications` block is a refusal rather than a set of
 * defaults — the same rule the appointment grid follows, and for a sharper reason here: a default wording would send a
 * patient a sentence this hospital never approved, and the first person to find out would be the patient.
 *
 * The branch's clock comes from `x-dizi-scheduling.timezone` rather than from a second field here. Quiet hours are
 * 21:00–08:00 *in the branch*, and a hospital that runs a night shift has one clock; a copy of it in this block would
 * be a second one, and they would disagree the first time somebody moved a boundary.
 */
final class ContractNotificationCatalogue implements NotificationCatalogue
{
    /** @var array<string, mixed>|null */
    private ?array $loaded = null;

    public function __construct(private readonly string $path) {}

    public function channels(): array
    {
        $channels = $this->load()['channels'] ?? null;

        if (! is_array($channels) || $channels === []) {
            throw $this->missing('`x-dizi-notifications.channels` names no channel, so no message could leave this node.');
        }

        return $channels;
    }

    public function events(): array
    {
        $events = $this->load()['events'] ?? null;

        if (! is_array($events)) {
            throw $this->missing('`x-dizi-notifications.events` is not a list of events.');
        }

        return $events;
    }

    public function templates(): array
    {
        $templates = $this->load()['templates'] ?? null;

        if (! is_array($templates)) {
            throw $this->missing('`x-dizi-notifications.templates` carries no wording.');
        }

        return $templates;
    }

    public function retry(): array
    {
        return $this->block('retry', ['attempts', 'backoffSeconds']);
    }

    public function alerting(): array
    {
        return $this->block('alerting', ['consecutiveFailures', 'windowMinutes']);
    }

    public function quietHours(): array
    {
        return $this->block('quietHours', ['from', 'to']);
    }

    public function timezone(): string
    {
        $zone = $this->document()['x-dizi-scheduling']['timezone'] ?? null;

        if (! is_string($zone) || $zone === '') {
            throw $this->missing('`x-dizi-scheduling.timezone` is not a timezone identifier, so the quiet hours have no clock to be read on.');
        }

        return $zone;
    }

    public function rules(): array
    {
        $rules = $this->load()['rules'] ?? null;

        return is_array($rules) ? array_values(array_filter($rules, 'is_string')) : [];
    }

    public function knows(string $topic): bool
    {
        return array_key_exists($topic, $this->events());
    }

    public function isNotifiable(string $topic): bool
    {
        $event = $this->events()[$topic] ?? null;
        $channels = is_array($event) ? ($event['channels'] ?? []) : [];

        return $event !== null && is_array($channels) && $channels !== [];
    }

    public function withinMinutes(string $topic): int
    {
        $event = $this->events()[$topic] ?? null;
        $minutes = is_array($event) ? ($event['withinMinutes'] ?? null) : null;

        return is_int($minutes) && $minutes >= 0 ? $minutes : 0;
    }

    public function templateFor(string $topic): ?string
    {
        $event = $this->events()[$topic] ?? null;
        $template = is_array($event) ? ($event['template'] ?? null) : null;

        return is_string($template) && $template !== '' ? $template : null;
    }

    public function wording(string $template, string $channel, string $language): array
    {
        $wording = $this->templates()[$template][$channel] ?? null;

        if (! is_array($wording)) {
            throw $this->missing("`x-dizi-notifications.templates.{$template}` has no wording for `{$channel}`.");
        }

        /* An e-mail carries a subject and a body; a WhatsApp template is one piece of text. Both are read as
           `{subject, body}` so the caller has one shape to render, and a missing subject is a null rather than an
           empty line on the screen. */
        $subject = $wording['subject'][$language] ?? null;
        $body = $wording['body'][$language] ?? ($wording[$language] ?? null);

        if (! is_string($body) || trim($body) === '') {
            throw $this->missing("`x-dizi-notifications.templates.{$template}.{$channel}` has no `{$language}` wording, and the portal is Bangla-first.");
        }

        return ['subject' => is_string($subject) ? $subject : null, 'body' => $body];
    }

    /**
     * One rule block, with the keys the rest of this module reads.
     *
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    private function block(string $name, array $keys): array
    {
        $block = $this->load()[$name] ?? null;

        if (! is_array($block)) {
            throw $this->missing("`x-dizi-notifications.{$name}` is missing.");
        }

        foreach ($keys as $key) {
            if (! array_key_exists($key, $block)) {
                throw $this->missing("`x-dizi-notifications.{$name}.{$key}` is missing.");
            }
        }

        return $block;
    }

    /** @return array<string, mixed> */
    private function load(): array
    {
        return $this->document()['x-dizi-notifications'] ?? throw $this->missing('the contract carries no `x-dizi-notifications` block.');
    }

    /** @return array<string, mixed> */
    private function document(): array
    {
        if ($this->loaded !== null) {
            return $this->loaded;
        }

        if (! is_file($this->path)) {
            throw $this->missing('the contract is not deployed beside this service.');
        }

        $document = json_decode((string) file_get_contents($this->path), true);

        if (! is_array($document)) {
            throw $this->missing('the contract could not be read as JSON.');
        }

        return $this->loaded = $document;
    }

    private function missing(string $because): ProblemException
    {
        return ProblemException::of(
            'dizi.unavailable',
            'The messaging catalogue is missing',
            503,
            'This service sends what the product contract says it sends and could not read it: '.$because
            .' Reading `'.$this->path.'`. Sending a patient a sentence nobody approved is worse than sending nothing, so no message leaves this node until the contract is deployed beside the service.',
        );
    }
}
