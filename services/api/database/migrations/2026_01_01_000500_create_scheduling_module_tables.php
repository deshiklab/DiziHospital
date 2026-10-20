<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The scheduling module's tables: who sits when, and the appointments that hold the slots.
 *
 * `slot_key` is the exclusivity rule made structural. A slot holds one patient (the `appointment` entity's policy is
 * `exclusive`), so an appointment that holds a slot carries `{doctorId}@{day}T{startMinute}` in this column and a
 * unique index over it — and an appointment that has been cancelled carries NULL, because a NULL never collides in
 * either SQLite or Postgres. Two branches booking the last slot of a morning at the same moment is the case this
 * exists for: one insert wins, the other raises a unique violation, and the service answers it with `dizi.slot-taken`
 * and the alternatives rather than with two patients in one chair. Enforcing it in a check-then-write would be the
 * same rule with a race in the middle.
 *
 * The sitting hours are here rather than in the contract because they are *roster data* — who sits on Tuesday, in
 * which room, claiming how many steps per consultation — while the rule that uses them (the slot grid, the horizon,
 * the closed day) is in the contract's `x-dizi-scheduling`. The pilot's six OPD doctors are seeded below; the staff
 * module takes the roster over when it lands, and until then the seeded rows are what "the pilot runs on this" means.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('scheduling');

        Schema::create(ModuleSchema::table('scheduling', 'sittings'), function (Blueprint $table): void {
            $table->string('doctor_id')->primary();
            $table->string('name');
            $table->string('department');
            $table->string('room');
            /* The window this doctor's slots are drawn in, in minutes from midnight. A doctor who sits 10:00–13:00
               while the OPD's default is 09:00–14:00 is the normal case, not an exception. */
            $table->unsignedSmallInteger('from_minute');
            $table->unsignedSmallInteger('to_minute');
            /* How many consecutive steps a consultation claims. A first visit is longer than a review, and a roster
               that cannot say so puts the overrun on the next patient. */
            $table->unsignedTinyInteger('capacity');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create(ModuleSchema::table('scheduling', 'appointments'), function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('token');
            $table->string('mrn');
            $table->string('doctor_id');
            /* The room as it was at booking time rather than as it is now: the desk has already told the patient
               where to go, and a roster change later in the morning is not a reason to send them elsewhere. */
            $table->string('room');
            $table->date('day');
            $table->unsignedSmallInteger('start_minute');
            $table->timestamp('start_at');
            $table->unsignedSmallInteger('duration_min');
            $table->unsignedTinyInteger('steps');
            $table->string('type');
            $table->string('status');
            $table->string('priority')->default('Routine');
            $table->string('source');
            $table->text('reason')->nullable();
            /* The branch that owns the slot: the appointment lives where it was taken, whatever the patient's own
               branch is. It is what makes the drain order answerable — a booking that arrives from a node is that
               node's claim, not this service's guess. */
            $table->string('origin');
            $table->string('node');
            /* NULL once cancelled: see the class comment. Not nullable before check-in, which is why the value is
               written at booking and cleared at cancellation rather than derived from `status` at read time. */
            $table->string('slot_key')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->string('created_by');
            $table->string('updated_by');
            $table->timestamp('checked_in_at')->nullable();
            $table->string('cancellation_reason')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->unique('slot_key');
            $table->unique(['doctor_id', 'day', 'token']);
            $table->index(['day', 'doctor_id', 'start_minute']);
            $table->index(['mrn', 'day']);
            $table->index('status');
        });

        /* The pilot's roster. Inserted only when the table is empty, so a deployment that has corrected a room or a
           window by hand keeps its correction when the migration runs again on a rebuilt environment. */
        if (DB::table(ModuleSchema::table('scheduling', 'sittings'))->count() === 0) {
            $now = now();

            DB::table(ModuleSchema::table('scheduling', 'sittings'))->insert(array_map(
                static fn (array $doctor): array => $doctor + ['active' => true, 'created_at' => $now, 'updated_at' => $now],
                [
                    ['doctor_id' => 'dr-rahman', 'name' => 'Dr. A. Rahman', 'department' => 'Medicine', 'room' => 'OPD-1', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 3],
                    ['doctor_id' => 'dr-chowdhury', 'name' => 'Dr. S. Chowdhury', 'department' => 'Medicine', 'room' => 'OPD-3', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 3],
                    ['doctor_id' => 'dr-islam', 'name' => 'Dr. N. Islam', 'department' => 'Cardiology', 'room' => 'OPD-5', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 4],
                    ['doctor_id' => 'dr-hossain', 'name' => 'Dr. T. Hossain', 'department' => 'Paediatrics', 'room' => 'OPD-7', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 2],
                    ['doctor_id' => 'dr-akter', 'name' => 'Dr. R. Akter', 'department' => 'Obstetrics', 'room' => 'OPD-9', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 2],
                    ['doctor_id' => 'dr-khan', 'name' => 'Dr. M. Khan', 'department' => 'Orthopaedics', 'room' => 'OPD-11', 'from_minute' => 540, 'to_minute' => 840, 'capacity' => 4],
                ],
            ));
        }
    }

    public function down(): void
    {
        Schema::dropIfExists(ModuleSchema::table('scheduling', 'appointments'));
        Schema::dropIfExists(ModuleSchema::table('scheduling', 'sittings'));
        ModuleSchema::drop('scheduling');
    }
};
