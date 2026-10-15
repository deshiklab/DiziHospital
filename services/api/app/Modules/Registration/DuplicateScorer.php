<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Support\ProblemException;

/**
 * Scoring two people as the same person, by the contract's rule set.
 *
 * The contract's own words for the combination, implemented rather than paraphrased:
 *
 *  · `score = min(1, the sum of the weights of the rules that matched)`
 *  · a rule with `veto: true` does not add to that sum, and a vetoing match caps the verdict at `warn` — two records
 *    whose sex disagrees are two people, so nothing may be refused on likeness alone
 *  · the MRN is identity rather than likeness: two records carrying one number is a data error a desk has to look at
 *    whatever else disagrees
 *
 * Nothing here merges, and nothing here refuses by itself. A score and its evidence come back, and the register — a
 * person, through the screen — decides. That division is why a duplicate check can be trusted instead of clicked past.
 */
final class DuplicateScorer
{
    public function __construct(private readonly DuplicateRules $rules) {}

    /**
     * @param  array<string, mixed>  $existing  the record already in the register
     * @param  array<string, mixed>  $incoming  what is being registered
     * @return array{score: float, verdict: string, evidence: list<string>}
     */
    public function score(array $existing, array $incoming): array
    {
        $matched = [];
        $vetoed = null;
        $mrnMatched = false;

        foreach ($this->rules->rules() as $rule) {
            if (! $this->matches($rule, $existing, $incoming)) {
                continue;
            }

            if ($rule['veto']) {
                $vetoed = $rule;

                continue;
            }

            $matched[$rule['id']] = $rule['weight'];
            if ($rule['id'] === 'identity.mrn-exact') {
                $mrnMatched = true;
            }
        }

        $score = min(1.0, array_sum($matched));
        $thresholds = $this->rules->thresholds();

        /* The MRN exception, in the contract's words: identity rather than likeness. Two records carrying one number
           is a data error, so it blocks whatever the weights add up to. */
        if ($mrnMatched) {
            $verdict = 'block';
        } elseif ($vetoed !== null) {
            $verdict = 'warn';
        } else {
            $verdict = $score >= $thresholds['block'] ? 'block' : ($score >= $thresholds['warn'] ? 'warn' : 'pass');
        }

        return [
            'score' => round($score, 2),
            'verdict' => $verdict,
            /* `array_merge`, not `+`: both operands are lists, and the union operator keeps the left operand's keys, so
               a veto would be silently dropped from the evidence whenever any other rule had matched. */
            'evidence' => array_merge(array_keys($matched), $vetoed !== null ? [$vetoed['id']] : []),
        ];
    }

