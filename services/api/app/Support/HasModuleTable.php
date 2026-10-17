<?php

declare(strict_types=1);

namespace App\Support;

/**
 * A model that lives in its module's schema.
 *
 * Every model declares which module and which table it belongs to, and the move between Postgres and the test database
 * is decided in one place rather than by every model remembering. A model whose table is spelled out as a string is a
 * model that silently reads the wrong table the day the schemas arrive.
 */
trait HasModuleTable
{
    public function getTable(): string
    {
        /** @var string $module */
        $module = static::MODULE;
        /** @var string $table */
        $table = static::TABLE;

        return ModuleSchema::table($module, $table);
    }
}
