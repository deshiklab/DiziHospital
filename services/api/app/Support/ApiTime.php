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
 * screens format for the branch, whose timezone the contract names in `x-dizi-scheduling`.
 *
 * The offset on the wire is always `+00:00`, and that is a decision rather than an accident: an instant is the same
 * moment wherever it is read, and a service that answers `09:00+06:00` from one endpoint and `03:00+00:00` from
 * another has two spellings of one moment that a client has to parse instead of being able to compare. The *local*
 * reading of a moment — the one the desk says out loud, "nine o'clock Tuesday" — is carried by the fields that are
 * local by their nature (`day` and `startMinute` on an appointment), and a screen that wants the wall clock asks for
 * the branch's zone rather than reparsing an offset.
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

        /* `utc()` rather than the offset it arrived with: one moment, one spelling, everywhere on this wire. The
           branch spells its own moments in `day` and `startMinute`, which is where a local reading belongs. */
        return Carbon::parse($at)->utc()->toIso8601String();
    }
}
