<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Messaging\Consent;
use App\Modules\Messaging\Delivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\Support\BooksAppointments;
use Tests\TestCase;

/**
 * What left the building: the outbound send, the log it lands in, and the retry.
 *
 * Four things are asserted here, and they are the ones a hospital would be asked about afterwards:
 *
 *  1. **Consent is per channel and per address.** A patient who agreed to WhatsApp has not agreed to e-mail, and the
 *     message goes to the address the consent covers — not to one typed into a dialog.
 *  2. **The quiet hours suppress rather than drop.** The row says `suppressed` with `dizi.quiet-hours` and says when
 *     the message is due again; nothing is sent late at night to be on time.
 *  3. **A gateway that is down is a failed attempt and a 502.** The row is written *before* the refusal travels, and
 *     it carries the gateway's own words — which is what turns three failures in an hour into a visible channel
 *     rather than three sentences somebody saw once.
 *  4. **A retry appends.** The failed attempt keeps its state and its provider's words, and the new row is the next
 *     attempt — unless there is nothing to retry, which is a 409 with the attempt returned as it stands.
 */
final class NotificationDeliveryTest extends TestCase
{
    use BooksAppointments;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        /* Nine in the morning in Dhaka: inside the OPD's day, well outside the quiet hours. */
        Carbon::setTestNow(Carbon::parse('2026-11-03 09:00:00', 'Asia/Dhaka'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_a_patient_message_goes_to_the_address_the_consent_covers_and_the_log_masks_it(): void
    {
        $mrn = $this->patient();
        $this->consent($mrn, 'whatsapp', '+8801711000678');

        $delivery = $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn), ['Idempotency-Key' => $this->key('m01')])
            ->assertCreated()
            ->assertJsonPath('topic', 'direct')
            ->assertJsonPath('channel', 'whatsapp')
            ->assertJsonPath('template', 'appointment-booked')
            ->assertJsonPath('language', 'bn')
            ->assertJsonPath('status', 'sent')
            /* `preview` on the row is what makes the log not evidence that anybody was told, and the driver block on
               the page says so at the top as well. */
            ->assertJsonPath('provider', 'preview')
            ->assertJsonPath('attempt', 1)
            ->assertJsonPath('retryable', false)
            /* The address is stored whole — a retry has to have somewhere to go — and the last three characters are
               all the log shows anybody. */
            ->assertJsonPath('to', '*****678')
            ->assertJsonPath('mrn', $mrn)
            ->json();

        $this->assertStringContainsString('preview', (string) $delivery['detail']);
        $this->assertStringContainsString('10:00', (string) $delivery['body']);

        $this->assertDatabaseHas('messaging_deliveries', [
            'id' => $delivery['id'],
            'status' => 'sent',
            'to_address' => '+8801711000678',
            'patient_facing' => true,
        ]);

        $this->assertDatabaseHas('audit_entries', ['action' => 'message.send', 'entity' => 'message.delivery', 'record_id' => $delivery['id']]);
    }

