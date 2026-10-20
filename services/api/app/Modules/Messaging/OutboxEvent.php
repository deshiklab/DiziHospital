<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Something worth telling somebody, written in the same transaction as the thing that caused it.
 *
 * That sentence is the reason this table exists. A booking and its confirmation must not be able to disagree about
 * whether the booking happened, so the event is a row in this node's database, written inside the booking's own
 * transaction, and a worker drains it afterwards. A queue held in memory or in a third-party broker would make the
 * disagreement possible — the booking commits, the process dies, and the patient who was told to expect a message
 * never gets one with nothing anywhere saying so.
 *
 * `values` holds the template's values as the event found them, not a rendered sentence: the wording is the branch's
 * and may be edited, and what has to be reproducible afterwards is what happened — the test name, the day, the room —
 * rather than the sentence a template would have built from it last Tuesday.
 *
 * @property string $id
 * @property string $topic
 * @property string|null $mrn
 * @property array<string, string> $values
 * @property string $state
 * @property int $attempts
 * @property int $within_minutes
 * @property Carbon $due_at
 * @property string|null $last_error
 * @property string $node
 * @property string $origin
 * @property string $created_by
 */
final class OutboxEvent extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'outbox';

    /** Pending is due; the other three are decided and final. */
    public const STATES = ['pending', 'sent', 'failed', 'suppressed'];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'values' => 'array',
        'attempts' => 'integer',
        'within_minutes' => 'integer',
        'due_at' => 'datetime',
    ];

    public static function newId(): string
    {
        return (string) Str::ulid();
    }

    /** Whether the promise the catalogue makes for this topic has already been missed. */
    public function isLate(): bool
    {
        return $this->state === 'pending'
            && $this->within_minutes > 0
            && $this->created_at !== null
            && $this->created_at->diffInMinutes(Carbon::now(), true) > $this->within_minutes;
    }
}
