<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * Who last changed one field of a patient's record, and at which version.
 *
 * This table exists for the merge rule in `PATCH /patients/{mrn}`. Two desks correcting the same patient at the same
 * time should not be offered a choice about fields they did not both touch — the desk that fixed the phone number and
 * the desk that fixed the address are not in conflict about anything. A row per field, carrying the version at which
 * that field last changed, is what lets the service answer "did anybody else change *this* field since you read it?"
 * rather than "did anybody else change this record?" — and the second question is why people abandon queue-based
 * systems.
 *
 * @property string $patient_mrn
 * @property string $field
 * @property string|null $value
 * @property int $version
 * @property string $updated_by
 */
final class PatientField extends Model
{
    use HasModuleTable;

    protected const MODULE = 'registration';

    protected const TABLE = 'patient_fields';

    protected $guarded = [];

    protected $casts = ['version' => 'integer', 'updated_at' => 'datetime'];
}
