<?php

declare(strict_types=1);

namespace App\Modules\Audit;

use App\Support\ApiTime;
use Illuminate\Support\Facades\DB;

/**
 * The ledger, appending and verifying.
 *
 * The canonical form is the part worth being precise about, because a hash chain is only as strong as the
 * reproducibility of what it hashes: the payload is encoded with one flag set (`JSON_UNESCAPED_SLASHES`), the keys
 * are in a fixed order written out here, and the previous hash is concatenated after it. Two implementations that
 * disagree about any of that would each verify their own entries and reject the other's, which is why the pivot
 * (`Sequence`, `Prev` then the fields) is spelled out rather than assembled by reflection.
 *
 * The genesis link is sixty-four zeros rather than an empty string: an empty string hashes to something every
 * language knows, and a chain whose first entry can be forged by anyone who can hash nothing is not a chain.
 */
final class HashChainLedger implements Ledger
{
    public const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

    public function append(
        string $node,
        string $actor,
        string $action,
        string $entity,
        string $recordId,
        array $before = [],
        array $after = [],
    ): AuditEntry {
        return DB::transaction(function () use ($node, $actor, $action, $entity, $recordId, $before, $after): AuditEntry {
            /* The node's own append point, taken under a lock so two concurrent writes on one node cannot claim the
               same sequence number — a duplicate sequence is exactly the gap a tamper test looks for. */
            $last = AuditEntry::query()
                ->where('node', $node)
                ->orderByDesc('sequence')
                ->lockForUpdate()
                ->first();

            $sequence = $last === null ? 1 : $last->sequence + 1;
            $prevHash = $last->hash ?? self::GENESIS;
            $at = ApiTime::now();

            $entry = new AuditEntry([
                'node' => $node,
                'sequence' => $sequence,
                'at' => $at,
                'actor' => $actor,
                'action' => $action,
                'entity' => $entity,
                'record_id' => $recordId,
                'before' => $before,
                'after' => $after,
            ]);

            $entry->prev_hash = $prevHash;
            $entry->hash = self::hash($entry);
            $entry->save();

            return $entry;
        });
    }

    public function verify(string $node): array
    {
        $entries = AuditEntry::query()->where('node', $node)->orderBy('sequence')->get();

        $expectedSequence = 1;
        $prevHash = self::GENESIS;

        foreach ($entries as $entry) {
            if ($entry->sequence !== $expectedSequence) {
                return [
                    'ok' => false,
                    'checked' => $expectedSequence - 1,
                    'brokenAt' => $entry->sequence,
                    'reason' => "The chain jumps: entry {$entry->sequence} follows {$expectedSequence} missing. A missing link is how a deleted entry shows.",
                ];
            }

            if ($entry->prev_hash !== $prevHash) {
                return [
                    'ok' => false,
                    'checked' => $expectedSequence - 1,
                    'brokenAt' => $entry->sequence,
                    'reason' => "Entry {$entry->sequence} does not point at the entry before it, so something between them was replaced.",
                ];
            }

            if (! hash_equals(self::hash($entry), (string) $entry->hash)) {
                return [
                    'ok' => false,
                    'checked' => $expectedSequence - 1,
                    'brokenAt' => $entry->sequence,
                    'reason' => "Entry {$entry->sequence} has been altered after it was written: its own hash does not match its contents.",
                ];
            }

            $prevHash = (string) $entry->hash;
            $expectedSequence++;
        }

        return [
            'ok' => true,
            'checked' => $entries->count(),
            'brokenAt' => null,
            'reason' => $entries->isEmpty()
                ? 'This node has not written anything yet, which is a fact rather than a clean bill of health.'
                : "Recomputed {$entries->count()} entries from the first to the last; the chain is intact.",
        ];
    }

    /** The one canonical form. Change this and every existing chain in every deployment stops verifying. */
    public static function hash(AuditEntry $entry): string
    {
        $payload = json_encode([
            'node' => $entry->node,
            'sequence' => $entry->sequence,
            'at' => ApiTime::iso($entry->at),
            'actor' => $entry->actor,
            'action' => $entry->action,
            'entity' => $entry->entity,
            'recordId' => $entry->record_id,
            'before' => $entry->before ?? [],
            'after' => $entry->after ?? [],
        ], JSON_UNESCAPED_SLASHES);

        return hash('sha256', $payload.'|'.($entry->prev_hash ?? self::GENESIS));
    }
}
