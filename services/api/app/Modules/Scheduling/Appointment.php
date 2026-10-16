<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * One appointment: a claim on a slot, held by the branch that took it.
 *
 * The row is small on purpose. What a screen needs at the desk — the patient's name, their age, whether they are
 * allergic to anything — is *registration's*, and this module reaches it by MRN at the edges (the controller reads
 * the patient through `Register`) rather than keeping a copy that goes stale the first time somebody corrects a
 * spelling. What this row owns is the claim: which doctor, which day, which minutes, held by which branch, and the
 * queue token the board calls out.
 *
 * `slot_key` is the exclusivity rule (see the migration): it is set while the appointment holds its slot and cleared
 * when it is cancelled, so the unique index over it is what makes "one patient per slot" true on both databases.
 *
 * `status` moves one way through the queue — a patient who has been called is not un-called — and the allowed moves
 * are named here rather than at each call site, because a status machine spread over three controllers is a status
 * machine with a transition nobody meant.
 *
 * @property string $id
 * @property string $token
 * @property string $mrn
 * @property string $doctor_id
 * @property string $room
 * @property string $day
 * @property int $start_minute
 * @property Carbon $start_at
 * @property int $duration_min
 * @property int $steps
 * @property string $type
 * @property string $status
 * @property string $priority
 * @property string $source
 * @property string|null $reason
 * @property string $origin
 * @property string $node
 * @property string|null $slot_key
 * @property int $version
 */
final class Appointment extends Model
{
    use HasModuleTable;

    protected const MODULE = 'scheduling';

    protected const TABLE = 'appointments';

    /** The contract's own enum, in the contract's own order. */
    public const STATUSES = ['Requested', 'Confirmed', 'Checked in', 'Waiting', 'In consultation', 'Completed', 'No show', 'Cancelled'];

    public const TYPES = ['New', 'Follow-up', 'Report review', 'Procedure'];

    public const SOURCES = ['Walk-in', 'Phone', 'Online portal', 'Follow-up'];

    /** The statuses that still hold their slot: everything but a cancellation. */
    public const HOLDING = ['Requested', 'Confirmed', 'Checked in', 'Waiting', 'In consultation', 'Completed', 'No show'];

    /** The statuses a patient is in the queue for — the ones the board counts. */
    public const IN_QUEUE = ['Checked in', 'Waiting', 'In consultation'];

    /** The statuses past which nothing may be changed: the visit happened, or it did not. */
    public const SETTLED = ['Completed', 'No show'];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'start_minute' => 'integer',
        'duration_min' => 'integer',
        'steps' => 'integer',
        'version' => 'integer',
        'start_at' => 'datetime',
        'checked_in_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /** A new appointment's identifier: sortable by creation, and safe to mint on a node that is offline. */
    public static function newId(): string
    {
        return (string) Str::ulid();
    }

    /**
     * The exclusive claim on one slot, as one comparable string.
     *
     * Minutes are padded so the key sorts by time; the padding is not decoration, because `9` sorting after `10` in a
     * key that is read by a person during an incident is a small, expensive kind of wrong.
     */
    public static function slotKeyFor(string $doctorId, string $day, int $startMinute): string
    {
        return $doctorId.'@'.$day.'T'.str_pad((string) $startMinute, 4, '0', STR_PAD_LEFT);
    }

    /** The slot key this appointment would hold, whether or not it currently holds one. */
    public function claimKey(): string
    {
        return self::slotKeyFor((string) $this->doctor_id, (string) $this->day, (int) $this->start_minute);
    }

    public function holdsASlot(): bool
    {
        return in_array($this->status, self::HOLDING, true);
    }

    public function isQueued(): bool
    {
        return in_array($this->status, self::IN_QUEUE, true);
    }

    /**
     * The appointment as the contract describes it.
     *
     * `queued` is always false here and that is not a placeholder: it means "this row is the branch's, not the
     * outbox's", which is the one thing a record read back from this service can say for certain. The app sets it
     * true for the rows it is still holding locally, and the screen draws those differently.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return [
            'id' => (string) $this->id,
            'token' => (string) $this->token,
            'mrn' => (string) $this->mrn,
            'doctorId' => (string) $this->doctor_id,
            'room' => (string) $this->room,
            'start' => ApiTime::iso($this->start_at),
            'durationMin' => (int) $this->duration_min,
            'status' => (string) $this->status,
            'type' => (string) $this->type,
            'priority' => (string) $this->priority,
            'source' => (string) $this->source,
            'reason' => $this->reason,
            'origin' => (string) $this->origin,
            'steps' => (int) $this->steps,
            'queued' => false,
        ];
    }
}
