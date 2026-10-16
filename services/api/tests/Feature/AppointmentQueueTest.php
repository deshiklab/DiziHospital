<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Scheduling\Appointment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Support\BooksAppointments;
use Tests\TestCase;

/**
 * What the desk does to a booking after it is taken: move it, cancel it, mark it a no-show, check the patient in.
 *
 * The cases that matter here are the ones where half an action would be worse than none: a move that claims the new
 * slot and fails to release the old one leaves two patients in one chair, and a cancellation that does not release
 * its slot leaves a morning with a hole in it that nobody can book. Both are asserted on the row rather than on the
 * response, because the response is what the service *said* and the row is what happened.
 */
final class AppointmentQueueTest extends TestCase
{
    use BooksAppointments;
    use RefreshDatabase;

    public function test_cancelling_releases_the_slot_and_the_number_is_never_given_to_another_patient(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Cancelled', 'because' => 'She telephoned to say she cannot come'], ['Idempotency-Key' => $this->key('c01')])
            ->assertOk()
            ->assertJsonPath('status', 'Cancelled');

        /* NULL is what releases the slot: a unique index lets a NULL happen more than once, and that is the whole
           exclusivity rule. The token is kept — a number already called out is not reissued. */
        $this->assertDatabaseHas('scheduling_appointments', ['id' => $id, 'slot_key' => null, 'token' => 'A-001']);

        $this->asRole()
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a02')])
            ->assertCreated()
            ->assertJsonPath('token', 'A-002');
    }

