<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Modules\Identity\Actor;
use App\Modules\Identity\RoleAbilities;
use App\Modules\Identity\TokenVerifier;
use App\Support\ProblemException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Who is asking, and whether their role may do this.
 *
 * The role check lives here rather than in each controller for the same reason the routes name it: `dizi.auth:write` on
 * the route is a fact a reader can check without opening any PHP at all. A controller that remembers to check the role
 * is a controller somebody will add a second action to.
 *
 * The actor is put in the container as well as on the request, because the login is the *token*, not the body: a
 * request that carries `createdBy` in its payload is a request that can claim somebody else's name, so nothing here
 * reads an actor from anything the client sent.
 */
final class Authenticate
{
    public function __construct(
        private readonly TokenVerifier $verifier,
        private readonly RoleAbilities $roles,
    ) {}

    public function handle(Request $request, Closure $next, string ...$abilities): Response
    {
        $token = $request->bearerToken();

        if (! is_string($token) || $token === '') {
            throw ProblemException::of(
                'dizi.unauthenticated',
                'Your session has ended',
                401,
                'No token was sent with this request. The outbox keeps the write, so signing in again and retrying loses nothing.',
            );
        }

        $actor = $this->verifier->verify($token);

        /* The abilities come from the contract's own role table (`x-dizi-roles`), not from a list here, and the
         * union across the roles the token carries is what is checked: a person who is both a doctor and an admin
         * may do what either role may. A role the table does not declare never reaches this line — `Roles` refuses
         * it when the abilities are asked for, so a renamed realm role is an error somebody can read rather than an
         * empty screen.
         *
         * Order matters in the message: the *widest* role the actor holds is named, because that is the one that
         * came closest to allowing the action, and "your receptionist role may not administer" is a sentence that
         * tells the person who to ask. */
        $granted = [];
        foreach ($actor->roles as $role) {
            foreach ($this->roles->abilitiesFor($role) as $ability) {
                $granted[$ability] = true;
            }
        }

        foreach ($abilities as $ability) {
            if (! isset($granted[$ability])) {
                throw ProblemException::of(
                    'dizi.forbidden',
                    'Your role cannot do this',
                    403,
                    "The role `{$actor->role}` may not {$ability} here. The app hides actions a role cannot take; if this screen offered you one, that is a bug in the screen rather than a permission to grant.",
                );
            }
        }

        $request->attributes->set('actor', $actor);
        app()->instance(Actor::class, $actor);

        return $next($request);
    }
}
