<?php

declare(strict_types=1);

namespace Tests\Contract;

use App\Modules\Messaging\Delivery;
use App\Modules\Messaging\Notice;
use App\Modules\Messaging\NoticeRecipient;
use App\Modules\Modules;
use App\Modules\Scheduling\Appointment;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Route as RouteFacade;
use Tests\TestCase;

/**
 * The service against the contract, both ways round.
 *
 * `openapi.json` is the product's agreement, and this file is the API's half of keeping it: every route this service
 * registers is an operation the contract declares, at the path and method the contract declares, and every operation
 * this service *says* it implements is a route that exists. A route in one and not the other is a client queueing a
 * write nobody receives, or a document promising a screen's action that returns 404 in the field.
 *
 * The rest of the file checks the two things a skeleton is most likely to lose quietly: the seams the module table
 * advertises are bound in the container, and the entities the contract names are owned by exactly one module — or are
 * on an explicit list of ones this slice does not build yet, so a later slice cannot land and leave the list stale.
 */
final class ContractTest extends TestCase
{
    /**
     * The operations this service implements, by `operationId`.
     *
     * Written out rather than derived, because the point of the assertion below is that this list and the router agree:
     * a slice that adds a route to `routes/api.php` without adding it here fails, and so does one that adds it here
     * without a route.
     */
    private const SERVED = [
        'health',
        'getMe',
        'listPatients',
        'createPatient',
        'getPatient',
        'updatePatient',
        'listPatientDuplicates',
        'listNumberBlocks',
        'appendAuditEntry',
        'listAppointments',
        'listAppointmentSlots',
        'createAppointment',
        'updateAppointment',
        'checkInAppointment',
        'listNotifications',
        'sendNotice',
        'recordNoticeReceipt',
        'sendPatientMessage',
        'listNotificationDeliveries',
        'listNotificationTemplates',
        'retryNotificationDelivery',
    ];

    /**
     * Entities the contract names that no module in `Modules::TABLE` owns yet.
     *
     * Most of them belong to modules this slice does not build: the CMS, surveys, printing, reporting and the
     * portal-facing features all have tables in a full deployment, and none of them is one of the ten modules P0-301
     * names. They are listed so the *difference* is a decision rather than an oversight: when a slice claims one, this
     * test fails until the entity is moved out of this list, which is the moment somebody should be reading it.
     */
    private const NOT_YET_OWNED = [
        'attendance.punch',
        'branch.setting',
        'certificate.issue',
        'cms.page',
        'commission.payout',
        'content.item',
        'content.type',
        'leave.request',
        'payroll.run',
        'platform.setting',
        'portal.feedback',
        'print.template',
        'report.run',
        'report.schedule',
        'survey.assignment',
        'survey.form',
        'survey.response',
        'telemedicine.session',
        'visitor.pass',
    ];

    /** A config namespace and not a problem type: the service reading its own configuration. */
    private const CONFIG_NAMESPACES = ['dizi.node', 'dizi.auth', 'dizi.blocks', 'dizi.contract', 'dizi.oidc', 'dizi.messaging'];

    public function test_every_route_is_a_contract_operation_at_the_contracts_own_path(): void
    {
        $contract = $this->contract();

        foreach ($this->routes() as $route) {
            $name = (string) $route->getName();
            $operation = $this->operation($contract, $name);

            $this->assertNotNull($operation, "Route `{$name}` is not an operationId in the contract.");
            $this->assertIsArray($operation);

            $path = $this->contractPath($contract, $name);
            $this->assertSame('/'.ltrim($route->uri(), '/'), $path, "Route `{$name}` is registered at a different path than the contract declares.");

            foreach ($route->methods() as $method) {
                if ($method === 'HEAD') {
                    continue;
                }
                $this->assertContains($method, $this->contractMethods($contract, $name), "`{$name}` is {$method} here and something else in the contract.");
            }

            /* The placeholder names are part of the contract's promise: a generated client substitutes them, and a
               route whose placeholder is called something else produces a URL the client cannot build. */
            foreach ($this->placeholders($path) as $placeholder) {
                $this->assertStringContainsString('{'.$placeholder.'}', $route->uri(), "`{$name}` is missing the contract's `{$placeholder}` placeholder.");
            }
        }
    }

