<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Modules\Identity\Actor;
use App\Modules\Identity\RoleAbilities;
use App\Modules\Identity\TokenVerifier;
use Illuminate\Http\JsonResponse;

/**
 * `GET /me` — the session, in words a person can read (P0-205 acceptance: role claims visible in the token).
 *
 * This is the operation that makes the role mapping checkable from outside the service. Everything else here checks
 * abilities by *refusing* something, which is the right way to enforce them and a poor way to answer "what am I?" —
 * a desk asking why a button is missing currently gets a 403 from a button they cannot see.
 *
 * What it returns is deliberately dull: the actor, the roles the token carries **as the contract declares them**, the
 * abilities those roles add up to, the branch and the node, who signed the token and which driver checked it, and how
 * wide the widest role reached in the legacy system. All of it read from the same table the middleware enforces, so
 * the screen cannot be told one thing and refused another.
 *
 * What it does not return: anything about anybody else, any list of what the person may *not* do, and no second
 * opinion about permissions. `/me` is a reading of the token, not a source of truth beside it.
 */
final class MeController
{
    public function __construct(
        private readonly TokenVerifier $verifier,
        private readonly RoleAbilities $roles,
    ) {}

    public function __invoke(): JsonResponse
    {
        $actor = app(Actor::class);

        /* The roles, widest first, each as the contract describes it. A role in the token the table does not declare
         * has already been refused by the ability check in the middleware — this only ever lists roles that are real,
         * which is what makes the ability list beside it trustworthy. */
        $roles = [];
        foreach ($this->orderedByReach($actor->roles) as $id) {
            $definition = $this->roles->definitionOf($id);
            $roles[] = [
                'id' => $id,
                'label' => [
                    'en' => (string) ($definition['label']['en'] ?? $id),
                    'bn' => (string) ($definition['label']['bn'] ?? $id),
                ],
                'shell' => (string) ($definition['shell'] ?? 'receptionist'),
                'abilities' => $this->roles->abilitiesFor($id),
            ];
        }

        $abilities = [];
        foreach ($actor->roles as $role) {
            foreach ($this->roles->abilitiesFor($role) as $ability) {
                $abilities[$ability] = true;
            }
        }

        return response()->json([
            'actor' => $actor->id,
            'name' => $actor->name,
            'roles' => $roles,
            'abilities' => array_values(array_filter(
                ['read', 'write', 'administer'],
                static fn (string $ability): bool => isset($abilities[$ability]),
            )),
            'branch' => $actor->branch,
            'node' => $actor->node,
            'issuer' => $actor->issuer,
            'driver' => $this->verifier->driver(),
            'legacyScreens' => max(array_map(
                fn (string $role): int => (int) ($this->roles->definitionOf($role)['legacyScreens'] ?? 0),
                $actor->roles,
            ) ?: [0]),
        ]);
    }

    /**
     * The roles, widest first, so the first line a screen draws names the role that grants the most.
     *
     * "Widest" is counted rather than listed: the abilities come from the contract, so a role that gains one moves up
     * this order without anybody editing it, and a role whose abilities are all shared with another does not pretend
     * to be wider than it is.
     *
     * @param  list<string>  $roles
     * @return list<string>
     */
    private function orderedByReach(array $roles): array
    {
        $reach = [];
        foreach ($roles as $role) {
            $reach[$role] = count($this->roles->abilitiesFor($role));
        }

        usort($roles, static fn (string $a, string $b): int => ($reach[$b] ?? 0) <=> ($reach[$a] ?? 0));

        return array_values($roles);
    }
}
