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
            'evidence' => array_keys($matched) + ($vetoed !== null ? [$vetoed['id']] : []),
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
            'identity.mrn-exact' => $this->present($a, 'mrn') && strcasecmp((string) $a['mrn'], (string) ($b['mrn'] ?? '')) === 0,
            'identity.phone-normalised' => $this->phone($a['phone'] ?? null) !== '' && $this->phone($a['phone'] ?? null) === $this->phone($b['phone'] ?? null),
            'identity.national-id-suffix' => $this->nationalIdTail($a) !== '' && $this->nationalIdTail($a) === $this->nationalIdTail($b),
            'identity.name-age-sex' => $this->sameNameAgeSex($a, $b),
            'identity.dob-exact' => $this->present($a, 'dateOfBirth') && ($a['dateOfBirth'] ?? null) === ($b['dateOfBirth'] ?? null),
            'identity.name-fuzzy' => $this->present($a, 'name')
                && $this->present($b, 'name')
                && $this->sameName((string) $a['name'], (string) $b['name'], $this->nameFuzzyAllowance()),
            'identity.sex-conflict' => $this->present($a, 'sex') && $this->present($b, 'sex') && $a['sex'] !== $b['sex'],
            default => throw ProblemException::of(
                'dizi.unavailable',
                'A duplicate rule this service cannot compute',
                503,
                "The register's rule set contains `{$rule['id']}`, which this service does not implement. Registering patients with that rule silently skipped would put duplicates in the register without anybody deciding to accept them, so nothing is written until the two agree.",
            ),
        };
    }

    /** @param array<string, mixed> $a @param array<string, mixed> $b */
    private function sameNameAgeSex(array $a, array $b): bool
    {
        if (! $this->present($a, 'name') || ! $this->present($b, 'name')) {
            return false;
        }

        if (! $this->sameAge($a, $b)) {
            return false;
        }

        if ($this->present($a, 'sex') && $this->present($b, 'sex') && $a['sex'] !== $b['sex']) {
            return false;
        }

        return $this->sameName((string) $a['name'], (string) $b['name'], 0);
    }

    /** @param array<string, mixed> $a @param array<string, mixed> $b */
    private function sameAge(array $a, array $b): bool
    {
        if ($this->present($a, 'age') && $this->present($b, 'age')) {
            return (int) $a['age'] === (int) $b['age'];
        }

        if ($this->present($a, 'dateOfBirth') && $this->present($b, 'dateOfBirth')) {
            return $a['dateOfBirth'] === $b['dateOfBirth'];
        }

        return false;
    }

    /** @param array<string, mixed> $record */
    private function present(array $record, string $key): bool
    {
        return isset($record[$key]) && $record[$key] !== '' && $record[$key] !== null;
    }

    /**
     * A name within one edit — the commonest transcription error at a busy desk.
     *
     * Compared by code points rather than bytes, which is not a detail: in Bangla a single letter is three bytes, and
     * a byte-wise distance would report a one-letter difference as a three-edit one and let two spellings of the same
     * name through. The comparison is case-folded first, because nobody at a registration desk cares about capitals.
     */
    private function sameName(string $a, string $b, int $maxEdits): bool
    {
        $left = $this->letters(mb_strtolower($a));
        $right = $this->letters(mb_strtolower($b));

        $short = min(count($left), count($right));
        $long = max(count($left), count($right));
        if ($long - $short > $maxEdits) {
            return false;
        }

        /* Classic dynamic-programming edit distance with an early exit: the row can never improve by more than the
           best value in it, so a row whose minimum already exceeds the allowance cannot end below it. */
        $previous = range(0, count($right));
        foreach ($left as $i => $letter) {
            $current = [$i + 1];
            foreach ($right as $j => $other) {
                $current[] = min(
                    $current[$j] + 1,
                    $previous[$j + 1] + 1,
                    $previous[$j] + ($letter === $other ? 0 : 1),
                );
            }
            if (min($current) > $maxEdits) {
                return false;
            }
            $previous = $current;
        }

        return $previous[count($right)] <= $maxEdits;
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

    /** @return list<string> */
    private function letters(string $text): array
    {
        return array_values(array_filter(mb_str_split($text), static fn (string $c): bool => $c !== ' '));
    }

    private function phone(?string $value): string
    {
        $digits = preg_replace('/\D+/', '', (string) $value) ?? '';

        /* The country code, and the leading zero a Dhaka number carries locally: 01711… and +8801711… are one number
           written two ways, and treating them as two is how a duplicate check reports nothing all day. */
        if (str_starts_with($digits, '880') && strlen($digits) > 10) {
            $digits = substr($digits, 3);
        }
        if (str_starts_with($digits, '0') && strlen($digits) === 11) {
            $digits = substr($digits, 1);
        }

        return $digits;
    }

    /**
     * The tail of a national ID, which is what the register holds when it holds one at all.
     *
     * @param  array<string, mixed>  $record
     */
    private function nationalIdTail(array $record): string
    {
        $value = (string) ($record['nationalId'] ?? '');
        $digits = preg_replace('/\D+/', '', $value) ?? '';

        return strlen($digits) >= 4 ? substr($digits, -4) : '';
    }
}
