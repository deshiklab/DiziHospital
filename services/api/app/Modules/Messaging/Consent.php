<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A patient's permission to be messaged on one channel, for one address.
 *
 * Three things about this row decide what the API does with it:
 *
 *  1. **Consent is per channel and per address.** A patient who gave a number for WhatsApp has not agreed to an
 *     e-mail, and a patient who gave a number last year has not agreed to the new one: the message goes to the
 *     address the consent was given for, and a changed address needs a new consent. That is why `ref` is what a send
 *     quotes back and why the address is stored here rather than read off the patient's record at send time.
 *  2. **Withdrawal is a date, not a delete.** The record that somebody once agreed stays, because "when did we stop"
 *     is a question an inspection asks; the send is what changes, and it changes to a refusal.
 *  3. **Nothing writes this yet.** The desk screen that records consent from the patient is a later slice, and until
 *     it exists a send with no consent row is refused with `dizi.consent-missing` rather than quietly allowed —
 *     which is the honest state of a module whose permission table is empty.
 *
 * @property string $id
 * @property string $mrn
 * @property string $channel
 * @property string $address
 * @property string $ref
 * @property Carbon $granted_at
 * @property Carbon|null $withdrawn_at
 * @property string $recorded_by
 * @property string $node
 * @property string $origin
 */
final class Consent extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'consents';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'granted_at' => 'datetime',
        'withdrawn_at' => 'datetime',
    ];

    public function stands(): bool
    {
        return $this->withdrawn_at === null;
    }

    /**
     * Whether this consent covers an address.
     *
     * Compared the way the number is *meant* rather than the way it was typed: `+880 1711-000678`, `8801711000678` and
     * `01711000678` are one subscriber, and an e-mail is compared case-insensitively because nobody means a different
     * mailbox by changing the case of one. Two genuinely different numbers stay different — a typo is a 422 at the
     * desk, not a message to a stranger.
     */
    public function covers(string $address): bool
    {
        return self::normalise((string) $this->channel, (string) $this->address) === self::normalise((string) $this->channel, $address);
    }

    /**
     * The consent in force for a patient on a channel, if there is one.
     *
     * Read as "the most recent one that has not been withdrawn": a patient who consented in January and again in June
     * has consented twice, and the second address is the one to write to.
     */
    public static function inForceFor(string $mrn, string $channel): ?self
    {
        return self::query()
            ->where('mrn', $mrn)
            ->where('channel', $channel)
            ->whereNull('withdrawn_at')
            ->orderByDesc('granted_at')
            ->first();
    }

    private static function normalise(string $channel, string $address): string
    {
        if ($channel === 'email') {
            return mb_strtolower(trim($address));
        }

        $digits = (string) preg_replace('/\D+/', '', $address);

        /* Bangladesh's country code and its national trunk prefix are two spellings of one subscriber: a desk that
           copies `+8801711000678` off a card and one that types `01711000678` mean the same patient, and refusing the
           second would make the desk guess which form the record holds. Everything else is compared digit for digit,
           because two different numbers really are two different numbers. */
        if (str_starts_with($digits, '880') && strlen($digits) > 11) {
            $digits = '0'.substr($digits, 3);
        }

        return $digits;
    }
}
