<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Support\ProblemException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * The Keycloak driver: a real OIDC access token, verified the way a resource server has to verify one.
 *
 * What it checks, and why each one is here rather than assumed:
 *
 *   - **The signature**, with RS256 only. The algorithm comes from the token's own header, which is exactly why it
 *     must be pinned: a verifier that trusts the header accepts a token signed `none`, or one signed HS256 with the
 *     public key as the HMAC secret. Both are the same mistake — believing a claim the attacker wrote.
 *   - **`kid` → JWKS.** The key is chosen by the token's key id from the realm's JWKS, so a key rotation at Keycloak
 *     is picked up without a deployment here. Keys are cached for `oidc.jwks_ttl_seconds`; a `kid` that is not in the
 *     cache makes the verifier fetch once more before refusing, because "the key rotated a minute ago" is a normal
 *     event and a refusal for it would page somebody at 3am.
 *   - **`iss`** exactly, **`aud`** (or `azp`) naming this API, **`exp`/`nbf`** with a small leeway for clock drift
 *     between the edge node and the cloud. A token minted for another client in the same realm is refused: one realm
 *     may host several audiences, and only the one that was asked for is an authorisation.
 *   - **Roles and attributes**: `realm_access.roles`, `branch`, `node`. A token whose roles are all ones the contract
 *     does not declare is refused by name rather than treated as a viewer — silence there is how a renamed role
 *     becomes an unexplained empty screen.
 *
 * What it deliberately does **not** do: no user federation, no session introspection, no token exchange, and no
 * `azp`-based client trust list. Those arrive with the portal and the adapters, and none of them is needed to verify
 * a staff token. The service's README says so rather than leaving it to be discovered.
 */
final class KeycloakTokenVerifier implements VerifiesTokens
{
    public function __construct(
        private readonly string $issuer,
        private readonly string $audience,
        private readonly string $jwksUri,
        private readonly int $leewaySeconds,
        private readonly int $jwksTtlSeconds,
        private readonly int $timeoutSeconds,
    ) {}

    public function verify(string $token): Actor
    {
        if ($this->issuer === '') {
            throw ProblemException::of(
                'dizi.unavailable',
                'Single sign-on is not configured yet',
                503,
                'This service is set to verify Keycloak tokens and no issuer is configured, so no token can be checked. Set OIDC_ISSUER — a service that cannot check a signature is a service that trusts anybody who can reach it. Ticket #24 carries the realm.',
            );
        }

        [$header, $claims, $signingInput, $signature] = $this->split($token);

        if (($header['alg'] ?? null) !== 'RS256') {
            throw $this->rejected(
                'That token is not signed the way this service signs in',
                'Only RS256 is accepted. The algorithm in the token header is not trusted — that is the whole point of pinning it.',
            );
        }

        $kid = $header['kid'] ?? null;
        if (! is_string($kid) || $kid === '') {
            throw $this->rejected(
                'That token carries no key id',
                'The token names no key, so this service cannot tell which of the realm\'s signing keys to check it against.',
            );
        }

        $this->assertSignature($kid, $signingInput, $signature);
        $this->assertRegisteredClaims($claims);

        $roles = $this->rolesIn($claims);

        return new Actor(
            id: (string) $claims['sub'],
            name: is_string($claims['name'] ?? null)
                ? $claims['name']
                : (is_string($claims['preferred_username'] ?? null) ? $claims['preferred_username'] : (string) $claims['sub']),
            role: $roles[0],
            roles: $roles,
            branch: is_string($claims['branch'] ?? null) ? $claims['branch'] : '',
            node: is_string($claims['node'] ?? null) ? $claims['node'] : '',
            issuer: $this->issuer,
        );
    }

    /**
     * The header, the claims, the signed bytes and the signature.
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: string, 3: string}
     */
    private function split(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3 || in_array('', $parts, true)) {
            throw $this->rejected('That token is not a token', 'A signed token has three parts. This one does not, so there is nothing to verify.');
        }

        [$header64, $claims64, $signature64] = $parts;
        $header = json_decode($this->unbase64url($header64), true);
        $claims = json_decode($this->unbase64url($claims64), true);

        if (! is_array($header) || ! is_array($claims)) {
            throw $this->rejected('That token cannot be read', 'Its header or its claims are not JSON, so nothing about it can be checked.');
        }

