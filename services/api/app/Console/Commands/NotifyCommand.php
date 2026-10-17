<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Modules\Messaging\Outbox;
use Illuminate\Console\Command;

/**
 * `php artisan dizi:notify` — send what the outbox is holding.
 *
 * The worker the contract promises, and a command rather than a daemon on purpose: a hospital's night is quiet and its
 * morning is not, so the drain is something the deployment schedules (every minute, or every five) instead of a
 * process this service has to keep alive. What it must never be is optional in the other direction — a queue that
 * nothing drains is a patient who was told to expect a message.
 *
 * The counts it prints are the four outcomes the catalogue describes, including the two that are not "sent":
 * `suppressed` (a patient who never agreed, a value the wording needed, an event that is deliberately quiet) and
 * `failed` (the gateway refused, and the attempts are used up). `late` counts events that missed the deadline their
 * topic promises — `withinMinutes` — which is the number an operator should be looking at when the drain runs behind.
 *
 * Nothing raises an event yet: the records that do belong to the billing, diagnostics and pharmacy modules. Running
 * this against a fresh deployment therefore prints zeroes, which is the honest state of it.
 */
final class NotifyCommand extends Command
{
    protected $signature = 'dizi:notify {--limit=50 : How many due events to send in this run} {--topic= : Only this event topic}';

    protected $description = 'Drain the messaging outbox: send what is due, and record what happened to every attempt';

    public function handle(Outbox $outbox): int
    {
        $counts = $outbox->drain((int) $this->option('limit'), $this->option('topic') === null ? null : (string) $this->option('topic'));

        $this->table(
            ['attempted', 'sent', 'suppressed', 'failed', 'quiet (due again)', 'late'],
            [[
                $counts['attempted'],
                $counts['sent'],
                $counts['suppressed'],
                $counts['failed'],
                $counts['quiet'],
                $counts['late'],
            ]],
        );

        $pending = $outbox->pending();

        if ($pending > 0) {
            $this->line($pending.' event(s) still waiting. A pending event is a message a patient was told to expect.');
        }

        if ($counts['suppressed'] > 0) {
            $this->warn('Some events were suppressed. Each one is a row in the delivery log with the code that refused it, and a suppression is a decision rather than a fault — read them rather than retrying them.');
        }

        return self::SUCCESS;
    }
}
