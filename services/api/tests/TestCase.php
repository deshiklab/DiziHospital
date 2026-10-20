<?php

declare(strict_types=1);

namespace Tests;

use App\Modules\Identity\TokenVerifier;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

/**
 * The base every test extends.
 *
 * The node and the token are configured here rather than in a fixture because they are the *subject* of most of these
 * tests: which node a write came from decides whether it is admitted as the canonical record, and which role the token
 * carries decides whether it is accepted at all. A test that has to build its own actor is a test that is checking
 * something else.
 *
 * The role ids are the contract's (`x-dizi-roles`), because the abilities are read from that table: `receptionist`,
 * not the `reception` this suite used while the preview driver carried its own list, and a read-only case asks for
 * the `auditor` role the contract declares rather than inventing a `viewer` the realm has never heard of.
 */
abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'dizi.node.id' => 'node-test',
            'dizi.node.branch' => 'Main Campus',
            'dizi.node.secret' => 'test-node-secret',
            'dizi.auth.driver' => 'preview',
            'dizi.auth.secret' => 'test-auth-secret',
            'dizi.blocks.size' => 5,
            'dizi.blocks.lease_hours' => 72,
        ]);
    }

    /**
     * A token for a role, minted the way the preview driver mints them.
     *
     * @param  array<string, mixed>  $claims
     */
    protected function token(array $claims = [], ?int $expiresAt = null): string
    {
        return $this->app->make(TokenVerifier::class)->issue(array_merge([
            'sub' => 'staff-7',
            'name' => 'Rahima Begum',
            'role' => 'receptionist',
            'branch' => 'Main Campus',
            'node' => 'node-test',
        ], $claims), $expiresAt);
    }

    /**
     * Make the following request as a role.
     *
     * @param  array<string, mixed>  $claims
     */
    protected function asRole(string $role = 'receptionist', array $claims = []): static
    {
        return $this->withHeader('Authorization', 'Bearer '.$this->token(array_merge(['role' => $role], $claims)));
    }

    /** A queued write's key, in the contract's own `nodeId:seq` shape. */
    protected function key(string $suffix = '0001'): string
    {
        return 'node-test:'.$suffix;
    }

    /**
     * Start the day online: reserve the numbers this node may mint from.
     *
     * Every registration test needs it, and every registration test should say so, because it is the real order of
     * events — a node reserves while it has a connection and then works. A registration without a reservation is a
     * refusal this service is supposed to make, and the test for that says it explicitly.
     */
    protected function reserve(): void
    {
        $this->asRole()->getJson('/node/number-blocks')->assertOk();
    }
}
