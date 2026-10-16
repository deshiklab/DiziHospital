# services/api — the cloud tier

The API the built screens write through, and the tier the edge nodes drain into. It is a **Laravel 13 application on
PHP 8.4** serving the operations `packages/contracts/openapi.json` declares — the same contract the generated client
in `packages/contracts/dist/client.ts` is built from, and the same one `apps/web` queues its writes against.

This is the P0-207 / P0-301 slice: the skeleton that proves the shape. It is a service that answers, refuses and
records; it is not yet a service that runs a hospital.

## What it serves

Twenty-one of the contract's ninety-eight operations, one route each, at the contract's own paths (no `/api`
segment, no prettier alias):

| Operation | Route | Middleware |
|---|---|---|
| `health` | `GET /health` | — (deliberately unauthenticated: it is the call that decides whether the screen says "connected") |
| `listPatients` | `GET /patients` | `dizi.auth:read` |
| `createPatient` | `POST /patients` | `dizi.auth:write` + `dizi.idempotency` |
| `getPatient` | `GET /patients/{mrn}` | `dizi.auth:read` |
| `updatePatient` | `PATCH /patients/{mrn}` | `dizi.auth:write` + `dizi.idempotency` |
| `listPatientDuplicates` | `GET /patients/{mrn}/duplicates` | `dizi.auth:read` |
| `listNumberBlocks` | `GET /node/number-blocks` | `dizi.auth:write` |
| `appendAuditEntry` | `POST /audit` | `dizi.auth:write` + `dizi.idempotency` |
| `getMe` | `GET /me` | `dizi.auth:read` |
| `listAppointments` | `GET /appointments` | `dizi.auth:read` |
| `listAppointmentSlots` | `GET /appointments/slots` | `dizi.auth:read` |
| `createAppointment` | `POST /appointments` | `dizi.auth:write` + `dizi.idempotency` |
| `updateAppointment` | `PATCH /appointments/{id}` | `dizi.auth:write` + `dizi.idempotency` |
| `checkInAppointment` | `POST /appointments/{id}/check-in` | `dizi.auth:write` + `dizi.idempotency` |
| `listNotifications` | `GET /notifications` | `dizi.auth:read` |
| `sendNotice` | `POST /notifications` | `dizi.auth:write` + `dizi.idempotency` |
| `recordNoticeReceipt` | `POST /notifications/{id}/receipts` | `dizi.auth:write` + `dizi.idempotency` |
| `sendPatientMessage` | `POST /notifications/outbound` | `dizi.auth:write` + `dizi.idempotency` |
| `listNotificationDeliveries` | `GET /notifications/deliveries` | `dizi.auth:read` |
| `listNotificationTemplates` | `GET /notifications/templates` | `dizi.auth:read` |
| `retryNotificationDelivery` | `POST /notifications/deliveries/{id}/retry` | `dizi.auth:write` + `dizi.idempotency` |

`tests/Contract/ContractTest.php` checks that list both ways round: every registered route is an operation the contract
declares, at the contract's path and method, with the contract's own placeholder names — and every operation this
service claims is a route that exists.

## The four rules this slice is built around

**A number is drawn, not invented.** `POST /patients` mints an MRN from a range the cloud reserved to *this node*
(`GET /node/number-blocks`, which issues the range on the spot because a node must be able to come online in the
morning and then work with the uplink down). A number a client supplies is accepted only if the cloud can find the
range it belongs to. A node with nothing left gets `409 dizi.number-block-exhausted` — a made-up MRN is a number
another branch may also make up, and two patients sharing one is found months later on a results screen.

**Duplicates are advice with evidence, never a silent decision.** The rule set is *data*: weights, the veto and the two
thresholds are read out of the contract's `x-dizi-duplicate-rules`, which is the same table
`apps/web/lib/duplicate-rules.ts` reads through the generated client, so a branch that tunes a weight tunes it for the
desk form and for the API at once. A match at or above `block` is `409 dizi.duplicate-patient` carrying the candidates
and which rules matched; the desk may register anyway with `duplicateAcknowledged: true`, and who dismissed what is
written on the record. A rule the service does not know how to compute is a `503`, not a rule quietly skipped.

**A message that did not go out is a row, never a silence.** `POST /notifications/outbound` is the one operation that
puts words on a patient's telephone, and it is online-only for that reason: a message that has left cannot be recalled,
so queuing it would send tomorrow one the desk expected to leave today. Consent is per channel *and per address* — the
consent records the number it was given for, and a message goes there and nowhere else, which is why a typo at the desk
is a `422` rather than a message to a stranger. Inside the quiet hours (21:00–08:00, read on `x-dizi-scheduling`'s
timezone) a patient message is recorded as `suppressed` with `dizi.quiet-hours` and a sentence saying it is due again at
08:00 — not sent late, not dropped. A gateway that is down is a `failed` attempt carrying the gateway's own words
*before* the `502` goes back, so three failures in an hour become a visible channel rather than three sentences somebody
read once; the page says so above the rows (`alerts`), and the profile of the morning is in `counts`.

