<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Registration\ContractDuplicateRules;
use App\Modules\Registration\DuplicateRules;
use App\Modules\Registration\DuplicateScorer;
use App\Support\ProblemException;
use Tests\TestCase;

/**
 * The duplicate rules, proved rule by rule against the contract's own table.
 *
 * These are the assertions that keep the API and the desk form checking the same thing: the weights, the veto and the
 * two thresholds are read from `x-dizi-duplicate-rules`, which is the table `apps/web/lib/duplicate-rules.ts` reads
 * through the generated client. A rule that behaves differently here is a duplicate that comes in through the front
 * door and a false match at the back.
 */
final class DuplicateScorerTest extends TestCase
{
    public function test_the_same_mrn_is_a_block_whatever_else_disagrees(): void
    {
        $result = $this->score(
            ['mrn' => 'MRN-000123', 'name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001'],
            ['mrn' => 'MRN-000123', 'name' => 'Karim Sheikh', 'sex' => 'Male', 'phone' => '01999000000'],
        );

        /* Identity rather than likeness: two records carrying one number is a data error a desk has to look at, and
           the veto is still reported as evidence — it is the reason a person should look carefully rather than the
           reason to stop looking. */
        $this->assertSame('block', $result['verdict']);
        $this->assertSame(1.0, $result['score']);
        $this->assertContains('identity.mrn-exact', $result['evidence']);
        $this->assertContains('identity.sex-conflict', $result['evidence']);
    }

