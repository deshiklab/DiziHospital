<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Support\ApiTime;
use App\Support\HasModuleTable;
use Illuminate\Database\Eloquent\Model;

/**
 * A patient's demographic record, as this service holds it.
 *
 * The MRN is the primary key rather than an auto-increment id, and that is the design showing through: a patient is
 * identified across the whole hospital by the number printed on their card, so a record whose identity is a local
 * integer would need translating at every boundary — and the translation is exactly where a duplicate gets created.
 *
 * `state` is the two-state record the sync design calls for. A node with a live lease writes `active` directly, because
 * the cloud knows those numbers are inside a range it reserved. A node whose lease has lapsed writes a `draft`, and the
 * draft becomes `active` on that node's next drain, when the numbers can be reconciled against the ranges that were
 * actually issued. Both states carry the same `client_created` value, which is what pairs the draft with the record it
 * becomes: after a drain the two are one row, but before it a draft is a claim rather than a fact, and the register says
 * so instead of pretending otherwise.
 *
 * @property string $mrn
 * @property string $name
 * @property string|null $name_bn
 * @property int|null $age
 * @property string|null $date_of_birth
 * @property string $sex
 * @property string $phone
 * @property string|null $payer
 * @property string $branch
 * @property string $state
 * @property int $version
 * @property string $client_created
 */
final class Patient extends Model
{
    use HasModuleTable;

    protected const MODULE = 'registration';

    protected const TABLE = 'patients';

    protected $primaryKey = 'mrn';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $casts = [
        'age' => 'integer',
        'version' => 'integer',
        'duplicate_ack_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /**
     * The fields a person may correct after registration, which is also the set `PATCH` accepts.
     *
     * It is deliberately short. An MRN is not editable — it is the patient's identity and the number their card
     * carries — and neither is the record's own provenance (`createdAt`, `version`, the branch it was registered at),
     * because a field the client can set is a field the audit ledger cannot vouch for. `legacyUid` is here because the
     * migration needs to record the old system's number, and it is the only field whose whole purpose is bookkeeping.
     */
    public const FIELD_COLUMNS = [
        'name' => 'name',
        'nameBn' => 'name_bn',
        'age' => 'age',
        'dateOfBirth' => 'date_of_birth',
        'sex' => 'sex',
        'phone' => 'phone',
        'address' => 'address',
        'allergies' => 'allergies',
        'payer' => 'payer',
        'legacyUid' => 'legacy_uid',
    ];

    /** Draft records are claims from a node whose lease lapsed; they are not the canonical record yet. */
    public function isDraft(): bool
    {
        return $this->state === 'draft';
    }

    /**
     * The record in the contract's own field names.
     *
     * A field with nothing in it is **absent**, not null. The contract declares these fields optional rather than
     * nullable (`age: integer`, not `integer|null`), and a client that validates what it receives — or a screen that
     * distinguishes "unknown age" from "age is nothing" — is reading the contract's own types when it does. A rural
     * desk often has a birth date and no age, and that is a field nobody typed, not a field holding nothing.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return array_merge([
            'mrn' => $this->mrn,
            'name' => $this->name,
            'nameBn' => (string) ($this->name_bn ?? ''),
            'sex' => $this->sex,
            'phone' => $this->phone,
            'branch' => $this->branch,
            'createdAt' => ApiTime::iso($this->created_at),
            'version' => $this->version,
        ], array_filter([
            'age' => $this->age,
            'dateOfBirth' => $this->date_of_birth,
            'address' => $this->address,
            'allergies' => $this->allergies,
            'payer' => $this->payer,
            'legacyUid' => $this->legacy_uid,
            'updatedAt' => ApiTime::iso($this->updated_at),
        ], static fn (mixed $value): bool => $value !== null && $value !== ''));
    }

    /**
     * The record's fields in the contract's own names, which is what the duplicate scorer compares.
     *
     * @return array<string, mixed>
     */
    public function toSignals(): array
    {
        return [
            'mrn' => $this->mrn,
            'name' => $this->name,
            'nameBn' => $this->name_bn,
            'age' => $this->age,
            'dateOfBirth' => $this->date_of_birth,
            'sex' => $this->sex,
            'phone' => $this->phone,
            'branch' => $this->branch,
        ];
    }
}
