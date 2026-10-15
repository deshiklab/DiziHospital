<?php

/**
 * The application's wiring, in one readable place.
 *
 * Two things about this file are decisions rather than boilerplate:
 *
 *  1. **`apiPrefix: ''` and no web routes.** The contract's paths are the product's paths — `/health`,
 *     `/patients/{mrn}`, `/node/number-blocks` — and they are not behind an `/api` segment. The generated client,
 *     the app's queued writes and every document in `docs/` name them that way, so the service serves them that way
 *     and there is no second, prettier address for the same resource.
 *  2. **No `health` route.** Laravel's own `/up` probe answers a question nobody asked in the product's vocabulary:
 *     this service has `/health` in the contract, which reports the tier and the replica lag the screens stamp on
 *     cached reads. Two health endpoints, one of them undocumented, is how an uptime check ends up watching the
 *     wrong one.
 */

declare(strict_types=1);

use App\Exceptions\ProblemRenderer;
use App\Http\Middleware\AttachTraceId;
use App\Http\Middleware\Authenticate;
use App\Http\Middleware\RequireIdempotencyKey;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        apiPrefix: '',
    )
    /* `app/Console/Commands` is where `dizi:modules` lives — the command an operator runs to see which modules this
       service has built and whether their schemas actually migrated. */
    ->withCommands()
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'dizi.auth' => Authenticate::class,
            'dizi.idempotency' => RequireIdempotencyKey::class,
        ]);
        $middleware->append(AttachTraceId::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        /* Every failure on this service is RFC 9457 `application/problem+json`, whatever the client asked for and
           whatever went wrong. An offline desk that receives `500 Internal Server Error` and an HTML body has been
           told nothing it can act on; the contract says so in its own words, and this is where it is kept. */
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);
        $exceptions->render(fn (Throwable $e, Request $request) => app(ProblemRenderer::class)->render($e, $request));
    })
    ->create();
