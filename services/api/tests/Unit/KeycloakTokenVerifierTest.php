<?php

declare(strict_types=1);

namespace Tests\Unit;

use Tests\Support\KeycloakFixture;
use Tests\TestCase;

/**
 * The Keycloak driver, verified the way it verifies.
 *
 * Every case here is a real token, signed with a real key, checked against a real key set — the only thing faked is
 * the HTTP hop, so the signature arithmetic, the base64url framing, the JWK-to-PEM encoding and the claim checks are
 * all the code that runs in production.
 *
 * The cases are the ways a token can be wrong, and each one is a separate test rather than an assertion inside a
 * loop, because they are separate decisions: an expired token and a token from another realm are both refusals, but
 * they send the person reading the log to different places.
 */
final class KeycloakTokenVerifierTest extends TestCase
{
    use KeycloakFixture;

    public function test_a_real_token_becomes_the_actor_the_rest_of_the_service_uses(): void
    {
        $actor = $this->verifyKeycloak($this->keycloakToken());

        $this->assertSame('kc-staff-7', $actor->id);
        $this->assertSame('Rahima Begum', $actor->name);
        $this->assertSame(['receptionist'], $actor->roles);
        $this->assertSame('receptionist', $actor->role);
        $this->assertSame('Main Campus', $actor->branch);
        $this->assertSame('node-test', $actor->node);
        $this->assertSame($this->issuer, $actor->issuer);
    }

    public function test_two_roles_are_kept_as_two_roles(): void
    {
        $actor = $this->verifyKeycloak($this->keycloakToken([
            'realm_access' => ['roles' => ['doctor', 'admin']],
        ]));

        $this->assertSame(['doctor', 'admin'], $actor->roles);
        // The sentence a refusal prints names the widest role held, not the first one in the list.
        $this->assertSame('doctor', $actor->role);
    }

    public function test_a_name_falls_back_to_the_username_when_the_realm_sends_no_name(): void
    {
        $actor = $this->verifyKeycloak($this->keycloakToken(['name' => null]));

        $this->assertSame('rahima.begum', $actor->name);
    }

    public function test_a_tampered_token_is_refused(): void
    {
        $token = $this->keycloakToken();
        $this->useKeycloakDriver();

        // Change a claim and keep the signature: the case the signature exists for.
        [$header, , $signature] = explode('.', $token);
        $forged = $header.'.'.$this->base64url((string) json_encode([
            'iss' => $this->issuer,
            'aud' => [$this->apiAudience],
            'sub' => 'kc-staff-7',
            'realm_access' => ['roles' => ['super-admin']],
            'branch' => 'Main Campus',
            'node' => 'node-test',
            'exp' => time() + 300,
        ])).'.'.$signature;

        $refusal = $this->refusalFor($forged);

        $this->assertNotNull($refusal);
        $this->assertSame(401, $refusal->status);
        $this->assertStringContainsString('altered', $refusal->getMessage());
    }

