<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * The slot grid for one doctor on one day, and the answers a refusal needs.
 *
 * Two things are computed here and nowhere else: which slots exist (the branch window and the doctor's sitting
 * intersected, stepped by the rule set) and which of them are free (the appointments that still hold theirs). The
 * desk's calendar draws what this returns, and a booking is checked against it — so a slot the screen offers and the
 * service refuses can only be a race, which is the one case a conflict refusal exists for.
 *
 * A consultation claims *steps* slots, not one. The calendar draws the whole claimed block as one appointment, and
 * the slot after the block is the next one that can be booked — which is why `alternatives()` checks the full claim
 * before offering a start rather than only the minute it starts at.
 *
 * Every instant crosses this boundary as ISO 8601 with an offset, and every minute-of-day is local to the branch's
 * timezone (the contract says which). A booking desk in Dhaka and a node in another zone disagree about what "09:15"
 * means, and the disagreement is not one a patient should ever be on the receiving end of.
 */
final class Availability
{
    /** @var array<string, list<Appointment>> the day's claims, read once per doctor and day */
    private array $claims = [];

    public function __construct(private readonly AvailabilityRules $rules) {}

    /**
     * The day as the contract's `AppointmentSlotDay`.
     *
     * A closed day is a 200 with no slots and the reason, not a 404: the calendar has to draw *why* Friday is empty,
     * and an empty grid with a sentence is a screen a receptionist can act on.
     *
     * @return array<string, mixed>
     */
    public function day(string $doctorId, string $day, ?string $excludeAppointmentId = null): array
    {
        $sitting = Sitting::forDoctor($doctorId);
        $window = $this->effectiveWindow($sitting);
        $open = $this->open($day);

        $held = $this->claimsFor($doctorId, $day, $excludeAppointmentId);

        return [
            'day' => $day,
            'doctorId' => $doctorId,
            'room' => (string) $sitting->room,
            'slotMinutes' => $this->rules->slotMinutes(),
            'open' => $open['open'],
            'closedBecause' => $open['because'],
            'window' => ['from' => $window['from'], 'to' => $window['to']],
            'slots' => $open['open'] ? $this->slots($day, $window, $held) : [],
            'asOf' => ApiTime::iso(ApiTime::now()),
        ];
    }

    /**
     * The next free starts after a refused one — what a conflict offers instead.
     *
     * The same day first, then the following open days inside the horizon, because "the morning is full" is a sentence
     * the desk can act on and an empty list is not. Each start is checked against the full claim, since offering a
     * 09:30 that only fits until 09:45 is offering a slot that will be refused a second later.
     *
     * @return list<array{start: string, day: string, minutes: int}>
     */
    public function alternatives(string $doctorId, string $day, int $fromMinute, int $take = 3): array
    {
        $sitting = Sitting::forDoctor($doctorId);
        $steps = max(1, (int) $sitting->capacity);
        $found = [];
        $scan = $day;

        for ($scanned = 0; $scanned <= $this->rules->horizonDays() && count($found) < $take; $scanned++) {
            if ($this->open($scan)['open']) {
                $window = $this->effectiveWindow($sitting);

                foreach ($this->starts($window) as $minute) {
                    if ($scan === $day && $minute <= $fromMinute) {
                        continue;
                    }

                    if (count($found) >= $take) {
                        break;
                    }

                    if ($this->isFree($doctorId, $scan, $minute, $steps)) {
                        $found[] = [
                            'start' => (string) ApiTime::iso($this->slotStart($scan, $minute)),
                            'day' => $scan,
                            'minutes' => $minute,
                        ];
                    }
                }
            }

            $scan = $this->shift($scan, 1);
        }

        return $found;
    }

