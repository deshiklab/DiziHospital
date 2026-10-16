<?php

declare(strict_types=1);

namespace App\Modules\Messaging;

use App\Modules\Audit\Ledger;
use App\Modules\Identity\Actor;
use App\Modules\Identity\RoleAbilities;
use App\Support\ApiTime;
use App\Support\ProblemException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The hospital's own board: notices written for staff, and who has read them.
 *
 * Three rules, and each one is a sentence somebody has said about a real hospital:
 *
 *  1. **A notice to a ward is not a broadcast.** A notice addressed to named people is a message between colleagues;
 *     one addressed to a role, a department or the branch is a management act. The second needs the `administer`
 *     ability, and that is where the contract's 403 — "the role may not send hospital-wide notices" — comes from. The
 *     check is here rather than in the controller because the sentence has to mean one thing.
 *  2. **An urgent notice says why it is urgent.** The API requires a reason on an urgent notice, because a notice that
 *     interrupts a ward without one is a notice people learn to ignore, and the day it matters nobody reads it.
 *  3. **A read receipt is a fact about a person, not a counter.** Receipts are rows keyed by the reader, so "twelve of
 *     eighteen have read it" is a count over them and "who has not" is a question that can be answered. A receipt that
 *     arrives twice — a queue drained after a reconnect — is one read, and the second arrival is refused rather than
 *     stored as a second time.
 */
final class Notices
{
    /** How many notices one page may hold, whatever the query string asks for. */
    public const MAX_PAGE_SIZE = 100;

    public function __construct(
        private readonly Ledger $ledger,
        private readonly RoleAbilities $abilities,
    ) {}

    /**
     * A page of notices, in one of the three boxes.
     *
     * @return array{rows: list<array<string, mixed>>, total: int, page: int, pageSize: int, asOf: string}
     */
    public function page(
        ?string $box,
        bool $unreadOnly,
        ?string $priority,
        ?string $q,
        int $page,
        int $pageSize,
        Actor $actor,
    ): array {
        $builder = Notice::query();

        /* `board` is the whole board — the hospital-wide list a shift reads at the start of the day. `inbox` is what
           names this person, a role they hold, or the branch they are standing in. `sent` is what they wrote. */
        switch ($box) {
            case 'sent':
                $builder->where('from_staff_id', $actor->id);
                break;
            case 'inbox':
                $this->addressesActor($builder, $actor);
                break;
            default:
                break;
        }

        if ($unreadOnly) {
            $receipts = (new NoticeReceipt)->getTable();
            $builder->whereNotExists(static function ($query) use ($actor, $receipts): void {
                $query->select(DB::raw(1))
                    ->from($receipts)
                    ->whereColumn($receipts.'.notice_id', (new Notice)->getTable().'.id')
                    ->where($receipts.'.staff_id', $actor->id);
            });
        }

        if ($priority !== null && $priority !== '') {
            $builder->where('priority', $priority);
        }

        if ($q !== null && trim($q) !== '') {
            $needle = '%'.trim($q).'%';
            $builder->where(function ($where) use ($needle): void {
                $where->where('subject', 'like', $needle)
                    ->orWhere('body', 'like', $needle)
                    ->orWhere('from_name', 'like', $needle);
            });
        }

        $total = (clone $builder)->count();

        $rows = $builder
            ->with(['recipientRows', 'receiptRows'])
            ->orderByDesc('sent_at')
            ->orderByDesc('id')
            ->forPage($page, $pageSize)
            ->get()
            ->map(static fn (Notice $notice): array => $notice->toApiArray())
            ->all();

        return [
            'rows' => array_values($rows),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'asOf' => ApiTime::iso(ApiTime::now()),
        ];
    }

    /** @throws ProblemException when there is no such notice on this node */
    public function find(string $id): Notice
    {
        $notice = Notice::query()->find($id);

        if ($notice === null) {
            throw ProblemException::of(
                'dizi.not-found',
                'Not found here',
                404,
                'This node has no notice `'.$id.'`. A notice written at another branch reaches this one when that branch drains; until then it is their board.',
            );
        }

        return $notice;
    }

