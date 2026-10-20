<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The request's correlation id, so a refusal a desk saw at 14:05 can be found in the log at 14:06.
 *
 * It is a singleton rather than a static so that two requests in one process — which is what the test suite does —
 * cannot see each other's id.
 */
final class Trace
{
    private string $id;

    public function __construct()
    {
        $this->id = self::fresh();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function adopt(string $id): void
    {
        $this->id = $id;
    }

    public static function fresh(): string
    {
        return bin2hex(random_bytes(8));
    }
}
