<?php
/**
 * The API's routes, one line per contract operation.
 *
 * Every route here is an `operationId` in `packages/contracts/openapi.json`, and `tests/Contract/ContractTest.php`
 * checks that both ways round: every registered route is an operation the contract declares, and the operations this
 * service claims to implement are the routes it actually serves. A route that exists in one and not the other is a
 * client that queues a write nobody receives.
 *
 * `dizi.idempotency` is on exactly the writes the contract marks `idempotency: required` — the queued ones. It is
 * not a decoration: a replayed write returns the original response instead of applying it twice, which is the only
 * reason a node can drain its outbox after a week offline without registering a patient twice.
 */

declare(strict_types=1);

use App\Http\Controllers\AuditController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\NodeNumberBlockController;
use App\Http\Controllers\PatientController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('health');

Route::get('/patients', [PatientController::class, 'index'])->middleware('dizi.auth:read')->name('listPatients');
Route::post('/patients', [PatientController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('createPatient');
Route::get('/patients/{mrn}', [PatientController::class, 'show'])->middleware('dizi.auth:read')->name('getPatient');
Route::get('/patients/{mrn}/duplicates', [PatientController::class, 'duplicates'])->middleware('dizi.auth:read')->name('listPatientDuplicates');
Route::patch('/patients/{mrn}', [PatientController::class, 'update'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('updatePatient');

Route::get('/node/number-blocks', NodeNumberBlockController::class)->middleware('dizi.auth:write')->name('listNumberBlocks');

Route::post('/audit', [AuditController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('appendAuditEntry');
