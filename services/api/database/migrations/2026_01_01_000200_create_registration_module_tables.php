<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The registration module's tables: the patients themselves, and one row per field for the merge rule.
 *
 * There is no `patients` table in `sync`, `clinical` or anywhere else. Every module that needs a patient refers to the
 * MRN and reaches registration through a seam, because the moment two modules hold a copy of a patient's name there are
 * two answers to "what is this patient called" and one of them is on a screen in front of a doctor.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('registration');

        Schema::create(ModuleSchema::table('registration', 'patients'), function (Blueprint $table): void {
            $table->string('mrn')->primary();
            $table->string('name');
            $table->string('name_bn')->nullable();
            /* Age and date of birth are both nullable and both kept: a rural desk often has one and not the other, and
               inferring the missing one silently is how a person's age changes every year on their chart. */
            $table->unsignedSmallInteger('age')->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('sex');
            $table->string('phone');
            $table->string('address')->nullable();
            $table->text('allergies')->nullable();
            $table->string('payer')->nullable();
            $table->string('branch');
            $table->string('legacy_uid')->nullable();

            /* draft → active, linked by `client_created`: the record a node wrote while it could not prove its numbers,
               and the same record once the drain has reconciled them. */
            $table->string('state')->default('active');
            $table->string('client_created', 36);

            /* Optimistic concurrency. `version` is bumped by every write; the per-field table records which version a
               field last changed at, so a conflict can name the field rather than the record. */
            $table->unsignedInteger('version')->default(1);

            /* Who dismissed which duplicate candidates, and when. The register's rule is that a match is never refused
               silently and never accepted silently either — this is the trail behind "we checked". */
            $table->string('duplicate_ack_by')->nullable();
            $table->timestamp('duplicate_ack_at')->nullable();
            $table->json('duplicate_ack_evidence')->nullable();

            $table->string('created_by');
            $table->string('updated_by');
            $table->timestamps();

            $table->index('client_created');
            $table->index(['branch', 'created_at']);
            /* The desk's search: a partial index on the normalised name is the difference between a list and a wait on
               a register with a million rows in it. */
            $table->index(['name', 'phone']);
            $table->index('state');
        });

        Schema::create(ModuleSchema::table('registration', 'patient_fields'), function (Blueprint $table): void {
            $table->id();
            $table->string('patient_mrn');
            $table->string('field');
            $table->text('value')->nullable();
            /* The patient version at which this field last changed — the number the merge rule compares against the
               version the client read. */
            $table->unsignedInteger('version');
            $table->string('updated_by');
            $table->timestamps();

            $table->unique(['patient_mrn', 'field']);
            $table->index('patient_mrn');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(ModuleSchema::table('registration', 'patient_fields'));
        Schema::dropIfExists(ModuleSchema::table('registration', 'patients'));
        ModuleSchema::drop('registration');
    }
};
