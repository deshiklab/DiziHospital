<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * A write this service has already applied, keyed by its idempotency key.
 *
 * This table is the entire reason a node can drain a week-old outbox: the key is `nodeId:seq`, the row holds the
 * response that was returned the first time, and a replay returns it again instead of registering the patient twice.
 * The unique index on `key` also settles the concurrent case — two retries arriving together cannot both apply,
 * because the second insert fails and the loser reads the winner's response.
 *
 * @property string $key
 * @property string $operation_id
 * @property int $status_code
 * @property array<string, mixed> $response
 */
final class OperationRecord extends Model
{
    use HasModuleTable;

    protected const MODULE = 'sync';

    protected const TABLE = 'operations';

    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = ['response' => 'array', 'status_code' => 'integer'];
}
