<?php

declare(strict_types=1);

namespace App\Modules\Identity;

/**
 * The role table — the seam between "who is this" and "what may they do".
 *
 * It is an interface for the same reason `DuplicateRules` is: the table is *data*, and where the data comes from is
 * a deployment decision. In this service it is read from the published contract (`x-dizi-roles`), which is the same
 * block `apps/web/lib/auth.ts` reads and the same block the contract's guardrail holds the Keycloak realm against.
 * A `match` in the middleware would be a second copy, and the second copy is the one that is wrong after a role
 * changes.
 */
interface RoleAbilities
{
    /**
     * What a role may do: a subset of `read`, `write`, `administer`.
     *
     * An unknown role is refused rather than answered with an empty list — see `ContractRoles`.
     *
     * @return list<string>
     */
    public function abilitiesFor(string $role): array;

    /** Whether the table declares this role at all. */
    public function knows(string $role): bool;

    /**
     * The role as the contract declares it, for the screens that *show* a role rather than check one.
     *
     * @return array<string, mixed>
     */
    public function definitionOf(string $role): array;

    /** @return list<string> */
    public function declared(): array;

    /** @return list<string> */
    public function legacy(): array;
}