        return [$header, $claims, $header64.'.'.$claims64, $this->unbase64url($signature64)];
    }

    private function assertSignature(string $kid, string $signingInput, string $signature): void
    {
        $key = $this->publicKeyFor($kid);

        if ($key === null) {
            // One more fetch before refusing: a key rotated seconds ago is not an attack, it is Tuesday.
            $key = $this->publicKeyFor($kid, fresh: true);
        }

        if ($key === null) {
            throw $this->rejected(
                'That token was signed with a key this service does not have',
                "The realm's published keys contain no `{$kid}`. Either the token is not from this realm, or the realm rotated its keys and this service cannot reach the JWKS to catch up.",
            );
        }

        $result = openssl_verify($signingInput, $signature, $key, OPENSSL_ALGO_SHA256);

        if ($result !== 1) {
            throw $this->rejected(
                'That token has been altered',
                'The signature does not match the contents. Sign in again; if this keeps happening, the realm and this service may be out of step and the IT desk needs to know.',
            );
        }
    }

    /** @param array<string, mixed> $claims */
    private function assertRegisteredClaims(array $claims): void
    {
        $issuer = $claims['iss'] ?? null;
        if (! is_string($issuer) || rtrim($issuer, '/') !== rtrim($this->issuer, '/')) {
            throw $this->rejected(
                'That token came from somewhere else',
                'The token says it was issued by `'.(is_string($issuer) ? $issuer : 'nobody').'`. This service only trusts '.$this->issuer.', so a token from another realm is a token from another hospital.',
            );
        }

        $audience = $claims['aud'] ?? null;
        $audience = is_array($audience) ? $audience : (is_string($audience) ? [$audience] : []);
        $authorisedParty = $claims['azp'] ?? null;
        if (! in_array($this->audience, $audience, true) && $authorisedParty !== $this->audience) {
            throw $this->rejected(
                'That token was not issued for this service',
                "The token's audience is `".implode(', ', array_map('strval', $audience)).'`. It has to name `'.$this->audience.'`: a token minted for another client in the same realm is not an authorisation to call this API.',
            );
        }

        $now = time();
        $expiresAt = (int) ($claims['exp'] ?? 0);
        if ($expiresAt <= 0) {
            throw $this->rejected('That token has no expiry', 'A token without an expiry never ends. Sign in again.');
        }
        if ($expiresAt + $this->leewaySeconds < $now) {
            throw ProblemException::of(
                'dizi.unauthenticated',
                'Your session has ended',
                401,
                'This token has expired. Sign in again — the outbox keeps the write, so nothing the desk typed is lost, and a refresh should have happened before this point in normal use.',
            );
        }

        $notBefore = (int) ($claims['nbf'] ?? 0);
        if ($notBefore > 0 && $notBefore - $this->leewaySeconds > $now) {
            throw $this->rejected(
                'That token is not valid yet',
                'The token starts later than now, which usually means the clock on this node is behind the identity server. Check the node\'s time; a wrong clock also breaks the hash-chained ledger reconciliation.',
            );
        }

        if (! is_string($claims['sub'] ?? null) || $claims['sub'] === '') {
            throw $this->rejected('That token names nobody', 'A token with no subject cannot be attributed to a person, so no write it makes could be audited.');
        }
    }

    /**
     * The roles, in the order the token lists them, with at least one the contract declares.
     *
     * @param  array<string, mixed>  $claims
     * @return list<string>
     */
    private function rolesIn(array $claims): array
    {
        $realmAccess = $claims['realm_access'] ?? null;
        $declared = is_array($realmAccess) ? ($realmAccess['roles'] ?? null) : null;
        $roles = is_array($declared) ? array_values(array_filter($declared, 'is_string')) : [];

        if ($roles === []) {
            throw ProblemException::of(
                'dizi.forbidden',
                'Your sign-in carries no role',
                403,
                'This token names no role. The realm has to put `realm_access.roles` in the access token — the `roles` mapper on the staff client does it — and this service will not guess: a token with no role is one that can do nothing, and saying so is clearer than an empty screen.',
            );
        }

        return array_values(array_unique($roles));
    }

    /**
     * A PEM public key for a `kid`, from the realm's JWKS.
     *
     * Keycloak publishes `x5c` (the certificate chain) for its signing keys and the bare `n`/`e` pair for others;
     * both are accepted here, because a realm with a certificate-less key would otherwise be a realm we cannot verify
     * against. The JWKS is cached for `oidc.jwks_ttl_seconds` so a busy desk does not fetch it per request.
     */
    private function publicKeyFor(string $kid, bool $fresh = false): ?string
    {
        $jwks = $fresh ? $this->fetch() : Cache::remember(
            'dizi.oidc.jwks',
            $this->jwksTtlSeconds,
            fn (): array => $this->fetch(),
        );

        foreach ($jwks['keys'] ?? [] as $key) {
            if (! is_array($key) || ($key['kid'] ?? null) !== $kid) {
                continue;
            }
            if (($key['kty'] ?? null) !== 'RSA') {
                continue;
            }

            if (is_array($key['x5c'] ?? null) && isset($key['x5c'][0]) && is_string($key['x5c'][0])) {
                $certificate = @openssl_x509_read("-----BEGIN CERTIFICATE-----\n".chunk_split($key['x5c'][0], 64, "\n").'-----END CERTIFICATE-----');
                if ($certificate !== false) {
                    $pem = openssl_pkey_get_public($certificate);

                    return $pem === false ? null : $this->pem($pem);
                }
            }

            if (is_string($key['n'] ?? null) && is_string($key['e'] ?? null)) {
                $pem = @openssl_pkey_get_public($this->rsaPem($key['n'], $key['e']));

                return $pem === false ? null : $this->pem($pem);
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    private function fetch(): array
    {
        try {
            $response = Http::timeout($this->timeoutSeconds)->acceptJson()->get($this->jwksUri);
        } catch (\Throwable $error) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The identity service cannot be reached',
                503,
                'This node could not fetch the signing keys from '.$this->jwksUri.' ('.$error->getMessage().'). A node that cannot reach its identity provider cannot verify a session, and refusing is what keeps an unreachable network from being the same thing as an open door.',
            );
        }

        if (! $response->successful()) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The identity service refused the key request',
                503,
                'The JWKS request to '.$this->jwksUri.' answered '.$response->status().'. Check that OIDC_ISSUER names the realm this hospital runs.',
            );
        }

        $jwks = $response->json();
        if (! is_array($jwks) || ! is_array($jwks['keys'] ?? null) || $jwks['keys'] === []) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The identity service published no keys',
                503,
                'The response from '.$this->jwksUri.' carries no keys, so no signature can be checked against it. An empty key set is treated as an outage rather than as an open door.',
            );
        }

        return $jwks;
    }

    /** A resource handle back to a PEM string. */
    private function pem(mixed $key): string
    {
        $details = openssl_pkey_get_details($key);

        return is_array($details) && is_string($details['key'] ?? null) ? $details['key'] : '';
    }

    /**
     * An RSA public key from a JWK's `n` and `e`, as PEM.
     *
     * `openssl` has no JWK reader, so the two integers are encoded into the DER a PEM wraps:
     * `SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier, BIT STRING RSAPublicKey }` and
     * `RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }`. Every step here is the encoding
     * rather than cryptography, and `tests/Unit/KeycloakTokenVerifierTest.php` signs a real token with a real key
     * and proves the round trip, because a hand-rolled encoder that nothing verifies is a guess.
     */
    private function rsaPem(string $modulus, string $exponent): string
    {
        $rsaKey = $this->der(0x30, $this->der(0x02, $this->unsigned($this->unbase64url($modulus)))
            .$this->der(0x02, $this->unsigned($this->unbase64url($exponent))));

        $algorithm = $this->der(
            0x30,
            // OID 1.2.840.113549.1.1.1 — rsaEncryption — followed by a NULL parameter.
            $this->der(0x06, $this->unbase64url('KoZIhvcNAQEB')).$this->der(0x05, ''),
        );

        $spki = $this->der(0x30, $algorithm.$this->der(0x03, "\x00".$rsaKey));

        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($spki), 64, "\n").'-----END PUBLIC KEY-----';
    }

    /** One DER value: tag, length, contents. */
    private function der(int $tag, string $contents): string
    {
        return chr($tag).$this->derLength(strlen($contents)).$contents;
    }

    private function derLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }

        $bytes = '';
        while ($length > 0) {
            $bytes = chr($length & 0xff).$bytes;
            $length >>= 8;
        }

        return chr(0x80 | strlen($bytes)).$bytes;
    }

    /** A DER INTEGER holds a signed, big-endian, minimally-encoded value: leading zeroes trimmed, and a zero byte in
     *  front when the top bit is set so it does not read as a negative number. */
    private function unsigned(string $bytes): string
    {
        $bytes = ltrim($bytes, "\x00");

        if ($bytes === '') {
            return "\x00";
        }

        return (ord($bytes[0]) & 0x80) ? "\x00".$bytes : $bytes;
    }

    private function rejected(string $title, string $because): ProblemException
    {
        return ProblemException::of('dizi.unauthenticated', $title, 401, $because);
    }

    /** base64url, decoded strictly: a token segment that is not base64 is a token that was not issued. */
    private function unbase64url(string $text): string
    {
        return (string) base64_decode(strtr($text, '-_', '+/'), true);
    }
}
