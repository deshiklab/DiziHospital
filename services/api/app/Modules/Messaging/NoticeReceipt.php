<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * One person having read one notice.
 *
 * The uniqueness is the table's, not this class's: `(notice_id, staff_id)` is a unique index, so a receipt that drains
 * twice is one read and the second arrival is answered with `dizi.duplicate-operation` — which is the correct answer
 * to "I already have this", and not a second timestamp that makes the notice look read twice.
 *
 * @property int $id
 * @property string $notice_id
 * @property string $staff_id
 * @property string $node
 * @property string $origin
 * @property Carbon $read_at
 */
final class NoticeReceipt extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'notice_receipts';

    protected $guarded = [];

    protected $casts = [
        'read_at' => 'datetime',
    ];

    /**
     * The receipt as the contract's `NoticeReceipt` describes it.
     *
     * `deviceNodeId` is the node the person was reading from, which is the point of the field: the receipt was made
     * while the screen could not reach the cloud, and this is what makes it attributable when it arrives.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return [
            'noticeId' => (string) $this->notice_id,
            'staffId' => (string) $this->staff_id,
            'readAt' => ApiTime::iso($this->read_at),
            'deviceNodeId' => (string) $this->node,
        ];
    }
}
