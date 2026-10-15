<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use App\Modules\Sync\ReservedBlocks;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The register: the one place a patient's record is created or corrected.
 *
 * Controllers translate HTTP and nothing else. The rules live here, and three of them are worth stating because the
 * code below is shaped by them:
 *
 *  1. **A registration is never refused silently, and never accepted silently either.** The duplicate rules produce
 *     candidates and the desk decides. What the service will not do is the two easy wrong things: insert a second
 *     record because nobody asked, or refuse a real new patient because their phone number matches their daughter's.
 *  2. **A correction is a decision, not an overwrite.** `PATCH` carries the version the desk was looking at and a
 *     reason; a field somebody else has changed since is offered back with both values, and the fields nobody
 *     disputed are merged. That is the contract's own sentence — "different fields merge automatically; the same
 *     field is offered to a person" — and it is why `patient_fields` exists.
 *  3. **Numbers are drawn, not invented.** An MRN comes from a range the cloud reserved to this node, so a
 *     registration taken during an outage cannot collide with one taken at another branch.
 *
 * Every method here takes the `Actor` and uses *its* node, never a node configured on the service. One cloud tier
 * serves every branch, so a write belongs to the node that took it — and a service that attributed a Mirpur
 * registration to itself would put the wrong device in the audit trail and check its numbers against the wrong
 * reservation.
 */
final class Register
{
    /** How many candidates a duplicate check considers after narrowing. Enough to show a desk; not a table scan. */
    private const CANDIDATE_POOL = 200;

    /** How many candidates come back. Beyond a handful, a list stops being evidence and becomes a haystack. */
    private const CANDIDATE_LIMIT = 5;

    public function __construct(
        private readonly ReservedBlocks $blocks,
        private readonly DuplicateScorer $scorer,
        private readonly Ledger $ledger,
    ) {}

    /**
     * A page of the register.
     *
     * @return array{rows: list<array<string, mixed>>, total: int, page: int, pageSize: int}
     */
    public function page(?string $query, int $page, int $pageSize): array
    {
        $builder = Patient::query();

        if ($query !== null && trim($query) !== '') {
            $needle = trim($query);
            $digits = preg_replace('/\D+/', '', $needle) ?? '';

            $builder->where(function ($where) use ($needle, $digits): void {
                $where->where('name', 'like', '%'.$needle.'%')
                    ->orWhere('name_bn', 'like', '%'.$needle.'%')
                    ->orWhere('mrn', 'like', '%'.$needle.'%')
                    ->orWhere('legacy_uid', 'like', '%'.$needle.'%');

                /* A desk types a telephone number with spaces, dashes or the country code, and a search that only
                   matches the way the number was stored is a search that finds nothing at exactly the moment somebody
                   is standing at the counter. */
                if ($digits !== '') {
                    $where->orWhere('phone', 'like', '%'.$digits.'%');
                }
            });
        }

        $total = (clone $builder)->count();

        $rows = $builder
            ->orderByDesc('created_at')
            ->orderBy('mrn')
            ->forPage($page, $pageSize)
            ->get()
            ->map(static fn (Patient $patient): array => $patient->toApiArray())
            ->all();

        return ['rows' => array_values($rows), 'total' => $total, 'page' => $page, 'pageSize' => $pageSize];
    }

    /** @throws ModelNotFoundException */
    public function find(string $mrn): Patient
    {
        return Patient::query()->findOrFail($mrn);
    }

