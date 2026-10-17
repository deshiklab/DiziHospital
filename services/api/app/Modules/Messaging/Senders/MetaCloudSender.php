<?php

declare(strict_types=1);

namespace App\Modules\Messaging\Senders;

use App\Support\ProblemException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * WhatsApp, through the Meta Cloud API.
 *
 * Three things about this driver are deliberate:
 *
 *  1. **It sends a template message, never free-form text.** Outside the 24-hour customer service window Meta refuses
 *     free-form text, and inside it the approved template is still the honest thing to send, because what the patient
 *     receives should be what the hospital approved. The template's named placeholders are mapped to positional
 *     parameters in the order they first appear in the body — the convention this account's templates have to be
 *     authored to, and the reason the mapping is written down here rather than assumed.
 *  2. **It refuses when it is not configured.** No token or no phone number id is a `502` naming the variable, not an
 *     attempt against a half-configured account.
 *  3. **No message has been sent through it from this repository.** There is no Meta account here and no network to
 *     one; `tests/Unit` exercises the mapping and the refusal shape, and that is the whole of the evidence. The
 *     honest statement is in `services/api/README.md`.
 */
final class MetaCloudSender implements Sender
{
    /**
     * @param  string  $graphUrl  the API root, so a deployment can pin a version instead of taking whatever is current
     */
    public function __construct(
        private readonly string $graphUrl,
        private readonly string $phoneNumberId,
        private readonly string $token,
        private readonly int $timeoutSeconds = 10,
    ) {}

    public function name(): string
    {
        return 'meta-cloud';
    }

    public function send(string $to, ?string $subject, string $body, string $template = ''): ?string
    {
        if ($this->token === '' || $this->phoneNumberId === '') {
            throw $this->refuse('this deployment has no WhatsApp Business token or phone number id.');
        }

        if ($template === '') {
            throw $this->refuse('a WhatsApp message is a template message, and none was named — free-form text is refused by Meta outside the 24-hour window.');
        }

        try {
            $response = Http::withToken($this->token)
                ->timeout($this->timeoutSeconds)
                ->post(rtrim($this->graphUrl, '/').'/'.$this->phoneNumberId.'/messages', [
                    'messaging_product' => 'whatsapp',
                    'to' => $to,
                    'type' => 'template',
                    'template' => [
                        'name' => $template,
                        'language' => ['code' => 'bn'],
                        'components' => [[
                            'type' => 'body',
                            'parameters' => self::parameters($body),
                        ]],
                    ],
                ]);
        } catch (ConnectionException $unreachable) {
            throw $this->refuse('the gateway could not be reached: '.$unreachable->getMessage());
        }

        if ($response->failed()) {
            /* Meta's own sentence goes into the log rather than a paraphrase of it: when a branch telephones about a
               message that did not arrive, "the number is not registered on WhatsApp" is the answer, and this is where
               it is kept. */
            throw $this->refuse('the gateway answered '.$response->status().': '.mb_substr(trim($response->body()), 0, 300));
        }

        $id = $response->json('messages.0.id');

        return is_string($id) ? $id : null;
    }

    private function refuse(string $because): ProblemException
    {
        return ProblemException::of(
            'dizi.unavailable',
            'The gateway is unreachable',
            502,
            'The WhatsApp gateway did not accept this message and nothing was sent: '.$because
            .' The attempt is in the delivery log with the gateway’s own words; the desk can send the printed copy or try again.',
        );
    }

    /**
     * The template's body parameters, in the order the placeholders appear.
     *
     * Meta numbers its parameters `{{1}}`, `{{2}}` … while the contract's templates name theirs (`{{day}}`,
     * `{{token}}`), so the order a value lands in is the order its placeholder first appears. Duplicated placeholders
     * share one parameter, which is what a template with `{{patient}}` twice needs.
     *
     * @return list<array{type: string, text: string}>
     */
    public static function parameters(string $body): array
    {
        preg_match_all('/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/', $body, $matches);

        return array_values(array_map(
            static fn (string $name): array => ['type' => 'text', 'text' => $name],
            array_values(array_unique($matches[1] ?? [])),
        ));
    }
}
