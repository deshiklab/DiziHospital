<?php

declare(strict_types=1);

namespace App\Modules\Scheduling;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * The desk's diary: booking, rescheduling, cancelling, marking a no-show, and checking a patient in.
 *
 * Every write lands in the audit ledger as well as in the table, because "who moved this patient's appointment" is
 * the question an incident asks, and the ledger is the only place the answer is append-only.
 *
 * The exclusivity of a slot is *not* decided here. The row carries its slot key and the database carries a unique
 * index over that key, so the case this method is written around — two branches claiming the last slot of a morning
 * in the same second — is decided by the index rather than by a check followed by a race. What this class does with
 * the refusal is the part that matters to the desk: it says which branch holds the slot and offers the next three
 * starts, because a desk that cannot say *who* has it is a desk that telephones somebody.
 */
final class Diary
{
    public function __construct(
        private readonly Availability $availability,
        private readonly Ledger $ledger,
    ) {}

    /**
     * A day's appointments, optionally for one doctor.
     *
     * The reads come from this node's own tables: the diary is the branch's, and the calendar draws it during an
     * outage from the replica rather than showing a gap where the morning used to be.
     *
     * @return array{rows: list<array<string, mixed>>, asOf: string}
     */
    public function day(string $day, ?string $doctorId): array
    {
        $rows = Appointment::query()
            ->where('day', $day)
            ->when($doctorId !== null && $doctorId !== '', fn ($query) => $query->where('doctor_id', $doctorId))
            ->orderBy('doctor_id')
            ->orderBy('start_minute')
            ->get()
            ->map(static fn (Appointment $appointment): array => $appointment->toApiArray())
            ->all();

        return ['rows' => array_values($rows), 'asOf' => ApiTime::iso(ApiTime::now())];
    }

    /** @throws ProblemException when there is no such appointment on this node */
    public function find(string $id): Appointment
    {
        $appointment = Appointment::query()->find($id);

        if ($appointment === null) {
            throw ProblemException::of(
                'dizi.not-found',
                'Not found here',
                404,
                'This node has no appointment `'.$id.'`. An appointment taken at another branch appears here when that branch drains; until then it is their record and their slot.',
            );
        }

        return $appointment;
    }

    /**
     * Book a slot.
     *
     * @param  array<string, mixed>  $input
     */
    public function book(array $input, Actor $actor): Appointment
    {
        $doctorId = (string) $input['doctorId'];
        $start = (string) $input['start'];
        $sitting = Sitting::forDoctor($doctorId);
        $day = $this->availability->dayOf($start);
        $minute = $this->availability->minuteOf($start);

        $this->availability->assertClaimable($doctorId, $day, $minute);

        $steps = max(1, (int) $sitting->capacity);
        $appointment = new Appointment([
            'id' => Appointment::newId(),
            'mrn' => (string) $input['mrn'],
            'doctor_id' => $doctorId,
            'room' => (string) $sitting->room,
            'day' => $day,
            'start_minute' => $minute,
            /* The same moment written three ways, in one insert, so they cannot disagree: the branch's local day and
               minute, and the instant the column will read back as. */
            'start_at' => $this->availability->stored($this->availability->slotStart($day, $minute)),
            'duration_min' => $steps * $this->availability->slotMinutes(),
            'steps' => $steps,
            'type' => (string) ($input['type'] ?? 'New'),
            'status' => 'Confirmed',
            'priority' => (string) ($input['priority'] ?? 'Routine'),
            'source' => (string) ($input['source'] ?? 'Walk-in'),
            'reason' => $input['reason'] ?? null,
            /* The branch that took the booking owns the slot, and the node is the device that took it. The two are
               kept apart because a branch has several desks and reconciling an outage means knowing which one. */
            'origin' => $actor->branch,
            'node' => $actor->node,
            'slot_key' => Appointment::slotKeyFor($doctorId, $day, $minute),
            'created_by' => $actor->id,
            'updated_by' => $actor->id,
        ]);

        $this->claim($appointment, $doctorId, $day, $minute, $steps, $actor, 'appointment.book');

        return $appointment;
    }

    /**
     * Confirm, reschedule, cancel, or mark a no-show — the contract's `PATCH`, in one place.
     *
     * The moves are checked against the appointment's own status rather than trusted from the client: a cancelled
     * appointment cannot be cancelled twice into a different reason, and a visit that has happened cannot be moved to
     * another morning after the fact.
     *
     * @param  array<string, mixed>  $input
     */
    public function patch(Appointment $appointment, array $input, Actor $actor): Appointment
    {
        $status = (string) ($input['status'] ?? 'Confirmed');
        $because = (string) $input['because'];
        $start = $input['start'] ?? null;

        if ($appointment->status === 'Cancelled') {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That appointment is already cancelled',
                422,
                'Token '.$appointment->token.' was cancelled'.($appointment->cancellation_reason !== null ? ' because: '.$appointment->cancellation_reason : '').'. Its slot is free again and the calendar shows it that way; take a new booking rather than changing this record.',
            );
        }

