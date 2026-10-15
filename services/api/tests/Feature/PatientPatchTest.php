<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Modules\Registration\Patient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class PatientPatchTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_correction_is_written_with_its_reason_and_a_new_version(): void
    {
        $this->register();

        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01811000009'],
            'version' => 1,
            'reason' => 'The number on the card was the husband’s',
        ])->assertOk()
            ->assertJsonPath('phone', '01811000009')
            ->assertJsonPath('version', 2)
            ->assertJsonPath('merged', ['phone']);

        /* The reason is part of the ledger entry, not a comment in a log: it is what makes a correction auditable
           rather than merely recorded. */
        $entry = Patient::query()->find('MRN-000001');
        $this->assertSame(2, $entry->version);
        $this->assertDatabaseHas('audit_entries', [
            'action' => 'patient.correct',
            'record_id' => 'MRN-000001',
            'sequence' => 2,
        ]);
    }

    public function test_a_field_somebody_else_changed_since_is_offered_back_with_both_values(): void
    {
        $this->register();

        /* Desk A corrects the phone number. */
        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01811000009'],
            'version' => 1,
            'reason' => 'Number corrected from the card',
        ])->assertOk();

        /* Desk B, still holding version 1, corrects the same field differently. */
        $response = $this->asRole('nurse', ['sub' => 'staff-9', 'name' => 'Nurse Ayesha'])
            ->patchJson('/patients/MRN-000001', [
                'fields' => ['phone' => '01999000000'],
                'version' => 1,
                'reason' => 'The patient gave a new number',
            ]);

        $response->assertStatus(409)
            ->assertJsonPath('title', 'Someone changed this record while you were looking at it')
            ->assertJsonPath('conflict.fields.0.field', 'phone')
            ->assertJsonPath('conflict.fields.0.yours', '01999000000')
            ->assertJsonPath('conflict.fields.0.theirs', '01811000009')
            ->assertJsonPath('conflict.fields.0.theirsActor', 'staff-7');

        $this->assertNotNull($response->json('conflict.fields.0.theirsAt'));

        /* Desk A's value stands: the refusal wrote nothing, and it did not overwrite the correction that landed. */
        $this->assertSame('01811000009', Patient::query()->find('MRN-000001')->phone);
        $this->assertSame(2, Patient::query()->find('MRN-000001')->version);
    }

    public function test_a_field_nobody_disputed_merges_even_though_the_record_moved_on(): void
    {
        $this->register();
        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01811000009'],
            'version' => 1,
            'reason' => 'Number corrected from the card',
        ])->assertOk();

        /* Desk B is fixing the address, which nobody touched. Being refused because a colleague fixed a phone number
           is the behaviour that makes people stop trusting a queue. */
        $this->asRole('nurse', ['sub' => 'staff-9'])
            ->patchJson('/patients/MRN-000001', [
                'fields' => ['address' => 'House 9, Uttara Sector 7'],
                'version' => 1,
                'reason' => 'Address collected at the counter',
            ])->assertOk()
            ->assertJsonPath('merged', ['address'])
            ->assertJsonPath('address', 'House 9, Uttara Sector 7')
            ->assertJsonPath('version', 3);
    }

    public function test_a_partly_disputed_correction_writes_nothing_at_all(): void
    {
        $this->register();
        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01811000009'],
            'version' => 1,
            'reason' => 'Number corrected from the card',
        ])->assertOk();

        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01999000000', 'address' => 'House 9, Uttara'],
            'version' => 1,
            'reason' => 'Both at once',
        ])->assertStatus(409);

        /* All or nothing: a 409 that had already applied the address would make the desk's next click a decision
           about a change they cannot see. */
        $patient = Patient::query()->find('MRN-000001');
        $this->assertSame('House 12, Mirpur 10', $patient->address);
        $this->assertSame('01811000009', $patient->phone);
    }

    public function test_a_field_that_cannot_be_corrected_is_named_rather_than_ignored(): void
    {
        $this->register();

        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['mrn' => 'MRN-000002'],
            'version' => 1,
            'reason' => 'Attempting to change the identity',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'mrn');
    }

    public function test_the_reason_is_required(): void
    {
        $this->register();

        /* The reason is what turns a change into an account of a change. Without it the ledger records that something
           happened and not why, which is the half that is never useful afterwards. */
        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['address' => 'House 9, Uttara'],
            'version' => 1,
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'reason');
    }

    public function test_correcting_a_field_to_the_value_it_already_has_is_not_a_new_edit(): void
    {
        $this->register();

        $this->asRole()->patchJson('/patients/MRN-000001', [
            'fields' => ['phone' => '01711000001'],
            'version' => 1,
            'reason' => 'Retry of the same correction',
        ])->assertOk()
            ->assertJsonPath('merged', [])
            ->assertJsonPath('version', 1);

        /* One ledger entry: the registration. Agreement is not an edit. */
        $this->assertSame(1, Patient::query()->find('MRN-000001')->version);
    }

    private function register(): void
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', [
            'name' => 'Rahima Begum',
            'sex' => 'Female',
            'phone' => '01711000001',
            'dateOfBirth' => '1990-05-05',
            'address' => 'House 12, Mirpur 10',
        ], ['Idempotency-Key' => $this->key('0001')])->assertCreated();
    }
}
