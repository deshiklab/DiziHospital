<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Scheduling\Appointment;
use App\Modules\Scheduling\Availability;
use App\Modules\Scheduling\AvailabilityRules;
use App\Modules\Scheduling\Sitting;
use App\Support\ProblemException;
use Tests\TestCase;

/**
 * The arithmetic of the slot grid, with no database under it.
 *
 * `Availability` needs two things: a rule set and a sitting. Both are values, so both are built here rather than
 * migrated — the point of this file is that the *rules* are testable on their own, without a patient, a booking or a
 * connection. The rule set is the pilot's own numbers, spelled out, so a case below reads as the sentence it tests:
 * a 15-minute grid from 09:00 to 14:00, closed on Fridays, thirty days of horizon.
 *
 * What is checked here is what a booking desk would call *obvious* and a program gets wrong: that the last slot of a
 * morning is the last one that **fits** rather than the last minute before closing, that a minute-of-day is local, and
 * that the window is the branch's and the doctor's intersected rather than either one alone.
 */
final class AppointmentGridTest extends TestCase
{
    public function test_a_slot_key_pads_the_minutes_so_the_key_sorts_by_time(): void
    {
        $morning = Appointment::slotKeyFor('dr-rahman', '2026-11-03', 540);
        $afternoon = Appointment::slotKeyFor('dr-rahman', '2026-11-03', 1005);

        $this->assertSame('dr-rahman@2026-11-03T0540', $morning);
        $this->assertSame('dr-rahman@2026-11-03T1005', $afternoon);

        /* The padding is the whole point: unpadded, `1005` sorts before `540`, and a key that a person reads during
           an incident would put the afternoon before the morning. */
        $this->assertLessThan($afternoon, $morning, 'An unpadded minute sorts its own key wrong.');
    }

    public function test_a_claim_key_is_the_appointments_own_doctor_day_and_minute(): void
    {
        $appointment = new Appointment(['doctor_id' => 'dr-islam', 'day' => '2026-11-03', 'start_minute' => 555]);

        $this->assertSame('dr-islam@2026-11-03T0555', $appointment->claimKey());
    }

    public function test_the_status_sets_agree_with_each_other(): void
    {
        /* A closed list rather than a vibe: every status the contract declares is either still holding its slot or is
           the cancellation that released it, and no status is in both. */
        foreach (Appointment::STATUSES as $status) {
            $holding = in_array($status, Appointment::HOLDING, true);

            $this->assertSame(
                $status !== 'Cancelled',
                $holding,
                "`{$status}` is on the holding list and the contract's status list disagrees about it.",
            );
        }

        $this->assertEmpty(array_diff(Appointment::IN_QUEUE, Appointment::HOLDING), 'A patient in the queue has released their slot.');
        $this->assertEmpty(array_intersect(Appointment::SETTLED, Appointment::IN_QUEUE), 'A settled visit is not still in the queue.');
    }

    public function test_the_window_is_the_branchs_and_the_doctors_intersected(): void
    {
        $availability = $this->availability();

        /* Dr. Khan sits until 900 while the branch closes at 840, so the day ends at 840. */
        $longSitting = new Sitting(['name' => 'Dr. M. Khan', 'from_minute' => 600, 'to_minute' => 900]);
        $this->assertSame(['from' => 600, 'to' => 840], $availability->effectiveWindow($longSitting));

        /* And a doctor who starts before the branch opens waits for the branch. */
        $earlySitting = new Sitting(['name' => 'Dr. Early', 'from_minute' => 480, 'to_minute' => 600]);
        $this->assertSame(['from' => 540, 'to' => 600], $availability->effectiveWindow($earlySitting));
    }

    public function test_a_sitting_too_short_for_one_slot_is_a_branch_problem_rather_than_a_booking_problem(): void
    {
        $this->expectException(ProblemException::class);
        $this->expectExceptionMessageMatches('/roster that needs correcting/');

        $this->availability()->effectiveWindow(new Sitting(['name' => 'Dr. Brief', 'from_minute' => 600, 'to_minute' => 605]));
    }

    public function test_a_friday_is_closed_and_says_so(): void
    {
        /* 2026-11-06 is a Friday. */
        $friday = $this->availability()->open('2026-11-06');
        $this->assertFalse($friday['open']);
        $this->assertStringContainsString('Friday', (string) $friday['because']);

        $tuesday = $this->availability()->open('2026-11-03');
        $this->assertTrue($tuesday['open']);
        $this->assertNull($tuesday['because']);
    }

    public function test_a_minute_of_day_is_local_to_the_branch(): void
    {
        $availability = $this->availability();

        /* 03:45 UTC is 09:45 in Dhaka, and 585 is the minute the grid means by that. */
        $this->assertSame('2026-11-03', $availability->dayOf('2026-11-03T03:45:00+00:00'));
        $this->assertSame(585, $availability->minuteOf('2026-11-03T03:45:00+00:00'));

        /* And the night-shift case: 20:00 UTC on Monday is already Tuesday morning at the desk. */
        $this->assertSame('2026-11-03', $availability->dayOf('2026-11-02T20:00:00+00:00'));
        $this->assertSame(120, $availability->minuteOf('2026-11-02T20:00:00+00:00'));
    }

    public function test_an_instant_is_named_in_the_branchs_zone_and_an_hour_is_a_clock(): void
    {
        $availability = $this->availability();

        $this->assertSame('2026-11-03T09:00:00+06:00', $availability->slotStart('2026-11-03', 540)->toIso8601String());
        $this->assertSame('09:00', $availability->clock(540));
        $this->assertSame('13:05', $availability->clock(785));
        $this->assertSame('2026-11-04', $availability->shift('2026-11-03', 1));
    }

    /** A rule set with the pilot's numbers, built in the test rather than read from a file. */
    private function availability(): Availability
    {
        $rules = new class implements AvailabilityRules
        {
            public function slotMinutes(): int
            {
                return 15;
            }

            public function window(): array
            {
                return ['from' => 540, 'to' => 840];
            }

            public function timezone(): string
            {
                return 'Asia/Dhaka';
            }

            public function horizonDays(): int
            {
                return 30;
            }

            public function closedOn(): array
            {
                return ['Friday'];
            }

            public function defaultCapacity(): int
            {
                return 2;
            }
        };

        return new Availability($rules);
    }
}
