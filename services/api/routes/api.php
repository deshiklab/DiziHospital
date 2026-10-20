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

use App\Http\Controllers\AppointmentController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\NodeNumberBlockController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PatientController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('health');

/* The session, for any role that may read anything — which is every role the contract declares, so the ability it
   asks for is `read` rather than nothing at all: an endpoint with no check would answer a token this service has not
   looked at. */
Route::get('/me', MeController::class)->middleware('dizi.auth:read')->name('getMe');

Route::get('/patients', [PatientController::class, 'index'])->middleware('dizi.auth:read')->name('listPatients');
Route::post('/patients', [PatientController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('createPatient');
Route::get('/patients/{mrn}', [PatientController::class, 'show'])->middleware('dizi.auth:read')->name('getPatient');
Route::get('/patients/{mrn}/duplicates', [PatientController::class, 'duplicates'])->middleware('dizi.auth:read')->name('listPatientDuplicates');
Route::patch('/patients/{mrn}', [PatientController::class, 'update'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('updatePatient');

/* Appointments (P0-401). `/appointments/slots` is declared before the day list's own route because the literal path is
   what the calendar calls per doctor; the diary itself is the branch's, so all of these read from this node. */
Route::get('/appointments/slots', [AppointmentController::class, 'slots'])->middleware('dizi.auth:read')->name('listAppointmentSlots');
Route::get('/appointments', [AppointmentController::class, 'index'])->middleware('dizi.auth:read')->name('listAppointments');
Route::post('/appointments', [AppointmentController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('createAppointment');
Route::patch('/appointments/{id}', [AppointmentController::class, 'update'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('updateAppointment');
Route::post('/appointments/{id}/check-in', [AppointmentController::class, 'checkIn'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('checkInAppointment');

/* Messaging (P0-403). Two things behind one resource, and the contract's own words for the split: the board is the
   hospital's (`message.notice`, written to the branch's own table), and the delivery log is what left the building
   (`message.delivery`, appended per attempt). `/notifications/outbound` is online-only because a message that has left
   cannot be recalled — queuing it would send tomorrow one the desk expected to leave today.

   The literal paths are registered before the ones with a placeholder, which is what keeps `/notifications/outbound`
   from being read as a notice id. */
Route::get('/notifications/deliveries', [NotificationController::class, 'deliveries'])->middleware('dizi.auth:read')->name('listNotificationDeliveries');
Route::get('/notifications/templates', [NotificationController::class, 'templates'])->middleware('dizi.auth:read')->name('listNotificationTemplates');
Route::post('/notifications/deliveries/{id}/retry', [NotificationController::class, 'retry'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('retryNotificationDelivery');
Route::post('/notifications/outbound', [NotificationController::class, 'outbound'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('sendPatientMessage');
Route::get('/notifications', [NotificationController::class, 'index'])->middleware('dizi.auth:read')->name('listNotifications');
Route::post('/notifications', [NotificationController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('sendNotice');
Route::post('/notifications/{id}/receipts', [NotificationController::class, 'receipts'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('recordNoticeReceipt');

Route::get('/node/number-blocks', NodeNumberBlockController::class)->middleware('dizi.auth:write')->name('listNumberBlocks');

Route::post('/audit', [AuditController::class, 'store'])
    ->middleware(['dizi.auth:write', 'dizi.idempotency'])
    ->name('appendAuditEntry');
