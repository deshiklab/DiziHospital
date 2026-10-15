<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Support\ProblemException;

/**
 * The identity seam, and the honest state of it.
 *
 * **Keycloak is the intended issuer** (P0-205, ticket #24) and is not wired yet. What is here instead is not a
 * bypass: the `preview` driver verifies a token signed with the service's own secret, with an expiry it really
 * checks, and it produces exactly the claims the Keycloak driver will produce — an actor, a role, a branch and a
 * node — so the middleware, the role table and every test on this service are exercising the same code path #24
 * will plug into. What it does **not** do is federate, refresh, or verify an RS256 signature against a JWKS, and the
 * service's README says so rather than implying otherwise.
 *
 * The token is `<base64url(payload)>.<base64url(hmac)>`, where payload is
 * `{"sub","name","role","branch","node","exp"}` and the hmac is SHA-256 over the payload segment.
 */
final class TokenVerifier
{
    public function __construct(
        private readonly string $driver,
        private readonly string $secret,
        private readonly int $leewaySeconds,
    ) {
    }

    public function verify(string $token): Actor
    {
        if ($this->driver === 'keycloak') {
            throw ProblemException::of(
                'dizi.unavailable',
                'Single sign-on is not configured yet',
                503,
                'This service is set to verify Keycloak tokens, and the OIDC client has not been configured. Ticket #24 covers it; until then the API is run with its own signed tokens.',
            );
        }

        if ($this->secret === '') {
            throw ProblemException::of(
                'dizi.unavailable',
                'This service cannot verify tokens',
                503,
                'No signing secret is configured, so no token can be checked. Set AUTH_PREVIEW_SECRET — a token nobody verifies is a token anybody can forge.',
            );
        }

        $parts = explode('.', $token);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            throw $this->rejected();
        }

        [$payload, $signature] = $parts;
        $expected = $this->base64url(hash_hmac('sha256', $payload, $this->secret, true));

        /* Constant time: a comparison that returns early tells an attacker how much of a forged signature was right. */
        if (! hash_equals($expected, $signature)) {
            throw $this->rejected();
        }

        $claims = json_decode($this->unbase64url($payload), true);
        if (! is_array($claims)) {
            throw $this->rejected();
        }

        foreach (['sub', 'role', 'branch', 'node'] as $required) {
            if (! is_string($claims[$required] ?? null) || $claims[$required] === '') {
                throw $this->rejected();
            }
        }

        $expiresAt = (int) ($claims['exp'] ?? 0);
        if ($expiresAt <= 0 || $expiresAt + $this->leewaySeconds < time()) {
            throw ProblemException::of(
                'dizi.unauthenticated',
                'Your session has ended',
                401,
                'This token has expired. Sign in again — a queued write is kept and can be sent under a fresh token, so nothing the desk typed is lost.',
            );
        }

        return new Actor(
            id: (string) $claims['sub'],
            name: is_string($claims['name'] ?? null) ? $claims['name'] : (string) $claims['sub'],
            role: (string) $claims['role'],
            branch: (string) $claims['branch'],
            node: (string) $claims['node'],
        );
    }

    /** What a test (and, later, Keycloak's own client) uses to mint a token for this driver. */
    public function issue(array $claims, ?int $expiresAt = null): string
    {
        $claims['exp'] = $expiresAt ?? time() + 3600;
        $payload = $this->base64url((string) json_encode($claims));

        return $payload.'.'.$this->base64url(hash_hmac('sha256', $payload, $this->secret, true));
    }

    private function rejected(): ProblemException
    {
        return ProblemException::of(
            'dizi.unauthenticated',
            'Your session has ended',
            401,
            'That token is not one this service issued, or it has been altered. Sign in again.',
        );
    }

    private function base64url(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }

    private function unbase64url(string $text): string
    {
        return (string) base64_decode(strtr($text, '-_', '+/'), true);
    }
}
