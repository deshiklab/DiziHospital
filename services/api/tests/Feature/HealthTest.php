<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class HealthTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_answers_without_a_token_and_names_the_tier_and_the_contract(): void
    {
        $contract = json_decode((string) file_get_contents((string) config('dizi.contract.path')), true);

        $response = $this->getJson('/health');

        $response->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('tier', 'cloud')
            ->assertJsonPath('version', $contract['info']['version']);

        /* The version is read from the contract rather than written here, and this is the assertion that says so: an
           app and a service disagreeing about the contract is the failure this field exists to catch. */
        $this->assertNotSame('unknown', $response->json('version'));
    }

    public function test_every_response_carries_a_trace_id(): void
    {
        $response = $this->getJson('/health');

        $this->assertNotEmpty($response->headers->get('X-Trace-Id'));
    }

    public function test_a_client_supplied_trace_id_is_adopted_rather_than_replaced(): void
    {
        /* A queued write has carried its trace id since it was typed, a week ago. Keeping it is what makes one string
           follow the write from the desk to the log. */
        $this->withHeader('X-Trace-Id', 'abc123def456')->getJson('/health')
            ->assertHeader('X-Trace-Id', 'abc123def456');
    }
}
