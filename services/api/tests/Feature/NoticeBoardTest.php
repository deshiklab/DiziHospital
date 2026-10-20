<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The board: a notice written for staff, and the record of who read it.
 *
 * The cases are the four things this slice has to be able to defend:
 *
 *  1. A notice addressed to named people reaches *them* and not everybody — the inbox is "what names you or your
 *     role", and the test checks that from both sides, with a second person looking at the same board.
 *  2. A broadcast is a management act. A doctor may write to colleagues; addressing a role is refused without the
 *     `administer` ability, which is the contract's own 403 sentence about hospital-wide notices.
 *  3. An urgent notice says why it is urgent, and the refusal names the field.
 *  4. A notice written while the node could not reach the cloud keeps the time it was written, because a notice whose
 *     order among the others is wrong is a notice somebody reads after the one it answers.
 */
final class NoticeBoardTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_notice_reaches_the_people_it_names_and_the_board_records_who_read_it(): void
    {
        $notice = $this->send();

        $this->assertSame('board', $notice['channel']);
        $this->assertSame('sent', $notice['status']);
        $this->assertSame('staff-7', $notice['fromStaffId']);
        $this->assertSame('Rahima Begum', $notice['fromName']);
        $this->assertSame(1, $notice['recipientCount']);
        $this->assertSame(0, $notice['readCount']);
        $this->assertSame([['kind' => 'staff', 'ref' => 'staff-7', 'name' => 'Rahima Begum']], $notice['to']);

        $id = (string) $notice['id'];

        $this->assertDatabaseHas('messaging_notices', ['id' => $id, 'priority' => 'normal', 'status' => 'sent']);
        $this->assertDatabaseHas('messaging_notice_recipients', ['notice_id' => $id, 'kind' => 'staff', 'ref' => 'staff-7']);
        $this->assertDatabaseHas('audit_entries', ['action' => 'notice.send', 'entity' => 'message.notice', 'record_id' => $id]);

        /* The writer's own inbox has it; the board has it for everybody; the next person's inbox does not. */
        $this->asRole()->getJson('/notifications?box=inbox')->assertOk()->assertJsonPath('total', 1);
        $this->asRole()->getJson('/notifications?box=sent')->assertOk()->assertJsonPath('total', 1);
        $this->asRole('nurse', ['sub' => 'staff-9', 'name' => 'Nurse Two'])
            ->getJson('/notifications?box=board')->assertOk()->assertJsonPath('total', 1);
        $this->asRole('nurse', ['sub' => 'staff-9', 'name' => 'Nurse Two'])
            ->getJson('/notifications?box=inbox')->assertOk()->assertJsonPath('total', 0);

        /* Reading it is a row about a person, keyed by the reader. */
        $this->asRole()
            ->postJson('/notifications/'.$id.'/receipts', [], ['Idempotency-Key' => $this->key('r01')])
            ->assertCreated()
            ->assertJsonPath('noticeId', $id)
            ->assertJsonPath('staffId', 'staff-7')
            ->assertJsonPath('deviceNodeId', 'node-test');

        $this->assertDatabaseHas('messaging_notice_receipts', ['notice_id' => $id, 'staff_id' => 'staff-7', 'node' => 'node-test']);
        $this->assertDatabaseHas('audit_entries', ['action' => 'notice.receipt', 'entity' => 'message.notice', 'record_id' => $id]);

        $this->asRole()->getJson('/notifications?box=inbox&unreadOnly=true')->assertOk()->assertJsonPath('total', 0);
        $this->asRole()->getJson('/notifications?box=board')->assertOk()->assertJsonPath('rows.0.readCount', 1);

        /* A receipt that drains twice is one read: the contract's own meaning for `dizi.duplicate-operation` is
           "treat as success — drop the outbox entry". */
        $this->asRole()
            ->postJson('/notifications/'.$id.'/receipts', [], ['Idempotency-Key' => $this->key('r02')])
            ->assertStatus(409)
            ->assertJsonPath('status', 409);

        $this->assertStringEndsWith('dizi.duplicate-operation', (string) $this->asRole()
            ->postJson('/notifications/'.$id.'/receipts', [], ['Idempotency-Key' => $this->key('r03')])
            ->json('type'));

        $this->assertDatabaseCount('messaging_notice_receipts', 1);
    }

    public function test_a_doctor_may_write_to_colleagues_and_not_to_the_whole_hospital(): void
    {
        /* A named colleague is a message between people. A role is an audience, and reaching people who cannot answer
           back is an administrator's act. */
        $this->assertStringEndsWith('dizi.forbidden', (string) $this->asRole('doctor')
            ->postJson('/notifications', [
                'to' => [['kind' => 'role', 'ref' => 'nurse']],
                'subject' => 'All nurses to report at 07:00',
                'body' => 'Handover moves to the ward office tomorrow.',
            ], ['Idempotency-Key' => $this->key('n02')])
            ->assertStatus(403)
            ->json('type'));

        $this->assertStringEndsWith('dizi.forbidden', (string) $this->asRole('doctor')
            ->postJson('/notifications', [
                'to' => [['kind' => 'branch', 'ref' => 'Main Campus']],
                'subject' => 'The whole branch',
                'body' => 'This reaches everybody, which is the point.',
            ], ['Idempotency-Key' => $this->key('n03')])
            ->assertStatus(403)
            ->json('type'));

        $this->assertSame(0, $this->asRole('doctor')->getJson('/notifications?box=board')->json('total'));

        $broadcast = $this->send([
            'to' => [['kind' => 'role', 'ref' => 'nurse'], ['kind' => 'staff', 'ref' => 'staff-7', 'name' => 'Rahima Begum']],
            'subject' => 'Nurses: the drug cupboard counts tonight',
        ], 'admin', 'n04');

        $this->assertSame(2, $broadcast['recipientCount']);

        /* And the nurse it was addressed to finds it in their inbox, through the role — not through a staff id they do
           not have. */
        $this->asRole('nurse', ['sub' => 'staff-9', 'name' => 'Nurse Two'])
            ->getJson('/notifications?box=inbox')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_an_urgent_notice_has_to_say_why_it_is_urgent(): void
    {
        $refusal = $this->asRole()
            ->postJson('/notifications', [
                'to' => [['kind' => 'staff', 'ref' => 'staff-7']],
                'subject' => 'Come now',
                'body' => 'Come now.',
                'priority' => 'urgent',
            ], ['Idempotency-Key' => $this->key('n05')])
            ->assertStatus(422);

        $this->assertStringEndsWith('dizi.validation-failed', (string) $refusal->json('type'));
        $this->assertSame('because', $refusal->json('errors.0.field'));

        $urgent = $this->send([
            'priority' => 'urgent',
            'because' => 'The oxygen supply on the second floor has failed.',
            'subject' => 'Second floor: oxygen supply down',
        ], 'receptionist', 'n06');

        $this->assertSame('urgent', $urgent['priority']);

        /* And the audit entry keeps the reason: "why was the whole ward interrupted at 3 a.m." has an answer. */
        $this->assertDatabaseHas('messaging_notices', ['id' => $urgent['id'], 'priority' => 'urgent', 'because' => 'The oxygen supply on the second floor has failed.']);
    }

    public function test_the_board_refuses_a_query_string_it_cannot_read(): void
    {
        $this->assertStringEndsWith('dizi.validation-failed', (string) $this->asRole()
            ->getJson('/notifications?box=wardrobe')->assertStatus(400)->json('type'));

        $this->asRole()->getJson('/notifications?pageSize=500')->assertStatus(400);
        $this->asRole()->getJson('/notifications?priority=quite-urgent')->assertStatus(400);
        $this->asRole()->getJson('/notifications?page=0')->assertStatus(400);
    }

    public function test_a_notice_written_on_a_node_that_could_not_reach_the_cloud_keeps_its_own_time(): void
    {
        $notice = $this->send([
            /* 05:00 in Dhaka, on the day the frozen clock runs. The board's own reading of it is what the desk
               recognises, and the wire spells it as the same instant in UTC. */
            'at' => '2026-11-03T05:00:00+06:00',
        ], 'receptionist', 'n07');

        $this->assertSame('2026-11-02T23:00:00+00:00', $notice['sentAt']);
        $this->assertSame('2026-11-02 23:00:00', Carbon::parse($notice['sentAt'])->utc()->toDateTimeString());
    }

    /**
     * Write a notice the way the desk does, and answer the row the service returned.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function send(array $overrides = [], string $role = 'receptionist', string $key = 'n01'): array
    {
        return (array) $this->asRole($role)
            ->postJson('/notifications', array_merge([
                'to' => [['kind' => 'staff', 'ref' => 'staff-7', 'name' => 'Rahima Begum']],
                'subject' => 'Ward 3 is short of a nurse tonight',
                'body' => 'Anyone who can cover the 22:00–06:00 shift, call the desk.',
            ], $overrides), ['Idempotency-Key' => $this->key($key)])
            ->assertCreated()
            ->json();
    }
}
