<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * The things a test about the diary needs before it can ask a question: a patient and a rule set that has not moved.
 *
 * Booking is a *second* step in the real order of events — the patient is registered at the desk, and then a slot is
 * claimed for them — so the helper here registers first rather than inserting a row behind the module's back. That
 * costs a number-block reservation and one request, and it means a test that books an appointment is also an
 * (unstated) test that the two modules meet at the MRN, which is the only place they do meet.
 *
 * The day constants are the days the frozen clock makes meaningful: 2026-11-02 is a Monday, so the Tuesday is open,
 * the Friday is closed, and the December date is past the thirty-day horizon.
 */
trait BooksAppointments
{
    protected const TODAY = '2026-11-02';

    protected const TUESDAY = '2026-11-03';

    protected const FRIDAY = '2026-11-06';

    protected const BEYOND_HORIZON = '2026-12-10';

    /** Register the patient the bookings below are for, and answer with their MRN. */
    protected function patient(): string
    {
        $this->reserve();

        $this->asRole()->postJson('/patients', [
            'name' => 'Rahima Begum',
            'nameBn' => 'রহিমা বেগম',
            'sex' => 'Female',
            'phone' => '01711000001',
            'dateOfBirth' => '1990-05-05',
        ], ['Idempotency-Key' => $this->key('p01')])->assertCreated();

        return 'MRN-000001';
    }

    /**
     * A booking body, with anything a case wants to change.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function booking(array $overrides = []): array
    {
        return array_merge([
            'mrn' => 'MRN-000001',
            'doctorId' => 'dr-rahman',
            'start' => self::TUESDAY.'T09:00:00+06:00',
            'type' => 'New',
            'reason' => 'Fever for three days',
        ], $overrides);
    }

    /** A booked appointment, taken the way the desk takes one, answering its id. */
    protected function booked(array $overrides = [], string $key = 'a02'): string
    {
        $response = $this->asRole()
            ->postJson('/appointments', $this->booking($overrides), ['Idempotency-Key' => $this->key($key)])
            ->assertCreated();

        return (string) $response->json('id');
    }
}
