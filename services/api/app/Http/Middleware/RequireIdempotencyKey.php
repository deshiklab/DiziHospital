<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Modules\Identity\Actor;
use App\Modules\Sync\OperationRecord;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * A queued write is applied once, however many times it arrives.
 *
 * This is the middleware that lets a node be offline for a week and drain afterwards: the key is `nodeId:seq`, the
 * response of the first attempt is stored beside it, and a replay returns that response rather than registering the
 * patient again. The contract's own words for the code are "treat as success — drop the outbox entry, do not resend",
 * which is why a replay is a 2xx with the original body and not a refusal the client has to interpret.
 *
 * Two failures at once are handled by the key being the primary key of `sync.operations`: the loser of the race cannot
 * insert its own row, so it reads the winner's. A retry storm is therefore one write and many identical answers, which
 * is the only property that makes an outbox safe to drain automatically.
 */
final class RequireIdempotencyKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');

        /* The contract's own bounds: 8–128 characters, `nodeId:seq` for a queued write or a UUID for an online one. A
           missing key is a client bug with a consequence — an unkeyed write cannot be replayed safely, and a node that
           sends one has no way to know whether its registration was applied. */
        if (! is_string($key) || mb_strlen($key) < 8 || mb_strlen($key) > 128) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'This write needs an `Idempotency-Key` header of 8 to 128 characters — `nodeId:seq` for a queued write, or a UUID for one made online. Without it a retry cannot be told from a second patient.',
                ['errors' => [['field' => 'Idempotency-Key', 'message' => 'Missing or out of range (8–128 characters)', 'code' => 'dizi.validation-failed']]],
            );
        }

        $operationId = (string) $request->route()?->getName();
        $fingerprint = hash('sha256', $request->getContent());
        $replay = OperationRecord::query()->where('key', $key)->first();

        if ($replay !== null) {
            /* The same key with a different body is two different writes, and answering the second with the first
               one's response would throw away whatever the desk typed the second time. Keys identify one write; a
               corrected write is a new key. */
            if ($replay->request_hash !== $fingerprint) {
                throw ProblemException::of(
                    'dizi.validation-failed',
                    'Some fields need attention',
                    422,
                    'This idempotency key was used before with different contents, so it cannot be replayed. A key identifies one write; send the correction under a new key.',
                    ['errors' => [['field' => 'Idempotency-Key', 'message' => 'Already used with a different body', 'code' => 'dizi.validation-failed']]],
                );
            }

            /* A key belongs to one operation: the same key on a different endpoint is a client that has reused a
               sequence number, and answering it with another operation's response would be worse than refusing. */
            if ($replay->operation_id !== $operationId) {
                throw ProblemException::of(
                    'dizi.validation-failed',
                    'Some fields need attention',
                    422,
                    "This idempotency key was used for `{$replay->operation_id}`. A key identifies one write; reusing it for another would return the wrong answer.",
                    ['errors' => [['field' => 'Idempotency-Key', 'message' => 'Already used for '.$replay->operation_id, 'code' => 'dizi.validation-failed']]],
                );
            }

            return $this->asResponse($replay->status_code, $replay->response ?? [], replay: true);
        }

        $response = $next($request);

        /* Only a success is recorded. A 5xx must be free to be retried — storing it would turn a transient failure into
           a permanent one — and a 4xx is deterministic for the same body, so replaying it recomputes the same answer. */
        if ($response->getStatusCode() >= 400) {
            return $response;
        }

        $record = new OperationRecord([
            'key' => $key,
            'operation_id' => $operationId,
            'node' => app(Actor::class)->node,
            'request_hash' => hash('sha256', $request->getContent()),
            'status_code' => $response->getStatusCode(),
            'response' => $this->body($response),
            'completed_at' => ApiTime::now(),
        ]);

        try {
            DB::transaction(static fn () => $record->save());
        } catch (QueryException) {
            /* Somebody else inserted this key between the read and the write. Their response is the one that was
               returned to the first arrival, so theirs is the one this arrival gets. */
            $winner = OperationRecord::query()->where('key', $key)->first();
            if ($winner !== null) {
                return $this->asResponse($winner->status_code, $winner->response ?? [], replay: true);
            }

            throw ProblemException::of(
                'dizi.unavailable',
                'The cloud is unreachable',
                503,
                'This write could not be recorded against its idempotency key, so a retry could not be told from a second patient. Keep it queued and try again.',
            );
        }

        return $response;
    }

    /** @param array<string, mixed> $body */
    private function asResponse(int $status, array $body, bool $replay): JsonResponse
    {
        return new JsonResponse($body, $status, ['X-Dizi-Replay' => $replay ? 'true' : 'false']);
    }

    /** @return array<string, mixed> */
    private function body(Response $response): array
    {
        $decoded = json_decode((string) $response->getContent(), true);

        return is_array($decoded) ? $decoded : [];
    }
}
