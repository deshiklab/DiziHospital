<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ReadsQueryStrings;
use App\Modules\Identity\Actor;
use App\Modules\Registration\Register;
use App\Modules\Scheduling\Appointment;
use App\Modules\Scheduling\Availability;
use App\Modules\Scheduling\Diary;
use App\Support\ProblemException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `/appointments` — the diary, over HTTP.
 *
 * As with the register, there is no rule in this file: it reads the request, refuses a query string it cannot read,
 * asks the module, and writes the answer. The one thing it does that the module does not is the cross-module read —
 * the patient is checked through *registration's* seam, because an appointment is a claim about a person and a claim
 * about an MRN nobody registered is a typo the desk should see at booking time rather than a queue token for nobody.
 */
final class AppointmentController
{
    use ReadsQueryStrings;

    public function __construct(
        private readonly Diary $diary,
        private readonly Availability $availability,
        private readonly Register $register,
    ) {}

    /** The day's diary, for the calendar, the queue board and the online-request inbox. */
    public function index(Request $request): JsonResponse
    {
        $day = $this->day($request);
        $doctorId = $this->word($request, 'doctorId');
        $status = $this->word($request, 'status');
        $source = $this->word($request, 'source');

        $page = $this->diary->day($day, $doctorId, $status, $source);

        /* The register is *projected* onto the page here rather than inside the diary, and that is the module
           boundary doing its job: `Scheduling` knows a booking's MRN and nothing about who carries it, so the join
           happens at the edge, through registration's own seam, in one query for the whole page. A screen prints a
           name beside a token from this, and the register is still the only place a name is edited. */
        $summaries = $this->register->summaries(array_map(
            static fn (array $row): string => (string) $row['mrn'],
            $page['rows'],
        ));

        $page['rows'] = array_map(static function (array $row) use ($summaries): array {
            $row['patient'] = $summaries[$row['mrn']] ?? null;

            return $row;
        }, $page['rows']);

        return new JsonResponse($page);
    }

    /** The slots one doctor offers on one day, with what holds each of them. */
    public function slots(Request $request): JsonResponse
    {
        $day = $this->day($request);
        $doctorId = $request->query('doctorId');

        if (! is_string($doctorId) || $doctorId === '') {
            throw $this->malformed('doctorId', 'Is required: a day\'s slots are a doctor\'s slots');
        }

        $exclude = $request->query('excludeAppointmentId');

        return new JsonResponse($this->availability->day(
            $doctorId,
            $day,
            is_string($exclude) && $exclude !== '' ? $exclude : null,
        ));
    }

    public function store(Request $request): JsonResponse
    {
        $actor = app(Actor::class);
        $data = $request->validate([
            'mrn' => ['required', 'string', 'max:32'],
            'doctorId' => ['required', 'string', 'max:64'],
            /* A start that is not a date-time is a form problem rather than a link problem, so this one is a 422. */
            'start' => ['required', 'date'],
            'type' => ['nullable', 'in:'.implode(',', Appointment::TYPES)],
            'priority' => ['nullable', 'in:'.implode(',', Appointment::PRIORITIES)],
            'source' => ['nullable', 'in:'.implode(',', Appointment::SOURCES)],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        try {
            $this->register->find((string) $data['mrn']);
        } catch (ModelNotFoundException) {
            /* The patient is checked through registration's own seam, and a number nobody carries is a 422 rather
               than a 404: the URL is right and the form is wrong, which is the distinction the desk needs in order to
               fix the field instead of re-navigating. */
            throw ProblemException::of(
                'dizi.validation-failed',
                'Some fields need attention',
                422,
                'No patient on this node carries the MRN `'.$data['mrn'].'`. Book against the number on the patient\'s card — a token issued for an MRN nobody registered is a patient in a queue with no chart.',
                ['errors' => [['field' => 'mrn', 'message' => 'No such patient on this node', 'code' => 'dizi.validation-failed']]],
            );
        }

        $appointment = $this->diary->book($data, $actor);

        return new JsonResponse($appointment->toApiArray() + [
            'patient' => $this->register->summaries([(string) $data['mrn']])[(string) $data['mrn']] ?? null,
        ], 201);
    }

    /** Confirm, reschedule, cancel or mark a no-show — the contract's `PATCH`, in one operation. */
    public function update(Request $request, string $id): JsonResponse
    {
        $actor = app(Actor::class);
        $data = $request->validate([
            /* The whole vocabulary, because the *moves* are the module's table and this field is only asking whether
               the word is one the contract defines. Listing the three statuses this operation used to accept here was
               a second copy of the enum, and it went stale the moment the contract's enum was widened: every queue
               move — `Waiting`, `In consultation`, `Completed` — came back as a malformed field before the state
               machine ever saw it. */
            'status' => ['required', 'in:'.implode(',', Appointment::STATUSES)],
            'start' => ['nullable', 'date'],
            'because' => ['required', 'string', 'min:3', 'max:500'],
        ]);

        return new JsonResponse($this->diary->patch($this->diary->find($id), $data, $actor)->toApiArray());
    }

    public function checkIn(Request $request, string $id): JsonResponse
    {
        $actor = app(Actor::class);

        return new JsonResponse($this->diary->checkIn($this->diary->find($id), $actor)->toApiArray());
    }

    /** A query word, or null when it was not sent. */
    private function word(Request $request, string $name): ?string
    {
        $value = $request->query($name);

        return is_string($value) && $value !== '' ? $value : null;
    }

    /** The day, refused as a malformed query string rather than as a validation failure. */
    private function day(Request $request): string
    {
        $day = $request->query('day');

        if (! is_string($day) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) !== 1) {
            throw $this->malformed('day', 'Must be a date, yyyy-mm-dd');
        }

        return $day;
    }
}