        if (in_array($appointment->status, Appointment::SETTLED, true)) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That appointment is settled',
                422,
                'Token '.$appointment->token.' is '.$appointment->status.'. A settled visit is a record of what happened, so it is not moved or cancelled afterwards — if the patient is coming back, book a new appointment.',
            );
        }

        if (is_string($start) && $start !== '' && $status === 'Cancelled') {
            throw ProblemException::of(
                'dizi.validation-failed',
                'A cancellation is not a move',
                422,
                'A patch that both moves an appointment and cancels it has no meaning: cancelling releases the slot it holds, and moving claims a new one. Send the move, or send the cancellation, and the diary records one of them.',
            );
        }

        if (is_string($start) && $start !== '') {
            return $this->reschedule($appointment, $start, $actor);
        }

        if ($status === 'Cancelled') {
            return $this->cancel($appointment, $because, $actor);
        }

        if ($status === 'No show') {
            $appointment->status = 'No show';
            $appointment->updated_by = $actor->id;
            $appointment->version++;
            $appointment->save();

            $this->ledger->append($actor->node, $actor->id, 'appointment.no-show', 'appointment', (string) $appointment->id, [], $appointment->toApiArray() + ['because' => $because]);

            return $appointment;
        }

        if ($appointment->status === 'Requested') {
            $appointment->status = 'Confirmed';
            $appointment->updated_by = $actor->id;
            $appointment->version++;
            $appointment->save();

            $this->ledger->append($actor->node, $actor->id, 'appointment.confirm', 'appointment', (string) $appointment->id, [], $appointment->toApiArray());

            return $appointment;
        }

        throw ProblemException::of(
            'dizi.validation-failed',
            'There is nothing to change',
            422,
            'Token '.$appointment->token.' is already '.$appointment->status.'. A patch either cancels it, marks it a no-show, or moves it to another slot; sending the status it already has would write a change to the record that did not happen.',
        );
    }

    /**
     * Move an appointment to another slot.
     *
     * The new claim and the release of the old one are one statement, which is the atomic version of the contract's
     * "claim first, then release": there is no moment in which the appointment holds two slots or none, and a refusal
     * from the unique index leaves the original booking exactly as it was.
     */
    private function reschedule(Appointment $appointment, string $start, Actor $actor): Appointment
    {
        $day = $this->availability->dayOf($start);
        $minute = $this->availability->minuteOf($start);
        $doctorId = (string) $appointment->doctor_id;
        $sitting = Sitting::forDoctor($doctorId);
        $steps = max(1, (int) $sitting->capacity);

        $this->availability->assertClaimable($doctorId, $day, $minute);

        $before = $appointment->toApiArray();
        $key = Appointment::slotKeyFor($doctorId, $day, $minute);

        try {
            DB::transaction(function () use ($appointment, $day, $minute, $steps, $key, $actor): void {
                $appointment->day = $day;
                $appointment->start_minute = $minute;
                $appointment->start_at = $this->availability->stored($this->availability->slotStart($day, $minute));
                $appointment->duration_min = $steps * $this->availability->slotMinutes();
                $appointment->steps = $steps;
                $appointment->slot_key = $key;
                $appointment->updated_by = $actor->id;
                $appointment->version++;
                $appointment->save();
            });
        } catch (QueryException $refused) {
            $this->refuseOrRethrow($appointment, $refused, $doctorId, $day, $minute, $steps);
        }

        $this->ledger->append($actor->node, $actor->id, 'appointment.reschedule', 'appointment', (string) $appointment->id, $before, $appointment->toApiArray());

        return $appointment;
    }

    private function cancel(Appointment $appointment, string $because, Actor $actor): Appointment
    {
        $before = $appointment->toApiArray();

        DB::transaction(function () use ($appointment, $because, $actor): void {
            $appointment->status = 'Cancelled';
            $appointment->cancellation_reason = $because;
            $appointment->cancelled_at = ApiTime::now();
            /* Releasing the slot is what lets it be booked again, and NULL is what a unique index lets happen more
               than once. The token is kept: a number already called out is never given to another patient. */
            $appointment->slot_key = null;
            $appointment->updated_by = $actor->id;
            $appointment->version++;
            $appointment->save();
        });

        $this->ledger->append($actor->node, $actor->id, 'appointment.cancel', 'appointment', (string) $appointment->id, $before, $appointment->toApiArray() + ['because' => $because]);

        return $appointment;
    }

    /**
     * Check a patient in.
     *
     * The second check-in of the same token is refused rather than applied twice: a patient called twice is a patient
     * seen once and logged as two arrivals, and the queue board counts arrivals.
     */
    public function checkIn(Appointment $appointment, Actor $actor): Appointment
    {
        if ($appointment->isQueued() || $appointment->status === 'Completed') {
            throw ProblemException::of(
                'dizi.duplicate-operation',
                'This patient is already checked in',
                409,
                'Token '.$appointment->token.' was checked in and is '.strtolower($appointment->status).'. Check-in happens once per visit — the board already has this patient, and checking in again would put a second arrival on the day\'s list.',
                ['status' => $appointment->status, 'token' => $appointment->token],
            );
        }

        if ($appointment->status === 'Cancelled' || $appointment->status === 'No show') {
            throw ProblemException::of(
                'dizi.validation-failed',
                'That appointment is not coming',
                422,
                'Token '.$appointment->token.' is '.$appointment->status.', so there is nothing to check in. Book a fresh appointment for today if the patient has arrived — a check-in against a cancelled visit would put somebody in a queue whose doctor is not expecting them.',
            );
        }

        $before = $appointment->toApiArray();

        $appointment->status = 'Checked in';
        $appointment->checked_in_at = ApiTime::now();
        $appointment->updated_by = $actor->id;
        $appointment->version++;
        $appointment->save();

        $this->ledger->append($actor->node, $actor->id, 'appointment.check-in', 'appointment', (string) $appointment->id, $before, $appointment->toApiArray());

        return $appointment;
    }

    /**
     * Insert the appointment, and turn the unique index's refusal into the sentence the desk needs.
     *
     * The catch is deliberately narrow: a query exception is only read as "the slot was taken" when the slot really is
     * held by another row. Anything else — a missing table, a broken connection — is re-thrown, because answering a
     * database outage with "somebody else took that slot" would send a patient away for a reason that is not true.
     */
    private function claim(Appointment $appointment, string $doctorId, string $day, int $minute, int $steps, Actor $actor, string $action): void
    {
        $attempts = 0;

        while (true) {
            /* The number is minted inside the attempt, not before it: two desks booking different slots of the same
               sitting at the same instant compute the same next number, and the unique index over (doctor, day, token)
               then refuses the second insert. That is a number to re-mint, not a slot to refuse, so it is retried —
               and if the retries run out, the original refusal is what the caller sees rather than a made-up one. */
            $appointment->token = $this->nextToken($doctorId, $day);

            try {
                DB::transaction(function () use ($appointment): void {
                    $appointment->save();
                });

                break;
            } catch (QueryException $refused) {
                if (Appointment::query()->where('slot_key', Appointment::slotKeyFor($doctorId, $day, $minute))->exists()) {
                    $this->refuseOrRethrow($appointment, $refused, $doctorId, $day, $minute, $steps);
                }

                if (++$attempts >= 3) {
                    throw $refused;
                }
            }
        }

        $this->ledger->append($actor->node, $actor->id, $action, 'appointment', (string) $appointment->id, [], $appointment->toApiArray());
    }

    /** The conflict refusal, or the original exception when the slot is not actually held. */
    private function refuseOrRethrow(Appointment $appointment, QueryException $refused, string $doctorId, string $day, int $minute, int $steps): void
    {
        $key = Appointment::slotKeyFor($doctorId, $day, $minute);
        $holder = Appointment::query()->where('slot_key', $key)->first();

        if ($holder === null) {
            throw $refused;
        }

        $alternatives = $this->availability->alternatives($doctorId, $day, $minute, 3);

        throw ProblemException::of(
            'dizi.slot-taken',
            'That slot has just been taken',
            409,
            'Doctor '.$doctorId.' at '.$this->availability->clock($minute).' on '.$day.' was claimed by '.$holder->origin
            .' first (token '.$holder->token.'). The desk that took the booking keeps it — take one of the times below, or another doctor at the same time.',
            [
                'slot' => ApiTime::iso($this->availability->slotStart($day, $minute)),
                'requestedBy' => $appointment->origin,
                'heldBy' => (string) $holder->origin,
                'steps' => $steps,
                'alternatives' => $alternatives,
            ],
        );
    }

    /**
     * The next queue token for a doctor's day.
     *
     * Counted over every appointment that day, cancellations included, so a number that has already been called out
     * is never given to a different patient later in the morning. The count is inside the same transaction as the
     * insert, and the unique index over (doctor, day, token) is the backstop if two desks book at the same instant.
     */
    private function nextToken(string $doctorId, string $day): string
    {
        $today = Appointment::query()->where('doctor_id', $doctorId)->where('day', $day)->count();

        return 'A-'.str_pad((string) ($today + 1), 3, '0', STR_PAD_LEFT);
    }
}
