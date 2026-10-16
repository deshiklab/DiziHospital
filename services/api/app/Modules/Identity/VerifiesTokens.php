<?php

declare(strict_types=1);

namespace App\Modules\Identity;

/**
 * Turn a bearer token into an Actor, or refuse it.
 *
 * Two drivers implement this and the difference between them is the whole of P0-205: `SignedTokenVerifier` checks a
 * token this service issued to itself, and `KeycloakTokenVerifier` checks a real OIDC access token against the
 * realm's published keys. `TokenVerifier` picks one from configuration and is what the middleware depends on, so the
 * day the hospital switches to Keycloak is a change to `DIZI_AUTH_DRIVER` rather than to every call site.
 *
 * Implementations must never return an Actor for a token they could not check. A verifier that "fails open" is not a
 * verifier, and on this service the consequence would be a patient record written by whoever could reach the port.
 */
interface VerifiesTokens
{
    /**
     * @throws \App\Support\ProblemException when the token is missing, altered, expired or from somewhere else
     */
    public function verify(string $token): Actor;
}