    /**
     * Register a patient.
     *
     * @param  array<string, mixed>  $input
     * @return array{patient: Patient, candidates: list<array<string, mixed>>, verdict: string}
     */
    public function register(array $input, Actor $actor, ?string $mrn = null): array
    {
        $signals = [
            'mrn' => $mrn ?? '',
            'name' => (string) $input['name'],
            'nameBn' => $input['nameBn'] ?? null,
            'age' => $input['age'] ?? null,
            'dateOfBirth' => $input['dateOfBirth'] ?? null,
            'sex' => (string) $input['sex'],
            'phone' => (string) $input['phone'],
        ];

        $scored = $this->score($signals, null);
        $verdict = $scored['verdict'];
        $blocking = $scored['blocking'];

        /* The contract's own sentence for this refusal: at or above `block` the write is refused with 409 and the
           candidates, and a person may then register anyway by acknowledging them. */
        if ($blocking !== [] && ! ($input['duplicateAcknowledged'] ?? false)) {
            throw ProblemException::of(
                'dizi.duplicate-patient',
                'This patient may already be registered',
                409,
                $blocking[0]['score'] === 1.0
                    ? 'The number this patient was given is already on the register, so this is the same person rather than a new one. Open the existing record.'
                    : 'This looks like somebody already in the register. Nothing has been written. If it is the same person, open the record that exists; if it is not, confirm and register.',
                ['candidates' => $scored['candidates']],
            );
        }

        return DB::transaction(function () use ($input, $actor, $mrn, $verdict, $scored): array {
            $drawn = $mrn === null;
            $number = $mrn ?? $this->draw($actor);

            if (! $this->numberIsReserved($number, $actor)) {
                throw $this->numberNotOurs($number);
            }

            $now = ApiTime::now();
            $patient = new Patient([
                'mrn' => $number,
                'name' => (string) $input['name'],
                'name_bn' => $input['nameBn'] ?? null,
                'age' => $input['age'] ?? null,
                'date_of_birth' => $input['dateOfBirth'] ?? null,
                'sex' => (string) $input['sex'],
                'phone' => (string) $input['phone'],
                'address' => $input['address'] ?? null,
                'allergies' => $input['allergies'] ?? null,
                'payer' => $input['payer'] ?? null,
                'branch' => $actor->branch,
                'state' => $this->blocks->admit($actor->node, 'mrn'),
                /* The draft and the record it becomes share this value, which is how a drain pairs them. */
                'client_created' => (string) Str::uuid(),
                'version' => 1,
                'duplicate_ack_by' => ($input['duplicateAcknowledged'] ?? false) ? $actor->id : null,
                'duplicate_ack_at' => ($input['duplicateAcknowledged'] ?? false) ? $now : null,
                'duplicate_ack_evidence' => ($input['duplicateAcknowledged'] ?? false) ? $scored['candidates'] : null,
                'created_by' => $actor->id,
                'updated_by' => $actor->id,
            ]);
            $patient->created_at = $now;
            $patient->updated_at = $now;
            $patient->save();

            PatientField::query()->insert(array_map(static fn (array $field): array => [
                'patient_mrn' => $number,
                'field' => $field['field'],
                'value' => $field['value'],
                'version' => 1,
                'updated_by' => $actor->id,
                'created_at' => $now,
                'updated_at' => $now,
            ], $this->fieldRows($patient)));

            /* The ledger entry carries the numbers as well as the person: "who admitted this patient, on which device,
               while the uplink was down" is the question an audit trail is read to answer. */
            $this->ledger->append(
                $actor->node,
                $actor->id,
                $drawn ? 'patient.register' : 'patient.register.offline-draw',
                'patient.demographic',
                $patient->mrn,
                [],
                $patient->toApiArray() + ['state' => $patient->state, 'acknowledgedDuplicates' => $scored['candidates']],
            );

            return ['patient' => $patient, 'candidates' => $scored['candidates'], 'verdict' => $verdict];
        });
    }

