<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\ApiTime;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * `GET /health` — the call the app makes before it decides what to tell the desk.
 *
 * Two things it deliberately does not do: it does not report a bare 200 while the database is unreachable, and it does
 * not fail with a 5xx when the database is unreachable. The contract's enum has a `degraded` status for exactly this,
 * because the useful answer to "am I connected?" is not a boolean — the cloud tier can be up with its database down,
 * and a screen that showed a green pill through that would be lying at the moment it mattered.
 *
 * `replicaLagSeconds` is absent here rather than reported as zero. This is the cloud tier: it has no replica of itself
 * to be behind. The field belongs to an edge node's answer, describing how far behind the branch's local replica is,
 * and reporting a made-up zero from here would be a number the screens stamp on cached reads for no reason.
 */
final class HealthController
{
    public function __invoke(): JsonResponse
    {
        $status = 'ok';
        $detail = null;

        try {
            DB::select('select 1');
        } catch (Throwable $e) {
            $status = 'degraded';
            $detail = 'The database is not answering, so nothing can be written or read. Queued writes are kept.';
        }

        $body = [
            'status' => $status,
            'tier' => 'cloud',
            'version' => $this->contractVersion(),
            'checkedAt' => ApiTime::iso(ApiTime::now()),
        ];

        if ($detail !== null) {
            $body['detail'] = $detail;
        }

        return new JsonResponse($body);
    }

    /**
     * The version of the contract this service serves.
     *
     * Read from the contract rather than from a constant here, because the two drifting apart is the failure this
     * number exists to catch: an app on a newer contract and a service on an older one see it in the health response
     * before anybody spends an afternoon on a mystery.
     */
    private function contractVersion(): string
    {
        $path = (string) config('dizi.contract.path');
        if (! is_file($path)) {
            return 'unknown';
        }

        $document = json_decode((string) file_get_contents($path), true);

        return is_array($document) && is_string($document['info']['version'] ?? null)
            ? $document['info']['version']
            : 'unknown';
    }
}