    /**
     * One rule, one signal, by the rule's own id.
     *
     * A rule this service does not implement is a **refusal**, not a rule that quietly never matches. The register is
     * the one place where silently skipping a check costs somebody a duplicate chart and a second set of results, and
     * the whole reason the rule set is data is that a branch may add to it — so a branch that adds a rule the API
     * cannot compute is told, immediately, that the API must be updated with it.
     *
     * @param  array{id: string, signal: string, weight: float, veto: bool, label: string, when: string}  $rule
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private function matches(array $rule, array $a, array $b): bool
    {
        return match ($rule['id']) {
            'identity.mrn-exact' => $this->present($a, 'mrn') && $this->present($b, 'mrn') && $this->flat($a['mrn']) === $this->flat($b['mrn']),
            'identity.phone-normalised' => $this->phoneOf($b) !== '' && $this->phoneOf($b) === $this->phoneOf($a),
            'identity.national-id-suffix' => $this->idTailOf($b) !== '' && $this->identifierEndsWith($a, $this->idTailOf($b)),
            'identity.name-age-sex' => $this->sameNameAgeSex($a, $b),
            'identity.dob-exact' => $this->present($a, 'dateOfBirth') && $this->present($b, 'dateOfBirth')
                && $this->flat($a['dateOfBirth']) === $this->flat($b['dateOfBirth']),
            'identity.name-fuzzy' => $this->nearName($a, $b),
            'identity.sex-conflict' => $this->sexOf($a) !== null && $this->sexOf($b) !== null && $this->sexOf($a) !== $this->sexOf($b),
            default => throw ProblemException::of(
                'dizi.unavailable',
                'A duplicate rule this service cannot compute',
                503,
                "The register's rule set contains `{$rule['id']}`, which this service does not implement. Registering patients with that rule silently skipped would put duplicates in the register without anybody deciding to accept them, so nothing is written until the two agree.",
            ),
        };
    }

    /**
     * The three fields rule, read the way the desk form reads it: the arriving record has all three, the record in the
     * register has a name and an age, and the sex is a sex this register recognises rather than a blank.
     *
     * Sex is compared as a *word* rather than as a string — `M`, `Male` and `পুরুষ` are one answer, and a difference in
     * capitalisation is not a disagreement about a person. `apps/web/lib/duplicate-rules.ts` folds it the same way,
     * because the rule has one sentence in the contract and two implementations that have to agree on it.
     *
     * @param  array<string, mixed>  $a  the record in the register
     * @param  array<string, mixed>  $b  what is arriving
     */
    private function sameNameAgeSex(array $a, array $b): bool
    {
        if (! $this->present($a, 'name') || ! $this->present($b, 'name') || ! $this->present($b, 'age') || ! $this->present($a, 'age')) {
            return false;
        }

        if ($this->sexOf($a) === null || $this->sexOf($b) === null || $this->sexOf($a) !== $this->sexOf($b)) {
            return false;
        }

        if ((int) $a['age'] !== (int) $b['age']) {
            return false;
        }

        return $this->flat($a['name']) === $this->flat($b['name']);
    }

    /**
     * The one-edit rule, with the exact match excluded.
     *
     * The rule's own words are "the names **differ** by a single insertion, deletion or substitution", and the
     * exclusion is load-bearing rather than pedantic: an identical name that counted here as well as in the
     * three-fields rule would take that rule's 0.6 to 1.05 on one name alone and refuse a patient the contract says
     * should only be shown a candidate. The desk form excludes it too — `withinOneEdit` returns false for two equal
     * strings, under the comment "an exact match is another rule's job".
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private function nearName(array $a, array $b): bool
    {
        if (! $this->present($a, 'name') || ! $this->present($b, 'name')) {
            return false;
        }

        $record = $this->flat($a['name']);
        $arriving = $this->flat($b['name']);

        /* A name of three letters or fewer is not compared by edit distance at all: one edit in `Ali` is a different
           name rather than a misspelling, and the desk's own search is what catches that one. */
        if (mb_strlen($arriving) < 4 || $arriving === $record) {
            return false;
        }