**A conflict is offered, not merged.** `PATCH /patients/{mrn}` carries the `version` the desk read and a required
`reason`. Different fields merge automatically; the same field is offered back with both values, who set the other one
and when (`409 dizi.stale-version`, `conflict.fields[].yours`/`theirs`/`theirsActor`/`theirsAt`) — and nothing is
written, including the fields that were free, because a refusal that had already applied half a correction makes the
desk's next click a decision about something they cannot see.

**A queued write is applied once.** `Idempotency-Key` (8–128 characters, `nodeId:seq` or a UUID) is the primary key of
`sync.operations`; a replay returns the first response with `X-Dizi-Replay: true`, the same key with a *different* body
is refused rather than answered with the older response, and the key's uniqueness is what settles two retries arriving
at once. Only 2xx responses are recorded, so a 500 stays retryable.

Every write also appends to the audit ledger: one row per action, hash-chained per node, `prevHash` → `hash`, and
`HashChainLedger::verify()` recomputes the chain rather than trusting it — an altered row and a deleted row are both
found, which is what `tests/Feature/AuditLedgerTest.php` proves by tampering with the table directly.

## The modules and their seams

Eleven modules, one Postgres schema each, named in `App\Modules\Modules` — the same eleven names the contract's tags
and `apps/web/lib/sync.ts` use. A module reaches another only through a named seam, and the seams are bound in
`app/Providers/ModuleServiceProvider.php`:

| Seam | Implementation | State |
|---|---|---|
| `Sync\NodePolicy` | `app/Modules/Sync/ReservedBlocks.php` | built — number ranges, leases derived with HKDF over the node's secret |
| `Registration\DuplicateRules` | `app/Modules/Registration/ContractDuplicateRules.php` | built — read from the contract, cached per process |
| `Audit\Ledger` | `app/Modules/Audit/HashChainLedger.php` | built — append-only, hash-chained per node |
| `Scheduling\AvailabilityRules` | `app/Modules/Scheduling/ContractAvailabilityRules.php` | built — the slot step, the OPD window, the timezone, the horizon and the closed day, read from `x-dizi-scheduling` in the contract |
| `Messaging\NotificationCatalogue` | `app/Modules/Messaging/ContractNotificationCatalogue.php` | built — the events, the wording in both languages, the retry policy and the quiet hours, read from `x-dizi-notifications` |
| `Messaging\SendsMessages` | `app/Modules/Messaging/ChannelSenders.php` | built — one driver per channel, and no fallback: `preview` labels every row it writes |
| **`Billing\Ledger`** | **`app/Modules/Billing/Ledger.php`** | **not built** — the billing module owes it, and this slice serves no money |

The seam a slice does not build is named in this table on purpose: `ContractTest` fails if a pending seam stops being
mentioned here, so the gap cannot quietly become a memory.

## Running it

```bash
cd services/api
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate          # creates the schemas, then the tables
php artisan dizi:modules     # what this service is made of, and whether it is in the database
php artisan serve            # http://127.0.0.1:8000
```

`php artisan dizi:modules --check` exits non-zero when a module this service claims to implement has no schema or no
tables — the state a half-run deployment is in, and the state in which one endpoint answers 500s while the next
answers 200s.