    public function test_the_service_serves_exactly_the_operations_it_declares(): void
    {
        $names = array_map(static fn (Route $route): string => (string) $route->getName(), $this->routes());

        sort($names);
        $declared = self::SERVED;
        sort($declared);

        $this->assertSame($declared, $names);

        foreach (self::SERVED as $operationId) {
            $this->assertNotNull($this->operation($this->contract(), $operationId), "`{$operationId}` is declared as served and is not in the contract.");
        }
    }

    public function test_a_write_the_contract_says_must_be_replayed_safely_carries_the_idempotency_middleware(): void
    {
        $contract = $this->contract();

        foreach ($this->routes() as $route) {
            $name = (string) $route->getName();
            $operation = $this->operation($contract, $name);
            $required = $operation['x-dizi']['idempotency'] ?? null;
            $carries = in_array('dizi.idempotency', $route->gatherMiddleware(), true);

            /* The contract's vocabulary has exactly two values, and they have to mean something here: a write marked
               `required` whose route does not carry the middleware is a queued write that can be applied twice. */
            $this->assertContains($required, ['none', 'required'], "`{$name}` declares no usable idempotency policy.");

            if ($required === 'required') {
                $this->assertTrue($carries, "`{$name}` is a queued write without the idempotency middleware.");
                $this->assertNotEmpty(array_intersect(['POST', 'PUT', 'PATCH', 'DELETE'], $route->methods()), "`{$name}` requires an idempotency key without being a write.");
            } else {
                $this->assertFalse($carries, "`{$name}` carries an idempotency key requirement the contract does not ask for.");
            }
        }
    }

    public function test_every_operation_that_needs_a_role_is_behind_the_auth_middleware(): void
    {
        foreach ($this->routes() as $route) {
            $name = (string) $route->getName();
            $middleware = $route->gatherMiddleware();
            $guarded = (bool) array_filter($middleware, static fn ($m): bool => is_string($m) && str_starts_with($m, 'dizi.auth'));

            if ($name === 'health') {
                /* The one operation that must answer without a token: it is the call that decides whether the screen
                   says "connected", and it cannot require the thing it reports on. */
                $this->assertFalse($guarded, 'Health must answer without a token.');

                continue;
            }

            $this->assertTrue($guarded, "`{$name}` is not behind the auth middleware.");
        }
    }

    public function test_the_implemented_seams_are_bound_in_the_container(): void
    {
        foreach (Modules::TABLE as $module => $detail) {
            if (! $detail['implemented']) {
                continue;
            }

            foreach ($detail['seams'] as $seam) {
                $interface = 'App\\Modules\\'.$seam;

                $this->assertTrue(interface_exists($interface), "`{$interface}` is advertised as a seam and is not an interface.");
                $this->assertInstanceOf($interface, $this->app->make($interface), "The `{$module}` module's `{$seam}` seam is not bound.");
            }
        }
    }

    public function test_the_seam_this_slice_does_not_build_yet_is_named_in_the_readme(): void
    {
        $readme = (string) file_get_contents(__DIR__.'/../../README.md');

        foreach (Modules::TABLE as $detail) {
            if ($detail['implemented']) {
                continue;
            }

            foreach ($detail['seams'] as $seam) {
                $file = 'app/Modules/'.str_replace('\\', '/', $seam).'.php';

                /* A seam that is advertised and not built is fine — it is honest. A seam nobody can find is not: the
                   README is where a reader learns what this service does not do yet and where the gap is written. */
                $this->assertStringContainsString($file, $readme, "The pending seam `{$seam}` is not named in services/api/README.md.");
            }
        }
    }

    public function test_every_entity_the_contract_names_is_owned_by_one_module_or_on_the_open_list(): void
    {
        $contract = $this->contract();
        $declared = array_keys($contract['x-dizi-entities']);

        $owned = [];
        foreach (Modules::TABLE as $module => $detail) {
            foreach ($detail['entities'] as $entity) {
                $this->assertArrayHasKey($entity, $contract['x-dizi-entities'], "The `{$module}` module claims `{$entity}`, which the contract does not name.");
                $this->assertArrayNotHasKey($entity, $owned, "`{$entity}` is claimed by two modules, which is how two modules come to write the same record.");
                $owned[$entity] = $module;
            }
        }

        $unowned = array_values(array_diff($declared, array_keys($owned)));
        sort($unowned);
        $expected = self::NOT_YET_OWNED;
        sort($expected);

        $this->assertSame($expected, $unowned, 'The set of contract entities no module owns has changed; move the entity rather than editing this list quietly.');
    }

