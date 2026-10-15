<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /audit` — a node handing over an entry for something it did while it was disconnected.
 *
 * The actor and the node come from the token, never from the body, and the entry is appended to that node's own chain:
 * the node was there, the cloud was not, and rewriting the chain to hide that would be the one edit an audit trail
 * exists to make impossible.
 */
final class AuditController
{
    public function __construct(private readonly Ledger $ledger)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $actor = app(Actor::class);

        $data = $request->validate([
            'action' => ['required', 'string', 'max:120'],
            'entity' => ['required', 'string', 'max:120'],
            'recordId' => ['required', 'string', 'max:120'],
            'before' => ['nullable', 'array'],
            'after' => ['nullable', 'array'],
        ]);

        /* The entry goes on this node's chain, in this node's own words. A node draining its outbox hands over the
           action it took, and the ledger is the one module allowed to write it. */
        $entry = $this->ledger->append(
            $actor->node,
            $actor->id,
            (string) $data['action'],
            (string) $data['entity'],
            (string) $data['recordId'],
            $data['before'] ?? [],
            $data['after'] ?? [],
        );

        return new JsonResponse($entry->toApiArray(), 201);
    }
}
