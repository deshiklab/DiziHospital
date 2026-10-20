<?php

declare(strict_types=1);

namespace App\Modules\Audit;

/**
 * The ledger of who did what, on the node that did it.
 *
 * The property that matters is not that entries are written — it is that they cannot be *edited*. Each entry carries
 * the hash of the previous entry on its own node's chain, and its own hash over its canonical form; recomputing the
 * chain is how tampering is detected rather than merely discouraged. The chains are per node because a node keeps
 * appending while it is offline, and the chains are reconciled when it drains (P0-311).
 */
interface Ledger
{
    /**
     * Append an entry to `$node`'s chain. Called inside the write's own transaction, so a write that fails leaves no
     * audit entry claiming it happened.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     */
    public function append(
        string $node,
        string $actor,
        string $action,
        string $entity,
        string $recordId,
        array $before = [],
        array $after = [],
    ): AuditEntry;

    /**
     * Walk a node's chain and recompute it.
     *
     * @return array{ok: bool, checked: int, brokenAt: int|null, reason: string}
     */
    public function verify(string $node): array;
}
