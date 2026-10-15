<?php

declare(strict_types=1);

namespace App\Support;

use App\Modules\Modules;
use Illuminate\Support\Facades\DB;

/**
 * Where a module's tables live, on whichever database this deployment is running.
 *
 * In production each module owns a Postgres schema — `registration.patients`, `audit.entries` — because a schema is a
 * grant: a module that has not been given rights on another module's schema *cannot* join to its tables, and "no
 * cross-module joins" stops being a rule reviewers have to remember. The test suite runs on SQLite, which has no
 * schemas at all, so there the prefix becomes part of the table name (`registration_patients`). Same tables, same
 * ownership, same queries; only the spelling of the namespace changes, and it changes here and nowhere else.
 */
final class ModuleSchema
{
    public static function table(string $module, string $table): string
    {
        Modules::schema($module);

        return self::qualified() ? "{$module}.{$table}" : "{$module}_{$table}";
    }

    /** Create the module's schema, which is the module's own migration's first act. */
    public static function create(string $module): void
    {
        $schema = Modules::schema($module);

        if (self::qualified()) {
            DB::statement('create schema if not exists "'.$schema.'"');
        }
    }

    /** Drop a module's schema and everything in it. Only a local `migrate:fresh` does this. */
    public static function drop(string $module): void
    {
        $schema = Modules::schema($module);

        if (self::qualified()) {
            DB::statement('drop schema if exists "'.$schema.'" cascade');
        }
    }

    /** Whether this connection has schemas at all — Postgres does, SQLite does not. */
    public static function qualified(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }
}
