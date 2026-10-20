<?php

declare(strict_types=1);

namespace App\Modules\Registration;

/**
 * The tunable duplicate rule set — the seam between the register and the rules that decide what "the same person"
 * means.
 *
 * It is an interface for one reason: the rules are *data*, and where the data comes from is a deployment decision.
 * In this service they are read from the published contract, which is the same table `apps/web/lib/duplicate-rules.ts`
 * reads through the generated client, so a branch that tunes a weight tunes it for the desk form and for the API at
 * once. A second copy of the rules inside a controller is how a duplicate comes in through the front door and a
 * false match is flagged at the back.
 */
interface DuplicateRules
{
    /** @return array{warn: float, block: float} */
    public function thresholds(): array;

    /**
     * @return list<array{id: string, signal: string, weight: float, veto: bool, label: string, when: string}>
     */
    public function rules(): array;
}