    public function test_a_cancelled_appointment_is_not_cancelled_twice_into_a_second_reason(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');
        $this->cancel($id, 'c01');

        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Cancelled', 'because' => 'Changed my mind again'], ['Idempotency-Key' => $this->key('c02')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That appointment is already cancelled');
    }

    public function test_a_patch_that_moves_and_cancels_at_once_is_refused(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()
            ->patchJson('/appointments/'.$id, [
                'status' => 'Cancelled',
                'start' => self::TUESDAY.'T10:00:00+06:00',
                'because' => 'Both, please',
            ], ['Idempotency-Key' => $this->key('c01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'A cancellation is not a move');

        /* Nothing was written: the appointment still holds its original slot. */
        $this->assertDatabaseHas('scheduling_appointments', ['id' => $id, 'status' => 'Confirmed', 'slot_key' => 'dr-rahman@2026-11-03T0540']);
    }

    public function test_a_move_claims_the_new_slot_and_releases_the_old_one(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()
            ->patchJson('/appointments/'.$id, [
                'status' => 'Confirmed',
                'start' => self::TUESDAY.'T10:00:00+06:00',
                'because' => 'The doctor is in theatre at nine',
            ], ['Idempotency-Key' => $this->key('c01')])
            ->assertOk()
            ->assertJsonPath('start', '2026-11-03T04:00:00+00:00');

        $this->assertDatabaseHas('scheduling_appointments', [
            'id' => $id,
            'slot_key' => 'dr-rahman@2026-11-03T0600',
            'start_minute' => 600,
        ]);

        /* The morning slot it left is bookable again, which is the half of the move a claim-first implementation can
           forget. */
        $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a02')])->assertCreated();
    }

    public function test_a_move_onto_a_slot_somebody_else_holds_leaves_the_original_booking_where_it_was(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');
        $this->asRole()->postJson('/appointments', $this->booking(['start' => self::TUESDAY.'T10:00:00+06:00']), ['Idempotency-Key' => $this->key('a02')])->assertCreated();

        $this->asRole()
            ->patchJson('/appointments/'.$id, [
                'status' => 'Confirmed',
                'start' => self::TUESDAY.'T10:00:00+06:00',
                'because' => 'A slot swap',
            ], ['Idempotency-Key' => $this->key('c01')])
            ->assertStatus(409)
            ->assertJsonPath('title', 'That slot has just been taken')
            ->assertJsonPath('heldBy', 'Main Campus');

        $this->assertDatabaseHas('scheduling_appointments', [
            'id' => $id,
            'slot_key' => 'dr-rahman@2026-11-03T0540',
            'start_minute' => 540,
        ]);
    }

    public function test_the_board_moves_a_patient_through_the_queue_and_the_ledger_keeps_each_step(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()->postJson('/appointments/'.$id.'/check-in', [], ['Idempotency-Key' => $this->key('k01')])->assertOk();

        /* Checked in → waiting → in consultation → completed, one write each, and a reason on each. */
        foreach ([['Waiting', 'q01'], ['In consultation', 'q02'], ['Completed', 'q03']] as [$to, $key]) {
            $this->asRole()
                ->patchJson('/appointments/'.$id, ['status' => $to, 'because' => 'Nurse moved the token'], ['Idempotency-Key' => $this->key($key)])
                ->assertOk()
                ->assertJsonPath('status', $to);
        }

        $this->assertDatabaseHas('scheduling_appointments', ['id' => $id, 'status' => 'Completed']);
        /* Five steps in the ledger, in order: the booking itself and the four moves. A board that reports timings
           nobody recorded is a board nobody can audit, so the *actions* are asserted rather than a count — a count of
           five is also what a booking and four copies of one move would produce. */
        $this->assertSame(
            ['appointment.book', 'appointment.check-in', 'appointment.queue', 'appointment.queue', 'appointment.queue'],
            DB::table('audit_entries')->where('record_id', $id)->orderBy('id')->pluck('action')->all(),
        );
    }

    public function test_every_status_the_contract_allows_is_a_value_this_field_accepts(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        /* The words the contract's enum defines, and the two the machine will actually write on this row last: a
           patch that is refused does not change the row, so every one of these can be asked of the same appointment —
           which is what makes this a test of the *field* rather than of the state machine. */
        $vocabulary = ['Requested', 'Confirmed', 'Checked in', 'Waiting', 'In consultation', 'Completed', 'Cancelled', 'No show'];

        foreach ($vocabulary as $index => $status) {
            $answer = $this->asRole()->patchJson('/appointments/'.$id, [
                'status' => $status,
                'because' => 'Checking the vocabulary',
            ], ['Idempotency-Key' => $this->key('v'.$index)]);

            $this->assertContains($answer->status(), [200, 422], "`{$status}` was not accepted as a word this field can carry.");

            /* A 422 here must be the service's own refusal — a sentence about where the appointment is, or that it
               is already finished — and never a field error: the contract says the word is valid, so a validation
               failure that names `status` is the service disagreeing with its own contract. The refusal's *title* is
               not asserted, because which sentence is right depends on where the row has got to by then; what is
               asserted is that the field itself was never the problem. */
            if ($answer->status() === 422) {
                $named = array_filter(
                    $answer->json('errors') ?? [],
                    static fn (array $error): bool => ($error['field'] ?? null) === 'status',
                );

                $this->assertSame([], array_values($named), "`{$status}` is in the contract's enum and was refused as a malformed field.");
            }
        }

        /* And a word nobody defined is a field error, which is the other half of the same rule. */
        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Paged', 'because' => 'Not a status'], ['Idempotency-Key' => $this->key('vbad')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'Some fields need attention')
            ->assertJsonPath('errors.0.field', 'status');
    }

    public function test_a_finished_appointment_is_not_moved_backwards(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        Appointment::query()->where('id', $id)->update(['status' => 'In consultation']);

        /* The one refusal a board has to make in the room: a patient already with the doctor cannot be put back in
           the waiting line, because the line would then call them twice. */
        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Waiting', 'because' => 'Back to the queue'], ['Idempotency-Key' => $this->key('q01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That is not the next step for this appointment')
            ->assertJsonPath('status', 422);

        $this->assertDatabaseHas('scheduling_appointments', ['id' => $id, 'status' => 'In consultation']);
    }

    public function test_a_confirmed_patient_cannot_be_moved_into_the_queue_without_arriving(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        /* Being in the queue is what arriving means: the desk records it with a check-in, and the board would count a
           patient twice if a status change could do it without one. */
        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Waiting', 'because' => 'Put them in the line'], ['Idempotency-Key' => $this->key('q01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That is not the next step for this appointment');

        $this->asRole()
            ->postJson('/appointments/'.$id.'/check-in', [], ['Idempotency-Key' => $this->key('k01')])
            ->assertOk()
            ->assertJsonPath('status', 'Checked in');
    }

    public function test_a_no_show_keeps_the_slot_and_asks_for_a_reason(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'No show', 'because' => 'Called three times, no answer'], ['Idempotency-Key' => $this->key('c01')])
            ->assertOk()
            ->assertJsonPath('status', 'No show');

        /* A no-show still holds its slot for the day: the calendar's job is to say why 09:00 is not bookable, and
           "the patient did not come" is a truer answer than a slot that quietly looks free. */
        $this->assertDatabaseHas('scheduling_appointments', ['id' => $id, 'slot_key' => 'dr-rahman@2026-11-03T0540']);

        $this->assertDatabaseHas('audit_entries', ['action' => 'appointment.no-show', 'entity' => 'appointment', 'record_id' => $id]);
    }

    public function test_check_in_puts_the_patient_in_the_queue_once(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        $this->asRole()
            ->postJson('/appointments/'.$id.'/check-in', [], ['Idempotency-Key' => $this->key('k01')])
            ->assertOk()
            ->assertJsonPath('status', 'Checked in');

        $this->assertNotNull(Appointment::query()->find($id)?->checked_in_at);

        $this->asRole()
            ->postJson('/appointments/'.$id.'/check-in', [], ['Idempotency-Key' => $this->key('k02')])
            ->assertStatus(409)
            ->assertJsonPath('title', 'This patient is already checked in')
            /* The refusal says which token it is about, so the desk can answer the patient in front of them. */
            ->assertJsonPath('token', 'A-001');
    }

    public function test_a_cancelled_appointment_has_nobody_to_check_in(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');
        $this->cancel($id, 'c01');

        $this->asRole()
            ->postJson('/appointments/'.$id.'/check-in', [], ['Idempotency-Key' => $this->key('k01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That appointment is not coming');
    }

    public function test_a_settled_visit_is_not_moved_or_cancelled_afterwards(): void
    {
        $this->patient();
        $id = $this->booked([], 'a01');

        /* The visit happened: the record is now a description of the past rather than a promise about the future. */
        Appointment::query()->where('id', $id)->update(['status' => 'Completed']);

        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Cancelled', 'because' => 'The patient went home'], ['Idempotency-Key' => $this->key('c01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That appointment is settled');
    }

    public function test_an_appointment_this_node_does_not_have_is_a_404_that_says_where_to_look(): void
    {
        $this->asRole()
            ->patchJson('/appointments/01J0000000000000000000000', ['status' => 'Cancelled', 'because' => 'Never booked here'], ['Idempotency-Key' => $this->key('c01')])
            ->assertStatus(404)
            ->assertJsonPath('title', 'Not found here');
    }

    public function test_a_write_without_an_idempotency_key_is_refused_rather_than_applied(): void
    {
        $this->patient();

        /* The contract says this write is queued, so it must be replayable: a node that sends one without a key has
           no way to know whether it was applied, and neither would this service. */
        $this->asRole()
            ->postJson('/appointments', $this->booking())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'Idempotency-Key');

        $this->assertSame(0, Appointment::query()->count());
    }

    /** Cancel an appointment the way the desk does, and insist that it worked. */
    private function cancel(string $id, string $key): void
    {
        $this->asRole()
            ->patchJson('/appointments/'.$id, ['status' => 'Cancelled', 'because' => 'The patient cannot come'], ['Idempotency-Key' => $this->key($key)])
            ->assertOk();
    }

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow(Carbon::parse('2026-11-02 08:00:00', 'Asia/Dhaka'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }
}
