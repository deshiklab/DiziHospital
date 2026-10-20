<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The audit module's one table, and the constraints that make "append-only" a property rather than a policy.
 *
 * There is no `updated_at` in the sense the rest of the service means it: an entry is written once. The unique index on
 * `(node, sequence)` is what makes a gap impossible to hide — a deleted entry leaves a hole in a numbered chain, and
 * `HashChainLedger::verify()` finds it by arithmetic rather than by noticing an absence.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('audit');

        Schema::create(ModuleSchema::table('audit', 'entries'), function (Blueprint $table): void {
            $table->id();
            $table->string('node');
            /* Per node, not global: a node keeps appending while it is offline, and reconciling two chains is possible
               where reconciling an interleaved global sequence is not. */
            $table->unsignedBigInteger('sequence');
            $table->timestamp('at');
            $table->string('actor');
            $table->string('action');
            $table->string('entity');
            $table->string('record_id');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('hash', 64);
            $table->string('prev_hash', 64);
            $table->timestamps();

            $table->unique(['node', 'sequence']);
            $table->index(['entity', 'record_id']);
            $table->index('at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(ModuleSchema::table('audit', 'entries'));
        ModuleSchema::drop('audit');
    }
};
