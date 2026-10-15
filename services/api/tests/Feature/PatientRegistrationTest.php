<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Registration\Patient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class PatientRegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_registration_gets_an_mrn_from_the_range_reserved_to_this_node(): void
    {
        $this->reserve();

        $response = $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key()]);

        $response->assertCreated()
            ->assertJsonPath('mrn', 'MRN-000001')
            ->assertJsonPath('branch', 'Main Campus')
            ->assertJsonPath('version', 1);

        $this->assertDatabaseHas('registration_patients', ['mrn' => 'MRN-000001', 'state' => 'active']);

        /* The registration is on the ledger, from the node that took it, with the numbers in the entry. */
        $this->assertDatabaseHas('audit_entries', [
            'node' => 'node-test',
            'actor' => 'staff-7',
            'action' => 'patient.register',
            'entity' => 'patient.demographic',
            'record_id' => 'MRN-000001',
            'sequence' => 1,
        ]);
    }

    public function test_a_registration_with_no_reserved_numbers_is_refused_rather_than_given_an_invented_one(): void
    {
        /* No `reserve()` call: this node never came online today. The honest answer is a refusal the desk can act on,
           not an MRN from nowhere that another branch may also invent. */
        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key()])
            ->assertStatus(409)
            ->assertJsonPath('title', 'This node has run out of reserved numbers');

        $this->assertSame(0, Patient::query()->count());
    }

    public function test_a_number_this_node_was_not_given_is_refused(): void
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', $this->body() + ['mrn' => 'MRN-099999'], ['Idempotency-Key' => $this->key()])
            ->assertStatus(409)
            ->assertJsonPath('title', 'That number was not reserved to this node');

        $this->assertSame(0, Patient::query()->count());
    }

    public function test_a_number_the_node_drew_offline_is_accepted_when_it_drains(): void
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', $this->body() + ['mrn' => 'MRN-000003'], ['Idempotency-Key' => $this->key()])
            ->assertCreated()
            ->assertJsonPath('mrn', 'MRN-000003');
    }

    public function test_a_likely_duplicate_is_refused_with_its_evidence_and_writes_nothing(): void
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();

        /* Same phone and same date of birth: 0.8 + 0.5, over the 0.85 block threshold. */
        $response = $this->asRole()->postJson('/patients', $this->body() + [
            'name' => 'Rahima Bagum',
            'phone' => '+880 1711 000 001',
        ], ['Idempotency-Key' => $this->key('0002')]);

        $response->assertStatus(409)
            ->assertJsonPath('title', 'This patient may already be registered')
            ->assertJsonPath('candidates.0.mrn', 'MRN-000001');

        $evidence = $response->json('candidates.0.evidence');
        $this->assertContains('identity.phone-normalised', $evidence);
        $this->assertContains('identity.dob-exact', $evidence);

        /* Nothing was written, and the refusal did not consume a reserved number either. */
        $this->assertSame(1, Patient::query()->count());
    }

    public function test_registering_anyway_is_a_decision_the_desk_makes_explicitly(): void
    {
        $this->reserve();
        $this->asRole('reception')->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();

        $this->asRole()->postJson('/patients', $this->body() + [
            'phone' => '01711000001',
            'duplicateAcknowledged' => true,
        ], ['Idempotency-Key' => $this->key('0002')])
            ->assertCreated()
            ->assertJsonPath('mrn', 'MRN-000002');

        $second = Patient::query()->find('MRN-000002');

        /* Who said it was a different person, when, and what they were shown — the trail behind "we checked". */
        $this->assertSame('staff-7', $second->duplicate_ack_by);
        $this->assertNotNull($second->duplicate_ack_at);
        $this->assertNotEmpty($second->duplicate_ack_evidence);
    }

    public function test_somebody_elses_phone_number_only_warns_rather_than_blocks(): void
    {
        $this->reserve();
        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();

        /* One number for a household is the common case in Dhaka. 0.8 is above the warn threshold and below the block
           threshold, and that gap is the whole reason there are two numbers instead of one. */
        $this->asRole()->postJson('/patients', [
            'name' => 'Karim Sheikh',
            'sex' => 'Male',
            'phone' => '01711000001',
            'dateOfBirth' => '1980-02-02',
        ], ['Idempotency-Key' => $this->key('0002')])
            ->assertCreated()
            ->assertJsonPath('mrn', 'MRN-000002');
    }

    public function test_a_replayed_write_returns_the_first_answer_and_registers_once(): void
    {
        $this->reserve();
        $headers = ['Idempotency-Key' => $this->key('0001')];

        $first = $this->asRole()->postJson('/patients', $this->body(), $headers)->assertCreated();

        $second = $this->asRole()->postJson('/patients', $this->body(), $headers);

        $second->assertCreated()->assertJsonPath('mrn', $first->json('mrn'));
        $this->assertSame('true', $second->headers->get('X-Dizi-Replay'));
        $this->assertSame(1, Patient::query()->count());
        $this->assertSame(1, Patient::query()->find($first->json('mrn'))->version);
    }

    public function test_the_same_key_with_different_contents_is_refused_rather_than_answered_with_the_old_response(): void
    {
        $this->reserve();
        $headers = ['Idempotency-Key' => $this->key('0001')];

        $this->asRole()->postJson('/patients', $this->body(), $headers)->assertCreated();

        $this->asRole()->postJson('/patients', $this->body() + ['name' => 'Somebody Else'], $headers)
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'Idempotency-Key');

        $this->assertSame(1, Patient::query()->count());
    }

    public function test_a_key_already_used_for_another_operation_is_refused(): void
    {
        $this->reserve();
        $headers = ['Idempotency-Key' => $this->key('0001')];

        $this->asRole()->postJson('/patients', $this->body(), $headers)->assertCreated();

        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['address' => 'House 4, Uttara'],
            'version' => 1,
            'reason' => 'Address corrected at the counter',
        ], $headers)->assertStatus(422);
    }

    public function test_a_queued_write_without_a_key_is_refused(): void
    {
        $this->reserve();

        /* Without a key a retry cannot be told from a second patient, and a node that sends one has no way to know
           whether its registration was applied. */
        $this->asRole()->postJson('/patients', $this->body())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'Idempotency-Key');
    }

    public function test_the_body_is_checked_against_the_contract(): void
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', ['name' => 'R', 'sex' => 'Female'], ['Idempotency-Key' => $this->key()])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => [['field', 'message']]]);

        $this->assertSame(0, Patient::query()->count());
    }

    public function test_a_registration_needs_a_role_that_may_write(): void
    {
        $this->reserve();

        $this->asRole('auditor')->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key()])
            ->assertStatus(403);
    }

    public function test_the_register_can_be_searched_and_read_back(): void
    {
        $this->reserve();
        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();
        $this->asRole()->postJson('/patients', [
            'name' => 'Karim Sheikh',
            'sex' => 'Male',
            'phone' => '01711000002',
        ], ['Idempotency-Key' => $this->key('0002')])->assertCreated();

        $this->asRole()->getJson('/patients?q=Karim')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('rows.0.name', 'Karim Sheikh');

        $this->asRole()->getJson('/patients?q=01711000001')->assertOk()->assertJsonPath('total', 1);

        $this->asRole()->getJson('/patients/MRN-000002')->assertOk()->assertJsonPath('name', 'Karim Sheikh');
    }

    public function test_an_unknown_mrn_is_a_404_that_says_where_to_look(): void
    {
        $this->asRole()->getJson('/patients/MRN-999999')
            ->assertStatus(404)
            ->assertJsonPath('title', 'Not found here');
    }

    public function test_a_malformed_query_string_is_a_400_rather_than_a_422(): void
    {
        $this->asRole()->getJson('/patients?pageSize=500')
            ->assertStatus(400)
            ->assertJsonPath('errors.0.field', 'pageSize');
    }

    public function test_the_duplicate_check_answers_for_a_record_already_on_the_register(): void
    {
        $this->reserve();
        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();
        $this->asRole()->postJson('/patients', [
            'name' => 'Rahima Bagum',
            'sex' => 'Female',
            'phone' => '01711000001',
            'dateOfBirth' => '1990-05-05',
        ], ['Idempotency-Key' => $this->key('0002'), 'X-Trace-Id' => 'trace-two'])->assertCreated();

        $this->asRole()->getJson('/patients/MRN-000002/duplicates')
            ->assertOk()
            ->assertJsonPath('candidates.0.mrn', 'MRN-000001');

        $this->asRole()->getJson('/patients/MRN-000001/duplicates')
            ->assertOk()
            ->assertJsonPath('candidates.0.mrn', 'MRN-000002');
    }

    public function test_a_refusal_carries_the_same_trace_id_as_the_header(): void
    {
        $this->reserve();
        $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0001')])->assertCreated();

        $response = $this->asRole()->postJson('/patients', $this->body(), ['Idempotency-Key' => $this->key('0002')])
            ->assertStatus(409);

        /* The desk reads the id off the screen and an engineer finds the request by it. Two ids would break that. */
        $this->assertSame($response->headers->get('X-Trace-Id'), $response->json('traceId'));
    }

    /** @return array<string, mixed> */
    private function body(): array
    {
        return [
            'name' => 'Rahima Begum',
            'nameBn' => 'রহিমা বেগম',
            'sex' => 'Female',
            'phone' => '01711000001',
            'dateOfBirth' => '1990-05-05',
            'address' => 'House 12, Mirpur 10',
        ];
    }
}