    /**
     * Refuse a start the rules do not allow, in the words the desk needs.
     *
     * Four refusals live here, and they are one method because they are one question — "may this slot be claimed at
     * all?" — as opposed to the conflict, which is about who got there first and is the database's answer rather than
     * this method's.
     */
    public function assertClaimable(string $doctorId, string $day, int $startMinute): void
    {
        $sitting = Sitting::forDoctor($doctorId);
        $window = $this->effectiveWindow($sitting);
        $open = $this->open($day);

        if (! $open['open']) {
            throw ProblemException::of('dizi.validation-failed', 'That day cannot be booked', 422, $open['because']);
        }

        if ($startMinute < $window['from'] || $startMinute + $this->rules->slotMinutes() > $window['to']) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That time is outside the sitting',
                422,
                'Doctor '.$sitting->name.' sits from '.$this->clock($window['from']).' to '.$this->clock($window['to'])
                .' in '.$sitting->room.'. A booking has to lie inside that window — the calendar only offers what fits inside it.',
            );
        }

        if (($startMinute - $window['from']) % $this->rules->slotMinutes() !== 0) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That time is not on the slot grid',
                422,
                'Slots start every '.$this->rules->slotMinutes().' minutes from '.$this->clock($window['from'])
                .'. Book '.$this->clock($window['from'] + intdiv($startMinute - $window['from'], $this->rules->slotMinutes()) * $this->rules->slotMinutes()).' instead, or change the step in Setup if the clinic really starts at odd minutes.',
            );
        }

        if ($this->shift($this->today(), $this->rules->horizonDays()) < $day) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That day is beyond the booking horizon',
                422,
                'Bookings are taken up to '.$this->rules->horizonDays().' days ahead, and '.$day.' is further out than that.'
                .' The horizon exists so a roster change does not leave a month of promises to keep; if a patient needs a date beyond it, note it and confirm when the roster is published.',
            );
        }
    }

    /** Whether the clinic is open on a day, and the sentence that says why when it is not. */
    public function open(string $day): array
    {
        $weekday = Carbon::parse($day.' 00:00:00', $this->timezone())->format('l');

        if (in_array($weekday, $this->rules->closedOn(), true)) {
            return ['open' => false, 'because' => 'The clinic is closed on '.$weekday.'s. Choose the next open day — the calendar greys out the rest of the week so the desk can see the reason rather than guess it.'];
        }

        return ['open' => true, 'because' => null];
    }

    /** The branch window and the doctor's sitting, intersected. */
    public function effectiveWindow(Sitting $sitting): array
    {
        $branch = $this->rules->window();
        $from = max($branch['from'], (int) $sitting->from_minute);
        $to = min($branch['to'], (int) $sitting->to_minute);

        if ($to - $from < $this->rules->slotMinutes()) {
            throw ProblemException::of(
                'dizi.unavailable',
                'That sitting has no slots in it',
                503,
                'Doctor '.$sitting->name.' sits from '.$this->clock((int) $sitting->from_minute).' to '.$this->clock((int) $sitting->to_minute)
                .', and the branch\'s OPD window is '.$this->clock($branch['from']).' to '.$this->clock($branch['to']).'. The two do not leave one '
                .$this->rules->slotMinutes().'-minute slot between them, which is a roster that needs correcting in Setup rather than a booking the desk can make.',
            );
        }

        return ['from' => $from, 'to' => $to];
    }

    /** The instant a local day and minute-of-day name. */
    public function slotStart(string $day, int $minute): Carbon
    {
        return Carbon::parse($day.' 00:00:00', $this->timezone())->addMinutes($minute);
    }

    /** The local day an instant falls on. */
    public function dayOf(string $start): string
    {
        return Carbon::parse($start)->setTimezone($this->timezone())->toDateString();
    }

    /** The local minute-of-day an instant falls on. */
    public function minuteOf(string $start): int
    {
        $local = Carbon::parse($start)->setTimezone($this->timezone());

        return ((int) $local->format('G')) * 60 + (int) $local->format('i');
    }

    public function today(): string
    {
        return Date::now($this->timezone())->toDateString();
    }

    public function shift(string $day, int $days): string
    {
        return Carbon::parse($day.' 00:00:00', $this->timezone())->addDays($days)->toDateString();
    }

    public function timezone(): string
    {
        return $this->rules->timezone();
    }

    /**
     * The slot step, from the rule set.
     *
     * One number, three readers — this class's grid, the diary's duration arithmetic and the calendar these two
     * answer — and the seam is where it is read from. A caller that reaches into `$this->rules` for it, or that
     * carries its own copy of 15, is a caller that can disagree with the grid about how long a consultation is.
     */
    public function slotMinutes(): int
    {
        return $this->rules->slotMinutes();
    }

    /**
     * The instant as the column will read it back.
     *
     * Three ways of writing one moment, and each is the right one for where it goes: `day` and `start_minute` are the
     * branch's own clock because that is what a desk says out loud, this is the service's clock because Laravel reads
     * a datetime column back in `config('app.timezone')` and a different zone here would move every appointment by
     * the difference, and `ApiTime::iso()` puts the offset on it for the wire. Nothing in this module reads the
     * service's zone except this line, so the store and the read agree whichever zone the deployment runs in.
     */
    public function stored(Carbon $instant): Carbon
    {
        return $instant->setTimezone((string) config('app.timezone'));
    }

    /** A minute-of-day as a clock face, for the sentences a refusal says out loud. */
    public function clock(int $minute): string
    {
        return sprintf('%02d:%02d', intdiv($minute, 60), $minute % 60);
    }

    /**
     * The starts on the grid, from the window's opening to the last one that fits.
     *
     * @return list<int>
     */
    private function starts(array $window): array
    {
        $starts = [];
        $step = $this->rules->slotMinutes();

        for ($minute = $window['from']; $minute + $step <= $window['to']; $minute += $step) {
            $starts[] = $minute;
        }

        return $starts;
    }

    /**
     * The day's slots, with what holds each one.
     *
     * @param  list<Appointment>  $held
     * @return list<array<string, mixed>>
     */
    private function slots(string $day, array $window, array $held): array
    {
        $slots = [];

        foreach ($this->starts($window) as $minute) {
            $holder = $this->holderAt($held, $minute);
            $slot = ['start' => ApiTime::iso($this->slotStart($day, $minute)), 'minutes' => $minute, 'state' => 'free'];

            if ($holder !== null) {
                $slot['state'] = 'booked';
                $slot['appointmentId'] = (string) $holder->id;
                $slot['token'] = (string) $holder->token;
                $slot['durationMin'] = (int) $holder->duration_min;
            }

            $slots[] = $slot;
        }

        return $slots;
    }

    /**
     * The appointments holding a slot on a day.
     *
     * `HOLDING` rather than "not cancelled": an appointment whose patient is in the room still holds its slot until
     * the visit is settled, because the calendar's job is to show the desk why 10:15 is not bookable yet.
     *
     * @return list<Appointment>
     */
    private function claimsFor(string $doctorId, string $day, ?string $excludeAppointmentId): array
    {
        $key = $doctorId.'|'.$day.'|'.($excludeAppointmentId ?? '-');

        if (isset($this->claims[$key])) {
            return $this->claims[$key];
        }

        return $this->claims[$key] = Appointment::query()
            ->where('doctor_id', $doctorId)
            ->where('day', $day)
            ->whereIn('status', Appointment::HOLDING)
            ->when($excludeAppointmentId !== null, fn ($query) => $query->where('id', '!=', $excludeAppointmentId))
            ->orderBy('start_minute')
            ->get()
            ->all();
    }

    /** The appointment whose claimed range covers a slot, if one does. */
    private function holderAt(array $held, int $minute): ?Appointment
    {
        foreach ($held as $appointment) {
            $start = (int) $appointment->start_minute;

            if ($minute >= $start && $minute < $start + (int) $appointment->duration_min) {
                return $appointment;
            }
        }

        return null;
    }

    /** Whether a start can take a claim of `steps` slots, checked against the full claim rather than its first slot. */
    private function isFree(string $doctorId, string $day, int $startMinute, int $steps): bool
    {
        $step = $this->rules->slotMinutes();
        $held = $this->claimsFor($doctorId, $day, null);

        for ($i = 0; $i < $steps; $i++) {
            if ($this->holderAt($held, $startMinute + $i * $step) !== null) {
                return false;
            }
        }

        return true;
    }
}
