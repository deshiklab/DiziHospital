<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Modules\Identity\Actor;
use App\Modules\Registration\Register;
use App\Support\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `/patients` — the register, over HTTP.
 *
 * There is no rule in this file. It reads the request, refuses what the contract says is malformed, calls the module
 * and writes the response, and every sentence a person reads comes from the module's refusal rather than being
 * assembled here. A controller that knows what a duplicate is has become a second place where duplicate rules live.
 */
final class PatientController
{
    public function __construct(private readonly Register $register) {}

    public function index(Request $request): JsonResponse
    {
        /* The contract's query bounds: `page` from 1, `pageSize` up to 100 — and its own status for a bad query string
           is 400 rather than the 422 a malformed body gets. Dates and counts in a URL are typed by whoever built the
           link, and "the link is wrong" is a different sentence from "the form is wrong". */
        $page = $this->integer($request->query('page'), 1);
        $pageSize = $this->integer($request->query('pageSize'), 20);
        $query = $request->query('q');

        if ($page < 1) {
            throw $this->malformed('page', 'Must be 1 or more');
        }
        if ($pageSize < 1 || $pageSize > 100) {
            throw $this->malformed('pageSize', 'Must be between 1 and 100');
        }
        if ($query !== null && ! is_string($query)) {
            throw $this->malformed('q', 'Must be text');
        }

        return new JsonResponse($this->register->page($query, $page, $pageSize));
    }

    public function show(string $mrn): JsonResponse
    {
        return new JsonResponse($this->register->find($mrn)->toApiArray());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = app(Actor::class);
        $validated = $this->validate($request);

        $result = $this->register->register($validated, $actor, $validated['mrn'] ?? null);

        return new JsonResponse($result['patient']->toApiArray(), 201);
    }

    public function update(Request $request, string $mrn): JsonResponse
    {
        $actor = app(Actor::class);
        $patient = $this->register->find($mrn);

        $data = $request->validate([
            'fields' => ['required', 'array'],
            'version' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
        ]);

        $result = $this->register->correct($patient, $data['fields'], (int) $data['version'], (string) $data['reason'], $actor);

        /* A merge that changed nothing is still a successful correction — the desk asked for the state the record is
           already in, which happens whenever a retry lands after the first attempt succeeded. */
        return new JsonResponse($result['patient']->toApiArray() + ['merged' => $result['merged']]);
    }

    public function duplicates(string $mrn): JsonResponse
    {
        $patient = $this->register->find($mrn);

        return new JsonResponse(['candidates' => $this->register->duplicatesFor($patient)]);
    }

    /**
     * The registration body, checked against the contract's own requirements.
     *
     * @return array<string, mixed>
     */
    private function validate(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'nameBn' => ['nullable', 'string', 'max:120'],
            /* A registration desk in Dhaka may have a birth date, an age, or neither; demanding the one the chart is
               missing is how a desk invents an age to get past a form. */
            'dateOfBirth' => ['nullable', 'date_format:Y-m-d'],
            'age' => ['nullable', 'integer', 'min:0', 'max:130'],
            'sex' => ['required', 'in:Male,Female,Other'],
            'phone' => ['required', 'string', 'min:6', 'max:24'],
            'address' => ['nullable', 'string', 'max:240'],
            'allergies' => ['nullable', 'string', 'max:1000'],
            'payer' => ['nullable', 'in:Self pay,Corporate — BRAC,Insurance — MetLife,Govt. scheme'],
            'mrn' => ['nullable', 'string', 'max:32'],
            'duplicateAcknowledged' => ['nullable', 'boolean'],
        ]);
    }

    private function integer(mixed $value, int $default): int
    {
        if ($value === null || $value === '') {
            return $default;
        }

        return is_numeric($value) ? (int) $value : -1;
    }

    private function malformed(string $field, string $message): ProblemException
    {
        return ProblemException::of(
            'dizi.validation-failed',
            'Some fields need attention',
            400,
            "The query string cannot be read: `{$field}` {$message}.",
            ['errors' => [['field' => $field, 'message' => $message, 'code' => 'dizi.validation-failed']]],
        );
    }
}
