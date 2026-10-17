<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

/**
 * What this node notices, what each event is said in, and how it behaves when it cannot send.
 *
 * The catalogue is *data* — `x-dizi-notifications` in `packages/contracts/openapi.json` — and this is the seam the
 * module reads it through. The alternative is a constant in PHP that the app's own client is generated against
 * separately, and the failure that produces is a screen offering a template the service has never heard of, or a
 * quiet-hours rule the desk's copy of the product disagrees with. One table, read by the service and by the app.
 *
 * Every method here refuses rather than defaults when the block is missing or malformed: sending a patient a sentence
 * built from invented wording is worse than sending nothing, and it is the kind of wrong that is only found when a
 * patient telephones about a message nobody meant to write.
 */
interface NotificationCatalogue
{
    /**
     * The channels a message may leave by, as `x-dizi-notifications.channels` names them.
     *
     * @return array<string, mixed> channel => the driver, what it carries, what it needs, how it refuses
     */
    public function channels(): array;

    /**
     * The events, as `x-dizi-notifications.events` names them.
     *
     * @return array<string, mixed> topic => means, template, channels, withinMinutes, consent
     */
    public function events(): array;

    /**
     * The wording, as `x-dizi-notifications.templates` carries it: template key => channel => bn/en.
     *
     * @return array<string, mixed>
     */
    public function templates(): array;

    /** How many attempts one channel gets, and the backoff between them. */
    public function retry(): array;

    /** When the log says a channel is not delivering rather than unlucky. */
    public function alerting(): array;

    /** The hours a patient is not messaged in, and why. */
    public function quietHours(): array;

    /** The branch's clock, which is where the quiet hours are read — `x-dizi-scheduling` owns it, once. */
    public function timezone(): string;

    /** The decisions a reader would otherwise have to guess at. */
    public function rules(): array;

    /** Whether this node has an event by that name. */
    public function knows(string $topic): bool;

    /** Whether the event is one a patient is told about, or one that is deliberately quiet. */
    public function isNotifiable(string $topic): bool;

    /** How long the catalogue promises the event takes to go out, in minutes. */
    public function withinMinutes(string $topic): int;

    /** The template key one event is said in, or null when it is deliberately not notifiable. */
    public function templateFor(string $topic): ?string;

    /**
     * The wording of one template in one language, ready for its values to be put in.
     *
     * @return array{subject: string|null, body: string}
     */
    public function wording(string $template, string $channel, string $language): array;
}
