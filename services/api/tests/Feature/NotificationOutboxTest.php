<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Identity\Actor;
use App\Modules\Messaging\Consent;
use App\Modules\Messaging\Delivery;
use App\Modules\Messaging\Outbox;
use App\Modules\Messaging\OutboxEvent;
use App\Support\ProblemException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The outbox: the events a hospital's own records raise, and what the drain does with them.
 *
 * **Nothing raises an event in production yet** — the records that do (a paid invoice, a released result, a shelf below
 * its re-order level) belong to modules this slice does not build — so these cases raise them through the module's own
 * method and drain them, which is what makes the mechanism proved rather than described. Every outcome the catalogue
 * names is here, and the ones that are not "sent" are the interesting ones:
 *
 *  · a value the wording needs and the event did not carry is a **suppression** naming the placeholder, never a
 *    sentence with a hole in it;
 *  · a patient with no consent is a **suppression**, not a failure, and the event is not retried into the same refusal
 *    every five minutes;
 *  · quiet hours leave the event **pending** with a due time of the hour the window closes;
 *  · a channel the node cannot carry is a **failed attempt** with the refusal in the log, and the event backs off.
 *
 * The one case that runs the command itself is there because an operator runs the command: a worker that can only be
 * tested by calling the method is a worker nobody has seen start.
 */
