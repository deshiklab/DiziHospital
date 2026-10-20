<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * One row of a notice's address list: a person, a role, a department or the branch.
 *
 * `kind` is the contract's `MessageRecipient.kind` and it is doing real work: `staff` is somebody by name, and the
 * other three are audiences — which is what "hospital-wide" means when the API refuses a broadcast to a role that may
 * not address everybody.
 *
 * @property int $id
 * @property string $notice_id
 * @property string $kind
 * @property string $ref
 * @property string|null $name
 */
final class NoticeRecipient extends Model
{
    use HasModuleTable;

    protected const MODULE = 'messaging';

    protected const TABLE = 'notice_recipients';

    /** The contract's own enum, in the contract's own order. */
    public const KINDS = ['staff', 'role', 'department', 'branch'];

    protected $guarded = [];
}
