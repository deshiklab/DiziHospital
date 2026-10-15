<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * Every instant this service returns, in one place.
 *
 * The contract says an instant is ISO 8601 *with an offset*, and the reason is worth writing down: a screen that
 * receives `2026-10-16 09:00` has to guess whether that was the server's morning or the reader's, and the guess is
 * wrong twice a year for a hospital that runs a night shift across a timezone change. Durations are durations; the
 * screens format for Dhaka.
 */
final class ApiTime
{
    public static function now(): Carbon
    {
        return Date::now();
    }

    public static function iso(\DateTimeInterface|string|null $at): ?string
    {
        if ($at === null || $at === '') {
            return null;
        }

        return Carbon::parse($at)->toIso8601String();
    }
}
