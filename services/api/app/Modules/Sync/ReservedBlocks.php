<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;

/**
 * Reserving numbers to a node, and proving whose numbers they were.
 *
 * The allocation itself is a database transaction with a row lock: the cloud keeps one high-water mark per series,
 * hands the asking node the next range of `size` numbers, and moves the mark past it. That is what makes an MRN
 * minted offline at Mirpur impossible to mint at Uttara — not a convention, a counter.
 *
 * The lease on a range is derived rather than stored-and-trusted: `hash_hkdf` over the node's own secret with the
 * range in the info string. Two consequences worth having. A node can regenerate the lease for any range it was
 * issued, so a node that drained after a week offline can prove which numbers were its own — the reconciliation
 * `Sync\NodePolicy::admit()` and P0-311 rely on. And the leases of two nodes are unrelated, because the secret is
 * per node: one branch cannot sign for another's block even if it learns the range.
 */
final class ReservedBlocks implements NodePolicy
{
    public function __construct(
        private readonly string $nodeSecret,
        private readonly int $size,
        private readonly int $leaseHours,
        /** @var array<string, string> */
        private readonly array $prefixes,
        /** @var list<string> */
        private readonly array $series,
    ) {}

    /**
     * The blocks in force for a node, issuing the ones it has none of.
     *
     * This is a `GET` that writes, and that is a deliberate reading of the contract rather than an accident:
     * `listNumberBlocks` is the call a node makes when it comes online in the morning, it is online-only for exactly
     * that reason, and the alternative — a separate "reserve" call the app must remember to make — is a node that
     * starts a day offline with no numbers and discovers it at the registration desk.
     *
     * @return list<NumberBlock>
     */
    public function inForceFor(string $nodeId): array
    {
        return DB::transaction(function () use ($nodeId): array {
            $blocks = [];

            foreach ($this->series as $series) {
                $block = $this->issueIfNeeded($nodeId, $series);
                if ($block !== null) {
                    $blocks[] = $block;
                }
            }

            return $blocks;
        });
    }

    /** Whether this node may write the canonical record, or only a draft to be reconciled on its next drain. */
    public function admit(string $nodeId, string $series): string
    {
        $live = NumberBlock::query()
            ->where('node', $nodeId)
            ->where('series', $series)
            ->where('expires_at', '>', ApiTime::now())
            ->whereColumn('next_value', '<=', 'to_value')
            ->exists();

        return $live ? 'active' : 'draft';
    }

    public function lease(string $nodeId, string $series, int $from, int $to): string
    {
        /* Hex rather than the raw 32 bytes: `hash_hkdf` returns binary, which is not a string a database column,
           a log line or a support ticket can carry. */
        return bin2hex(hash_hkdf('sha256', $this->nodeSecret, 32, "dizi:block:{$nodeId}:{$series}:{$from}:{$to}"));
    }

    public function verifyLease(string $lease, string $nodeId, string $series, int $from, int $to): bool
    {
        return hash_equals($this->lease($nodeId, $series, $from, $to), $lease);
    }

    /** The next number this node should mint for a series, or a refusal the desk can read. */
    public function draw(string $nodeId, string $series): int
    {
        return DB::transaction(function () use ($nodeId, $series): int {
            $block = NumberBlock::query()
                ->where('node', $nodeId)
                ->where('series', $series)
                ->where('expires_at', '>', ApiTime::now())
                ->orderBy('from_value')
                ->lockForUpdate()
                ->first();

            if ($block === null || $block->exhausted()) {
                throw ProblemException::of(
                    'dizi.number-block-exhausted',
                    'This node has run out of reserved numbers',
                    409,
                    'Every number reserved to this node for '.$series.' has been used. Reserve another block while online — until then the record can be written and queued, but it cannot be given a number.',
                );
            }

            $number = $block->next_value;
            $block->next_value = $number + 1;
            $block->save();

            return $number;
        });
    }

    /**
     * Whether a number falls inside a range reserved to this node, live or lapsed.
     *
     * Lapsed blocks count: a number minted during an outage is still this node's number when the node drains, and
     * refusing it because the lease has since expired would throw away a patient's MRN and reissue it. The lease's own
     * expiry decides whether the record may be `active` (see `admit`), not whether the number was ever ours.
     */
    public function covers(string $nodeId, string $series, int $number): bool
    {
        return NumberBlock::query()
            ->where('node', $nodeId)
            ->where('series', $series)
            ->where('from_value', '<=', $number)
            ->where('to_value', '>=', $number)
            ->exists();
    }

    /** The prefix a numbered record carries, so a document's number says where it was minted. */
    public function prefixFor(string $series): string
    {
        return $this->prefixes[$series] ?? strtoupper($series);
    }

    private function issueIfNeeded(string $nodeId, string $series): ?NumberBlock
    {
        $live = NumberBlock::query()
            ->where('node', $nodeId)
            ->where('series', $series)
            ->where('expires_at', '>', ApiTime::now())
            ->orderBy('from_value')
            ->first();

        if ($live !== null && ! $live->exhausted()) {
            return $live;
        }

        $counter = SeriesCounter::query()->lockForUpdate()->find($series);
        if ($counter === null) {
            $counter = new SeriesCounter(['series' => $series, 'next_value' => 1]);
        }

        $from = (int) $counter->next_value;
        $to = $from + $this->size - 1;

        $counter->next_value = $to + 1;
        $counter->save();

        $block = new NumberBlock([
            'node' => $nodeId,
            'series' => $series,
            'prefix' => $this->prefixFor($series),
            'from_value' => $from,
            'to_value' => $to,
            'next_value' => $from,
            'lease' => $this->lease($nodeId, $series, $from, $to),
            'issued_at' => Date::now(),
            'expires_at' => Date::now()->addHours($this->leaseHours),
        ]);
        $block->save();

        return $block;
    }
}