    /**
     * Write a notice to the board.
     *
     * @param  array<string, mixed>  $input
     */
    public function send(array $input, Actor $actor): Notice
    {
        /** @var list<array{kind: string, ref: string, name?: string}> $to */
        $to = array_values($input['to'] ?? []);
        $priority = (string) ($input['priority'] ?? 'normal');
        $because = $input['because'] ?? null;

        if ($to === []) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'A notice needs somebody to go to. Name the people, the role, the department or the branch — a notice with no recipients is a sentence the writer believes was read.',
                ['errors' => [['field' => 'to', 'message' => 'At least one recipient is required', 'code' => 'dizi.validation-failed']]],
            );
        }

        if ($priority === 'urgent' && (! is_string($because) || trim($because) === '')) {
            throw ProblemException::of(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'An urgent notice has to say why it could not wait. Urgent interrupts a ward wherever its people are; a notice that does that without a reason is one people learn to dismiss, and the day it matters nobody reads it.',
                ['errors' => [['field' => 'because', 'message' => 'Required when the priority is urgent', 'code' => 'dizi.validation-failed']]],
            );
        }

        $audience = array_values(array_filter($to, static fn (array $recipient): bool => $recipient['kind'] !== 'staff'));

        if ($audience !== [] && ! in_array('administer', $this->abilities->abilitiesFor($actor->role), true)) {
            throw ProblemException::of(
                'dizi.forbidden',
                'The role may not send hospital-wide notices',
                403,
                'The role `'.$actor->role.'` may write to colleagues by name, and not to a role, a department or the whole branch. Addressing an audience reaches people who cannot answer back, which is why it is an administrator’s act — the audience asked for was '.implode(', ', array_map(
                    static fn (array $recipient): string => $recipient['kind'].':'.$recipient['ref'],
                    array_slice($audience, 0, 4),
                )).'.',
            );
        }

        $notice = DB::transaction(function () use ($to, $priority, $because, $actor, $input): Notice {
            $notice = new Notice([
                'id' => Notice::newId(),
                'subject' => (string) $input['subject'],
                'body' => (string) $input['body'],
                'priority' => $priority,
                'because' => is_string($because) ? $because : null,
                'from_staff_id' => $actor->id,
                'from_name' => $actor->name,
                /* Written to this branch's own table, so it is readable from the replica the moment it is written.
                   `queued` would be a state this node never has: the board is the node's own. */
                'status' => 'sent',
                'related_to' => is_string($input['relatedTo'] ?? null) ? $input['relatedTo'] : null,
                /* The moment the writer's node said it was, when the notice drained from an outage, and this
                   service's clock otherwise. A notice that appears to have been written when the uplink returned is a
                   notice whose order among the others is wrong. */
                'sent_at' => $input['sentAt'] instanceof Carbon ? $input['sentAt'] : ApiTime::now(),
                'node' => $actor->node,
                'origin' => $actor->branch,
            ]);

            $notice->save();

            foreach ($to as $recipient) {
                NoticeRecipient::query()->create([
                    'notice_id' => (string) $notice->id,
                    'kind' => $recipient['kind'],
                    'ref' => $recipient['ref'],
                    'name' => $recipient['name'] ?? null,
                ]);
            }

            return $notice;
        });

        $this->ledger->append(
            $actor->node,
            $actor->id,
            'notice.send',
            'message.notice',
            (string) $notice->id,
            [],
            $notice->toApiArray() + ['summary' => $notice->summary()],
        );

        return $notice;
    }

    /**
     * Record that somebody has read a notice.
     *
     * The uniqueness is the table's, and the refusal below is what a drained duplicate gets: `409
     * dizi.duplicate-operation`, whose meaning in the contract is "treat as success — drop the outbox entry". A second
     * timestamp would be a second read that never happened.
     */
    public function receipt(Notice $notice, Actor $actor): NoticeReceipt
    {
        if (NoticeReceipt::query()->where('notice_id', (string) $notice->id)->where('staff_id', $actor->id)->exists()) {
            throw $this->alreadyRead($notice, $actor);
        }

        try {
            $receipt = NoticeReceipt::query()->create([
                'notice_id' => (string) $notice->id,
                'staff_id' => $actor->id,
                'node' => $actor->node,
                'origin' => $actor->branch,
                'read_at' => ApiTime::now(),
            ]);
        } catch (QueryException) {
            /* The uniqueness is the table's, so two receipts arriving at once — a drained outbox and a person tapping
               the same notice — are decided by the index rather than by the check above followed by a race. */
            throw $this->alreadyRead($notice, $actor);
        }

        $this->ledger->append(
            $actor->node,
            $actor->id,
            'notice.receipt',
            'message.notice',
            (string) $notice->id,
            [],
            $receipt->toApiArray(),
        );

        return $receipt;
    }

    /** What a replay gets: the contract's own meaning for `dizi.duplicate-operation` is "drop the outbox entry". */
    private function alreadyRead(Notice $notice, Actor $actor): ProblemException
    {
        return ProblemException::of(
            'dizi.duplicate-operation',
            'That notice is already marked read',
            409,
            'You have already receipted this notice, so this arrival is a replay and nothing has changed. Drop the outbox entry — a second read receipt would make the board look read twice.',
            ['noticeId' => (string) $notice->id, 'staffId' => $actor->id],
        );
    }

    /** Narrow a notice query to what names this person: them by id, a role they hold, or the branch they are in. */
    private function addressesActor($builder, Actor $actor): void
    {
        $recipients = (new NoticeRecipient)->getTable();
        $builder->whereExists(static function ($query) use ($actor, $recipients): void {
            $query->select(DB::raw(1))
                ->from($recipients)
                ->whereColumn($recipients.'.notice_id', (new Notice)->getTable().'.id')
                ->where(function ($match) use ($actor, $recipients): void {
                    $match->where(function ($staff) use ($actor, $recipients): void {
                        $staff->where($recipients.'.kind', 'staff')->where($recipients.'.ref', $actor->id);
                    })->orWhere(function ($roles) use ($actor, $recipients): void {
                        $roles->where($recipients.'.kind', 'role')->whereIn($recipients.'.ref', $actor->roles === [] ? [$actor->role] : $actor->roles);
                    })->orWhere(function ($branch) use ($actor, $recipients): void {
                        $branch->where($recipients.'.kind', 'branch')->where($recipients.'.ref', $actor->branch);
                    });
                });
        });
    }
}
