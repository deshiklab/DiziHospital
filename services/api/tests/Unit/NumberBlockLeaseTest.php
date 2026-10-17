<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Sync\ReservedBlocks;
use Tests\TestCase;

/**
 * The lease on a reserved range, which is what a node uses to prove which numbers were its own.
 *
 * The property that matters is that the lease is *derived* rather than remembered: a node that has been offline for a
 * week can regenerate the lease for a range it was issued and prove it, without the cloud having kept a record of
 * anything but the range itself. Two nodes must never derive the same lease — the secret is per node — so one branch
 * cannot sign for another's numbers even if it learns the range.
 */
final class NumberBlockLeaseTest extends TestCase
{
    public function test_a_lease_is_derived_from_the_node_the_range_and_the_node_secret(): void
    {
        $blocks = $this->blocks('node-test', 'secret-one');

        $lease = $blocks->lease('node-test', 'mrn', 1, 500);

        $this->assertSame(64, mb_strlen($lease));
        $this->assertSame($lease, $blocks->lease('node-test', 'mrn', 1, 500));
        $this->assertTrue($blocks->verifyLease($lease, 'node-test', 'mrn', 1, 500));
    }

    public function test_a_lease_does_not_verify_for_another_node_another_range_or_another_secret(): void
    {
        $blocks = $this->blocks('node-test', 'secret-one');
        $lease = $blocks->lease('node-test', 'mrn', 1, 500);

        $this->assertFalse($blocks->verifyLease($lease, 'node-other', 'mrn', 1, 500));
        $this->assertFalse($blocks->verifyLease($lease, 'node-test', 'mrn', 501, 1000));
        $this->assertFalse($blocks->verifyLease($lease, 'node-test', 'invoice', 1, 500));

        /* One branch's secret must not sign another branch's numbers. */
        $this->assertNotSame($lease, $this->blocks('node-other', 'secret-one')->lease('node-other', 'mrn', 1, 500));
        $this->assertNotSame($lease, $this->blocks('node-test', 'secret-two')->lease('node-test', 'mrn', 1, 500));
    }

    public function test_a_numbered_record_carries_the_prefix_of_its_series(): void
    {
        $blocks = $this->blocks('node-test', 'secret-one');

        $this->assertSame('MRN', $blocks->prefixFor('mrn'));
        $this->assertSame('INV', $blocks->prefixFor('invoice'));
        $this->assertSame('WEIRD', $blocks->prefixFor('weird'));
    }

    private function blocks(string $node, string $secret): ReservedBlocks
    {
        /* Built directly rather than resolved from the container: the lease is a pure function of the node, the range
           and the secret, and a test that needed a database to prove it would be testing the database. */
        return new ReservedBlocks(
            nodeSecret: $secret,
            size: 500,
            leaseHours: 72,
            prefixes: ['mrn' => 'MRN', 'invoice' => 'INV', 'receipt' => 'RCP'],
            series: ['mrn', 'invoice', 'receipt'],
        );
    }
}
