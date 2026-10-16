<?php

declare(strict_types=1);

namespace App\Http\Controllers\Concerns;

use App\Support\ProblemException;

/**
 * The two things every list endpoint does with its query string: read a bounded integer, and refuse the rest.
 *
 * A query string is typed by whoever built the link, so a bad one is a *400* and not the 422 a malformed body gets:
 * "the link is wrong" and "the form is wrong" are different sentences, and the contract says which is which. The
 * refusal names the field and carries it in `errors` too, so a client can mark the input rather than parse prose.
 */
trait ReadsQueryStrings
{
    /** A query integer, or the default when it was not sent, or -1 when it cannot be an integer at all. */
    private function integer(mixed $value, int $default): int
    {
        if ($value === null || $value === '') {
            return $default;
        }

        return is_numeric($value) ? (int) $value : -1;
    }

    private function malformed(string $field, string $message): ProblemException
    {
        return ProblemException::of(
            'dizi.validation-failed',
            'Some fields need attention',
            400,
            "The query string cannot be read: `{$field}` {$message}.",
            ['errors' => [['field' => $field, 'message' => $message, 'code' => 'dizi.validation-failed']]],
        );
    }
}
