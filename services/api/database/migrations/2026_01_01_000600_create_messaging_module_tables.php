<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The messaging module's tables: what the hospital says to itself, what it says to patients, and what happened to
 * every message that left.
 *
 * Five tables, and the split between them is the design:
 *
 *  1. `notices` / `notice_recipients` / `notice_receipts` are the internal noticeboard. A notice is written once and
 *     addressed to people, roles, departments or the branch; a receipt is one person having read it. The two are
 *     separate tables because "who was told" and "who read it" are different questions and the second arrives one
 *     person at a time — a read count kept on the notice row would need a lock per reader and would still not say
 *     *who*.
 *  2. `deliveries` is the log of everything that left, one row per *attempt*. It is append-only, which is why the
 *     retry of a failed message inserts attempt 2 rather than editing attempt 1: the row that failed keeps the
 *     provider's own words, and the log a patient's complaint is answered from is the history rather than the last
 *     state. The address is stored in full because a retry has to have somewhere to send; the API never returns it —
 *     `to` is masked in `NotificationDelivery` — because a delivery log is read by whoever is on duty and a log full
 *     of phone numbers is a patient register in a second place.
 *  3. `outbox` is the transactional half. An event is written in the same database transaction as the record that
 *     caused it — that is the whole point, and it is why this table is here rather than an in-memory queue — and
 *     `php artisan dizi:notify` drains it. No module raises an event yet: the records that do (a paid invoice, a
 *     released result, a low shelf) belong to modules this slice does not build, and the catalogue in
 *     `x-dizi-notifications` is what says what those events will be. The mechanism is exercised by
 *     `tests/Feature/NotificationOutboxTest.php`, and nothing pretends a message was sent because a row exists.
 *  4. `consents` is where a patient's permission to be messaged lives, per channel. It is the reason
 *     `POST /notifications/outbound` can be refused with a sentence instead of a shrug: consent for WhatsApp is not
 *     consent for e-mail, the address is the one the consent was given for, and a consent that has been withdrawn
 *     stops a send without deleting the record that it once existed.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('messaging');

        Schema::create(ModuleSchema::table('messaging', 'notices'), function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('subject');
            $table->text('body');
            $table->string('priority')->default('normal');
            /* Why an urgent notice is urgent. Nullable, and required by the API when the priority is `urgent`: a
               notice that interrupts a ward without saying why is a notice people learn to ignore. */
            $table->string('because')->nullable();
            $table->string('from_staff_id');
            $table->string('from_name');
            /* What a screen prints: `queued` until the recipients' node has it, then `sent`. A board notice is
               written to the branch's own table and is readable from the replica at once. */
            $table->string('status')->default('sent');
            $table->string('related_to')->nullable();
            $table->timestamp('sent_at');
            $table->string('node');
            $table->string('origin');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index('sent_at');
            $table->index('from_staff_id');
            $table->index('priority');
        });

        Schema::create(ModuleSchema::table('messaging', 'notice_recipients'), function (Blueprint $table): void {
            $table->id();
            $table->string('notice_id', 36);
            /* `staff` is one person; `role`, `department` and `branch` are audiences, and the API refuses those to a
               role that may not address the whole hospital. */
            $table->string('kind');
            $table->string('ref');
            $table->string('name')->nullable();
            $table->timestamps();

            $table->unique(['notice_id', 'kind', 'ref']);
            $table->index(['kind', 'ref']);
        });

        Schema::create(ModuleSchema::table('messaging', 'notice_receipts'), function (Blueprint $table): void {
            $table->id();
            $table->string('notice_id', 36);
            $table->string('staff_id');
            $table->string('node');
            $table->string('origin');
            $table->timestamp('read_at');
            $table->timestamps();

            /* One receipt per person per notice. The duplicate is refused by this index rather than by a check, so a
               queued receipt that drains twice is one read — which is what `dizi.duplicate-operation` reports. */
            $table->unique(['notice_id', 'staff_id']);
            $table->index('staff_id');
        });

        Schema::create(ModuleSchema::table('messaging', 'consents'), function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('mrn');
            $table->string('channel');
            /* The number or address the consent was given for. A patient who changes number needs a new consent,
               because the consent was for that address and not for the person in general. */
            $table->string('address');
            $table->string('ref')->unique();
            $table->timestamp('granted_at');
            $table->timestamp('withdrawn_at')->nullable();
            $table->string('recorded_by');
            $table->string('node');
            $table->string('origin');
            $table->timestamps();

            $table->index(['mrn', 'channel']);
        });

        Schema::create(ModuleSchema::table('messaging', 'deliveries'), function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            /* The outbox event this attempt is about, when it came from one. A message sent by hand has none, and
               that is a distinction the log keeps rather than hides. */
            $table->string('event_id', 36)->nullable();
            $table->string('topic');
            $table->string('channel');
            $table->string('template');
            $table->string('language');
            $table->string('mrn')->nullable();
            /* The address as it went, and the sentence as it went. The address is never returned by the API — see
               the class comment, and the schema's own note on `to` — and the body is here for two reasons: a retry
               repeats the message rather than inventing a second one, and "what did we tell them?" is answered from
               the log instead of from somebody's memory. */
            $table->string('to_address');
            $table->string('subject')->nullable();
            $table->text('body')->nullable();
            $table->string('status');
            $table->string('provider');
            $table->string('provider_message_id')->nullable();
            $table->string('error_code')->nullable();
            $table->text('detail')->nullable();
            $table->unsignedTinyInteger('attempt')->default(1);
            /* Whether this message was addressed to a patient, which is what quiet hours are about: a store keeper's
               re-order warning at 23:40 is not the thing the rule protects a household from. */
            $table->boolean('patient_facing')->default(false);
            $table->timestamp('at');
            $table->string('node');
            $table->string('origin');
            $table->string('created_by');
            $table->timestamps();

            $table->index(['status', 'at']);
            $table->index(['channel', 'at']);
            $table->index(['topic', 'at']);
            $table->index(['mrn', 'at']);
            $table->index('event_id');
        });

        Schema::create(ModuleSchema::table('messaging', 'outbox'), function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('topic');
            $table->string('mrn')->nullable();
            /* The template's values, as the event found them. Kept as values rather than as a rendered sentence: the
               wording is the branch's and may change, and what has to be reproducible is what happened, not what it
               would have said last Tuesday. */
            $table->json('values');
            $table->string('state')->default('pending');
            $table->unsignedTinyInteger('attempts')->default(0);
            /* The promise the catalogue makes for this topic, in minutes. The drain sends immediately; this is what
               makes "it should have gone out five minutes ago" answerable rather than a guess. */
            $table->unsignedSmallInteger('within_minutes')->default(0);
            $table->timestamp('due_at');
            $table->string('last_error')->nullable();
            $table->string('node');
            $table->string('origin');
            $table->string('created_by');
            $table->timestamps();

            $table->index(['state', 'due_at']);
            $table->index(['topic', 'due_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(ModuleSchema::table('messaging', 'outbox'));
        Schema::dropIfExists(ModuleSchema::table('messaging', 'deliveries'));
        Schema::dropIfExists(ModuleSchema::table('messaging', 'consents'));
        Schema::dropIfExists(ModuleSchema::table('messaging', 'notice_receipts'));
        Schema::dropIfExists(ModuleSchema::table('messaging', 'notice_recipients'));
        Schema::dropIfExists(ModuleSchema::table('messaging', 'notices'));
        ModuleSchema::drop('messaging');
    }
};