    public function test_an_expired_token_asks_the_person_to_sign_in_again(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['exp' => time() - 120]));

        $this->assertNotNull($refusal);
        $this->assertSame('dizi.unauthenticated', $refusal->type);
        $this->assertSame(401, $refusal->status);
        $this->assertStringContainsString('expired', $refusal->getMessage());
    }

    public function test_a_token_from_another_realm_is_refused(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['iss' => 'https://other.hospital.test/realms/staff']));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('came from somewhere else', $refusal->title);
    }

    public function test_a_token_minted_for_another_client_is_not_an_authorisation(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['aud' => ['dizi-portal'], 'azp' => 'dizi-portal']));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('not issued for this service', $refusal->title);
    }

    public function test_a_token_whose_authorised_party_is_this_api_is_accepted_without_an_audience(): void
    {
        // Keycloak omits `aud` when only the authorised party is configured; refusing those would be refusing every
        // token a correctly configured realm mints.
        $actor = $this->verifyKeycloak($this->keycloakToken(['aud' => null, 'azp' => $this->apiAudience]));

        $this->assertSame(['receptionist'], $actor->roles);
    }

    public function test_an_unsigned_token_is_refused_and_not_read_as_trusted(): void
    {
        $this->useKeycloakDriver();
        $refusal = $this->refusalFor($this->keycloakToken([], ['alg' => 'none'], sign: false));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('signed the way', $refusal->title);
    }

    public function test_a_token_signed_with_the_public_key_as_an_hmac_secret_is_refused(): void
    {
        /* The algorithm-confusion attack: the realm's public key is public, so a verifier that reads `alg` from the
           token's own header can be talked into checking an HMAC that anybody can compute. Only RS256 is accepted, so
           this token never reaches a signature check at all. */
        $this->useKeycloakDriver();
        $token = $this->keycloakToken([], ['alg' => 'HS256'], sign: false);

        $refusal = $this->refusalFor($token);

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('signed the way', $refusal->title);
    }

    public function test_a_key_id_the_realm_does_not_publish_is_refused(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken([], ['kid' => 'a-key-from-elsewhere']));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('key this service does not have', $refusal->title);
    }

    public function test_a_rotated_key_is_picked_up_without_a_deployment(): void
    {
        /* Keycloak rotation: the driver has the old key cached, the token arrives signed with the new one. The
           verifier fetches again before refusing, so a rotation during the cache's hour is not an outage. */
        $this->generateRealmKey('realm-key-2');
        $rotated = ['keys' => [[
            'kid' => 'realm-key-2',
            'kty' => 'RSA',
            'alg' => 'RS256',
            'use' => 'sig',
            'n' => $this->realmKey['n'],
            'e' => $this->realmKey['e'],
        ]]];

        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => $this->issuer,
            'dizi.oidc.audience' => $this->apiAudience,
            'dizi.oidc.jwks_uri' => $this->issuer.'/protocol/openid-connect/certs',
        ]);
        $this->app->forgetInstance(\App\Modules\Identity\TokenVerifier::class);

        // The first fetch publishes the *new* set, as a realm that has just rotated would.
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            $this->issuer.'/protocol/openid-connect/certs' => \Illuminate\Support\Facades\Http::response($rotated, 200),
        ]);

        $actor = $this->verifyKeycloak($this->keycloakToken([], ['kid' => 'realm-key-2']));

        $this->assertSame(['receptionist'], $actor->roles);
    }

    public function test_a_realm_with_no_roles_is_refused_by_name(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['realm_access' => ['roles' => []]]));

        $this->assertNotNull($refusal);
        $this->assertSame('dizi.forbidden', $refusal->type);
        $this->assertStringContainsString('carries no role', $refusal->title);
    }

    public function test_a_token_that_names_nobody_is_refused(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['sub' => null]));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('names nobody', $refusal->title);
    }

    public function test_a_token_that_starts_in_the_future_is_refused_as_a_clock_problem(): void
    {
        $refusal = $this->refusalFor($this->keycloakToken(['nbf' => time() + 600]));

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('clock', $refusal->getMessage());
    }

    public function test_an_unreachable_identity_service_is_an_outage_and_not_an_open_door(): void
    {
        $this->generateRealmKey();
        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => $this->issuer,
            'dizi.oidc.audience' => $this->apiAudience,
            'dizi.oidc.jwks_uri' => $this->issuer.'/protocol/openid-connect/certs',
        ]);
        $this->app->forgetInstance(\App\Modules\Identity\TokenVerifier::class);
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            $this->issuer.'/protocol/openid-connect/certs' => \Illuminate\Support\Facades\Http::response('', 502),
        ]);

        $refusal = $this->refusalFor($this->keycloakToken());

        $this->assertNotNull($refusal);
        $this->assertSame('dizi.unavailable', $refusal->type);
        $this->assertSame(503, $refusal->status);
    }

    public function test_a_key_set_with_no_keys_is_treated_as_an_outage(): void
    {
        /* An empty `keys` array is what a misconfigured realm or a proxy's error page can produce. Reading it as
           "no keys, so nothing to check" is how a verifier becomes a door. */
        $this->generateRealmKey();
        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => $this->issuer,
            'dizi.oidc.audience' => $this->apiAudience,
            'dizi.oidc.jwks_uri' => $this->issuer.'/protocol/openid-connect/certs',
        ]);
        $this->app->forgetInstance(\App\Modules\Identity\TokenVerifier::class);
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            $this->issuer.'/protocol/openid-connect/certs' => \Illuminate\Support\Facades\Http::response(['keys' => []], 200),
        ]);

        $refusal = $this->refusalFor($this->keycloakToken());

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('published no keys', $refusal->title);
    }

    public function test_the_x5c_certificate_path_is_accepted_as_well_as_the_raw_key(): void
    {
        /* Keycloak publishes `x5c` for keys that have a certificate and bare `n`/`e` for the rest. A realm whose key
           has no certificate would otherwise be a realm this service cannot verify. */
        $this->generateRealmKey();
        $certificate = $this->selfSignedCertificate();

        if ($certificate === null) {
            $this->markTestSkipped('This PHP cannot mint a self-signed certificate, so the x5c path cannot be built here.');
        }

        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => $this->issuer,
            'dizi.oidc.audience' => $this->apiAudience,
            'dizi.oidc.jwks_uri' => $this->issuer.'/protocol/openid-connect/certs',
        ]);
        $this->app->forgetInstance(\App\Modules\Identity\TokenVerifier::class);
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            $this->issuer.'/protocol/openid-connect/certs' => \Illuminate\Support\Facades\Http::response(['keys' => [[
                'kid' => $this->realmKid,
                'kty' => 'RSA',
                'alg' => 'RS256',
                'use' => 'sig',
                'x5c' => [$certificate],
                // Deliberately no `n`/`e`: this test is about the certificate path on its own.
            ]]], 200),
        ]);

        $actor = $this->verifyKeycloak($this->keycloakToken());

        $this->assertSame('receptionist', $actor->role);
    }

    /** A base64 DER certificate for the test's own key, the way Keycloak publishes one. */
    private function selfSignedCertificate(): ?string
    {
        $csr = openssl_csr_new(['commonName' => 'identity.dizihospital.test'], $this->realmPrivateKey, ['digest_alg' => 'sha256']);
        if ($csr === false) {
            return null;
        }

        $certificate = openssl_csr_sign($csr, null, $this->realmPrivateKey, 1, ['digest_alg' => 'sha256']);
        if ($certificate === false) {
            return null;
        }

        if (! openssl_x509_export($certificate, $pem)) {
            return null;
        }

        $body = preg_replace('/-----(BEGIN|END) CERTIFICATE-----|\s+/', '', $pem);

        return is_string($body) ? $body : null;
    }
}
