<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;

/**
 * A refusal the product has a name for, thrown from wherever it is noticed.
 *
 * The `type` is one of the contract's own codes (`dizi.stale-version`, `dizi.duplicate-patient`, …): the app branches
 * on it, so the screens' sentences and this service's sentences cannot drift apart. The `extra` array carries what
 * the contract puts beside the code — the duplicate candidates, the two values that conflict — because a refusal that
 * names the code and withholds the evidence is a refusal somebody has to telephone about.
 */
final class ProblemException extends RuntimeException
{
    /** @param array<string, mixed> $extra */
    public function __construct(
        public readonly string $type,
        public readonly string $title,
        public readonly int $status,
        string $detail,
        public readonly array $extra = [],
    ) {
        parent::__construct($detail);
    }

    /** @param array<string, mixed> $extra */
    public static function of(string $type, string $title, int $status, string $detail, array $extra = []): self
    {
        return new self($type, $title, $status, $detail, $extra);
    }
}
