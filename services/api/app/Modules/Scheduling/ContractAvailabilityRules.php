<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

use App\Support\ProblemException;

/**
 * The rule set, read from the contract itself.
 *
 * Read once and cached in the instance: these are configuration, changed when a branch changes them in Setup rather
 * than per request. A missing or unreadable `x-dizi-scheduling` block is a refusal rather than a set of defaults —
 * substituting invented sitting hours is the most expensive kind of helpful, because the service would keep accepting
 * bookings into a grid nobody configured and the first person to notice would be a patient in the wrong queue.
 */
final class ContractAvailabilityRules implements AvailabilityRules
{
    /** @var array<string, mixed>|null */
    private ?array $loaded = null;

    public function __construct(private readonly string $path) {}

    public function slotMinutes(): int
    {
        return $this->positiveInt('slotMinutes', 1, 240);
    }

    public function window(): array
    {
        $window = $this->load()['window'] ?? null;
        $from = is_array($window) ? ($window['from'] ?? null) : null;
        $to = is_array($window) ? ($window['to'] ?? null) : null;

        if (! is_int($from) || ! is_int($to) || $from < 0 || $to > 1440 || $to <= $from) {
            throw $this->missing('`x-dizi-scheduling.window` is not a window of minutes from midnight.');
        }

        if (($to - $from) % $this->slotMinutes() !== 0) {
            throw $this->missing('`x-dizi-scheduling.window` is not a whole number of slots wide, so the grid would end mid-slot.');
        }

        return ['from' => $from, 'to' => $to];
    }

    public function timezone(): string
    {
        $zone = $this->load()['timezone'] ?? null;

        if (! is_string($zone) || ! in_array($zone, \DateTimeZone::listIdentifiers(), true)) {
            throw $this->missing('`x-dizi-scheduling.timezone` is not a timezone identifier.');
        }

        return $zone;
    }

    public function horizonDays(): int
    {
        return $this->positiveInt('horizonDays', 1, 730);
    }

    public function closedOn(): array
    {
        $days = $this->load()['closedOn'] ?? [];

        if (! is_array($days)) {
            throw $this->missing('`x-dizi-scheduling.closedOn` is not a list of weekdays.');
        }

        return array_values(array_filter($days, 'is_string'));
    }

    public function defaultCapacity(): int
    {
        return $this->positiveInt('defaultCapacity', 1, 24);
    }

    private function positiveInt(string $key, int $min, int $max): int
    {
        $value = $this->load()[$key] ?? null;

        if (! is_int($value) || $value < $min || $value > $max) {
            throw $this->missing("`x-dizi-scheduling.{$key}` is not a number between {$min} and {$max}.");
        }

        return $value;
    }

    /** @return array<string, mixed> */
    private function load(): array
    {
        if ($this->loaded !== null) {
            return $this->loaded;
        }

        if (! is_file($this->path)) {
            throw $this->missing('the contract is not deployed beside this service.');
        }

        $document = json_decode((string) file_get_contents($this->path), true);
        $rules = is_array($document) ? ($document['x-dizi-scheduling'] ?? null) : null;

        if (! is_array($rules)) {
            throw $this->missing('the contract carries no `x-dizi-scheduling` block.');
        }

        return $this->loaded = $rules;
    }

    private function missing(string $because): ProblemException
    {
        return ProblemException::of(
            'dizi.unavailable',
            'The appointment rules are missing',
            503,
            'This service draws its booking grid from the product contract and could not read it: '.$because
            .' Reading `'.$this->path.'`. Booking against invented sitting hours would put patients in a queue that does not exist, so no appointment is accepted until the contract is deployed beside the service.',
        );
    }
}
