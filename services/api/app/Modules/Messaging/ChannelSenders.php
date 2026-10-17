<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Modules\Messaging\Senders\MetaCloudSender;
use App\Modules\Messaging\Senders\PreviewSender;
use App\Modules\Messaging\Senders\Sender;
use App\Modules\Messaging\Senders\SmtpSender;
use App\Support\ProblemException;

/**
 * Which driver carries which channel, decided once at boot.
 *
 * The mapping is configuration (`dizi.messaging.channels`) and the drivers are named in it, so a deployment that has
 * a WhatsApp account and no mail relay is a two-line change with no code path that can be half-updated. A channel with
 * no driver is refused with `503` naming it, because the alternative — falling back to a driver that carries nothing —
 * is the failure mode this whole module is written against.
 *
 * The `preview` driver is a driver and not a fallback: a deployment that selects it gets rows that say `preview`, and
 * the page shows which driver is in force at the top.
 */
final class ChannelSenders implements SendsMessages
{
    /** @var array<string, Sender> */
    private array $senders = [];

    /**
     * @param  array<string, array{driver?: string, from?: string}>  $channels
     */
    public function __construct(
        private readonly array $channels,
        private readonly string $whatsappGraphUrl,
        private readonly string $whatsappPhoneNumberId,
        private readonly string $whatsappToken,
        private readonly string $mailFrom,
    ) {}

    public function driver(string $channel): string
    {
        return $this->driverName($channel);
    }

    public function carries(string $channel): bool
    {
        return array_key_exists($channel, $this->channels);
    }

    public function send(string $channel, string $to, ?string $subject, string $body, string $template = ''): array
    {
        $sender = $this->sender($channel);
        $messageId = $sender->send($to, $subject, $body, $template);

        return ['provider' => $sender->name(), 'messageId' => $messageId];
    }

    private function sender(string $channel): Sender
    {
        if (isset($this->senders[$channel])) {
            return $this->senders[$channel];
        }

        return $this->senders[$channel] = match ($this->driverName($channel)) {
            'preview' => new PreviewSender,
            'meta-cloud' => new MetaCloudSender($this->whatsappGraphUrl, $this->whatsappPhoneNumberId, $this->whatsappToken),
            'smtp' => new SmtpSender($this->mailFrom),
            default => throw ProblemException::of(
                'dizi.unavailable',
                'This node cannot carry that channel',
                503,
                'The channel `'.$channel.'` is configured with a driver this service does not implement. Naming it is the point: a channel that silently falls back to one that carries nothing is how a patient is never told.',
            ),
        };
    }

    private function driverName(string $channel): string
    {
        if (! $this->carries($channel)) {
            throw ProblemException::of(
                'dizi.unavailable',
                'This node cannot carry that channel',
                503,
                'This node carries no driver for `'.$channel.'`. The channels it carries are named in `x-dizi-notifications.channels` and bound in configuration; a message addressed to a channel nobody implements is refused here rather than dropped quietly.',
            );
        }

        return (string) ($this->channels[$channel]['driver'] ?? 'preview');
    }
}
