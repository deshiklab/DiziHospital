<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Modules\Identity\Actor;
use App\Modules\Sync\ReservedBlocks;
use Illuminate\Http\JsonResponse;

/**
 * `GET /node/number-blocks` — reserve the numbers this node may mint from.
 *
 * The call is online-only in the contract, and this is why: a node that cannot reach the cloud cannot reserve a range,
 * and a node with no range may read and queue but may not mint. The failure mode is deliberately a refusal rather than
 * a guess — an MRN invented offline is a number another branch may also invent, and two patients sharing an MRN is a
 * mistake that surfaces months later on a results screen.
 *
 * A `GET` that writes is unusual enough to be stated plainly: it issues the blocks if this node has none in force,
 * because this is the call a node makes when it comes online in the morning, and making it two calls would be a node
 * that starts a day offline numberless because somebody forgot the second one.
 */
final class NodeNumberBlockController
{
    public function __construct(private readonly ReservedBlocks $blocks)
    {
    }

    public function __invoke(): JsonResponse
    {
        $actor = app(Actor::class);

        $blocks = $this->blocks->inForceFor($actor->node);

        return new JsonResponse([
            'blocks' => array_map(static fn ($block): array => $block->toApiArray(), $blocks),
        ]);
    }
}
