<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Support\ProblemException;

/**
 * The verifier the application depends on: one name, two drivers, chosen by configuration.
 *
 * The middleware asks this to verify a token and does not care whether the hospital is running its own realm yet.
 * That is the whole point of the seam: P0-205 lands as a change to `DIZI_AUTH_DRIVER` plus a configured issuer, not
 * as an edit to the authentication path — and a service that is configured for Keycloak and has no issuer is refused
 * at the first request rather than quietly falling back to the development driver, because a fallback there is a
 * door that opens itself.
 *
 * `issue()` belongs to the development driver and is kept here because the test suite mints tokens through the
 * container. It refuses when the configured driver is Keycloak: minting a preview token that the Keycloak driver
 * would then reject is not a shortcut, it is a test that proves nothing.
 */
final class TokenVerifier implements VerifiesTokens
{
    public const DRIVERS = ['preview', 'keycloak'];

    public function __construct(
        private readonly string $driver,
        private readonly SignedTokenVerifier $preview,
        private readonly KeycloakTokenVerifier $keycloak,
    ) {
        if (! in_array($driver, self::DRIVERS, true)) {
            throw ProblemException::of(
                'dizi.unavailable',
                'This service cannot verify tokens',
                503,
                "`{$driver}` is not a token driver this service has. It has: ".implode(', ', self::DRIVERS).'. An unknown driver is a misconfiguration, and guessing which one was meant is how a deployment ends up trusting the wrong issuer.',
            );
        }
    }

    public function verify(string $token): Actor
    {
        return $this->driver === 'keycloak'
            ? $this->keycloak->verify($token)
            : $this->preview->verify($token);
    }

    /** Which driver is in force. Named in logs and in `/health`, so "who signed this" is answerable without a guess. */
    public function driver(): string
    {
        return $this->driver;
    }

    /**
     * Mint a development token.
     *
     * @param  array<string, mixed>  $claims
     */
    public function issue(array $claims, ?int $expiresAt = null): string
    {
        if ($this->driver !== 'preview') {
            throw ProblemException::of(
                'dizi.unavailable',
                'This service does not mint tokens',
                503,
                "It is configured to verify Keycloak tokens (`{$this->driver}`), and it is a resource server rather than an issuer. Mint tokens at Keycloak; tests for the Keycloak driver build their own, signed with a key they generate.",
            );
        }

        return $this->preview->issue($claims, $expiresAt);
    }
}
