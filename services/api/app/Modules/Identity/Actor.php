<?php

declare(strict_types=1);

namespace App\Modules\Identity;

/**
 * Who is asking, taken from the token and never from the request body.
 *
 * `branch` matters more than it looks: every write this service accepts is attributed to a node and a branch, and the
 * audit ledger names both, so "who admitted this patient" is answerable with the device as well as the person.
 */
final class Actor
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly string $role,
        public readonly string $branch,
        public readonly string $node,
    ) {}

    /** The role an operation needs, checked here rather than in each controller. */
    public function may(string $ability): bool
    {
        return in_array($ability, self::ABILITIES[$this->role] ?? [], true);
    }

    /**
     * What each role may do, until Keycloak's roles arrive with #24.
     *
     * This table is small on purpose and it is *enforced*: a viewer who calls `POST /patients` receives the
     * contract's own `dizi.forbidden` with a 403, which is what makes the app's "hide the action rather than offer it
     * and refuse it" rule checkable from the outside.
     */
    private const ABILITIES = [
        'reception' => ['read', 'write'],
        'nurse' => ['read', 'write'],
        'doctor' => ['read', 'write'],
        'admin' => ['read', 'write', 'administer'],
        'auditor' => ['read'],
        'viewer' => ['read'],
    ];
}
