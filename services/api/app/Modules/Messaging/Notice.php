<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * One notice on the hospital's own board.
 *
 * A notice is not a message to a patient: it names people, roles, departments or the whole branch, and it never
 * leaves the building. That is why the row keeps who wrote it and how urgent it is, and why the read state is not on
 * this row — `NoticeReceipt` is one person having opened it, and "twelve of eighteen people have read this" is a count
 * over that table rather than a number somebody remembered to increment.
 *
 * @property string $id
 * @property string $subject
 * @property string $body
 * @property string $priority
 * @property string|null $because
 * @property string $from_staff_id
 * @property string $from_name
 * @property string $status
 * @property string|null $related_to
 * @property Carbon $sent_at
 * @property string $node
 * @property string $origin
 * @property int $version
 */
final class Notice extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'notices';

    /** The contract's own vocabulary, in the contract's own order. */
    public const PRIORITIES = ['normal', 'urgent'];

    /** What a notice's own state may be, from `Notice.status`. */
    public const STATUSES = ['queued', 'sent', 'delivered', 'failed', 'cancelled'];

    /** The three boxes the screen asks for. */
    public const BOXES = ['inbox', 'sent', 'board'];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'version' => 'integer',
        'sent_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /** A new notice's identifier: sortable by creation, and safe to mint on a node that is offline. */
    public static function newId(): string
    {
        return (string) Str::ulid();
    }

    /**
     * Who the notice was addressed to, as rows.
     *
     * A relation rather than a query per read, because a page of notices is a list on a screen and two queries per row
     * is how a board with a year of notices on it becomes slow — the same reason the register projects its patient
     * summaries onto a page in one query rather than in the loop.
     */
    public function recipientRows(): HasMany
    {
        return $this->hasMany(NoticeRecipient::class, 'notice_id', 'id')->orderBy('id');
    }

    /** Who has read it. */
    public function receiptRows(): HasMany
    {
        return $this->hasMany(NoticeReceipt::class, 'notice_id', 'id');
    }

    /** @return list<array{kind: string, ref: string, name?: string}> */
    public function recipients(): array
    {
        $rows = $this->relationLoaded('recipientRows')
            ? $this->getRelation('recipientRows')
            : $this->recipientRows()->get();

        return array_values($rows->map(static fn (NoticeRecipient $row): array => array_filter([
            'kind' => (string) $row->kind,
            'ref' => (string) $row->ref,
            'name' => $row->name,
        ], static fn ($value): bool => $value !== null))->all());
    }

    public function readCount(): int
    {
        return $this->relationLoaded('receiptRows')
            ? $this->getRelation('receiptRows')->count()
            : $this->receiptRows()->count();
    }

    /**
     * The notice as the contract describes it.
     *
     * `channel` is always `board` and that is the truth rather than a placeholder: this is the hospital's own board,
     * and the channels that leave the building are recorded in the delivery log, one row per attempt, where a refusal
     * can be read back.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        $recipients = $this->recipients();

        return [
            'id' => (string) $this->id,
            'channel' => 'board',
            'to' => $recipients,
            'subject' => (string) $this->subject,
            'body' => (string) $this->body,
            'priority' => (string) $this->priority,
            'fromStaffId' => (string) $this->from_staff_id,
            'fromName' => (string) $this->from_name,
            'sentAt' => ApiTime::iso($this->sent_at),
            'status' => (string) $this->status,
            'relatedTo' => $this->related_to,
            'recipientCount' => count($recipients),
            'readCount' => $this->readCount(),
            'version' => (int) $this->version,
        ];
    }

    /**
     * Whether this notice was addressed to an audience rather than to people by name.
     *
     * A broadcast is a management act and the API refuses it to a role that may not address the whole hospital — the
     * distinction is here rather than at the call site because the refusal's sentence ("hospital-wide") has to mean
     * one thing.
     */
    public function isBroadcast(): bool
    {
        foreach ($this->recipients() as $recipient) {
            if ($recipient['kind'] !== 'staff') {
                return true;
            }
        }

        return false;
    }

    /** A short summary of one recipient row, for a ledger entry that has to stay readable. */
    public function summary(): string
    {
        $to = $this->recipients();
        $audience = $to === [] ? 'nobody' : implode(', ', array_map(
            static fn (array $recipient): string => $recipient['kind'].':'.$recipient['ref'],
            array_slice($to, 0, 4),
        ));

        return (string) $this->subject.' → '.$audience;
    }
}