final class NotificationOutboxTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow(Carbon::parse('2026-11-03 09:00:00', 'Asia/Dhaka'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_an_event_raised_inside_a_write_is_sent_by_the_drain(): void
    {
        $this->consent('MRN-000001', 'whatsapp', '01711000678');

        $event = $this->outbox()->raise('appointment.booked', 'MRN-000001', [
            'patient' => 'Rahima Begum',
            'day' => '2026-11-04',
            'doctor' => 'Dr. A. Rahman',
            'token' => 'A-014',
            'room' => 'OPD-1',
        ], $this->actor());

        $this->assertSame('pending', $event->state);
        $this->assertSame(5, (int) $event->within_minutes, 'The deadline is the catalogue’s own promise for this topic.');

        $counts = $this->outbox()->drain();

        $this->assertSame(['attempted' => 1, 'sent' => 1, 'suppressed' => 0, 'failed' => 0, 'quiet' => 0, 'late' => 0], $counts);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('sent', $delivery->status);
        $this->assertSame('preview', $delivery->provider, 'No gateway is configured here, and the row says so.');
        $this->assertSame('appointment.booked', $delivery->topic);
        $this->assertSame('appointment-booked', $delivery->template);
        $this->assertSame('bn', $delivery->language, 'Bangla-first: the record carries no language, so the branch’s is used.');
        $this->assertTrue((bool) $delivery->patient_facing);
        $this->assertSame((string) $event->id, (string) $delivery->event_id);
        $this->assertStringContainsString('A-014', (string) $delivery->body);
        $this->assertStringNotContainsString('{{', (string) $delivery->body, 'A message with a placeholder still in it is the defect this drain exists to refuse.');

        $this->assertSame('sent', OutboxEvent::query()->findOrFail((string) $event->id)->state);

        /* The command an operator runs does the same thing and exits cleanly. */
        $this->artisan('dizi:notify')->assertSuccessful();
    }

    public function test_a_value_the_wording_needs_and_the_event_did_not_carry_refuses_the_message(): void
    {
        $this->consent('MRN-000001', 'whatsapp', '01711000678');

        /* The token is missing: the wording says `{{token}}` and the event never carried one. */
        $this->outbox()->raise('appointment.booked', 'MRN-000001', [
            'patient' => 'Rahima Begum',
            'day' => '2026-11-04',
            'doctor' => 'Dr. A. Rahman',
            'room' => 'OPD-1',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['suppressed']);
        $this->assertSame(0, $counts['sent']);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('suppressed', $delivery->status);
        $this->assertSame('dizi.template-incomplete', $delivery->error_code);
        $this->assertStringContainsString('{{token}}', (string) $delivery->detail);
        /* The row carries no sentence: the service renders nothing rather than sending `{{token}}`, and the column
           holds that as an empty body — the difference between "" and null is the database's, not the reader's. */
        $this->assertStringNotContainsString('{{', (string) $delivery->body);
        $this->assertSame('', trim((string) $delivery->body), 'A suppression whose wording could not be filled says nothing rather than showing a sentence with a hole in it.');
        $this->assertSame('', $delivery->to);
    }

    public function test_a_patient_with_no_consent_is_a_suppression_rather_than_a_failure(): void
    {
        $this->outbox()->raise('appointment.booked', 'MRN-000001', [
            'patient' => 'Rahima Begum',
            'day' => '2026-11-04',
            'doctor' => 'Dr. A. Rahman',
            'token' => 'A-014',
            'room' => 'OPD-1',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['suppressed']);
        $this->assertSame(0, $counts['failed']);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('suppressed', $delivery->status);
        $this->assertSame('dizi.consent-missing', $delivery->error_code);
        /* Nobody agreed to be written to, so the row carries no address at all — a mask over nothing would read as a
           number somebody is hiding. */
        $this->assertSame('', Delivery::mask((string) $delivery->to_address));
        $this->assertFalse($delivery->isRetryable(3), 'Pressing retry does not create consent.');
    }

    public function test_quiet_hours_leave_the_event_pending_until_the_window_closes(): void
    {
        $this->consent('MRN-000001', 'whatsapp', '01711000678');

        /* Twenty to midnight: inside the quiet hours, and the window closes at eight in the morning. */
        Carbon::setTestNow(Carbon::parse('2026-11-03 23:40:00', 'Asia/Dhaka'));

        $event = $this->outbox()->raise('appointment.booked', 'MRN-000001', [
            'patient' => 'Rahima Begum',
            'day' => '2026-11-04',
            'doctor' => 'Dr. A. Rahman',
            'token' => 'A-014',
            'room' => 'OPD-1',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['quiet']);
        $this->assertSame(0, $counts['sent']);

        $event = OutboxEvent::query()->findOrFail((string) $event->id);

        $this->assertSame('pending', $event->state, 'Not dropped: it is due again, and the outbox is where that is held.');
        $this->assertSame(0, (int) $event->attempts, 'Nothing was attempted, so nothing counts against the retry budget.');
        /* 08:00 in Dhaka on the 4th is 02:00 UTC. */
        $this->assertSame('2026-11-04 02:00:00', $event->due_at?->utc()->toDateTimeString());

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('suppressed', $delivery->status);
        $this->assertSame('dizi.quiet-hours', $delivery->error_code);
    }

    public function test_a_channel_this_node_cannot_carry_is_a_failed_attempt_and_a_backoff(): void
    {
        $this->consent('MRN-000001', 'whatsapp', '01711000678');

        /* A driver name nothing implements. The channel is configured, so the send is attempted — and refused by name
           rather than quietly carried by something that sends nothing. */
        config(['dizi.messaging.channels.whatsapp.driver' => 'smoke-signal']);

        $event = $this->outbox()->raise('appointment.booked', 'MRN-000001', [
            'patient' => 'Rahima Begum',
            'day' => '2026-11-04',
            'doctor' => 'Dr. A. Rahman',
            'token' => 'A-014',
            'room' => 'OPD-1',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['failed']);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('failed', $delivery->status);
        $this->assertSame('dizi.unavailable', $delivery->error_code);
        $this->assertSame('smoke-signal', $delivery->provider);

        $event = OutboxEvent::query()->findOrFail((string) $event->id);

        $this->assertSame('pending', $event->state, 'Attempts remain, so the event waits rather than failing.');
        $this->assertSame(1, (int) $event->attempts);
        /* The first backoff in the catalogue is thirty seconds. */
        $this->assertSame(Carbon::now()->addSeconds(30)->utc()->toDateTimeString(), $event->due_at?->utc()->toDateTimeString());
    }

    public function test_a_staff_notification_goes_to_the_hospital_and_says_it_was_not_a_patient(): void
    {
        config(['dizi.messaging.staff_address' => 'store@dizi.example.test']);

        $event = $this->outbox()->raise('stock.low', null, [
            'store' => 'Main Store',
            'item' => 'Paracetamol 500mg',
            'onHand' => '40',
            'reorderLevel' => '100',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['sent']);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('sent', $delivery->status);
        $this->assertSame('stock.low', $delivery->topic);
        $this->assertSame('store@dizi.example.test', $delivery->to_address);
        /* Quiet hours are about a household asleep, and this is a store keeper's shelf: the patient flag is what the
           rule reads. */
        $this->assertFalse((bool) $delivery->patient_facing);
        $this->assertSame('sent', OutboxEvent::query()->findOrFail((string) $event->id)->state);
    }

    public function test_a_staff_notification_with_nowhere_to_go_is_suppressed_with_the_code_that_says_so(): void
    {
        /* No staff address configured: nothing is invented, and the row says which setting is missing. */
        config(['dizi.messaging.staff_address' => '']);

        $this->outbox()->raise('stock.low', null, [
            'store' => 'Main Store',
            'item' => 'Paracetamol 500mg',
            'onHand' => '40',
            'reorderLevel' => '100',
        ], $this->actor());

        $counts = $this->outbox()->drain();

        $this->assertSame(1, $counts['suppressed']);

        $delivery = Delivery::query()->firstOrFail();

        $this->assertSame('dizi.recipient-missing', $delivery->error_code);
        $this->assertStringContainsString('no staff address', (string) $delivery->detail);
    }

    public function test_an_event_that_is_deliberately_quiet_cannot_be_raised_at_all(): void
    {
        try {
            $this->outbox()->raise('encounter.signed', 'MRN-000001', ['patient' => 'Rahima Begum'], $this->actor());
            $this->fail('A signed consultation is not a message to the patient, and raising it should be refused.');
        } catch (ProblemException $refused) {
            $this->assertSame('dizi.validation-failed', $refused->type);
            $this->assertSame(422, $refused->status);
            $this->assertStringContainsString('sends nothing, on purpose', $refused->getMessage());
            $this->assertStringContainsString('the honest place for that decision is the producer', $refused->getMessage());
        }

        try {
            $this->outbox()->raise('appointment.rescheduled', 'MRN-000001', [], $this->actor());
            $this->fail('An event the catalogue does not carry has no wording, and raising it should be refused.');
        } catch (ProblemException $refused) {
            $this->assertStringContainsString('does not notice', $refused->getMessage());
        }

        $this->assertDatabaseCount('messaging_outbox', 0);
        $this->assertDatabaseCount('messaging_deliveries', 0);
    }

    public function test_the_drain_says_nothing_was_due_rather_than_inventing_a_message(): void
    {
        $counts = $this->outbox()->drain();

        $this->assertSame(0, $counts['attempted']);
        $this->assertSame(0, $this->outbox()->pending());
        $this->assertDatabaseCount('messaging_deliveries', 0);

        $this->artisan('dizi:notify')->assertSuccessful();
    }

    /** The drain, as the command resolves it. */
    private function outbox(): Outbox
    {
        return $this->app->make(Outbox::class);
    }

    /** The node and the writer a producer would be: a booking taken at this branch's desk. */
    private function actor(): Actor
    {
        return new Actor(
            id: 'staff-7',
            name: 'Rahima Begum',
            role: 'receptionist',
            branch: 'Main Campus',
            node: 'node-test',
        );
    }

    private function consent(string $mrn, string $channel, string $address): Consent
    {
        return Consent::query()->create([
            'id' => (string) str()->ulid(),
            'mrn' => $mrn,
            'channel' => $channel,
            'address' => $address,
            'ref' => 'consent-'.$channel.'-1',
            'granted_at' => Carbon::now(),
            'recorded_by' => 'staff-7',
            'node' => 'node-test',
            'origin' => 'Main Campus',
        ]);
    }
}
