<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Audit\HashChainLedger;
use App\Modules\Audit\Ledger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The ledger, from the outside and from the inside.
 *
 * The outside tests check that a node can hand over an entry for something it did while it was offline. The inside
 * ones check the property that makes the table worth having: an entry that is altered afterwards can be *found*, by
 * recomputing the chain rather than by trusting it.
 */
final class AuditLedgerTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_node_hands_over_an_entry_and_the_chain_starts_at_genesis(): void
    {
        $response = $this->asRole()->postJson('/audit', [
            'action' => 'stock.dispense',
            'entity' => 'audit',
            'recordId' => 'dose-8812',
            'after' => ['patient' => 'MRN-000123', 'drug' => 'Amlodipine 5mg'],
        ], ['Idempotency-Key' => $this->key()]);

        $response->assertCreated()
            ->assertJsonPath('sequence', 1)
            ->assertJsonPath('node', 'node-test')
            ->assertJsonPath('actor', 'staff-7')
            ->assertJsonPath('prevHash', HashChainLedger::GENESIS);

        $this->assertSame(64, mb_strlen((string) $response->json('hash')));
    }

    public function test_each_entry_points_at_the_one_before_it(): void
    {
        $first = $this->asRole()->postJson('/audit', $this->entry('dose-1'), ['Idempotency-Key' => $this->key('0001')]);
        $second = $this->asRole()->postJson('/audit', $this->entry('dose-2'), ['Idempotency-Key' => $this->key('0002')]);

        $second->assertCreated()->assertJsonPath('sequence', 2);

        $this->assertSame($first->json('hash'), $second->json('prevHash'));
    }

    public function test_a_replayed_entry_is_written_once(): void
    {
        $headers = ['Idempotency-Key' => $this->key('0001')];

        $first = $this->asRole()->postJson('/audit', $this->entry('dose-1'), $headers)->assertCreated();
        $replay = $this->asRole()->postJson('/audit', $this->entry('dose-1'), $headers)->assertCreated();

        /* A ledger that can be written twice by one retry is a ledger with two of everything, and the second one looks
           exactly like tampering when the chain is checked. */
        $this->assertSame($first->json('hash'), $replay->json('hash'));
        $this->assertSame(1, DB::table('audit_entries')->count());
    }

    public function test_the_intact_chain_verifies_and_says_what_it_checked(): void
    {
        $this->asRole()->postJson('/audit', $this->entry('dose-1'), ['Idempotency-Key' => $this->key('0001')])->assertCreated();
        $this->asRole()->postJson('/audit', $this->entry('dose-2'), ['Idempotency-Key' => $this->key('0002')])->assertCreated();

        $result = $this->ledger()->verify('node-test');

        $this->assertTrue($result['ok']);
        $this->assertSame(2, $result['checked']);
        $this->assertNull($result['brokenAt']);
    }

    public function test_an_altered_entry_is_found_by_recomputation(): void
    {
        $this->asRole()->postJson('/audit', $this->entry('dose-1'), ['Idempotency-Key' => $this->key('0001')])->assertCreated();
        $this->asRole()->postJson('/audit', $this->entry('dose-2'), ['Idempotency-Key' => $this->key('0002')])->assertCreated();

        /* Tampering, done the way a database would be changed by somebody with access: the row is edited in place and
           the hash beside it is left alone. */
        DB::table('audit_entries')->where('sequence', 2)->update(['after' => json_encode(['drug' => 'Morphine 10mg'])]);

        $result = $this->ledger()->verify('node-test');

        $this->assertFalse($result['ok']);
        $this->assertSame(2, $result['brokenAt']);
        $this->assertSame(1, $result['checked']);
        $this->assertStringContainsString('altered', (string) $result['reason']);
    }

    public function test_a_deleted_entry_leaves_a_gap_that_shows(): void
    {
        foreach ([1, 2, 3] as $n) {
            $this->asRole()->postJson('/audit', $this->entry('dose-'.$n), ['Idempotency-Key' => $this->key('000'.$n)])->assertCreated();
        }

        DB::table('audit_entries')->where('sequence', 2)->delete();

        $result = $this->ledger()->verify('node-test');

        $this->assertFalse($result['ok']);
        $this->assertSame(3, $result['brokenAt']);
        $this->assertStringContainsString('jumps', (string) $result['reason']);
    }

    public function test_a_chain_with_nothing_in_it_says_so_rather_than_calling_itself_clean(): void
    {
        $result = $this->ledger()->verify('node-test');

        $this->assertTrue($result['ok']);
        $this->assertSame(0, $result['checked']);
        $this->assertStringContainsString('not written anything yet', (string) $result['reason']);
    }

    public function test_an_entry_needs_a_role_that_may_write(): void
    {
        $this->asRole('viewer')->postJson('/audit', $this->entry('dose-1'), ['Idempotency-Key' => $this->key()])
            ->assertStatus(403);
    }

    private function ledger(): Ledger
    {
        return $this->app->make(Ledger::class);
    }

    /** @return array<string, mixed> */
    private function entry(string $recordId): array
    {
        return [
            'action' => 'dose.sign',
            'entity' => 'audit',
            'recordId' => $recordId,
            'before' => ['signed' => false],
            'after' => ['signed' => true],
        ];
    }
}