    public function test_every_problem_code_this_service_raises_is_one_the_contract_defines(): void
    {
        $defined = array_keys($this->contract()['x-dizi-problem-types']);
        $raised = [];

        foreach (File::allFiles(__DIR__.'/../../app') as $file) {
            preg_match_all("/'(dizi\\.[a-z0-9.-]+)'/", (string) $file->getContents(), $matches);
            foreach ($matches[1] as $code) {
                $raised[$code] = true;
            }
        }

        $this->assertNotEmpty($raised, 'No problem codes found in the source, which means this check stopped working.');

        foreach (array_keys($raised) as $code) {
            if ($this->isConfigNamespace($code)) {
                continue;
            }

            /* The app branches on these codes. A refusal whose code is not in the contract is a sentence the screens
               cannot act on, and it is exactly what a hand-written `detail` string drifts into. */
            $this->assertContains($code, $defined, "`{$code}` is raised by this service and is not a problem type in the contract.");
        }
    }

    /**
     * The vocabularies the API validates against are the contract's own enums.
     *
     * This is a gate rather than a comment because it has already failed once in the other direction: the contract's
     * `Appointment.status` enum was widened to the whole queue vocabulary, the state machine learned the new moves,
     * and the controller went on validating the three statuses it had been written with. Every queue move was refused
     * as a malformed field — a 422 saying "some fields need attention" for a request that was perfectly well formed —
     * and only the CI suite saw it, because the modules' own tests exercise the module rather than the field list in
     * front of it.
     *
     * A vocabulary kept in two places drifts, so what is asserted here is that there is one.
     */
    public function test_the_vocabularies_the_service_validates_against_are_the_contracts_own_enums(): void
    {
        $contract = $this->contract();

        $this->assertSame(
            $this->enumOf($contract, 'AppointmentPatch', 'status'),
            Appointment::STATUSES,
            'The statuses the service stores are not the statuses the contract lets a client send.',
        );

        $this->assertSame(
            $contract['x-dizi-scheduling']['queueMoves'] ?? null,
            Appointment::MOVES,
            'The moves the service enforces are not the moves the contract publishes. The order matters too: the refusal lists them in it.',
        );

        $this->assertSame(
            $contract['x-dizi-scheduling']['checkInFrom'] ?? null,
            Appointment::CHECK_IN_FROM,
            'The states the contract says a patient may be checked in from are not the states the service publishes.',
        );

        /* And the published list is what the guard in `checkIn()` adds up to: the statuses that hold a slot, minus the
           ones that are already in the queue, minus the ones the visit is finished by. Written as that arithmetic
           rather than as a second list, so a change to `IN_QUEUE` cannot leave this passing for the wrong reason. */
        $this->assertSame(
            Appointment::CHECK_IN_FROM,
            array_values(array_diff(Appointment::HOLDING, Appointment::IN_QUEUE, Appointment::SETTLED)),
            'The check-in guard and the states it is published under have drifted apart.',
        );

        /* The messaging vocabulary (P0-403) is the contract's, once, for the same reason: the delivery log's statuses
           are what the screen branches on, the channels are what a driver is configured for, and a second copy of
           either is a screen offering something the service refuses. */
        $this->assertSame($this->enumOf($contract, 'NotificationDelivery', 'channel'), Delivery::CHANNELS);
        $this->assertSame($this->enumOf($contract, 'NotificationDelivery', 'status'), Delivery::STATUSES);
        $this->assertSame($this->enumOf($contract, 'OutboundMessage', 'channel'), Delivery::CHANNELS);
        $this->assertSame($this->enumOf($contract, 'NoticeSend', 'priority'), Notice::PRIORITIES);
        $this->assertSame($this->enumOf($contract, 'MessageRecipient', 'kind'), NoticeRecipient::KINDS);
        $this->assertSame($this->parameterEnumOf($contract, 'listNotifications', 'box'), Notice::BOXES);

        /* The two channels the catalogue declares are the two a message may leave by, and the events are exactly the
           events this service knows how to say something about — including the one that is deliberately quiet. */
        $this->assertSame(['whatsapp', 'email'], array_keys($contract['x-dizi-notifications']['channels']));
        $this->assertNull(
            $contract['x-dizi-notifications']['events']['encounter.signed']['template'],
            'A signed consultation is deliberately not notifiable: the clinical record is not a message to the patient, and what a patient may see is decided by the portal’s own rules after they sign in.',
        );

        $this->assertSame($this->enumOf($contract, 'AppointmentCreate', 'type'), Appointment::TYPES);
        $this->assertSame($this->enumOf($contract, 'AppointmentCreate', 'priority'), Appointment::PRIORITIES);
        $this->assertSame($this->enumOf($contract, 'AppointmentCreate', 'source'), Appointment::SOURCES);
    }

