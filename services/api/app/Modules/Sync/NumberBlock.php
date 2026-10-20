<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A range of numbers reserved to one node for one series, with the lease it was issued under.
 *
 * `from_value`/`to_value` rather than `from`/`to` because the latter are reserved words in SQL, and a column that has
 * to be quoted in every query is a column somebody eventually forgets to quote. The contract's field names are
 * `from` and `to`; `toApiArray()` is the one place that translation happens.
 *
 * @property string $node
 * @property string $series
 * @property string $prefix
 * @property int $from_value
 * @property int $to_value
 * @property int $next_value
 * @property string $lease
 * @property Carbon $issued_at
 * @property Carbon $expires_at
 */
final class NumberBlock extends Model
{
    use HasModuleTable;

    protected const MODULE = 'sync';

    protected const TABLE = 'number_blocks';

    protected $guarded = [];

    protected $casts = [
        'from_value' => 'integer',
        'to_value' => 'integer',
        'next_value' => 'integer',
        'issued_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    public function leaseIsLive(): bool
    {
        return $this->expires_at->isFuture();
    }

    public function exhausted(): bool
    {
        return $this->next_value > $this->to_value;
    }

    /** @return array<string, mixed> */
    public function toApiArray(): array
    {
        return [
            'series' => $this->series,
            'prefix' => $this->prefix,
            'from' => $this->from_value,
            'to' => $this->to_value,
            'next' => $this->next_value,
            'expiresAt' => ApiTime::iso($this->expires_at),
        ];
    }
}
