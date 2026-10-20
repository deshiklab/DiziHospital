<?php

declare(strict_types=1);

namespace App\Modules\Sync;

/**
 * The seam between the cloud and the branches: what a node may decide on its own, and what it must be told.
 *
 * A hospital LAN node has to register a patient with the uplink down, which means it must mint an MRN nobody else
 * will mint. That is only safe because the cloud reserves *ranges* to a node in advance, and the reservation is a
 * lease with an expiry: a node that has not been heard from cannot hold a year of numbers hostage, and its unused
 * tail is recorded as a gap rather than handed to somebody else — a number that was used and then reissued is a
 * number two patients share.
 *
 * Everything else about sync (the change feed, cursors, batch signatures) is ticket P0-210 and is not in this slice.
 */
interface NodePolicy
{
    /**
     * Whether a write arriving from `$nodeId` may be admitted as the canonical record (`active`) or held as a
     * `draft` until that node's next drain reconciles it.
     *
     * The rule this slice implements: a node with a live lease on the series it is minting from is trusted to write
     * `active` records, and a node whose lease has lapsed has its writes admitted as `draft` — because an expired
     * lease means the cloud cannot tell whether those numbers are still inside the range it reserved.
     */
    public function admit(string $nodeId, string $series): string;

    /** The lease on a reserved range: derived, not stored, so a node can prove its numbers after a long outage. */
    public function lease(string $nodeId, string $series, int $from, int $to): string;

    public function verifyLease(string $lease, string $nodeId, string $series, int $from, int $to): bool;
}
