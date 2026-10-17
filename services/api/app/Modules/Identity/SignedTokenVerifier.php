<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Support\ProblemException;

/**
 * The development driver: a token this service signs for itself, with a real expiry it really checks.
 *
 * It exists because Keycloak needs somewhere to run, and the alternative to it is not "no authentication" but a
 * middleware that lets everything through — which is how a tolerance for local development becomes a production
 * incident. What it verifies is honest: an HMAC-SHA256 signature over the payload segment, an expiry with a leeway,
 * and the four claims the rest of the service reads. What it is **not** is an OIDC verifier: it does not federate,
 * refresh, or check an RS256 signature against a JWKS. `KeycloakTokenVerifier` does that, and `TokenVerifier` decides
 * between them from `DIZI_AUTH_DRIVER`.
 *
 * The token is `<base64url(payload)>.<base64url(hmac)>`, where payload is
 * `{"sub","name","role","branch","node","exp"}` and the hmac is SHA-256 over the payload segment.
 *
 * The role claim is singular and unchecked here on purpose: this driver is used by tests and by a developer's own
 * machine, and the *abilities* of the role it names are checked in the middleware against the contract either way,
 * so an unknown role is refused there rather than accepted here.
 */
final class SignedTokenVerifier implements VerifiesTokens
{
    public function __construct(
        private readonly string $secret,
        private readonly int $leewaySeconds,
    ) {}

    public function verify(string $token): Actor
    {
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
            roles: [(string) $claims['role']],
            branch: (string) $claims['branch'],
            node: (string) $claims['node'],
            issuer: 'preview',
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
