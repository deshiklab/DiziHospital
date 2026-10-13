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

## Consequences
* The legacy app and the new API share one identity provider; a bridging adapter keeps legacy sessions valid
  until the last legacy screen retires.
* Mandatory MFA will slow the first login for privileged staff; onboarding includes assisted enrolment and
  recovery codes, and the change is communicated before enforcement.
* Locking in Laravel means a PHP runtime stays in production; that is accepted in exchange for delivery speed.
