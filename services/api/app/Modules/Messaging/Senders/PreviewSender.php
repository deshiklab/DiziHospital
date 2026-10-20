<?php

declare(strict_types=1);

namespace App\Modules\Messaging\Senders;

/**
 * The driver that sends nothing, and says so.
 *
 * This is the default in this repository, and it is not a stub in the sense of being unfinished: it is what a
 * deployment with no WhatsApp Business account and no mail relay actually is. What it must never do is look like a
 * delivery. It renders the sentence (so the log shows what *would* have gone), records the attempt with
 * `provider: preview`, and the delivery page prints the driver in force at the top — "a log of preview rows is not
 * evidence that anybody was told" is the contract's own sentence about it.
 *
 * There is no message id, because no carrier issued one.
 */
final class PreviewSender implements Sender
{
    public function name(): string
    {
        return 'preview';
    }

    public function send(string $to, ?string $subject, string $body, string $template = ''): ?string
    {
        return null;
    }
}
