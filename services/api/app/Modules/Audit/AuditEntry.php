<?php

declare(strict_types=1);

namespace App\Modules\Audit;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * One link in a node's chain.
 *
 * @property int $id
 * @property string $node
 * @property int $sequence
 * @property \Illuminate\Support\Carbon $at
 * @property string $actor
 * @property string $action
 * @property string $entity
 * @property string $record_id
 * @property array<string, mixed>|null $before
 * @property array<string, mixed>|null $after
 * @property string $hash
 * @property string $prev_hash
 */
final class AuditEntry extends Model
{
    use HasModuleTable;

    protected const MODULE = 'audit';

    protected const TABLE = 'entries';

    protected $guarded = [];

    protected $casts = [
        'sequence' => 'integer',
        'at' => 'datetime',
        'before' => 'array',
        'after' => 'array',
    ];

    /** @return array<string, mixed> */
    public function toApiArray(): array
    {
        return [
            'id' => (string) $this->id,
            'sequence' => $this->sequence,
            'at' => ApiTime::iso($this->at),
            'actor' => $this->actor,
            'action' => $this->action,
            'entity' => $this->entity,
            'recordId' => $this->record_id,
            'before' => $this->before ?? [],
            'after' => $this->after ?? [],
            'node' => $this->node,
            'hash' => $this->hash,
            'prevHash' => $this->prev_hash,
        ];
    }
}
