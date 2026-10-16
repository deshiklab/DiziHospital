<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Scheduling\Appointment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\Support\BooksAppointments;
use Tests\TestCase;

/**
 * Booking a slot: the grid, the claim, and the conflict the desk has to answer.
 *
 * The DoD for this slice is "conflict prompt verified", and the shape of that here is deliberate: the conflict case
 * does not stop at asserting a 409 with a list in it — it takes the first time the refusal offered and books it, so a
 * prompt whose alternatives cannot actually be booked fails the suite rather than a usability test six weeks later.
 *
 * Every case runs against a frozen clock, because a booking is checked against a horizon and a weekday: a suite that
 * runs on a Friday cannot test an open Tuesday without one.
 */
final class AppointmentBookingTest extends TestCase
{
    use BooksAppointments;
    use RefreshDatabase;

    public function test_a_booking_claims_the_slot_and_writes_the_ticket_to_the_ledger(): void
    {
        $this->patient();

        $response = $this->asRole()
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])
            ->assertCreated()
            ->assertJsonPath('token', 'A-001')
            ->assertJsonPath('status', 'Confirmed')
            ->assertJsonPath('room', 'OPD-1')
            ->assertJsonPath('doctorId', 'dr-rahman')
            ->assertJsonPath('steps', 3)
            ->assertJsonPath('durationMin', 45)
            ->assertJsonPath('origin', 'Main Campus')
            /* A record read back from the service is the branch's, never the outbox's. */
            ->assertJsonPath('queued', false)
            /* The instant is UTC on the wire, whatever the branch's clock said. */
            ->assertJsonPath('start', '2026-11-03T03:00:00+00:00');

        $id = (string) $response->json('id');

        $this->assertDatabaseHas('scheduling_appointments', [
            'id' => $id,
            'day' => self::TUESDAY,
            'start_minute' => 540,
            'slot_key' => 'dr-rahman@2026-11-03T0540',
        ]);

        /* The local reading and the instant are written together, so they cannot disagree. */
        $this->assertSame('2026-11-03 03:00:00', Appointment::query()->find($id)?->getRawOriginal('start_at'));

        $this->assertDatabaseHas('audit_entries', [
            'node' => 'node-test',
            'actor' => 'staff-7',
            'action' => 'appointment.book',
            'entity' => 'appointment',
            'record_id' => $id,
        ]);
    }

    public function test_a_replayed_booking_under_one_key_is_one_appointment(): void
    {
        $this->patient();
        $key = $this->key('a01');

        $first = $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $key])->assertCreated();
        $replay = $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $key])->assertCreated();

        $this->assertSame($first->json('id'), $replay->json('id'));
        $this->assertSame('true', $replay->headers->get('X-Dizi-Replay'));
        $this->assertSame(1, Appointment::query()->count());
    }

    public function test_the_second_booking_of_a_slot_is_refused_with_the_alternatives_the_desk_can_use(): void
    {
        $this->patient();

        $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])->assertCreated();

        $refusal = $this->asRole()
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a02')])
            ->assertStatus(409)
            ->assertJsonPath('title', 'That slot has just been taken')
            ->assertJsonPath('heldBy', 'Main Campus')
            ->assertJsonPath('requestedBy', 'Main Campus')
            ->assertJsonPath('slot', '2026-11-03T03:00:00+00:00');

        /* The app branches on the code at the tail of the type, which is the contract's own spelling of it. */
        $this->assertStringEndsWith('dizi.slot-taken', (string) $refusal->json('type'));

        $alternatives = $refusal->json('alternatives');
        $this->assertIsArray($alternatives);
        $this->assertCount(3, $alternatives);
        /* The consultation claims three steps, so the next free start is the minute after the block, not the next
           step: 09:45 for a 09:00 booking of 45 minutes. */
        $this->assertSame('2026-11-03T03:45:00+00:00', $alternatives[0]['start']);
        $this->assertSame(self::TUESDAY, $alternatives[0]['day']);

        /* The prompt is only worth showing the desk if what it offers can be booked. */
        $this->asRole()
            ->postJson('/appointments', $this->booking(['start' => $alternatives[0]['start']]), ['Idempotency-Key' => $this->key('a03')])
            ->assertCreated()
            ->assertJsonPath('token', 'A-002');

        $this->assertSame(2, Appointment::query()->count());
    }

    public function test_the_branch_that_took_the_booking_keeps_the_slot(): void
    {
        $this->patient();

        $this->asRole('receptionist', ['branch' => 'Satellite OPD'])
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])
            ->assertCreated()
            ->assertJsonPath('origin', 'Satellite OPD');

        $this->asRole()
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a02')])
            ->assertStatus(409)
            ->assertJsonPath('heldBy', 'Satellite OPD')
            ->assertJsonPath('requestedBy', 'Main Campus');
    }

    public function test_a_start_that_is_not_on_the_grid_is_refused_with_a_time_that_is(): void
    {
        $this->patient();

        $refusal = $this->asRole()
            ->postJson('/appointments', $this->booking(['start' => self::TUESDAY.'T09:07:00+06:00']), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That time is not on the slot grid');

        $this->assertStringContainsString('Book 09:00 instead', (string) $refusal->json('detail'));
        $this->assertSame(0, Appointment::query()->count());
    }

    public function test_a_friday_is_refused_and_the_reason_names_the_day(): void
    {
        $this->patient();

        $refusal = $this->asRole()
            ->postJson('/appointments', $this->booking(['start' => self::FRIDAY.'T09:00:00+06:00']), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That day cannot be booked');

        $this->assertStringContainsString('Friday', (string) $refusal->json('detail'));
        $this->assertSame(0, Appointment::query()->count());
    }

    public function test_a_date_past_the_horizon_is_refused_rather_than_promised(): void
    {
        $this->patient();

        $refusal = $this->asRole()
            ->postJson('/appointments', $this->booking(['start' => self::BEYOND_HORIZON.'T09:00:00+06:00']), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That day is beyond the booking horizon');

        $this->assertStringContainsString('30 days ahead', (string) $refusal->json('detail'));
        $this->assertSame(0, Appointment::query()->count());
    }

    public function test_an_unknown_doctor_is_refused_rather_than_given_the_first_sitting(): void
    {
        $this->patient();

        $this->asRole()
            ->postJson('/appointments', $this->booking(['doctorId' => 'dr-nobody']), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'That doctor has no sitting');

        $this->assertSame(0, Appointment::query()->count());
    }

    public function test_a_booking_against_an_mrn_nobody_registered_is_a_field_the_desk_can_correct(): void
    {
        $this->reserve();

        $this->asRole()
            ->postJson('/appointments', $this->booking(['mrn' => 'MRN-000404']), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(422)
            ->assertJsonPath('title', 'Some fields need attention')
            ->assertJsonPath('errors.0.field', 'mrn');

        $this->assertSame(0, Appointment::query()->count());
    }

    public function test_the_days_diary_lists_the_appointments_of_every_doctor_on_this_node(): void
    {
        $this->patient();

        $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])->assertCreated();
        $this->asRole()->postJson('/appointments', $this->booking(['doctorId' => 'dr-islam']), ['Idempotency-Key' => $this->key('a02')])->assertCreated();

        $this->asRole()->getJson('/appointments?day='.self::TUESDAY)
            ->assertOk()
            ->assertJsonCount(2, 'rows')
            /* The diary is ordered by doctor and then by time, which is the order the day runs in. */
            ->assertJsonPath('rows.0.doctorId', 'dr-islam')
            ->assertJsonPath('rows.1.doctorId', 'dr-rahman');

        $this->asRole()->getJson('/appointments?day='.self::TUESDAY.'&doctorId=dr-islam')
            ->assertOk()
            ->assertJsonCount(1, 'rows')
            ->assertJsonPath('rows.0.mrn', 'MRN-000001')
            /* Dr. Islam's cardiology clinic claims four steps rather than three. */
            ->assertJsonPath('rows.0.durationMin', 60);
    }

    public function test_the_day_list_carries_the_registers_projection_of_the_patient(): void
    {
        $this->patient();

        $booked = $this->asRole()
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])
            ->assertCreated();

        /* The booking answers with the same projection the day list does, so a screen that has just taken a slot can
           print the name it was given without a second request. */
        $this->assertSame('Rahima Begum', $booked->json('patient.name'));
        $this->assertSame('রহিমা বেগম', $booked->json('patient.nameBn'));
        $this->assertSame('MRN-000001', $booked->json('patient.mrn'));

        $this->asRole()->getJson('/appointments?day='.self::TUESDAY)
            ->assertOk()
            ->assertJsonPath('rows.0.patient.name', 'Rahima Begum')
            ->assertJsonPath('rows.0.patient.sex', 'Female')
            ->assertJsonPath('rows.0.patient.phone', '01711000001')
            /* Fields the register does not have are absent rather than invented: this patient has no allergy recorded
               and the screen must be able to tell "none known" from "not asked". */
            ->assertJsonPath('rows.0.patient.allergies', null);
    }

    public function test_the_inbox_query_asks_the_server_for_the_requests_nobody_has_answered(): void
    {
        $this->patient();
        $taken = $this->booked([], 'a01');
        $walkIn = $this->booked(['doctorId' => 'dr-islam', 'source' => 'Walk-in'], 'a02');

        /* A portal request is an appointment in the contract's own `Requested` state with the portal as its source.
           Only `POST /portal/appointments` creates one in production — it is the cloud's operation and this branch
           does not serve it yet — so the suite writes the row the portal will write. */
        $requested = $this->booked(['doctorId' => 'dr-hossain', 'source' => 'Online portal'], 'a03');
        Appointment::query()->where('id', $requested)->update(['status' => 'Requested']);

        $inbox = $this->asRole()->getJson('/appointments?day='.self::TUESDAY.'&source=Online portal&status=Requested')
            ->assertOk()
            ->assertJsonCount(1, 'rows')
            ->assertJsonPath('rows.0.id', $requested)
            ->assertJsonPath('rows.0.status', 'Requested')
            ->assertJsonPath('rows.0.source', 'Online portal');

        /* Two filters are two conditions, not one: the walk-in is in the day but not in the inbox, and the answered
           booking is in neither. */
        $this->assertNotSame('', $taken);
        $this->assertNotSame('', $walkIn);
        $this->asRole()->getJson('/appointments?day='.self::TUESDAY.'&status=Requested')
            ->assertOk()
            ->assertJsonCount(1, 'rows')
            ->assertJsonPath('rows.0.id', $requested);
    }

    public function test_the_queue_board_asks_for_the_states_a_patient_is_actually_in_the_queue_for(): void
    {
        $this->patient();
        $first = $this->booked([], 'a01');
        $second = $this->booked(['start' => self::TUESDAY.'T11:00:00+06:00'], 'a02');

        $this->asRole()->postJson('/appointments/'.$first.'/check-in', [], ['Idempotency-Key' => $this->key('k01')])->assertOk();

        $this->asRole()->getJson('/appointments?day='.self::TUESDAY.'&status=Checked in')
            ->assertOk()
            ->assertJsonCount(1, 'rows')
            ->assertJsonPath('rows.0.id', $first);

        /* The board is more than one state, and a filter that took only a single word would be the wrong shape for
           it — so the app asks per status and the API answers per status. What the API refuses to do is invent a
           combined state the contract does not name. */
        $this->asRole()->getJson('/appointments?day='.self::TUESDAY.'&status=Checked in,Waiting')
            ->assertOk()
            ->assertJsonCount(0, 'rows');
        $this->assertNotSame('', $second);
    }

    public function test_the_slot_list_draws_the_grid_and_marks_the_whole_claimed_block(): void
    {
        $this->patient();

        $this->asRole()->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])->assertCreated();

        $day = $this->asRole()->getJson('/appointments/slots?day='.self::TUESDAY.'&doctorId=dr-rahman')
            ->assertOk()
            ->assertJsonPath('open', true)
            ->assertJsonPath('room', 'OPD-1')
            ->assertJsonPath('slotMinutes', 15)
            ->assertJsonPath('window.from', 540)
            ->assertJsonPath('window.to', 840)
            ->assertJsonCount(20, 'slots')
            ->assertJsonPath('slots.0.start', '2026-11-03T03:00:00+00:00')
            ->assertJsonPath('slots.0.minutes', 540)
            ->assertJsonPath('slots.0.state', 'booked')
            ->assertJsonPath('slots.0.token', 'A-001')
            ->assertJsonPath('slots.0.durationMin', 45)
            /* Three steps at fifteen minutes: 09:00, 09:15 and 09:30 are held, and 09:45 is the first free start. */
            ->assertJsonPath('slots.2.state', 'booked')
            ->assertJsonPath('slots.3.state', 'free');

        $this->assertNull($day->json('closedBecause'));
        $this->assertSame(825, $day->json('slots.19.minutes'));
        $this->assertNotNull($day->json('asOf'));
    }

    public function test_a_closed_day_is_an_empty_grid_with_the_reason_rather_than_an_error(): void
    {
        $this->patient();

        $day = $this->asRole()->getJson('/appointments/slots?day='.self::FRIDAY.'&doctorId=dr-rahman')
            ->assertOk()
            ->assertJsonPath('open', false)
            ->assertJsonCount(0, 'slots');

        $this->assertStringContainsString('Friday', (string) $day->json('closedBecause'));
    }

    public function test_the_slots_of_a_move_leave_out_the_appointment_being_moved(): void
    {
        $this->patient();
        $id = $this->booked();

        /* The desk rescheduling an appointment is asking for the times *it* could take, so its own slot must not be
           offered as the booked one holding the slot it currently holds. */
        $this->asRole()->getJson('/appointments/slots?day='.self::TUESDAY.'&doctorId=dr-rahman&excludeAppointmentId='.$id)
            ->assertOk()
            ->assertJsonPath('slots.0.state', 'free')
            ->assertJsonPath('slots.0.appointmentId', null);
    }

    public function test_a_slot_list_without_a_doctor_is_a_400_rather_than_a_422(): void
    {
        $this->asRole()->getJson('/appointments/slots?day='.self::TUESDAY)
            ->assertStatus(400)
            ->assertJsonPath('errors.0.field', 'doctorId');

        $this->asRole()->getJson('/appointments/slots?day=tuesday&doctorId=dr-rahman')
            ->assertStatus(400)
            ->assertJsonPath('errors.0.field', 'day');
    }

    public function test_a_role_that_may_only_read_cannot_take_a_booking(): void
    {
        $this->patient();

        $this->asRole('auditor')
            ->postJson('/appointments', $this->booking(), ['Idempotency-Key' => $this->key('a01')])
            ->assertStatus(403)
            ->assertJsonPath('title', 'Your role cannot do this');

        $this->assertSame(0, Appointment::query()->count());
    }

    protected function setUp(): void
    {
        parent::setUp();

        /* 2026-11-02 is a Monday, so the Tuesday below is open, the Friday is closed and the December date is past
           the thirty-day horizon — the three refusals this file is about. */
        Carbon::setTestNow(Carbon::parse('2026-11-02 08:00:00', 'Asia/Dhaka'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }
}
