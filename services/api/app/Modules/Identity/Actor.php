<?php

declare(strict_types=1);

namespace App\Modules\Identity;

/**
 * Who is asking, taken from the token and never from the request body.
 *
 * `roles` is a list, because a person may hold more than one: a consultant who is also the clinical lead is one
 * account with `doctor` and `admin`, and the abilities of both apply. The single `role` is kept for the sentences
 * that have to name one — a refusal reads better as "the role `receptionist` may not administer here" than as a
 * list — and it is the first role the issuer listed, in the token's own order, because that order is the realm's and
 * this value object has no business reordering it. Where a sentence has to name the role that came *closest* to
 * allowing something, the ranking is done where the abilities are known: `Authenticate` for a refusal, and
 * `MeController` for the `/me` screen.
 *
 * `branch` and `node` matter more than they look: every write this service accepts is attributed to a node and a
 * branch, and the audit ledger names both, so "who admitted this patient" is answerable with the device as well as
 * the person. `issuer` is the identity provider that signed the token, which is what makes a log line answer the
 * question "was this the edge realm or the cloud one" during an outage.
 *
 * What a role may *do* is not decided here: it is the contract's table, read through `RoleAbilities` and checked in
 * `App\Http\Middleware\Authenticate`. Keeping the abilities out of this value object is what lets the table move
 * from the contract to a database without every caller changing.
 */
final class Actor
{
    /**
     * @param  list<string>  $roles  every role in the token, in the order the issuer listed them
     */
    public readonly array $roles;

    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly string $role,
        array $roles = [],
        public readonly string $branch = '',
        public readonly string $node = '',
        public readonly string $issuer = 'preview',
    ) {
        /* One initialization, in the constructor, and never a second: a promoted `readonly` property is initialized by
           the promotion itself, so assigning to it in the body is a modification and PHP refuses it at runtime — the
           shape `new Actor(role: 'receptionist')` reached that path and threw. A caller that knows one role and not
           the token's whole list passes it here and the list is derived from it. */
        $this->roles = $roles === [] && $this->role !== '' ? [$this->role] : $roles;
    }
}