    public function test_a_household_telephone_number_warns_rather_than_blocks(): void
    {
        $result = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'Karim Sheikh', 'sex' => 'Male', 'phone' => '+880 1711 000 001', 'age' => 51],
        );

        /* 0.8 alone, below the 0.85 block threshold and above the 0.4 warn threshold: the number is shared, the people
           are not. This one assertion is the reason the two thresholds differ. */
        $this->assertSame('warn', $result['verdict']);
        $this->assertSame(0.8, $result['score']);
        $this->assertContains('identity.phone-normalised', $result['evidence']);
    }

    public function test_a_telephone_number_and_a_birth_date_together_block(): void
    {
        $result = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'dateOfBirth' => '1990-05-05'],
            ['name' => 'Rahima Bagum', 'sex' => 'Female', 'phone' => '01711000001', 'dateOfBirth' => '1990-05-05'],
        );

        $this->assertSame('block', $result['verdict']);
        $this->assertSame(1.0, $result['score']);
        $this->assertContains('identity.dob-exact', $result['evidence']);
    }

    public function test_a_disagreement_about_sex_caps_the_verdict_at_warn(): void
    {
        $result = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'dateOfBirth' => '1990-05-05'],
            ['name' => 'Rahima Begum', 'sex' => 'Male', 'phone' => '01711000001', 'dateOfBirth' => '1990-05-05'],
        );

        /* Two people, one of them transcribed wrongly. The weights would have blocked; the veto says a person decides,
           and the veto is in the contract's table rather than in this file. */
        $this->assertSame('warn', $result['verdict']);
        $this->assertContains('identity.sex-conflict', $result['evidence']);
    }

    public function test_three_fields_agreeing_is_the_strongest_likeness_rule(): void
    {
        /* `identity.name-age-sex` is the name *exactly*, the age and the sex — the contract's own sentence, and the
           implementation `apps/web/lib/duplicate-rules.ts` shares. 0.6 alone is a warning rather than a refusal: the
           rule's own words are "more than a coincidence and still less than a certainty". The one-edit rule does not
           also fire here, which is the difference between warning about this patient and refusing them: an exact name
           that counted twice would be 1.05 on one name alone. */
        $agree = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 34],
        );

        $this->assertSame('warn', $agree['verdict']);
        $this->assertSame(0.6, $agree['score']);
        $this->assertContains('identity.name-age-sex', $agree['evidence']);
        $this->assertNotContains('identity.name-fuzzy', $agree['evidence']);
    }

    public function test_a_name_one_edit_apart_matches_and_two_edits_apart_does_not(): void
    {
        /* One edit and the same age is *not* three fields agreeing — the name has to be identical for that rule — so
           this is the fuzzy rule on its own: 0.45, a warning. */
        $oneEdit = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'Rahima Bagum', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 34],
        );

        $this->assertContains('identity.name-fuzzy', $oneEdit['evidence']);
        $this->assertNotContains('identity.name-age-sex', $oneEdit['evidence']);
        $this->assertSame('warn', $oneEdit['verdict']);

        $twoEdits = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'Rahim Bigam', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 41],
        );

        $this->assertSame('pass', $twoEdits['verdict']);
        $this->assertSame([], $twoEdits['evidence']);
    }

    public function test_a_bangla_name_is_compared_by_letters_rather_than_bytes(): void
    {
        /* A Bangla letter is three bytes in UTF-8. A byte-wise comparison would read one inserted letter as three
           edits and let two spellings of one name through, which is exactly the duplicate a busy desk creates. */
        $oneLetter = $this->score(
            ['name' => 'রহিমা বেগম', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'রাহিমা বেগম', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 51],
        );

        $this->assertContains('identity.name-fuzzy', $oneLetter['evidence']);

        $twoLetters = $this->score(
            ['name' => 'রহিমা বেগম', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34],
            ['name' => 'রাহিমাক বেগম', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 51],
        );

        $this->assertNotContains('identity.name-fuzzy', $twoLetters['evidence']);
    }

    public function test_the_last_four_digits_of_a_national_id_are_enough_to_warn(): void
    {
        /* Both records carry an identifier: the last four digits agreeing is a partial match, which is all the rule
           claims — the register is full of partial identifiers and this is the signal they give up. */
        $result = $this->score(
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01711000001', 'age' => 34, 'nationalId' => '1990123456789'],
            ['name' => 'Rahima Begum', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 34, 'nationalId' => '2000999876789'],
        );

        $this->assertContains('identity.national-id-suffix', $result['evidence']);

        /* And the identifier this register was built on: the MRN a record was filed under, which is what the desk form
           checks and what the API reads under the same rule id. */
        $byMrnTail = $this->score(
            ['mrn' => 'SH-2106789', 'name' => 'Nasrin Akter', 'sex' => 'Female'],
            ['name' => 'Nasrin Akhter', 'sex' => 'Female', 'phone' => '01811000002', 'age' => 29, 'nationalId' => '1990123456789'],
        );

        $this->assertContains('identity.national-id-suffix', $byMrnTail['evidence']);
    }

    public function test_a_rule_this_service_cannot_compute_is_refused_rather_than_skipped(): void
    {
        /* A branch adds a rule to the shared table. The API does not know how to compute it, and quietly treating the
           register as if the rule did not exist is how duplicates get in with nobody deciding to accept them. */
        $rules = new class implements DuplicateRules
        {
            public function thresholds(): array
            {
                return ['warn' => 0.4, 'block' => 0.85];
            }

            public function rules(): array
            {
                return [[
                    'id' => 'identity.future-rule',
                    'signal' => 'phone',
                    'weight' => 0.9,
                    'veto' => false,
                    'label' => 'Same WhatsApp',
                    'when' => 'A rule added in a later release',
                ]];
            }
        };

        $scorer = new DuplicateScorer($rules);

        $this->expectException(ProblemException::class);
        $this->expectExceptionMessage('identity.future-rule');

        $scorer->score(['mrn' => 'MRN-1', 'phone' => '01711000001'], ['name' => 'X', 'sex' => 'Female', 'phone' => '01711000001']);
    }

    /**
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $incoming
     * @return array{score: float, verdict: string, evidence: list<string>}
     */
    private function score(array $existing, array $incoming): array
    {
        return (new DuplicateScorer(new ContractDuplicateRules((string) config('dizi.contract.path'))))
            ->score($existing, $incoming);
    }
}
