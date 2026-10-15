<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Support\ProblemException;

/**
 * The rule set, read from the contract itself.
 *
 * The file is read once and cached in the instance, because the rules are configuration rather than data: they change
 * when a branch changes them in Setup, which is a deployment-time event and not a per-request one.
 *
 * A missing contract is a refusal rather than a default. Substituting a built-in rule set here would be the most
 * expensive kind of helpful: the API would keep admitting registrations against rules nobody configured, and the
 * difference would only show up as duplicates months later.
 */
final class ContractDuplicateRules implements DuplicateRules
{
    /** @var array{rules: list<array<string, mixed>>, thresholds: array{warn: float, block: float}}|null */
    private ?array $loaded = null;

    public function __construct(private readonly string $path)
    {
    }

    public function thresholds(): array
    {
        return $this->load()['thresholds'];
    }

    public function rules(): array
    {
        return $this->load()['rules'];
    }

    /** @return array{rules: list<array<string, mixed>>, thresholds: array{warn: float, block: float}} */
    private function load(): array
    {
        if ($this->loaded !== null) {
            return $this->loaded;
        }

        if (! is_file($this->path)) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The duplicate rule set is missing',
                503,
                'This service reads the product contract for the duplicate rules and could not find it at '.$this->path.'. Registering patients against invented rules would put duplicates in the register, so nothing is accepted until the contract is deployed beside it.',
            );
        }

        $document = json_decode((string) file_get_contents($this->path), true);
        $rules = $document['x-dizi-duplicate-rules']['rules'] ?? null;
        $thresholds = $document['x-dizi-duplicate-rules']['thresholds'] ?? null;

        if (! is_array($rules) || ! is_array($thresholds) || ! isset($thresholds['warn'], $thresholds['block'])) {
            throw ProblemException::of(
                'dizi.unavailable',
                'The duplicate rule set cannot be read',
                503,
                'The contract at '.$this->path.' does not carry `x-dizi-duplicate-rules` with its rules and thresholds. The contract guardrail refuses a malformed contract, so this file has been edited by hand.',
            );
        }

        $this->loaded = [
            'rules' => array_values(array_map(static fn (array $rule): array => [
                'id' => (string) $rule['id'],
                'signal' => (string) $rule['signal'],
                'weight' => (float) $rule['weight'],
                'veto' => (bool) ($rule['veto'] ?? false),
                'label' => (string) $rule['label'],
                'when' => (string) $rule['when'],
            ], $rules)),
            'thresholds' => ['warn' => (float) $thresholds['warn'], 'block' => (float) $thresholds['block']],
        ];

        return $this->loaded;
    }
}
