<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Trace;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * One id per request, on the way in and on the way out.
 *
 * A client that already has a trace id — a node draining its outbox, whose entry has been sitting in a queue for a week
 * — sends it, and this service adopts it rather than minting a new one. That is what makes a single queued write
 * traceable end to end: the desk's screenshot, the outbox entry, the API's log and the return trip all carry the same
 * string.
 */
final class AttachTraceId
{
    public function handle(Request $request, Closure $next): Response
    {
        $trace = app(Trace::class);
        $supplied = $request->header('X-Trace-Id');

        if (is_string($supplied) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $supplied) === 1) {
            $trace->adopt($supplied);
        }

        $response = $next($request);
        $response->headers->set('X-Trace-Id', $trace->id());

        return $response;
    }
}
