<?php

declare(strict_types=1);

namespace App\Providers;

use App\Modules\Audit\HashChainLedger;
use App\Modules\Audit\Ledger;
use App\Modules\Identity\ContractRoles;
use App\Modules\Identity\KeycloakTokenVerifier;
use App\Modules\Identity\RoleAbilities;
use App\Modules\Identity\SignedTokenVerifier;
use App\Modules\Identity\TokenVerifier;
use App\Modules\Identity\VerifiesTokens;
use App\Modules\Registration\ContractDuplicateRules;
use App\Modules\Registration\DuplicateRules;
use App\Modules\Registration\DuplicateScorer;
use App\Modules\Registration\Register;
use App\Modules\Scheduling\AvailabilityRules;
use App\Modules\Scheduling\ContractAvailabilityRules;
use App\Modules\Sync\NodePolicy;
use App\Modules\Sync\ReservedBlocks;
use App\Support\Trace;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * The seams, bound in one place.
 *
 * Every interface a module exposes to the rest of the service is bound here, and nothing resolves a concrete class
 * across a module boundary: `Audit\Ledger` is what registration may use, `HashChainLedger` is how it happens to be
 * implemented today. The rule this buys is not architectural purity — it is that the second implementation (a ledger
 * that batches to the cloud, a rule set read from the database) is a binding rather than an edit to every caller.
 *
 * `tests/Contract/ContractTest.php` asserts the bindings exist against `Modules::TABLE`, so a seam cannot be deleted
 * while the module table still advertises it.
 */
final class ModuleServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        /* One trace id per request, shared by the middleware that reads it, every refusal that reports it and the
           header that returns it. As two instances it would be two different ids, and the point of the id is that the
           desk's screenshot and the log line match. */
        $this->app->singleton(Trace::class);

        /* The two token drivers, built from configuration and held by the one the application depends on. The
           issuer's JWKS URI is derived from the issuer when it is not given, which is the shape Keycloak publishes:
           `<issuer>/.well-known/openid-configuration` names it, and this is the same path. */
        $this->app->singleton(TokenVerifier::class, fn (): TokenVerifier => new TokenVerifier(
            driver: (string) config('dizi.auth.driver'),
            preview: new SignedTokenVerifier(
                secret: (string) config('dizi.auth.secret'),
                leewaySeconds: (int) config('dizi.auth.leeway_seconds'),
            ),
            keycloak: new KeycloakTokenVerifier(
                issuer: rtrim((string) config('dizi.oidc.issuer'), '/'),
                audience: (string) config('dizi.oidc.audience'),
                jwksUri: (string) (config('dizi.oidc.jwks_uri') ?: rtrim((string) config('dizi.oidc.issuer'), '/').'/protocol/openid-connect/certs'),
                leewaySeconds: (int) config('dizi.auth.leeway_seconds'),
                jwksTtlSeconds: (int) config('dizi.oidc.jwks_ttl_seconds'),
                timeoutSeconds: (int) config('dizi.oidc.timeout_seconds'),
            ),
        ));

        /* The verification seam is an alias rather than a second binding: `TokenVerifier` is the singleton, and this
           is the interface the middleware's dependency is expressed against (`VerifiesTokens`), so the contract test
           can ask the container for the seam by name and get the configured one. */
        $this->app->alias(TokenVerifier::class, VerifiesTokens::class);

        /* The role table, read out of the same contract the client is generated from (P0-205). Bound as a seam so
           the ability check does not care whether the table is a file or a table in the database. */
        $this->app->singleton(ContractRoles::class, fn (): ContractRoles => new ContractRoles(
            (string) config('dizi.contract.path'),
        ));

        $this->app->bind(RoleAbilities::class, ContractRoles::class);

        $this->app->singleton(ReservedBlocks::class, fn (): ReservedBlocks => new ReservedBlocks(
            nodeSecret: (string) config('dizi.node.secret'),
            size: (int) config('dizi.blocks.size'),
            leaseHours: (int) config('dizi.blocks.lease_hours'),
            prefixes: config('dizi.blocks.prefixes'),
            series: config('dizi.blocks.series'),
        ));

        $this->app->bind(NodePolicy::class, ReservedBlocks::class);

        $this->app->singleton(ContractDuplicateRules::class, fn (): ContractDuplicateRules => new ContractDuplicateRules(
            (string) config('dizi.contract.path'),
        ));

        $this->app->bind(DuplicateRules::class, ContractDuplicateRules::class);

        /* The appointment rules (P0-401), read from the same contract and bound the same way: a branch that tunes its
           sitting hours in Setup is changing the file both the calendar and this service read. */
        $this->app->singleton(ContractAvailabilityRules::class, fn (): ContractAvailabilityRules => new ContractAvailabilityRules(
            (string) config('dizi.contract.path'),
        ));

        $this->app->bind(AvailabilityRules::class, ContractAvailabilityRules::class);

        $this->app->singleton(DuplicateScorer::class, fn ($app): DuplicateScorer => new DuplicateScorer(
            $app->make(DuplicateRules::class),
        ));

        $this->app->bind(Ledger::class, HashChainLedger::class);

        /* The register is the registration module's public face, so it takes the seams rather than the classes that
           implement them. Nothing here is given a node: the node comes from the token with every request, because one
           cloud tier serves every branch and the write belongs to the device that took it. */
        $this->app->singleton(Register::class, fn ($app): Register => new Register(
            blocks: $app->make(ReservedBlocks::class),
            scorer: $app->make(DuplicateScorer::class),
            ledger: $app->make(Ledger::class),
        ));
    }

    /**
     * The `api` rate limit the route group names.
     *
     * The number is chosen around the one burst this service genuinely has: a node that has been offline for a week
     * draining its outbox posts its writes as fast as it can, and a limit tuned for people typing would throttle a
     * branch's whole morning into a partial sync. Six hundred a minute is far above a drain and far below a runaway
     * loop, and the key is the token rather than the address, because a hospital's nodes share one outbound address
     * and one node's loop must not lock out the others.
     */
    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request): Limit {
            $token = $request->bearerToken();
            $key = is_string($token) && $token !== '' ? hash('sha256', $token) : (string) $request->ip();

            return Limit::perMinute(600)->by($key);
        });
    }
}
