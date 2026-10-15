<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Modules\Modules;
use App\Support\ModuleSchema;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

/**
 * `php artisan dizi:modules` — what this service is made of, and what of it exists in the database.
 *
 * Every module has a schema, and every entity has exactly one owning module; the table this prints is the same table
 * the contract's tags, `apps/web/lib/sync.ts` and the migrations all name. Printing it is the fastest way for somebody
 * holding a database to answer "which part of this service has been built, and did its tables actually migrate?".
 *
 * `--check` turns it into a gate. It exits non-zero when a module this service claims to implement has no schema, or
 * has a schema without the tables its migration creates — which is the state a half-run deployment is in, and the
 * state in which an API answers 500s on one endpoint and 200s on the next.
 */
final class ModulesCommand extends Command
{
    protected $signature = 'dizi:modules {--check : Fail when an implemented module is missing its schema or tables}';

    protected $description = 'The ten modules, their schemas, their seams, and whether they are in the database';

    /**
     * The tables each module's migrations create, so `--check` can tell a schema that exists from a module that is
     * actually there. The identity module is absent on purpose: until Keycloak arrives (#24) it has a schema and no
     * rows, and an empty schema is the honest state of a module that has nothing to store yet.
     */
    private const TABLES = [
        'sync' => ['series_counters', 'number_blocks', 'operations'],
        'registration' => ['patients', 'patient_fields'],
        'audit' => ['entries'],
    ];

    public function handle(): int
    {
        $rows = [];
        $missing = [];

        foreach (Modules::TABLE as $module => $detail) {
            $schema = $detail['schema'];
            $hasSchema = $this->hasSchema($schema);
            $tables = self::TABLES[$module] ?? [];
            $absent = array_values(array_filter($tables, static fn (string $table): bool => ! Schema::hasTable(ModuleSchema::table($module, $table))));

            if ($detail['implemented'] && (! $hasSchema || $absent !== [])) {
                $missing[] = $module.($hasSchema ? ' (missing '.implode(', ', $absent).')' : ' (no schema)');
            }

            $rows[] = [
                $module,
                $schema,
                $hasSchema ? 'yes' : 'no',
                (string) count($tables),
                $absent === [] ? 'yes' : 'no',
                $detail['seams'] === [] ? '—' : implode(', ', $detail['seams']),
                $detail['implemented'] ? 'built' : 'not yet',
            ];
        }

        $this->table(['module', 'schema', 'schema there', 'tables', 'tables there', 'seam', 'state'], $rows);

        if (! $this->option('check')) {
            return self::SUCCESS;
        }

        if ($missing !== []) {
            $this->error('These modules say they are implemented and are not in the database: '.implode('; ', $missing).'.');
            $this->line('Run `php artisan migrate` — a module whose tables are missing serves 500s on one endpoint and 200s on the next.');

            return self::FAILURE;
        }

        $this->info('Every implemented module has its schema and its tables.');

        return self::SUCCESS;
    }

    /** One query per module, and it works on both engines: Postgres has schemas, the test database has prefixes. */
    private function hasSchema(string $schema): bool
    {
        if (! ModuleSchema::qualified()) {
            return true;
        }

        return $this->laravel['db']->selectOne(
            'select schema_name from information_schema.schemata where schema_name = ?',
            [$schema],
        ) !== null;
    }
}
