<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Support\ProblemException;

/**
 * The role table, read out of the contract.
 *
 * `packages/contracts/openapi.json` → `x-dizi-roles` is the one place a role's abilities are written down: the
 * Keycloak realm is checked against it by the contract's own guardrail, `apps/web/lib/auth.ts` reads it through the
 * generated client, and this reads the same table at start-up. The alternative — a `match` in the middleware that
 * lists what each role may do — is the copy that goes stale on the day a role changes, and the failure it produces
 * is a role that can do something the app has already stopped showing a button for, or cannot do the thing it was
 * granted.
 *
 * A role the table does not declare is **refused**, not ignored. Ignoring it would mean a person whose realm role
 * was renamed signs in and then has no access at all, with nothing anywhere saying why; refusing it means the
 * refusal names the role and somebody fixes the realm.
 *
 * The file is read once and cached in the instance: roles change at deployment time, not per request.
 */
final class ContractRoles implements RoleAbilities
{
    /** @var array<string, list<string>>|null */
    private ?array $abilities = null;

    /** @var array<string, array<string, mixed>>|null */
    private ?array $roles = null;

    public function __construct(private readonly string $path) {}

    public function abilitiesFor(string $role): array
    {
        $abilities = $this->load();

        if (! isset($abilities[$role])) {
            throw ProblemException::of(
                'dizi.forbidden',
                'Your sign-in carries a role this service does not know',
                403,
                "The token's role `{$role}` is not one the product contract declares. It is refused rather than ignored, because a role nobody can describe is a role nobody has decided the limits of. The realm and `x-dizi-roles` in packages/contracts/openapi.json have to name it in the same commit.",
            );
        }

        return $abilities[$role];
    }

    public function knows(string $role): bool
    {
        return isset($this->load()[$role]);
    }

    /**
     * The role as the contract declares it: id, labels, shell, abilities, the legacy reach and the sentence that
     * explains the mapping.
     *
     * @return array<string, mixed>
     */
    public function definitionOf(string $role): array
    {
        // Asking for the abilities first is what refuses an undeclared role, and the refusal is the same one here as
        // it is in the ability check: one place decides whether a role exists.
        $this->abilitiesFor($role);

        return $this->roles[$role] ?? [];
    }

    /** Every role this service will act on, for a token whose roles are all unknown to be refused by name. */
    public function declared(): array
    {
        return array_keys($this->load());
    }

    /** The nine legacy roles, which is what P0-205's acceptance line is about. */
    public function legacy(): array
    {
        $this->load();

        return array_keys(array_filter($this->roles ?? [], static fn (array $role): bool => ($role['kind'] ?? '') === 'legacy'));
    }

    /**
     * @return array<string, list<string>>
     */
    private function load(): array
    {
        if ($this->abilities !== null) {
            return $this->abilities;
        }

        if (! is_file($this->path)) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The role table is missing',
                '503',
                'This service reads the product contract for the roles and their abilities and could not find it at '.$this->path.'. Refusing every request is the honest failure: the alternative is inventing what a role may do, which is how a receptionist ends up able to change a price list.',
            );
        }

        $document = json_decode((string) file_get_contents($this->path), true);
        $block = is_array($document) ? ($document['x-dizi-roles'] ?? null) : null;

        if (! is_array($block)) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The role table cannot be read',
                '503',
                'The contract at '.$this->path.' carries no `x-dizi-roles` block. The service will not guess which roles exist.',
            );
        }

        $abilities = [];
        $roles = [];

        foreach (['legacy', 'service'] as $kind) {
            foreach ($block[$kind] ?? [] as $role) {
                $id = is_array($role) ? ($role['id'] ?? null) : null;
                $granted = is_array($role) ? ($role['abilities'] ?? null) : null;

                if (! is_string($id) || $id === '' || ! is_array($granted) || $granted === []) {
                    throw ProblemException::of(
                        'dizi.unavailable',
                        'A role in the contract cannot be read',
                        '503',
                        "The `x-dizi-roles.{$kind}` entry is missing an id or its abilities, so this service cannot tell what it grants.",
                    );
                }

                $abilities[$id] = array_values(array_map('strval', $granted));
                $roles[$id] = $role + ['kind' => $kind];
            }
        }

        if ($abilities === []) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The contract declares no roles',
                '503',
                'An empty role table would let every token through, so this service refuses to start answering with one. Check that the contract deployed beside it is the published one.',
            );
        }

        $this->roles = $roles;

        return $this->abilities = $abilities;
    }
}
