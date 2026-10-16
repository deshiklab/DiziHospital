<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Modules\Identity\Actor;
use App\Modules\Identity\TokenVerifier;
use App\Support\ProblemException;
use Illuminate\Support\Facades\Http;

/**
 * A real realm, in a test.
 *
 * The Keycloak driver is the one thing in this service that cannot be exercised by calling a method: it verifies a
 * signature against a key set fetched over the network. So the tests bring their own realm out of one `openssl`
 * keypair — a JWKS served by a faked HTTP client, tokens signed with the matching private key — and let the driver
 * do exactly what it does in production: read the header, pick the key by `kid`, check the signature over the real
 * bytes, then check the claims.
 *
 * **The keys here are generated per test and thrown away.** Nothing in this file is a credential, and the realm that
 * runs in the hospital has its own key material inside Keycloak, which is the only place a signing key can live
 * without being a shared secret between everybody who runs the tests.
 *
 * What this fixture cannot prove is stated in `services/api/README.md`: that Keycloak's own tokens look like the ones
 * minted here. That is what `provision.mjs --check` does against a running realm, and it is the reason the realm's
 * mappers are checked against the contract by `npm run contract:check` as well.
 */
trait KeycloakFixture
{
    protected string $issuer = 'https://identity.dizihospital.test/realms/dizihospital';

    protected string $apiAudience = 'dizi-api';

    /** @var array{n: string, e: string}|null */
    private ?array $realmKey = null;

    private mixed $realmPrivateKey = null;

    private string $realmKid = 'realm-key-1';

    /**
     * Generate this test's realm keypair.
     *
     * RSA-2048 rather than a larger key: the test is proving the encoding and the signature check, not the strength
     * of the modulus, and a slower keypair is a suite nobody runs.
     */
    protected function generateRealmKey(string $kid = 'realm-key-1'): void
    {
        $resource = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);

        if ($resource === false) {
            $this->markTestSkipped('This PHP has no OpenSSL key generation, so the RS256 path cannot be exercised here.');
        }

        $details = openssl_pkey_get_details($resource);
        $this->realmKey = [
            'n' => $this->base64url($details['rsa']['n']),
            'e' => $this->base64url($details['rsa']['e']),
        ];
        $this->realmPrivateKey = $resource;
        $this->realmKid = $kid;
    }

    /** @param list<array<string, string>>|null $keys */
    protected function fakeJwks(?array $keys = null): void
    {
        if ($this->realmKey === null) {
            $this->generateRealmKey($this->realmKid);
        }

        $jwks = ['keys' => $keys ?? [[
            'kid' => $this->realmKid,
            'kty' => 'RSA',
            'alg' => 'RS256',
            'use' => 'sig',
            'n' => $this->realmKey['n'],
            'e' => $this->realmKey['e'],
        ]]];

        Http::fake([
            $this->issuer.'/protocol/openid-connect/certs' => Http::response($jwks, 200),
            '*' => Http::response(['error' => 'unexpected call'], 500),
        ]);
    }

    /** Point the service at the faked realm and the faked key set. */
    protected function useKeycloakDriver(?string $audience = null): void
    {
        $this->fakeJwks();

        config([
            'dizi.auth.driver' => 'keycloak',
            'dizi.oidc.issuer' => $this->issuer,
            'dizi.oidc.audience' => $audience ?? $this->apiAudience,
            'dizi.oidc.jwks_uri' => $this->issuer.'/protocol/openid-connect/certs',
        ]);

        $this->app->forgetInstance(TokenVerifier::class);
    }

    /**
     * Mint an access token the way the realm would.
     *
     * @param  array<string, mixed>  $claims
     * @param  array<string, mixed>  $headers
     */
    protected function keycloakToken(array $claims = [], array $headers = [], ?string $kid = null, bool $sign = true): string
    {
        /* A key, before anything is signed with one. Tests write `$this->verifyKeycloak($this->keycloakToken())` all
           the time, and PHP evaluates the argument first — so the mint has to be able to stand on its own. The first
           CI run of this suite failed fourteen cases on `openssl_sign(): Supplied key param cannot be coerced into a
           private key` because it could not. */
        if ($sign && $this->realmPrivateKey === null) {
            $this->generateRealmKey($this->realmKid);
        }

        $header = array_merge(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => $kid ?? $this->realmKid], $headers);
        $payload = array_merge([
            'iss' => $this->issuer,
            'aud' => ['account', $this->apiAudience],
            'azp' => 'dizi-web',
            'sub' => 'kc-staff-7',
            'preferred_username' => 'rahima.begum',
            'name' => 'Rahima Begum',
            'realm_access' => ['roles' => ['receptionist']],
            'branch' => 'Main Campus',
            'node' => 'node-test',
            'iat' => time() - 5,
            'exp' => time() + 300,
        ], $claims);

        $signingInput = $this->base64url((string) json_encode($header)).'.'.$this->base64url((string) json_encode($payload));

        if ($sign) {
            openssl_sign($signingInput, $signature, $this->realmPrivateKey, OPENSSL_ALGO_SHA256);

            return $signingInput.'.'.$this->base64url($signature);
        }

        /* `sign: false` is the attacker's token — `alg: none`, or an HMAC signed with a public key — and it is framed
           like a real one: three parts, the third one bytes somebody made up. An empty third part is refused earlier,
           as a token that is not a token, which is a different refusal from the one these cases are about. */
        return $signingInput.'.'.$this->base64url('not-a-signature');
    }

    /**
     * Drive the driver directly, for the cases that are about verification rather than about a request.
     *
     * `$configure` is the difference between the two kinds of case in this suite. Most of them want a realm: a key,
     * the key set published, the service pointed at it — that is the default. The four that build a realm of their
     * own (a rotated key, a key set that answers 502, one that publishes nothing, one that carries only `x5c`) pass
     * `configure: false`, because re-faking the default set would quietly replace the very thing they are testing.
     */
    protected function verifyKeycloak(string $token, bool $configure = true): Actor
    {
        if ($configure) {
            $this->useKeycloakDriver();
        }

        return $this->app->make(TokenVerifier::class)->verify($token);
    }

    /** The refusal a token produces, as a `ProblemException`, or null when it was accepted. See `verifyKeycloak`. */
    protected function refusalFor(string $token, bool $configure = true): ?ProblemException
    {
        if ($configure) {
            $this->useKeycloakDriver();
        }

        try {
            $this->app->make(TokenVerifier::class)->verify($token);
        } catch (ProblemException $refusal) {
            return $refusal;
        }

        return null;
    }

    /** Make the following requests as the realm's own token. */
    protected function asKeycloak(array $claims = [], array $headers = []): static
    {
        $this->useKeycloakDriver();

        return $this->withHeader('Authorization', 'Bearer '.$this->keycloakToken($claims, $headers));
    }

    /**
     * Reserve this node's number blocks as the realm's own token.
     *
     * `TestCase::reserve()` mints a preview token, and a service configured for Keycloak refuses those — which is
     * correct and is why this exists rather than an overload: a test must reserve as the identity it then works as,
     * the same way a real node does not switch identity between reserving and registering.
     */
    protected function reserveAsKeycloak(): void
    {
        $this->asKeycloak(['realm_access' => ['roles' => ['receptionist']]])
            ->getJson('/node/number-blocks')
            ->assertOk();
    }

    private function base64url(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }
}
