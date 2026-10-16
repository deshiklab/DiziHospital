# ADR 0003 — API style and authentication

* Status: **Accepted** — decisions **D2 = Laravel (latest)** and **D4 = hybrid** (2026-10-14)
* Date: 2026-10-14
* Deciders: tech lead, security owner, clinical owner

## Context
The legacy app has no API: every integration is screen-based, and the patient portal, WhatsApp and mobile app
all depend on the vendor's own endpoints. We need an API for the new UI, integrations (lab, PACS, payments,
messaging) and future products (kiosk, mobile, partner hospitals). Authentication today is per-app sessions with
optional TOTP 2FA, and privileged accounts are not forced to enrol.

## Decision
1. **API**: REST/JSON, OpenAPI 3.1 as the contract, generated clients in `packages/contracts`, `/api/v1` with
   additive-only evolution, RFC 9457 problem responses, `Idempotency-Key` required on money and clinical writes,
   transactional outbox for domain events.
2. **Backend runtime**: **Laravel 13 on PHP 8.4** (D2 = latest; Laravel 13 supports PHP 8.3–8.5 and is
   security-supported to March 2028). Production runtime: Octane on FrankenPHP for concurrency; Horizon for
   queues; Reverb for live updates; Sanctum for first-party tokens; Pulse/Telescope for local observability.
   Note that the legacy application is a black box (D1), so Laravel's advantage here is team continuity and
   delivery speed, **not** code sharing with the legacy system — there is no shared code and no shared schema.
   Alternative recorded and rejected for now: NestJS/TypeScript (one language end-to-end, but a second
   runtime and a second hiring profile).
3. **Identity**: Keycloak, self-hosted **on the edge node** so staff login works with the uplink down, with a
   cloud Keycloak for the patient portal and remote staff federated one-way from the edge; OIDC; short-lived
   access tokens; rotating refresh; **MFA mandatory** for Super Admin, Admin, Doctor, Pharmacist, Accountant and any role that can
   access clinical or financial records; WebAuthn supported for admins; password policy and lockout enforced.
4. **Authorisation**: policy layer in the API (`can(action, resource)`), role + attribute based; every endpoint
   has a test asserting behaviour for all nine roles; UI hides what the API forbids, never the reverse.
5. **Audit**: all writes emit an append-only, hash-chained audit event (actor, action, resource, before/after),
   queryable from the admin UI and exportable for inspections.

## Status of the identity decision (2026-10-16, ticket P0-205 / #24)

What is **built** and what is **not**, because “Keycloak is the identity provider” is an accepted decision and not a
deployment that has happened:

* **Built.** The realm is a file in this repository (`infra/keycloak/realm-dizihospital.json`): the nine legacy roles
  plus `auditor`, the `dizi-web` public client with PKCE S256, the bearer-only `dizi-api`, the mappers that put the
  roles, the branch, the node and the staff id into the token, the forced `CONFIGURE_TOTP` and
  `CONFIGURE_RECOVERY_AUTHN_CODES`, the twelve-character password policy, the lockout, TOTP, and Bangla as the
  default locale. The app's half is `apps/web/lib/auth.ts` plus the two pages that use it; the API's half is the
  `keycloak` driver in `App\Modules\Identity\KeycloakTokenVerifier`. `packages/contracts/check.mjs` reads the realm
  and holds it to the role table in `x-dizi-roles`, so a role renamed in one and not the other fails the build
  rather than a sign-in.
* **The nine roles are mapped in the open.** `x-dizi-roles` carries each legacy role's abilities, the shell it lands
  on and the number of screens the legacy system reached with it (from `docs/FEATURE-CATALOG.md` §5) — the mapping
  described below, as data the app, the API and the realm all read rather than as prose only a reader sees.
* **Not proved here.** No Keycloak runs in this repository's development environment, so no staff member has signed
  in against a real realm, no one-time code has been verified by a real Keycloak and no recovery code has been
  printed. The client flow is proved against a provider that behaves like Keycloak (`npm run test:auth`) and the
  verifying half against real RS256 signatures in CI (`tests/Unit/KeycloakTokenVerifierTest.php`). The first person
  with docker should import the realm, run `infra/keycloak/provision.mjs --check` against it, and sign in once.
* **Still open from this decision.** WebAuthn for the two admin roles is configured in the realm and not yet exercised;
  the one-way federation from the edge realm to the cloud one for the portal and remote staff is the cloud Keycloak's
  own deployment (P0-108 / ticket #16 owns the container; the portal's sign-in is a later phase); and the legacy
  session bridge (dual-read, then the assisted reset at the pilot desk) is the migration work in
  `docs/plan/06-DATA-MIGRATION-AND-ROLLOUT.md`, not code in this repository.

## Consequences
* The legacy app and the new API share one identity provider; a bridging adapter keeps legacy sessions valid
  until the last legacy screen retires.
* Mandatory MFA will slow the first login for privileged staff; onboarding includes assisted enrolment and
  recovery codes, and the change is communicated before enforcement.
* Locking in Laravel means a PHP runtime stays in production; that is accepted in exchange for delivery speed.
