<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

/**
 * The availability rule set — the seam between "the pilot's numbers" and the code that uses them.
 *
 * It is an interface for the same reason `DuplicateRules` is: the rule set is *data*, and where the data comes from is
 * a deployment decision. In this service it is read from the published contract (`x-dizi-scheduling`), which is where
 * the calendar the desk sees and the refusal this API writes come from — one set of numbers, so a slot the screen
 * offers and the service refuses is a bug rather than a policy.
 *
 * The rules are deliberately small: a step, a window, a horizon, a weekly closed day, and a default capacity. A shop
 * that needs four kinds of clinic, half-day holidays and a per-visit-type duration has outgrown this interface, and
 * saying so here is better than growing it one method per branch.
 */
interface AvailabilityRules
{
    /** The slot step in minutes: the grid the calendar draws, and the only start times a booking may claim. */
    public function slotMinutes(): int;

    /**
     * The branch's OPD window, in minutes from midnight, local time.
     *
     * @return array{from: int, to: int}
     */
    public function window(): array;

    /** The zone the sitting hours are local to. `09:00` in a rule set without a zone is a guess. */
    public function timezone(): string;

    /** How far ahead a booking may be taken, in days. */
    public function horizonDays(): int;

    /**
     * The weekdays the clinic is closed on, spelled the way `Date::format('l')` spells them.
     *
     * @return list<string>
     */
    public function closedOn(): array;

    /** The steps a consultation claims when a doctor's sitting does not say otherwise. */
    public function defaultCapacity(): int;
}
