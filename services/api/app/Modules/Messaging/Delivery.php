<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * One attempt to deliver one message.
 *
 * Appended, never edited — and that is the whole design. A retry inserts attempt 2 next to the failed attempt 1, so the
 * log answers both questions a complaint asks: *did it go?* (the newest attempt) and *what did the gateway say?* (a row
 * per try, in the gateway's own words). Editing the failed row would answer the first and destroy the second, which is
 * the one an incident is reconstructed from.
 *
 * `to` is stored in full and returned masked. The address has to be here for the next attempt to have somewhere to go;
 * the API never gives it back, because this table is read at a desk by whoever is on duty, and a delivery log with
 * every patient's number in it is a second patient register — one that nobody looks after.
 *
 * `retryable` is derived rather than stored: it is a failed attempt with attempts left. A suppression is deliberately
 * *not* retryable, because pressing retry does not create consent, and a queued one is not either — nothing has failed
 * yet.
 *
 * @property string $id
 * @property string|null $event_id
 * @property string $topic
 * @property string $channel
 * @property string $template
 * @property string $language
 * @property string|null $mrn
 * @property string $to_address
 * @property string|null $subject
 * @property string|null $body
 * @property string $status
 * @property string $provider
 * @property string|null $provider_message_id
 * @property string|null $error_code
 * @property string|null $detail
 * @property int $attempt
 * @property bool $patient_facing
 * @property Carbon $at
 * @property string $node
 * @property string $origin
 * @property string $created_by
 */
final class Delivery extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'deliveries';

    /** The contract's own enum, in the contract's own order. */
    public const STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'suppressed'];

    /** The channels this node carries, which is `x-dizi-notifications.channels`. */
    public const CHANNELS = ['whatsapp', 'email'];

    /** The languages a wording exists in. */
    public const LANGUAGES = ['bn', 'en'];

    /** The statuses a person may retry from: a failed attempt, and nothing else. */
    public const RETRYABLE_FROM = ['failed'];

    /** The statuses that mean "this attempt was not a fault of the channel". */
    public const SUPPRESSIONS = ['suppressed'];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'attempt' => 'integer',
        'patient_facing' => 'boolean',
        'at' => 'datetime',
    ];

    public static function newId(): string
    {
        return (string) Str::ulid();
    }

    /**
     * An address as a log may show it.
     *
     * The last three characters survive, and nothing else does. That is enough to answer "did it go to the number
     * ending 678?" — the question a patient actually asks — and not enough to be a usable list of numbers if the log
     * is photographed, exported or left on a screen.
     */
    public static function mask(string $address): string
    {
        /* A suppressed attempt has no address — nobody agreed to be written to — and a mask over nothing would read as
           a number somebody is hiding rather than as one that was never used. */
        if ($address === '') {
            return '';
        }

        $at = strpos($address, '@');

        if ($at !== false) {
            $name = substr($address, 0, $at);
            $domain = substr($address, $at + 1);

            return mb_substr($name, 0, 1).str_repeat('*', 4).'@'.$domain;
        }

        $tail = mb_substr($address, -3);

        return str_repeat('*', 5).$tail;
    }

    /** Whether a person may retry this attempt: it failed, and the attempts the catalogue allows are not used up. */
    public function isRetryable(int $allowedAttempts): bool
    {
        return in_array($this->status, self::RETRYABLE_FROM, true) && (int) $this->attempt < $allowedAttempts;
    }

    /**
     * The attempt as the contract's `NotificationDelivery` describes it.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(int $allowedAttempts): array
    {
        return [
            'id' => (string) $this->id,
            'eventId' => $this->event_id,
            'topic' => (string) $this->topic,
            'channel' => (string) $this->channel,
            'template' => (string) $this->template,
            'language' => (string) $this->language,
            'mrn' => $this->mrn,
            'to' => self::mask((string) $this->to_address),
            'status' => (string) $this->status,
            'provider' => (string) $this->provider,
            'providerMessageId' => $this->provider_message_id,
            'errorCode' => $this->error_code,
            'detail' => $this->detail,
            'subject' => $this->subject,
            'body' => $this->body,
            'attempt' => (int) $this->attempt,
            'at' => ApiTime::iso($this->at),
            'retryable' => $this->isRetryable($allowedAttempts),
        ];
    }
}