    /**
     * Correct a patient's record.
     *
     * @param  array<string, mixed>  $fields  only the fields being changed
     * @return array{patient: Patient, merged: list<string>, conflicts: list<array<string, mixed>>}
     */
    public function correct(Patient $patient, array $fields, int $version, string $reason, Actor $actor): array
    {
        return DB::transaction(function () use ($patient, $fields, $version, $reason, $actor): array {
            $before = $patient->toApiArray();
            $columns = $this->columns();
            $provenance = PatientField::query()->where('patient_mrn', $patient->mrn)->get()->keyBy('field');
            $merged = [];
            $conflicts = [];
            $changed = [];

            foreach ($fields as $field => $value) {
                if (! isset($columns[$field])) {
                    /* A field nobody can correct is not a field this service silently ignores: ignoring it is how a
                       client comes to believe it changed something it did not. */
                    throw ProblemException::of(
                        'dizi.validation-failed',
                        'Some fields need attention',
                        422,
                        "`{$field}` is not a field that can be corrected here. The fields that can are listed in the contract's PatientPatch.",
                        ['errors' => [['field' => (string) $field, 'message' => 'Not a correctable field', 'code' => 'dizi.validation-failed']]],
                    );
                }

                $current = $patient->getAttribute($columns[$field]);
                if ((string) $current === (string) $value) {
                    /* Already what the desk wants. Two desks correcting a record to the same value is agreement, not
                       a conflict, and reporting it as one trains people to click through conflicts. */
                    continue;
                }

                $lastChangedAt = $provenance->get($field)?->version;

                /* The merge rule. `version` is what the desk read; if this field has changed since — under a newer
                   version — then somebody is about to lose an edit and a person has to choose. A field nobody touched
                   since the desk read it merges, whether or not *other* fields changed. */
                if ($lastChangedAt !== null && $lastChangedAt > $version) {
                    $conflicts[] = [
                        'field' => $field,
                        'yours' => $value,
                        'theirs' => $current,
                        'theirsActor' => $provenance->get($field)?->updated_by,
                        'theirsAt' => ApiTime::iso($provenance->get($field)?->updated_at),
                    ];

                    continue;
                }

                $changed[$field] = $value;
                $merged[] = $field;
            }

            if ($conflicts !== []) {
                /* Nothing is written when a field is disputed: a 409 that had already applied the other fields would
                   make the desk's next click a decision about something they cannot see. The response says which fields
                   were free to merge and which were not, and the client resends the free ones with a fresh version. */
                throw ProblemException::of(
                    'dizi.stale-version',
                    'Someone changed this record while you were looking at it',
                    409,
                    'Another desk changed '.count($conflicts).' of the fields you are correcting. Both values are below. Nothing was written; reload the record and re-send the fields that are not in dispute.',
                    [
                        'conflict' => ['entity' => 'patient.demographic', 'fields' => $conflicts],
                        'mergeable' => $merged,
                    ],
                );
            }

            if ($changed === []) {
                /* Nothing to write is not an error, and it is certainly not a version bump: an idempotent retry of a
                   correction that already landed must not look like a new edit in the ledger. */
                return ['patient' => $patient, 'merged' => [], 'conflicts' => []];
            }

            $patient->version = $patient->version + 1;
            $patient->updated_by = $actor->id;
            $patient->updated_at = ApiTime::now();

            foreach ($changed as $field => $value) {
                $patient->setAttribute($columns[$field], $value);
                PatientField::query()->updateOrCreate(
                    ['patient_mrn' => $patient->mrn, 'field' => $field],
                    ['value' => $value, 'version' => $patient->version, 'updated_by' => $actor->id, 'updated_at' => ApiTime::now()],
                );
            }

            $patient->save();

            $this->ledger->append(
                $actor->node,
                $actor->id,
                'patient.correct',
                'patient.demographic',
                $patient->mrn,
                $before,
                $patient->toApiArray() + ['reason' => $reason],
            );

            return ['patient' => $patient, 'merged' => $merged, 'conflicts' => []];
        });
    }

    /**
     * The candidates for a record already on the register.
     *
     * @return list<array<string, mixed>>
     */
    public function duplicatesFor(Patient $patient): array
    {
        return $this->score($patient->toSignals(), $patient->mrn)['candidates'];
    }