**`migrate:fresh` is not the way to start over here.** Fresh wipes the schema Laravel knows about — `public` — and
leaves `registration`, `sync` and `audit` standing, so the next `migrate` fails on tables that already exist. Use
`php artisan migrate:refresh` (which walks each migration's `down()`, and those drop the schemas) or drop the schemas
by hand. Each module's migration is what creates its schema, so nothing else has to know where they live.

### Configuration

`.env.example` names every variable; the ones worth knowing about:

* `NODE_SECRET` — the node's own secret, the HKDF key behind the leases on the number blocks reserved to it. Per node,
  never shared between branches: two branches with one secret is one branch that can mint the other's MRNs.
* `DIZI_NODE_ID` / `DIZI_BRANCH` — the default identity of this deployment. Writes are attributed to the *token's*
  node, not to these, because one cloud tier serves every branch.
* `DIZI_AUTH_DRIVER` — `preview` or `keycloak`, and there is no fallback between them on purpose: a verifier that
  falls back is one that can be made to fall back. `AUTH_PREVIEW_SECRET` signs the preview driver's own tokens.
* `OIDC_ISSUER` / `OIDC_AUDIENCE` / `OIDC_JWKS_URI` — the realm the `keycloak` driver trusts. Only read when that
  driver is selected; configured for it with no issuer, the service refuses every request rather than guessing. The
  realm is `infra/keycloak/`, and `OIDC_JWKS_URI` is an override for a deployment that fronts Keycloak under another
  name.
* `DIZI_CONTRACT_PATH` — where `openapi.json` is. The duplicate rules are read from it at runtime, and a missing or
  malformed contract is a `503` rather than a built-in default: the register must not admit patients against rules
  nobody configured.
* `APP_TIMEZONE` — **inert today, and named here so nobody assumes otherwise.** It is set to `Asia/Dhaka` in
  `.env.example` and in `phpunit.xml`, but this service ships no `config/app.php`, and Laravel's own default for that
  key is a literal `'UTC'` — so PHP runs in UTC whatever the variable says. Nothing depends on it: instants on the
  wire are UTC (`ApiTime::iso`), the branch's clock is `x-dizi-scheduling.timezone`, and the diary writes its
  timestamps in the zone Laravel reads them back in rather than in the zone it was handed. Making the variable real
  means adding `config/app.php` with `'timezone' => env('APP_TIMEZONE', 'UTC')`, which is a change to every timestamp
  this service stores and belongs to a slice that does it on purpose.
* `CACHE_STORE=array` — the rate limiter is the only thing that caches, and this service ships no cache table, so the
  600-per-minute `api` limit is per worker. A shared store is a deployment decision that arrives with the load
  balancer.

## The honest gaps in this slice

* **Both token drivers are implemented; no real Keycloak has verified one here.** `App\Modules\Identity\TokenVerifier`
  picks between two, and neither is a stub. `preview` exchanges a token this repository signs for itself
  (`<base64url(payload)>.<base64url(HMAC-SHA256)>` over `{sub, name, role, branch, node, exp}`, `hash_equals` and a
  real expiry) and is what a checkout with no identity provider runs. `keycloak` verifies a real OIDC access token:
  RS256 pinned, the key id resolved against the realm's published JWKS (cached for an hour, with one fresh fetch
  before a refusal so a rotation mid-hour is not an outage), and the issuer, audience, `azp`, `sub`, `nbf` and `exp`
  all checked — see `tests/Unit/KeycloakTokenVerifierTest.php`, which signs real tokens with a real key and proves
  each refusal. What has **not** happened is the other half: no Keycloak runs in this repository's development
  environment, so no token minted by a real realm has ever reached this service. Turning it on is
  `DIZI_AUTH_DRIVER=keycloak` + `OIDC_ISSUER`, and `infra/keycloak/README.md` says what has and has not been run.
* **A role the contract does not declare is refused, not ignored.** `realm_access.roles` is read out of
  `x-dizi-roles`; a token carrying a role that is not in that table is answered with `403 dizi.forbidden` naming the
  role, because ignoring it is how a person ends up with less access than any of their roles claims. `GET /me` is the
  same table from the other side: it answers with the abilities a person's roles add up to, so "why is this button
  missing" has an answer on screen rather than only in a log.
* **The diary is served; no real patient has been booked through it here.** `scheduling.appointments` carries the
  exclusive claim as a unique index over `slot_key` (`{doctorId}@{day}T{minute}`), so two desks claiming the last slot
  of a morning are decided by the index rather than by a check followed by a race: the loser gets
  `409 dizi.slot-taken`, the branch that holds the slot, and the next three free starts.
  `tests/Feature/AppointmentBookingTest.php` books the first of those alternatives, which is what "the conflict prompt
  is verified" means for this slice. A cancelled appointment keeps its token and clears its slot key, so a number
  already called out is never given to another patient. Not run here: these queries against Postgres (the suite is
  SQLite, and the `schema` job migrates and walks back without booking anything), and the six OPD doctors in
  `scheduling.sittings` are **seeded by the migration** — the Setup screen that edits a roster arrives with P0-402, so
  today changing a sitting is a new migration. The app's appointment screens still read `lib/mock.ts` for the same
  reason; P0-402 is the slice that points them at these five operations.
