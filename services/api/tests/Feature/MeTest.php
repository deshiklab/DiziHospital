<?php

declare(strict_types=1);

namespace Tests\Feature;

use Tests\Support\KeycloakFixture;
use Tests\TestCase;

/**
 * `GET /me` — P0-205's acceptance line, on the wire.
 *
 * "Role claims visible in the token" is only half a claim: a token nothing acts on is a token that might as well not
 * carry the claims. This proves the other half — the roles a realm puts in the token are the roles this service
 * shows, and the abilities it shows are the abilities it enforces, because both come from the contract's one table.
 */
final class MeTest extends TestCase
{
    use KeycloakFixture;

    public function test_a_realm_session_reports_its_roles_and_what_they_may_do(): void
    {
        $response = $this->asKeycloak(['realm_access' => ['roles' => ['accountant']]])
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('actor', 'kc-staff-7')
            ->assertJsonPath('name', 'Rahima Begum')
            ->assertJsonPath('branch', 'Main Campus')
            ->assertJsonPath('node', 'node-test')
            ->assertJsonPath('issuer', $this->issuer)
            ->assertJsonPath('driver', 'keycloak')
            ->assertJsonPath('roles.0.id', 'accountant')
            ->assertJsonPath('roles.0.shell', 'billing')
            ->assertJsonPath('roles.0.label.bn', 'হিসাবরক্ষক')
            ->assertJsonPath('legacyScreens', 45);

        // The abilities are the contract's own list, in the contract's own order.
        $this->assertSame(['read', 'write'], $response->json('abilities'));
    }

    public function test_the_widest_role_is_listed_first(): void
    {
        /* Order is not decoration: the screen draws the first role as the person's role. An admin who is also a
           receptionist is an admin here, because that is the role that grants the most. */
        $response = $this->asKeycloak(['realm_access' => ['roles' => ['receptionist', 'super-admin']]])
            ->getJson('/me')
            ->assertOk();

        $this->assertSame(['super-admin', 'receptionist'], array_column($response->json('roles'), 'id'));
        $this->assertSame(['read', 'write', 'administer'], $response->json('abilities'));
    }

    public function test_the_read_only_role_says_so_rather_than_being_an_absence(): void
    {
        $response = $this->asKeycloak(['realm_access' => ['roles' => ['auditor']]])
            ->getJson('/me')
            ->assertOk();

        $this->assertSame(['read'], $response->json('abilities'));
        $this->assertSame(['read'], $response->json('roles.0.abilities'));
        $this->assertSame(0, $response->json('legacyScreens'));
    }

    public function test_the_preview_driver_answers_too_so_a_checkout_without_keycloak_can_be_worked_on(): void
    {
        $this->asRole('doctor')
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('driver', 'preview')
            ->assertJsonPath('roles.0.id', 'doctor')
            ->assertJsonPath('abilities', ['read', 'write']);
    }

    public function test_a_role_the_contract_does_not_declare_is_refused_rather_than_reported(): void
    {
        /* A code the contract declares, on a wire where the `type` is the contract's own URI for it: the last segment
           is what a screen branches on, and every other refusal test in this suite reads it the same way. */
        $response = $this->asKeycloak(['realm_access' => ['roles' => ['ward-clerk']]])->getJson('/me');

        $response->assertForbidden();
        $this->assertStringEndsWith('dizi.forbidden', (string) $response->json('type'));
    }

    public function test_no_token_is_a_session_that_has_ended_and_not_a_list_of_nothing(): void
    {
        $response = $this->getJson('/me');

        $response->assertUnauthorized();
        $this->assertStringEndsWith('dizi.unauthenticated', (string) $response->json('type'));
    }

    public function test_the_contract_declares_this_operation_like_any_other(): void
    {
        /* The house rule: a screen's write — and a screen's read — is a contract operation. A route that is not in
           the contract is one the generated client cannot call, so `/me` is checked here by name and in
           `tests/Contract/ContractTest.php` both ways round. */
        /* Through the configuration, not a path built here: the API reads the contract at `dizi.contract.path`, and a
           test that counts directories is a test that breaks the day the file moves. */
        $contract = json_decode((string) file_get_contents((string) config('dizi.contract.path')), true);

        $this->assertSame('getMe', $contract['paths']['/me']['get']['operationId']);
        $this->assertSame('cache', $contract['paths']['/me']['get']['x-dizi']['offline']);
        $this->assertSame('edge', $contract['paths']['/me']['get']['x-dizi']['authority']);
    }
}
