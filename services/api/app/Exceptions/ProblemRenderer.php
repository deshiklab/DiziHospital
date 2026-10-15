<?php

declare(strict_types=1);

namespace App\Exceptions;

use App\Support\ProblemException;
use App\Support\Trace;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/**
 * Every failure becomes RFC 9457 `application/problem+json`, in the contract's own vocabulary.
 *
 * Three things are deliberate:
 *
 *  1. **The type is a code, not prose.** `dizi.stale-version` is what the app branches on; the `title` and `detail`
 *     are what a person reads, and they are sentences. A screen that has to parse an English sentence to decide
 *     whether to offer "reload" is a screen that breaks the first time somebody improves the wording.
 *  2. **A failure nobody anticipated is still a problem document**, with `about:blank` as its type — RFC 9457's
 *     default for "no more specific type" — and a 500. It does not pretend to be a product refusal it is not.
 *  3. **Every one carries the trace id**, because the desk's next sentence is "it said something went wrong" and the
 *     engineer's next question is "which request".
 */
final class ProblemRenderer
{
    private const PROBLEM_TYPE_PREFIX = 'https://contract.dizihospital.example/problems/';

    public function render(Throwable $e, Request $request): JsonResponse
    {
        $trace = app(Trace::class)->id();

        if ($e instanceof ProblemException) {
            return $this->problem($e->type, $e->title, $e->status, $e->getMessage(), $trace, $request, $e->extra);
        }

        if ($e instanceof ValidationException) {
            $errors = [];
            foreach ($e->errors() as $field => $messages) {
                foreach ($messages as $message) {
                    $errors[] = ['field' => $field, 'message' => $message, 'code' => 'dizi.validation-failed'];
                }
            }

            return $this->problem(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'Some of what was sent cannot be stored as it stands. Each field below says what it needs; nothing was written.',
                $trace,
                $request,
                ['errors' => $errors],
            );
        }

        if ($e instanceof ModelNotFoundException || $e instanceof NotFoundHttpException) {
            return $this->problem(
                'dizi.not-found',
                'Not found here',
                404,
                'There is no such record on this node. If it exists at another branch, it will appear when that branch drains.',
                $trace,
                $request,
            );
        }

        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();
            $type = match ($status) {
                401 => 'dizi.unauthenticated',
                403 => 'dizi.forbidden',
                429 => 'dizi.unavailable',
                503 => 'dizi.unavailable',
                default => 'about:blank',
            };
            $title = match ($status) {
                401 => 'Your session has ended',
                403 => 'Your role cannot do this',
                429 => 'Slow down',
                503 => 'The cloud is unreachable',
                default => 'That request could not be served',
            };

            return $this->problem($type, $title, $status, $e->getMessage() ?: $title, $trace, $request);
        }

        /* Nobody planned this one. It is reported as itself rather than dressed as a product refusal, and the detail
           is a sentence a person can quote — the message stays in the log, where it belongs. */
        return $this->problem(
            'about:blank',
            'The hospital server failed',
            500,
            'Something went wrong that the service did not expect. Nothing was written. Quote the trace id when this is reported.',
            $trace,
            $request,
        );
    }

    /** @param array<string, mixed> $extra */
    private function problem(string $type, string $title, int $status, string $detail, string $trace, Request $request, array $extra = []): JsonResponse
    {
        $body = array_merge([
            'type' => str_starts_with($type, 'about:blank') ? 'about:blank' : self::PROBLEM_TYPE_PREFIX.$type,
            'title' => $title,
            'status' => $status,
            'detail' => $detail,
            'instance' => $request->getRequestUri(),
            'traceId' => $trace,
        ], $extra);

        return new JsonResponse(
            $body,
            $status,
            [
                'Content-Type' => 'application/problem+json',
                'X-Trace-Id' => $trace,
            ],
        );
    }
}