    public function test_consent_is_per_channel_and_per_address(): void
    {
        $mrn = $this->patient();
        $this->consent($mrn, 'whatsapp', '01711000678');

        /* No consent for e-mail at all. */
        $this->assertStringEndsWith('dizi.consent-missing', (string) $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn, ['channel' => 'email', 'to' => 'rahima@example.test']), ['Idempotency-Key' => $this->key('m02')])
            ->assertStatus(409)
            ->json('type'));

        /* A consent quoted that this patient does not have. */
        $this->assertStringEndsWith('dizi.consent-missing', (string) $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn, ['consentRef' => 'consent-somebody-else']), ['Idempotency-Key' => $this->key('m03')])
            ->assertStatus(409)
            ->json('type'));

        /* A number that is not the one the consent covers: a typo at the desk is a 422, not a message to a stranger. */
        $refusal = $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn, ['to' => '01711999999']), ['Idempotency-Key' => $this->key('m04')])
            ->assertStatus(422);

        $this->assertSame('to', $refusal->json('errors.0.field'));

        /* The country code is the same subscriber, so the same message goes through when it is spelled that way. */
        $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn, ['to' => '+8801711000678']), ['Idempotency-Key' => $this->key('m05')])
            ->assertCreated()
            ->assertJsonPath('status', 'sent');

        /* Nothing was written for the three refusals. */
        $this->assertDatabaseCount('messaging_deliveries', 1);
    }

    public function test_a_patient_this_hospital_has_no_record_of_is_refused_before_anything_is_sent(): void
    {
        $this->assertStringEndsWith('dizi.forbidden', (string) $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound('MRN-999999'), ['Idempotency-Key' => $this->key('m06')])
            ->assertStatus(403)
            ->json('type'));

        $this->assertDatabaseCount('messaging_deliveries', 0);
    }

    public function test_the_quiet_hours_suppress_a_patient_message_and_say_when_it_is_due_again(): void
    {
        $mrn = $this->patient();
        $this->consent($mrn, 'whatsapp', '01711000678');

        /* Twenty past ten at night, in the branch's own zone. */
        Carbon::setTestNow(Carbon::parse('2026-11-03 22:20:00', 'Asia/Dhaka'));

        $delivery = $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn), ['Idempotency-Key' => $this->key('m07')])
            ->assertCreated()
            /* It is a successful request with a suppressed attempt: nothing failed, and the message is due again at
               eight in the morning. A refusal here would make the desk think the send broke. */
            ->assertJsonPath('status', 'suppressed')
            ->assertJsonPath('errorCode', 'dizi.quiet-hours')
            ->assertJsonPath('retryable', false)
            ->json();

        $this->assertStringContainsString('suppressed', (string) $delivery['detail']);
        $this->assertStringContainsString('08:00', (string) $delivery['detail']);

        /* The wording is on the row: "what would have gone" is answerable, and it is what the message will say when
           the window closes. */
        $this->assertNotEmpty($delivery['body']);

        $this->assertDatabaseHas('messaging_deliveries', ['id' => $delivery['id'], 'status' => 'suppressed', 'error_code' => 'dizi.quiet-hours']);
    }

    public function test_a_gateway_that_is_down_is_a_failed_attempt_and_a_502(): void
    {
        $mrn = $this->patient();
        $this->consent($mrn, 'whatsapp', '01711000678');

        config([
            'dizi.messaging.channels.whatsapp.driver' => 'meta-cloud',
            'dizi.messaging.whatsapp.phone_number_id' => '1234567890',
            'dizi.messaging.whatsapp.token' => 'token-for-the-test',
        ]);

        Http::fake([
            'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Recipient not in allowed list']], 400),
        ]);

        $refusal = $this->asRole()
            ->postJson('/notifications/outbound', $this->outbound($mrn), ['Idempotency-Key' => $this->key('m08')])
            ->assertStatus(502);

        $this->assertStringEndsWith('dizi.unavailable', (string) $refusal->json('type'));
        $this->assertStringContainsString('Recipient not in allowed list', (string) $refusal->json('detail'));

        /* The attempt is in the log — that is what makes a channel that is down visible rather than a sentence the
           desk read once and forgot. */
        $this->assertDatabaseHas('messaging_deliveries', [
            'status' => 'failed',
            'provider' => 'meta-cloud',
            'error_code' => 'dizi.unavailable',
        ]);

        $failed = Delivery::query()->firstOrFail();
        $this->assertSame(1, (int) $failed->attempt);
        $this->assertStringContainsString('Recipient not in allowed list', (string) $failed->detail);
    }

    public function test_the_log_states_which_driver_is_in_force_and_when_a_channel_is_failing(): void
    {
        $page = $this->asRole()->getJson('/notifications/deliveries')->assertOk();

        $page->assertJsonPath('driver.whatsapp', 'preview');
        $page->assertJsonPath('driver.email', 'preview');
        $this->assertSame([], $page->json('alerts'));

        /* Three failures inside the hour on one channel is a channel that is not delivering, and the page says so
           above the rows rather than leaving a reader to count them. */
        foreach ([1, 2, 3] as $n) {
            $this->attempt('whatsapp', $n);
        }

        $page = $this->asRole()->getJson('/notifications/deliveries?status=failed')->assertOk();

        $page->assertJsonPath('counts.failed', 3);
        $page->assertJsonPath('alerts.0.channel', 'whatsapp');
        $page->assertJsonPath('alerts.0.failures', 3);

        /* A suppression is not a failure: it is a decision, and the alert stays about the channel. */
        $this->attempt('whatsapp', 4, 'suppressed', 'dizi.consent-missing');

        $page = $this->asRole()->getJson('/notifications/deliveries')->assertOk();
        $this->assertSame(3, $page->json('alerts.0.failures'));
        $this->assertSame(4, $page->json('counts.failed') + $page->json('counts.suppressed'));

        /* The address is masked in the page too, which is the rule the whole log is built around. */
        $this->assertStringNotContainsString('01711000678', (string) $page->getContent());
    }

    public function test_a_failed_attempt_is_retried_as_the_next_row_and_an_answered_one_is_not(): void
    {
        $failed = $this->attempt('whatsapp', 1);

        $retry = $this->asRole()
            ->postJson('/notifications/deliveries/'.$failed->id.'/retry', [], ['Idempotency-Key' => $this->key('m09')])
            ->assertCreated()
            ->assertJsonPath('attempt', 2)
            ->assertJsonPath('status', 'sent')
            ->assertJsonPath('provider', 'preview')
            ->assertJsonPath('to', '*****678')
            ->json();

        /* Both rows are in the log: the one that failed keeps its provider's words, and the retry is the next
           attempt rather than an edit of it. */
        $this->assertDatabaseHas('messaging_deliveries', ['id' => $failed->id, 'status' => 'failed', 'attempt' => 1]);
        $this->assertDatabaseHas('messaging_deliveries', ['id' => $retry['id'], 'status' => 'sent', 'attempt' => 2]);
        /* Two rows, not one: the retry is an append, and the failed attempt keeps the gateway's own words. */
        $this->assertNotSame($failed->id, $retry['id']);
        $this->assertDatabaseCount('messaging_deliveries', 3);

        $this->assertDatabaseHas('audit_entries', ['action' => 'message.retry', 'entity' => 'message.delivery', 'record_id' => $retry['id']]);

        /* A message that went out cannot be un-sent: retrying it would tell the patient twice. */
        $this->assertStringEndsWith('dizi.duplicate-operation', (string) $this->asRole()
            ->postJson('/notifications/deliveries/'.$retry['id'].'/retry', [], ['Idempotency-Key' => $this->key('m10')])
            ->assertStatus(409)
            ->json('type'));

        /* A suppression is a decision, and pressing retry does not create consent. */
        $suppressed = $this->attempt('whatsapp', 1, 'suppressed', 'dizi.consent-missing');

        $this->assertStringEndsWith('dizi.consent-missing', (string) $this->asRole()
            ->postJson('/notifications/deliveries/'.$suppressed->id.'/retry', [], ['Idempotency-Key' => $this->key('m11')])
            ->assertStatus(409)
            ->json('type'));

        /* And an attempt with no attempts left is a 422 with the attempt returned as it stands. */
        $exhausted = $this->attempt('whatsapp', 3);

        $this->asRole()
            ->postJson('/notifications/deliveries/'.$exhausted->id.'/retry', [], ['Idempotency-Key' => $this->key('m12')])
            ->assertStatus(422)
            ->assertJsonPath('attempt.attempt', 3)
            ->assertJsonPath('attempt.retryable', false);
    }

    public function test_the_templates_come_from_the_contract_and_say_which_events_are_quiet(): void
    {
        $page = $this->asRole()->getJson('/notifications/templates')->assertOk();

        /* Six templates: four of them on both channels, two that only go by e-mail. Two languages each. */
        $this->assertCount(20, $page->json('rows'));
        $this->assertCount(7, $page->json('events'));

        $rows = collect($page->json('rows'));
        $candidate = $rows->firstWhere(fn (array $row): bool => $row['template'] === 'appointment-booked' && $row['channel'] === 'whatsapp' && $row['language'] === 'bn');

        $this->assertNotNull($candidate);
        $this->assertSame(['patient', 'day', 'doctor', 'token', 'room'], $candidate['placeholders']);
        $this->assertStringContainsString('{{token}}', (string) $candidate['body']);
        /* No Meta account stands behind this repository, so the approval state is `pending` — which the contract says
           refuses a send with its own sentence. */
        $this->assertSame('pending', $candidate['approval']);

        $email = $rows->firstWhere(fn (array $row): bool => $row['channel'] === 'email');
        $this->assertSame('not-required', $email['approval']);
        $this->assertNotNull($email['subject']);

        /* The one event that is deliberately not notifiable is in the list, with the contract's own sentence — an
           event that looks like an oversight is one. */
        $quiet = collect($page->json('events'))->firstWhere('topic', 'encounter.signed');

        $this->assertNotNull($quiet);
        $this->assertFalse($quiet['notifiable']);
        $this->assertNull($quiet['template']);
        $this->assertSame([], $quiet['channels']);
        $this->assertStringContainsString('not notifiable', (string) $quiet['means']);
    }

    /**
     * A consent as the desk would record one.
     *
     * Nothing in this slice writes these rows — the screen that captures a patient's permission is a later piece of
     * work — which is exactly why a send without one is refused rather than allowed.
     */
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

    /**
     * The outbound body, with anything a case wants to change.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function outbound(string $mrn, array $overrides = []): array
    {
        return array_merge([
            'channel' => 'whatsapp',
            'to' => '01711000678',
            'patientMrn' => $mrn,
            'body' => 'রহিমা বেগম — 2026-11-04 তারিখে 10:00 টায় আপনার সিরিয়াল A-014।',
            'templateKey' => 'appointment-booked',
            'consentRef' => 'consent-whatsapp-1',
        ], $overrides);
    }

    /** An attempt as the log would hold one: sent, or failed, or refused by policy. */
    private function failedAttempt(string $channel, int $attempt, string $status = 'failed', ?string $code = 'dizi.unavailable'): Delivery
    {
        return Delivery::query()->create([
            'id' => Delivery::newId(),
            'topic' => 'appointment.booked',
            'channel' => $channel,
            'template' => 'appointment-booked',
            'language' => 'bn',
            'mrn' => 'MRN-000001',
            'to_address' => '01711000678',
            'subject' => null,
            'body' => 'Your appointment is confirmed.',
            'status' => $status,
            'provider' => 'preview',
            'provider_message_id' => null,
            'error_code' => $code,
            'detail' => 'The gateway could not be reached.',
            'attempt' => $attempt,
            'patient_facing' => true,
            'at' => Carbon::now(),
            'node' => 'node-test',
            'origin' => 'Main Campus',
            'created_by' => 'staff-7',
        ]);
    }
}
