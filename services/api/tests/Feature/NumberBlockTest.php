<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Sync\ReservedBlocks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class NumberBlockTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_node_is_given_a_range_to_mint_from(): void
    {
        $response = $this->asRole('reception')->getJson('/node/number-blocks');

        $response->assertOk()->assertJsonCount(3, 'blocks');

        $mrn = $this->block($response->json('blocks'), 'mrn');

        $this->assertSame('MRN', $mrn['prefix']);
        $this->assertSame(1, $mrn['from']);
        $this->assertSame(5, $mrn['to']);
        $this->assertSame(1, $mrn['next']);
        $this->assertNotNull($mrn['expiresAt']);
    }

    public function test_asking_again_returns_the_block_in_force_rather_than_a_second_one(): void
    {
        $first = $this->asRole()->getJson('/node/number-blocks')->json('blocks');
        $second = $this->asRole()->getJson('/node/number-blocks')->json('blocks');

        /* A node that reserves a new range every time it says good morning would burn ranges all day and leave the
           gaps behind it. */
        $this->assertSame($this->block($first, 'mrn')['from'], $this->block($second, 'mrn')['from']);
    }

    public function test_it_needs_a_token(): void
    {
        $response = $this->getJson('/node/number-blocks');

        $response->assertStatus(401);
        $this->assertStringEndsWith('dizi.unauthenticated', (string) $response->json('type'));
    }

    public function test_a_viewer_may_not_reserve_numbers(): void
    {
        $this->asRole('viewer')->getJson('/node/number-blocks')
            ->assertStatus(403)
            ->assertJsonPath('title', 'Your role cannot do this');
    }

    public function test_an_expired_token_is_refused_and_says_the_outbox_is_kept(): void
    {
        $this->withHeader('Authorization', 'Bearer '.$this->token([], time() - 3600))
            ->getJson('/node/number-blocks')
            ->assertStatus(401)
            ->assertJsonPath('title', 'Your session has ended');
    }

    public function test_a_node_that_has_used_every_reserved_number_is_told_so(): void
    {
        config(['dizi.blocks.size' => 2]);
        $this->app->forgetInstance(ReservedBlocks::class);

        $this->asRole()->getJson('/node/number-blocks')->assertOk();

        foreach ([1, 2] as $n) {
            $this->asRole()->postJson('/patients', [
                'name' => 'Patient '.$n,
                'sex' => 'Female',
                'phone' => '0171100000'.$n,
            ], ['Idempotency-Key' => $this->key('000'.$n)])->assertCreated();
        }

        $this->asRole()->postJson('/patients', [
            'name' => 'Patient three',
            'sex' => 'Female',
            'phone' => '01711000009',
        ], ['Idempotency-Key' => $this->key('0009')])
            ->assertStatus(409)
            ->assertJsonPath('title', 'This node has run out of reserved numbers');
    }

    /**
     * @param  list<array<string, mixed>>  $blocks
     * @return array<string, mixed>
     */
    private function block(array $blocks, string $series): array
    {
        foreach ($blocks as $block) {
            if ($block['series'] === $series) {
                return $block;
            }
        }

        $this->fail("no {$series} block in the response");
    }
}