        return $this->withinOneEdit($arriving, $record);
    }

    /**
     * One insertion, deletion or substitution apart — over characters, not bytes.
     *
     * Compared by code points, which is not a detail: in Bangla a single letter is three bytes, and a byte-wise
     * distance would read a one-letter difference as a three-edit one and let two spellings of one name through.
     *
     * The two strings arrive already case-folded and space-collapsed, so a difference in spacing is a difference of one
     * character here and a difference of one character on the desk form, which walks the same two strings the same way.
     */
    private function withinOneEdit(string $a, string $b): bool
    {
        $left = mb_str_split($a);
        $right = mb_str_split($b);
        $allowance = $this->nameFuzzyAllowance();
        $shorter = min(count($left), count($right));
        $longer = max(count($left), count($right));

        if ($longer - $shorter > $allowance) {
            return false;
        }

        $i = 0;
        $j = 0;
        $edits = 0;

        while ($i < count($left) && $j < count($right)) {
            if ($left[$i] === $right[$j]) {
                $i++;
                $j++;

                continue;
            }

            $edits++;
            if ($edits > $allowance) {
                return false;
            }

            if (count($left) > count($right)) {
                $i++;
            } elseif (count($right) > count($left)) {
                $j++;
            } else {
                $i++;
                $j++;
            }
        }

        if ($i < count($left) || $j < count($right)) {
            $edits++;
        }

        return $edits <= $allowance;
    }

    /**
     * The sex a register recognises, as one of three words — or `null` when the field is missing or says something this
     * service has no reading for. Missing is not a disagreement: a record with no sex recorded cannot conflict with
     * anything, and treating the blank as a fourth value would veto every block against the oldest rows in the register.
     *
     * @param  array<string, mixed>  $record
     */
    private function sexOf(array $record): ?string
    {
        if (! $this->present($record, 'sex')) {
            return null;
        }

        $sex = $this->flat($record['sex']);

        if (str_starts_with($sex, 'm') || $sex === 'পুরুষ') {
            return 'male';
        }

        if (str_starts_with($sex, 'f') || $sex === 'মহিলা') {
            return 'female';
        }

        return $sex === 'other' ? 'other' : null;
    }

    /**
     * The last four digits of the national ID a desk typed — or an empty string when there are fewer than four.
     *
     * @param  array<string, mixed>  $record
     */
    private function idTailOf(array $record): string
    {
        $digits = preg_replace('/\D+/', '', (string) ($record['nationalId'] ?? '')) ?? '';

        return strlen($digits) >= 4 ? substr($digits, -4) : '';
    }

    /**
     * Whether an existing record already carries that tail as one of its identifiers.
     *
     * The contract's sentence names "the tail of an existing identifier", and this register holds two kinds: the MRN
     * the record was filed under, and — where a branch has one — the record's own national-ID field. Either counts;
     * the rule only ever raises a candidate for a person to look at.
     *
     * @param  array<string, mixed>  $record
     */
    private function identifierEndsWith(array $record, string $tail): bool
    {
        if (str_ends_with($this->flat($record['mrn'] ?? ''), $tail)) {
            return true;
        }

        return $this->idTailOf($record) !== '' && $this->idTailOf($record) === $tail;
    }

    /** @param array<string, mixed> $record */
    private function present(array $record, string $key): bool
    {
        return isset($record[$key]) && $record[$key] !== '' && $record[$key] !== null;
    }

    /**
     * A value as a comparison sees it: trimmed, case-folded, runs of whitespace collapsed to one space.
     *
     * This is `flat()` in `apps/web/lib/duplicate-rules.ts`, deliberately character for character: the two
     * implementations of this rule set serve one desk — `Md.  Selim` typed at the counter and `MD SELIM` on a referral
     * note are one person, and it must not matter which side decided that.
     */
    private function flat(mixed $value): string
    {
        $text = preg_replace('/\s+/u', ' ', trim((string) $value)) ?? (string) $value;

        return mb_strtolower($text);
    }

    /**
     * The fuzzy rule's allowance: one insertion, deletion or substitution, in the contract's own words.
     *
     * It is a constant with a name rather than a literal in the call, because it is the one number in this file a
     * branch might want to argue about — and arguing about it means changing the rule's own sentence in the contract
     * first, not editing a controller.
     */
    private function nameFuzzyAllowance(): int
    {
        return 1;
    }

    /**
     * The digits of a phone number, with the two ways one number is written two ways taken off: the country code, and
     * the leading zero a Dhaka number carries locally. `01711…` and `+8801711…` are one number, and treating them as
     * two is how a duplicate check reports nothing all day.
     *
     * @param  array<string, mixed>  $record
     */
    private function phoneOf(array $record): string
    {
        $digits = preg_replace('/\D+/', '', (string) ($record['phone'] ?? '')) ?? '';

        if (str_starts_with($digits, '880') && strlen($digits) > 10) {
            $digits = substr($digits, 3);
        }
        if (str_starts_with($digits, '0') && strlen($digits) === 11) {
            $digits = substr($digits, 1);
        }

        /* Fewer than ten digits is not a number anybody can be reached on — it is a year, a bed number, or half a
           number typed in a hurry — and matching those against each other raises candidates the desk has to dismiss. */
        return strlen($digits) >= 10 ? $digits : '';
    }
}