    /**
     * Score an incoming record against the register.
     *
     * The narrowing step is not an optimisation detail, it is what keeps the check honest at scale: a full scan would
     * have to be capped, and a capped scan silently stops finding matches on a large register. This narrows on the
     * signals the rules actually use — the phone digits, the date of birth, the first letters of the name, the MRN —
     * so the pool is small and the scoring is complete over it. The trigram indexes a full deployment adds make the
     * name part of that narrowing cheap; the shape of the query does not change.
     *
     * @param  array<string, mixed>  $signals
     * @return array{candidates: list<array<string, mixed>>, verdict: string, blocking: list<array<string, mixed>>, best: float}
     */
    private function score(array $signals, ?string $excludeMrn): array
    {
        $pool = Patient::query()
            ->when($excludeMrn !== null, fn ($query) => $query->where('mrn', '!=', $excludeMrn))
            ->where(function ($query) use ($signals): void {
                $digits = preg_replace('/\D+/', '', (string) ($signals['phone'] ?? '')) ?? '';
                $tail = substr($digits, -9);

                if ($tail !== '') {
                    $query->orWhere('phone', 'like', '%'.$tail.'%');
                }
                if (($signals['dateOfBirth'] ?? null) !== null && $signals['dateOfBirth'] !== '') {
                    $query->orWhere('date_of_birth', $signals['dateOfBirth']);
                }
                if (($signals['name'] ?? '') !== '') {
                    $query->orWhere('name', 'like', mb_substr((string) $signals['name'], 0, 3).'%');
                }
                if (($signals['mrn'] ?? '') !== '') {
                    $query->orWhere('mrn', $signals['mrn']);
                }
            })
            ->orderByDesc('created_at')
            ->limit(self::CANDIDATE_POOL)
            ->get();

        $candidates = [];
        $blocking = [];
        $best = 0.0;
        $verdict = 'pass';

        foreach ($pool as $existing) {
            $result = $this->scorer->score($existing->toSignals(), $signals);
            $best = max($best, $result['score']);

            if ($result['verdict'] === 'pass') {
                continue;
            }

            $candidate = array_filter([
                'mrn' => $existing->mrn,
                'name' => $existing->name,
                'nameBn' => $existing->name_bn,
                'branch' => $existing->branch,
                'registeredAt' => ApiTime::iso($existing->created_at),
                'score' => $result['score'],
                'evidence' => $result['evidence'],
            ], static fn (mixed $value): bool => $value !== null && $value !== '');

            if ($result['verdict'] === 'block') {
                $blocking[] = $candidate;
                $verdict = 'block';

                continue;
            }

            if ($verdict !== 'block') {
                $verdict = 'warn';
            }

            if (count($candidates) < self::CANDIDATE_LIMIT) {
                $candidates[] = $candidate;
            }
        }

        /* A blocking match is the most important thing on the screen, so it comes first — a desk that has to scroll to
           read the strongest evidence will act on the weakest. */
        usort($blocking, static fn (array $a, array $b): int => $b['score'] <=> $a['score']);
        $candidates = array_slice(array_merge($blocking, $candidates), 0, self::CANDIDATE_LIMIT);

        return ['candidates' => array_values($candidates), 'verdict' => $verdict, 'blocking' => $blocking, 'best' => $best];
    }

    /** Draw the next MRN from the range reserved to this node, formatted with its prefix. */
    private function draw(Actor $actor): string
    {
        $number = $this->blocks->draw($actor->node, 'mrn');

        return $this->blocks->prefixFor('mrn').'-'.str_pad((string) $number, 6, '0', STR_PAD_LEFT);
    }

    /**
     * Whether a number the client supplied came from a range this node was given.
     *
     * This is the check that makes an offline registration trustworthy rather than merely optimistic: an MRN is not
     * accepted because the client says it drew one, it is accepted because the cloud can find the range it belongs to
     * and the lease still proves it was issued to that node.
     */
    private function numberIsReserved(string $mrn, Actor $actor): bool
    {
        $digits = (string) preg_replace('/\D+/', '', $mrn);
        $number = (int) ltrim($digits, '0');
        if ($number <= 0) {
            return false;
        }

        return $this->blocks->covers($actor->node, 'mrn', $number);
    }

    private function numberNotOurs(string $mrn): ProblemException
    {
        return ProblemException::of(
            'dizi.number-block-exhausted',
            'That number was not reserved to this node',
            409,
            "This node has no reservation covering {$mrn}. Numbers are minted from a range the cloud hands out, so a number from nowhere is a number two patients can be given. Reserve a block while online and register again.",
        );
    }

    /**
     * The column each contract field name maps to — the model's own table, not a second copy of it.
     *
     * Both the patch check and the write read it, so a field cannot be accepted by one and dropped by the other, which
     * is the quiet failure mode of hand-written field lists.
     *
     * @return array<string, string>
     */
    private function columns(): array
    {
        return Patient::FIELD_COLUMNS;
    }

    /** @return list<array{field: string, value: string|null}> */
    private function fieldRows(Patient $patient): array
    {
        $rows = [];
        foreach ($this->columns() as $field => $column) {
            $rows[] = ['field' => $field, 'value' => $this->asText($patient->getAttribute($column))];
        }

        return $rows;
    }

    private function asText(mixed $value): ?string
    {
        return $value === null ? null : (string) $value;
    }
}
