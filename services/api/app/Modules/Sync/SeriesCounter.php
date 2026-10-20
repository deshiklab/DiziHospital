<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * The cloud's own high-water mark per number series — the thing that makes a collision impossible.
 *
 * It is read with `FOR UPDATE` inside the transaction that issues a block, so two nodes asking at the same instant
 * are served one after the other and never receive overlapping ranges. The counter only ever moves forward: a block
 * that expires unused leaves a gap, and a gap is the price of never reissuing a number a patient may already have
 * written down.
 *
 * @property string $series
 * @property int $next_value
 */
final class SeriesCounter extends Model
{
    use HasModuleTable;

    protected const MODULE = 'sync';

    protected const TABLE = 'series_counters';

    protected $primaryKey = 'series';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = ['next_value' => 'integer'];
}
