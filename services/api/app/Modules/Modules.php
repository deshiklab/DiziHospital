<?php

declare(strict_types=1);

namespace App\Modules;

/**
 * The ten modules, their Postgres schemas and the entities each one owns.
 *
 * The words here are the same words in three places, and that is the whole point of the table: the OpenAPI contract's
 * tags, the schemas in the database, and `apps/web/lib/sync.ts`'s `ENTITY_POLICY` name the same ten modules. A module
 * that exists in the queue and not in the API is a write nobody receives; one that exists in the API and not in the
 * queue is a screen that cannot work offline.
 *
 * The seams are deliberate and named. A module may only reach another through one of them, because the alternative —
 * one module importing another's model — is how a modular monolith turns into a monolith with directories:
 *
 *  · `Sync\NodePolicy`       what a node may do on its own, and how its numbers are leased (implemented)
 *  · `Registration\DuplicateRules`  the tunable duplicate rule set, read from the contract (implemented)
 *  · `Audit\Ledger`          the append-only hash-chained ledger every write lands in (implemented)
 *  · `Billing\Ledger`        the money ledger, which the billing module owes and this slice does not build
 *
 * `tests/Contract/ContractTest.php` checks the implemented ones are bound in the container and that the pending one
 * is named in the service's README, so a seam cannot quietly stop existing.
 */
final class Modules
{
    /**
     * @var array<string, array{schema: string, entities: list<string>, seams: list<string>, implemented: bool}>
     */
    public const TABLE = [
        'identity' => [
            'schema' => 'identity',
            'entities' => ['staff.member', 'identity.card'],
            'seams' => [],
            'implemented' => true,
        ],
        'registration' => [
            'schema' => 'registration',
            'entities' => ['patient.demographic', 'patient.contact', 'vital.event'],
            'seams' => ['Registration\DuplicateRules'],
            'implemented' => true,
        ],
        'scheduling' => [
            'schema' => 'scheduling',
            'entities' => ['appointment'],
            'seams' => [],
            'implemented' => false,
        ],
        'beds' => [
            'schema' => 'beds',
            'entities' => ['bed.state', 'admission'],
            'seams' => [],
            'implemented' => false,
        ],
        'clinical' => [
            'schema' => 'clinical',
            'entities' => ['observation', 'nursing.note', 'mar.dose', 'prescription'],
            'seams' => [],
            'implemented' => false,
        ],
        'diagnostics' => [
            'schema' => 'diagnostics',
            'entities' => ['lab.result'],
            'seams' => [],
            'implemented' => false,
        ],
        'pharmacy' => [
            'schema' => 'pharmacy',
            'entities' => [],
            'seams' => [],
            'implemented' => false,
        ],
        'billing' => [
            'schema' => 'billing',
            'entities' => ['invoice', 'payment', 'claim', 'ledger.income', 'ledger.expense'],
            'seams' => ['Billing\Ledger'],
            'implemented' => false,
        ],
        'audit' => [
            'schema' => 'audit',
            'entities' => ['audit'],
            'seams' => ['Audit\Ledger'],
            'implemented' => true,
        ],
        'sync' => [
            'schema' => 'sync',
            'entities' => [],
            'seams' => ['Sync\NodePolicy'],
            'implemented' => true,
        ],
    ];

    /** The schema every module's tables live in — one grant per module, so a cross-module query is a missing right. */
    public static function schema(string $module): string
    {
        return self::TABLE[$module]['schema'] ?? throw new \InvalidArgumentException("no module named {$module}");
    }

    /** The module that owns an entity, which is the only module allowed to write it. */
    public static function owner(string $entity): ?string
    {
        foreach (self::TABLE as $module => $detail) {
            if (in_array($entity, $detail['entities'], true)) {
                return $module;
            }
        }

        return null;
    }

    /** @return list<string> */
    public static function schemas(): array
    {
        return array_values(array_map(static fn (array $m): string => $m['schema'], self::TABLE));
    }
}
