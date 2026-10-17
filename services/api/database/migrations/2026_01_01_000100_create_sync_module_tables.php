<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The sync module's own tables: the cloud's number counters, the ranges reserved to nodes, and the record of writes
 * already applied.
 *
 * `sync` owns the numbering because numbering is a cloud decision, and it owns the idempotency table because replay is
 * a sync concern — a controller should not have to think about whether this POST has happened before, any more than a
 * desk should have to think about whether the uplink is up.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('sync');

        Schema::create(ModuleSchema::table('sync', 'series_counters'), function (Blueprint $table): void {
            $table->string('series')->primary();
            $table->unsignedBigInteger('next_value');
            $table->timestamps();
        });

        Schema::create(ModuleSchema::table('sync', 'number_blocks'), function (Blueprint $table): void {
            $table->id();
            $table->string('node');
            $table->string('series');
            $table->string('prefix');
            $table->unsignedBigInteger('from_value');
            $table->unsignedBigInteger('to_value');
            $table->unsignedBigInteger('next_value');
            /* The lease is a derived value (HKDF of the node's secret over the range) stored for the audit trail rather
               than for trust: verification recomputes it. */
            $table->string('lease', 64);
            $table->timestamp('issued_at');
            $table->timestamp('expires_at');
            $table->timestamps();

            /* Two nodes must never be handed overlapping ranges, and the guarantee is this index as much as the
               transaction: a range that already exists cannot be issued again. */
            $table->unique(['node', 'series', 'from_value']);
            $table->index(['series', 'expires_at']);
        });

        Schema::create(ModuleSchema::table('sync', 'operations'), function (Blueprint $table): void {
            /* The idempotency key is the primary key, and that is the concurrency control: two retries of one queued
               write cannot both apply, because the second insert fails. */
            $table->string('key')->primary();
            $table->string('operation_id');
            $table->string('node');
            $table->string('request_hash', 64);
            $table->unsignedSmallInteger('status_code');
            $table->json('response');
            $table->timestamp('completed_at');
            $table->timestamps();

            $table->index(['operation_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(ModuleSchema::table('sync', 'operations'));
        Schema::dropIfExists(ModuleSchema::table('sync', 'number_blocks'));
        Schema::dropIfExists(ModuleSchema::table('sync', 'series_counters'));
        ModuleSchema::drop('sync');
    }
};
