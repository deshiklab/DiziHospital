<?php

declare(strict_types=1);

namespace App\Modules\Messaging\Senders;

/**
 * One way of getting a message out.
 *
 * A sender does one thing: hand the text to something that will carry it, and come back with that carrier's own name
 * for the message. It does not decide whether the message should be sent (that is consent and quiet hours, and it
 * happens before this is called) and it does not write the log (that is `Deliveries`, so that every driver's failure
 * is recorded in the same place, in the same shape).
 *
 * A failure here is a `502` and never a quiet `false`: the contract's own words are "the gateway is unreachable and
 * nothing was sent — the screen says so rather than showing a tick". That refusal is each driver's own sentence and not
 * part of this promise, because the only driver that can never fail is the one that carries nothing.
 */
interface Sender
{
    /** The driver's name as the delivery log records it. */
    public function name(): string;

    /**
     * @param  string  $template  the template's key, where the carrier needs it (a WhatsApp template message names one)
     * @return string|null the provider's own id for the message, or null when the carrier gives none
     */
    public function send(string $to, ?string $subject, string $body, string $template = ''): ?string;
}