    /**
     * The enum a contract schema declares for one of its properties.
     *
     * @param  array<string, mixed>  $contract
     * @return list<string>
     */
    private function enumOf(array $contract, string $schema, string $property): array
    {
        $enum = $contract['components']['schemas'][$schema]['properties'][$property]['enum'] ?? null;

        $this->assertIsArray($enum, "`{$schema}.{$property}` is not an enum in the contract, so there is nothing to compare.");

        return array_values($enum);
    }

    /**
     * The enum one operation declares for one of its query parameters.
     *
     * The delivery log's own parameters carry the statuses a screen may filter on, and a list that lives here would be
     * a third copy of the vocabulary: one in the contract, one in the filter and one in the schema the rows are read
     * with.
     *
     * @param  array<string, mixed>  $contract
     * @return list<string>
     */
    private function parameterEnumOf(array $contract, string $operationId, string $name): array
    {
        $operation = $this->operation($contract, $operationId) ?? [];

        foreach ($operation['parameters'] ?? [] as $parameter) {
            if (($parameter['name'] ?? null) === $name) {
                $enum = $parameter['schema']['enum'] ?? null;
                $this->assertIsArray($enum, "`{$operationId}.{$name}` is not an enum in the contract, so there is nothing to compare.");

                return array_values($enum);
            }
        }

        $this->fail("`{$operationId}` declares no parameter `{$name}`, so there is nothing to compare.");

        return [];
    }

    /**
     * Every named route this service registers.
     *
     * Nothing is filtered out by hand. If a package ever registers a route of its own it will appear here and fail the
     * comparison in `test_the_service_serves_exactly_the_operations_it_declares` — which is the right outcome: an
     * endpoint nobody documented is an endpoint nobody agreed to.
     *
     * @return list<Route>
     */
    private function routes(): array
    {
        return array_values(array_filter(
            RouteFacade::getRoutes()->getRoutes(),
            static fn (Route $route): bool => $route->getName() !== null,
        ));
    }

    /**
     * `dizi.node.secret` is a config key; `dizi.forbidden` is a refusal. Only the second belongs in the contract.
     *
     * `dizi.oidc` is on the list because the JWKS is cached under a key in that namespace: it is read from `config()`
     * in the provider and written to the cache in the verifier, and neither is a sentence a screen could branch on.
     */
    private function isConfigNamespace(string $code): bool
    {
        foreach (self::CONFIG_NAMESPACES as $namespace) {
            if (str_starts_with($code, $namespace.'.')) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function contract(): array
    {
        $document = json_decode((string) file_get_contents((string) config('dizi.contract.path')), true);
        $this->assertIsArray($document, 'The contract could not be read.');

        return $document;
    }

    /** @return array<string, mixed>|null */
    private function operation(array $contract, string $operationId): ?array
    {
        foreach ($contract['paths'] as $item) {
            foreach ($item as $operation) {
                if (is_array($operation) && ($operation['operationId'] ?? null) === $operationId) {
                    return $operation;
                }
            }
        }

        return null;
    }

    private function contractPath(array $contract, string $operationId): string
    {
        foreach ($contract['paths'] as $path => $item) {
            foreach ($item as $operation) {
                if (is_array($operation) && ($operation['operationId'] ?? null) === $operationId) {
                    return (string) $path;
                }
            }
        }

        return '';
    }

    /** @return list<string> */
    private function contractMethods(array $contract, string $operationId): array
    {
        $methods = [];
        foreach ($contract['paths'] as $item) {
            foreach ($item as $method => $operation) {
                if (is_array($operation) && ($operation['operationId'] ?? null) === $operationId) {
                    $methods[] = strtoupper((string) $method);
                }
            }
        }

        return $methods;
    }

    /** @return list<string> */
    private function placeholders(string $path): array
    {
        preg_match_all('/\{([a-zA-Z0-9_]+)\}/', $path, $matches);

        return $matches[1];
    }
}
