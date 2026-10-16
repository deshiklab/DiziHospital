<?php

declare(strict_types=1);

namespace Tests\Feature;

use Tests\Support\KeycloakFixture;
use Tests\TestCase;

/**
 * A Keycloak session, all the way through the service (P0-205 / #24).
 *
 * The unit test proves the verifier. This proves the *service*: a token minted by the realm reaches the middleware,
 * becomes an actor, is checked against the contract's role table, and either writes a patient or is refused — with
 * the refusal in the contract's own problem shape. It is the acceptance line of the ticket ("login with MFA against
 * migrated users; role claims visible in the token") reduced to the part a repository can prove on its own: the role
 * claims a real realm would issue are the claims this service acts on.
 *
 * What it does not prove, and what the README says: that a live Keycloak issues exactly these claims. That is what
 * `infra/keycloak/provision.mjs --check` does against a running realm.
 */
final class KeycloakSessionTest extends TestCase
{
    use KeycloakFixture;

    public function test_a_realm_token_reads_the_patient_register(): void
    {
        $this->reserveAsKeycloak();

        $this->asKeycloak(['realm_access' => ['roles' => ['receptionist']]])
            ->getJson('/patients')
            ->assertOk()
            ->assertJsonPath('patients', []);
    }

    public function test_a_realm_token_registers_a_patient_and_the_ledger_names_the_person_and_the_node(): void
    {
        $this->reserve();

        $response = $this->asKeycloak(['realm_access' => ['roles' => ['receptionist']]])
            ->postJson('/patients', [
                'name' => 'Rahima Begum',
                'age' => 34,
                'sex' => 'Female',
                'phone' => '01712345678',
                'branch' => 'Main Campus',
            ], ['Idempotency-Key' => $this->key('0001')])
            ->assertCreated();

        $this->assertStringStartsWith('MRN-', (string) $response->json('mrn'));
        $this->assertDatabaseHas('registration_patients', ['mrn' => $response->json('mrn'), 'created_by' => 'kc-staff-7']);
    }

    public function test_a_role_that_may_not_write_is_refused_with_the_contract_sentence(): void
    {
        /* The auditor is the read-only role in the contract's table, and this is the refusal that exists because of
           it: the app hides the action, the API refuses it, and the refusal says which role and which ability. */
        $this->reserveAsKeycloak();

        $this->asKeycloak(['realm_access' => ['roles' => ['auditor']]])
            ->postJson('/patients', ['name' => 'Nobody'], ['Idempotency-Key' => $this->key('0002')])
            ->assertForbidden()
            ->assertJsonPath('type', 'dizi.forbidden')
            ->assertJsonPath('status', 403);
    }

    public function test_two_roles_add_up_rather_than_the_first_one_winning(): void
    {
        /* A consultant who is also the hospital admin is one account with two roles. The union is what applies; if
           the first role won, adding a role would take access away. */
        $this->reserveAsKeycloak();

        $this->asKeycloak(['realm_access' => ['roles' => ['auditor', 'admin']]])
            ->postJson('/patients', [
                'name' => 'Nusrat Jahan',
                'age' => 41,
                'sex' => 'Female',
                'phone' => '01712345679',
                'branch' => 'Main Campus',
            ], ['Idempotency-Key' => $this->key('0003')])
            ->assertCreated();
    }

    public function test_a_role_the_contract_does_not_declare_is_refused_by_name(): void
    {
        /* The failure this prevents is the quiet one: a realm role renamed in Keycloak, the person signs in
           successfully, and every screen is empty with nothing anywhere saying why. */
        $this->reserve();

        $response = $this->asKeycloak(['realm_access' => ['roles' => ['night-supervisor']]])
            ->getJson('/patients')
            ->assertForbidden()
            ->assertJsonPath('type', 'dizi.forbidden');

        $this->assertStringContainsString('night-supervisor', (string) $response->json('detail'));
    }

    public function test_an_expired_session_is_a_sign_in_prompt_and_not_a_server_error(): void
    {
        $this->asKeycloak(['exp' => time() - 60])
            ->getJson('/patients')
            ->assertUnauthorized()
            ->assertJsonPath('type', 'dizi.unauthenticated')
            ->assertJsonPath('status', 401);
    }

    public function test_the_preview_driver_still_works_when_it_is_the_configured_one(): void
    {
        /* The switch is configuration, and the default is the driver a checkout with no Keycloak runs. A test that
           only covered the new driver would be a suite that stops noticing when the old one breaks. */
        $this->reserve();

        $this->asRole('reception')->getJson('/patients')->assertOk();
    }

    public function test_the_driver_in_force_is_named_rather_than_implied(): void
    {
        $this->useKeycloakDriver();

        $this->assertSame('keycloak', $this->app->make(\App\Modules\Identity\TokenVerifier::class)->driver());
    }

    public function test_a_service_configured_for_keycloak_with_no_issuer_refuses_everything(): void
    {
        /* The dangerous configuration: `keycloak` chosen and the issuer left blank. The honest failure is 503 on
           every request, not a fallback to the development driver — a fallback there is a door that opens itself
           when the environment file is wrong. */
        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => '',
        ]);
        $this->app->forgetInstance(\App\Modules\Identity\TokenVerifier::class);

        $this->getJson('/patients')->assertStatus(503);
    }

    public function test_a_forged_token_cannot_write_a_patient(): void
    {
        $this->reserve();

        $this->useKeycloakDriver();
        $realmKid = $this->realmKid;
        $realmToken = $this->keycloakToken();

        /* Sign with a key this service has never seen, while *claiming* the realm's own key id: the key lookup
           succeeds, so the signature check is the thing that has to refuse. (Claiming an unknown kid instead would
           test the lookup rather than the verification.) */
        $this->generateRealmKey('attacker-key');
        $forged = $this->keycloakToken(['realm_access' => ['roles' => ['admin']]], ['kid' => $realmKid]);

        $this->withHeader('Authorization', 'Bearer '.$forged)
            ->postJson('/patients', ['name' => 'Ghost'], ['Idempotency-Key' => $this->key('0004')])
            ->assertUnauthorized();

        // And the realm's own token still works, so the refusal above is about the signature and not about the path.
        $this->withHeader('Authorization', 'Bearer '.$realmToken)->getJson('/patients')->assertOk();
    }
}
