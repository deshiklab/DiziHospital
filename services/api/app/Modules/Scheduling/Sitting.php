<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

use App\Support\HasModuleTable;
use App\Support\ProblemException;
use Illuminate\Database\Eloquent\Model;

/**
 * One doctor's sitting: which room, which window, and how many slot steps a consultation claims.
 *
 * This is roster data, not a product rule — the *rule* (the slot grid, the horizon, the closed day) is in the
 * contract's `x-dizi-scheduling` and read through `AvailabilityRules`, while who sits when is what a branch changes
 * in Setup. In this slice the rows are seeded with the pilot's six OPD doctors by the module's migration; the staff
 * module takes the roster over later, and this table's shape is what that handover will write to.
 *
 * `capacity` is the number of consecutive steps one consultation claims. It is per doctor rather than per visit type
 * because the sitting is what the desk knows: Dr. Islam's cardiology clinic runs longer consultations, and a grid
 * that pretends every visit is the same length puts the overrun on the next patient's appointment.
 *
 * @property string $doctor_id
 * @property string $name
 * @property string $department
 * @property string $room
 * @property int $from_minute
 * @property int $to_minute
 * @property int $capacity
 * @property bool $active
 */
final class Sitting extends Model
{
    use HasModuleTable;

    protected const MODULE = 'scheduling';

    protected const TABLE = 'sittings';

    protected $primaryKey = 'doctor_id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'from_minute' => 'integer',
        'to_minute' => 'integer',
        'capacity' => 'integer',
        'active' => 'boolean',
    ];

    /**
     * The sitting for a doctor, or a refusal naming the roster.
     *
     * An unknown doctor is refused rather than defaulted to the first sitting: a booking against the wrong doctor is
     * a patient waiting in the wrong corridor, and "we assumed" is not a sentence the desk can act on.
     */
    public static function forDoctor(string $doctorId): self
    {
        $sitting = self::query()->where('doctor_id', $doctorId)->where('active', true)->first();

        if ($sitting === null) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That doctor has no sitting',
                422,
                "`{$doctorId}` is not on this branch's roster, so there is no window to draw slots in. Check the doctor on the appointment screen — a booking against the wrong doctor is a patient waiting in the wrong corridor.",
            );
        }

        return $sitting;
    }

    /** The roster, for the desk's doctor picker and for the day's calendar headers. */
    public static function roster(): array
    {
        return self::query()->where('active', true)->orderBy('room')->get()->all();
    }
}