* **Nothing raises a notification event yet, and no real gateway has carried one.** `messaging.outbox` is the
  transactional half of P0-403 — an event commits with the record that caused it — and `php artisan dizi:notify` drains
  it with the backoff, the quiet hours and the retry budget the catalogue declares. The producers are the missing half:
  a paid invoice, a released result and a shelf below its re-order level belong to the billing, diagnostics and pharmacy
  modules, so today a fresh deployment's drain prints zeroes and `tests/Feature/NotificationOutboxTest.php` is what
  proves the mechanism, by raising events through the module's own method. The two real drivers (`meta-cloud` for
  WhatsApp, `smtp` for e-mail) are implemented and **have never carried a message from this repository**: there is no
  Meta account here, no mail relay, and no network to either. Everything else — the preview driver, the consent
  refusals, the masking, the quiet hours, the retry, the alerting — is exercised against SQLite, and the WhatsApp
  driver's refusal shape is tested with a faked gateway (`Http::fake`), which is a test of this service and not of Meta.
  The desk screen that records a patient's consent does not exist yet, so a send with no consent row is refused with
  `dizi.consent-missing` — the honest state of a permission table nothing writes to.
* **The sync change feed is not here.** P0-210 (cursors, batch signatures, the drain protocol) and P0-311 (nightly
  reconciliation) are the next slices. What exists is the part a node cannot start without: the reserved ranges, the
  idempotency table, and the ledger the reconciliation will walk.
* **The suite runs on SQLite.** The module schemas are Postgres-only, so `App\Support\ModuleSchema` spells them as
  prefixes on SQLite (`registration_patients`) and the tests keep working without a database container. The
  Postgres-specific half — schema creation and grants — is proved by the `schema` job in
  [`.github/workflows/ci-api.yml`](../../.github/workflows/ci-api.yml), which migrates a real Postgres 18, checks the
  modules, then walks every migration back down and up again. Row locks and partial-index behaviour are not covered by
  either.
* **Every test uses the file's own node.** Nothing here proves two nodes draining the same MRN range, or two nodes
  correcting the same patient over the wire; what is proved is what one node does when it is told about it.
* **No Octane, Horizon, Reverb or Pulse**, by decision rather than omission (P0-301): the service is a queue-driven
  worker later, and the sync engine's own protocol comes first.

## Working on it in this repository

**PHP and Composer cannot be run from this repository's development environment.** Packagist is reachable from GitHub
Actions and nowhere else, so `composer install` happens in CI and the limitation is a fact about the environment
rather than a preference. What that means in practice:

```bash
npm run api:lint      # parses every file in services/api with PHP compiled to WebAssembly (needs `npm i --no-save php-wasm`)
npm run api:style     # the rules pint.json pins, checked without PHP (no dependencies; runs in the ci-app job)
```

`tools/ci/php-lint.mjs` is a syntax gate: it catches a typo in a second instead of a CI round trip. It loads no
framework and touches no database, so **types, behaviour and the contract are proved by the `ci-api` job** — PHP 8.4
via `shivammathur/setup-php`, `php -l` over every file, `vendor/bin/pint --test` and `vendor/bin/phpunit`.

`pint.json` names both halves of the style that judges this code: the `laravel` preset as the base, and the rules this
service pins on top of it — including `braces`, whose default position differs from the preset's and is the reason
methods here open on the next line. Naming them keeps the rules a block a reviewer can argue with rather than a
default that moves when the tool does, and `composer.lock` pins the Pint version that applies them. The half a reader
can check without a parser — unused imports, import order, quoting, `!` spacing, the `declare` prologue, file endings
— is checked by [`tools/ci/php-style.mjs`](../../tools/ci/php-style.mjs), which needs no dependencies and runs in the
`ci-app` job on every pull request as well as here. The rest is left to Pint rather than approximated, because a second
implementation that disagrees with Pint is worse than no check at all.

`composer.lock` is committed. It was resolved by the `ci-api` runner — the only place in this project that can reach
packagist — and committed by that same job, once, in a step that then came back out along with the write-scoped token
it needed; every install since is from the lock, so the versions a green run was proved against are the versions the
next one gets. Regenerating the lock means a machine that can reach packagist, or restoring that bootstrap.

## Layout

```
app/Console/Commands/ModulesCommand.php   php artisan dizi:modules
app/Exceptions/ProblemRenderer.php        every failure as RFC 9457 application/problem+json
app/Http/Controllers/                     one class per contract resource; no rules live here
app/Http/Middleware/                      trace id, token + role, idempotency key
app/Modules/Modules.php                   the eleven modules, their schemas, their entities, their seams
app/Modules/{Identity,Sync,Registration,Audit,Scheduling,Messaging}/   what this slice builds
app/Support/                              ApiTime, Trace, ProblemException, ModuleSchema
database/migrations/                      one migration per module: the schema, then its tables
tests/{Unit,Feature,Contract}/            the rules, the operations, and the agreement with the contract
```
