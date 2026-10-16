<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\ProblemException;

/**
 * How a message leaves this node.
 *
 * One seam, two named drivers, and no fallback between them. The `preview` driver is what a checkout with no gateway
 * runs: it renders the sentence, records it, and touches no network — and every row it writes carries
 * `provider: preview` so that a log of preview rows can never be read as evidence that a patient was told. The real
 * drivers (`meta-cloud` for WhatsApp, `smtp` for e-mail) are what a branch with a paid account runs, and which one is
 * in force is a deployment decision rather than something inferred at send time.
 *
 * The contract is `x-dizi-notifications.channels`, and it is deliberately one table read by the service and by the
 * app: a screen that offers a send on a channel this node cannot carry is a screen offering something that will fail
 * at the desk rather than in Setup.
 */
interface SendsMessages
{
    /** Which driver is in force for a channel: `preview`, `meta-cloud` or `smtp`. */
    public function driver(string $channel): string;

    /** Whether this node can carry that channel at all. */
    public function carries(string $channel): bool;

    /**
     * Send one message, and answer with the provider's own name for it.
     *
     * @return array{provider: string, messageId: string|null}
     *
     * @throws ProblemException 502 when the gateway refused or could not be reached — the attempt is recorded before
     *                           this is thrown, so "the gateway is down" is a row in the log and not only a sentence on
     *                           a screen.
     */
    public function send(string $channel, string $to, ?string $subject, string $body, string $template = ''): array;
}
