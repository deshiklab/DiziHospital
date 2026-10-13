# 01 — Strategy & Target Architecture

## 1. Where we are today

Observed from the live capture (`capture/`), not from documentation claims:

| Dimension | Reality |
|---|---|
| Stack | PHP CodeIgniter (server-rendered views), MySQL, Bootstrap + jQuery + DataTables, Chart.js |
| UI | Full page reload per action; 76 screens; 96 add/edit dialogs pre-rendered in the DOM (one page renders 34 forms); 597 grids, 441 tabs, 978 filter controls |
| Forms | 9,568 rendered field instances across 389 distinct field names; text 52 %, select 23 %, textarea 11 % |
| Navigation | 5 sections → 30 menu items → 76 screens; no command palette; patient search matches name only |
| Users | 9 staff roles + patient portal; hospital LAN desktops, some tablets, counter keyboards/scanners |
| Quality gaps | KPIs contradict themselves (56 % vs 30/54), currency hard-coded `$`, mojibake in clinical headers, destructive bulk delete without confirmation, no allergy checking at dispense, no API, no automated tests, no observability, backups only manual |
| Strengths to preserve | Genuine clinical depth (14-tab IPD case, vitals, obstetric history, ICD-10), true RBAC, complete revenue cycle, multi-branch, fast vendor cadence (v7.0 shipped theme, WhatsApp, surveys, ICD-10) |

## 2. Constraints and drivers

1. **A running hospital cannot stop.** Any plan that requires a freeze longer than a weekend is rejected.
2. **Clinicians' muscle memory is an asset.** The new UI must be faster for the same tasks, not merely prettier.
3. **Data is the crown jewel.** Clinical, billing and legal records must be migrated with reconcilable proof.
4. **Hardware is real.** Barcode scanners as keyboard wedges, label/receipt printers, A4 reports, occasional tablets, intermittent Wi-Fi.
5. **Small team.** The team must favour a single language and few moving parts per phase.
6. **Licensing.** Regular CodeCanyon licence — private fork, no redistribution (see README decision D1/legal note).

## 3. Options considered

| Option | What it means | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Harden in place** | Keep CodeIgniter views, restyle with the vendor theme, fix bugs from the backlog | Cheapest, fastest cosmetic win | Does not fix architecture, performance, a11y, testability or the DOM weight; the redesign would be superficial | Rejected as the main strategy; **still do the P0 bug fixes** (KPI, currency, delete safety, encoding) |
| **B. Big-bang rewrite** | Build a complete replacement and switch over on a launch date | Single clean architecture | 12–18 months of parallel cost, no user feedback until the end, enormous cutover risk, scope inevitably grows | Rejected |
| **C. Strangler fig, module by module** | New app + API in front; replace modules one at a time behind a router; legacy shrinks | Value every 3–6 weeks, real feedback, reversible, pilotable per department, preserves clinical depth where it exists | Requires disciplined boundaries, dual-run of two UIs, temporary duplication | **Chosen** |

### Why C wins for this product
The legacy app is **function-rich but architecture-poor**. The risk is not that features are missing — it is
that the delivery model cannot improve safely. Strangler lets us keep the 200+ behaviours we catalogued while
changing how they are built and used, and every phase ends with something a nurse or clerk can actually use.

## 4. Target architecture

### 4.1 Runtime topology

```
                        ┌──────────────────────────────────────────┐
  Browsers (staff)  ──▶ │  Edge router (Traefik/NGINX)             │
  Tablets (wards)       │  /            → new web app              │
  Patient portal    ──▶ │  /legacy/**   → CodeIgniter app          │
  Public website        │  /api/**      → new API                  │
                        └───────┬───────────────┬──────────────────┘
                                │               │
                 ┌──────────────▼───┐     ┌─────▼─────────────────────────┐
                 │ dizi-web         │     │ dizi-api                      │
                 │ Next.js + TS     │     │ Domain modules:               │
                 │ design system    │     │  identity · patients ·        │
                 │ PWA, offline Q   │     │  scheduling · encounters ·    │
                 │ BFF routes       │     │  orders · pharmacy · billing ·│
                 └──────┬───────────┘     │  inventory · hr · admin ·     │
                        │ /api/v1         │  documents · notifications    │
                        └────────────────▶└──┬──────┬──────┬──────────────┘
                                            │      │      │
                              MySQL 8 (shared,  Redis  S3/MinIO
                              schema-owned per   cache,  (reports, scans,
                              module via views)  queues,  certificates)
                                                 flags
                                            │
                              Outbox → worker: WhatsApp/SMS/e-mail/push,
                              PDF render, DICOM/lab adapters, webhooks
```

### 4.2 Component responsibilities

| Component | Responsibility | Notes |
|---|---|---|
| **Edge router** | Path-based routing to new or legacy app, TLS, rate limiting, request IDs | The strangler switch lives here — one line flips a screen back if needed |
| **dizi-web** | All new UI, PWA, offline queue, print layouts | Talks only to `dizi-api` plus BFF routes for aggregation |
| **dizi-api** | Domain logic, validation, authorisation, transactional integrity, audit | OpenAPI-first; each module owns its tables (or reads legacy via views) |
| **Legacy adapter** | Where a new module needs legacy data during transition: read views, read-only repositories, or RPC to a legacy endpoint | Explicitly temporary; every adapter carries a removal date |
| **Worker** | Outbox consumer: notifications, PDF generation, nightly reconciliation, report materialisation | Idempotent, retry with backoff, dead-letter queue |
| **Scheduler** | Slot generation, reminders ladder, no-show detection, daily KPI rollups, backup verification | Cron container with leader election |
| **Identity** | Keycloak (OIDC): passwords, TOTP/WebAuthn MFA, sessions, role claims | Self-hostable — important for on-prem hospitals; syncs roles from HR |
| **Observability** | OpenTelemetry traces, Prometheus/Grafana, Loki logs, Sentry errors, audit ledger | Audit ledger is append-only, hash-chained, separate from app logs |

### 4.3 Data strategy

* **MySQL 8 stays the system of record initially.** Migrating the engine while rebuilding the UI is two
  risky changes at once. Re-evaluation trigger for PostgreSQL: analytics workload, JSONB-heavy features
  (custom fields, dynamic forms) or partitioning needs — recorded in `adr/0004-database-engine.md`.
* **Schema ownership.** New modules create their own tables and **never** write to legacy tables directly;
  where existing data is needed they read through **views** (`v_patient`, `v_visit`, `v_invoice`) owned by
  a documented adapter. This keeps the legacy app working while preventing two writers on one table.
* **Every write is audited** (who, what, before/after diff) in the ledger — required for clinical and legal
  traceability, and the reason we can safely delete nothing.
* **Migrations** are versioned files in the repo, forward-only with tested rollback scripts; production
  migrations run in CI with a dry-run against a restored production snapshot.
* **Files** move from `uploads/` to S3-compatible object storage with signed URLs; a migration job copies
  and verifies checksums; the legacy path stays readable until its module is retired.

### 4.4 API and integration contracts

| Concern | Decision |
|---|---|
| Style | REST/JSON, resource + action endpoints where a state machine exists (`POST /encounters/{id}:sign`) |
| Spec | OpenAPI 3.1 generated from code, published as the contract; client types generated from it |
| Versioning | `/api/v1`; additive changes only inside a version; deprecation headers with 2 release cycles |
| Auth | OIDC bearer tokens from Keycloak; short-lived access (10 min) + rotating refresh; service tokens for adapters |
| Authorisation | Role + attribute policies (`can("prescribe", patient)`), never UI-only; every endpoint tested for the 9 roles |
| Errors | RFC 9457 problem+json with a stable `type`, human message and field-level details |
| Idempotency | `Idempotency-Key` required on money/clinical writes (billing, dispense, results) |
| Events | Transactional outbox → worker. Domain events: `patient.registered`, `appointment.booked`, `encounter.signed`, `invoice.paid`, `result.released`, `stock.low` |
| Webhooks | Outbound to hospital systems with HMAC signature, retries, replay endpoint |
| External adapters | Lab analyzers (HL7 v2 / ASTM), PACS (DICOMweb), payments (gateway + UPI), messaging (Meta WhatsApp Cloud API, Twilio, SMS gateway, SMTP), Zoom, biometric/QR attendance, e-signature |
| Interoperability roadmap | FHIR R4 façade for Patient/Encounter/Observation/DiagnosticReport/Invoice; ABDM (ABHA) linking where the hospital operates in India |

### 4.5 Non-functional requirements (enforced in CI)

| Area | Requirement |
|---|---|
| Performance | p95 API < 300 ms server time; LCP < 2 s on the hospital LAN profile; grids first page < 1 s for 100 k rows; report queries < 5 s (materialised beyond that) |
| Availability | 99.5 % during OPD hours; planned maintenance only 01:00–04:00 with a published calendar |
| Durability | RPO 15 min (binlog shipping), RTO 1 h; restore drill quarterly, evidence stored in the repo |
| Capacity | 500 k patients, 5 M invoices, 20 M audit rows without degradation — server-side pagination everywhere |
| Security | OWASP ASVS L2; MFA mandatory for privileged roles; least-privilege DB accounts; secrets in Vault/SOPS; field-level encryption for national IDs and insurance data |
| Privacy | Configurable retention and redaction; access logs for record views; export/erasure workflow for patient requests (DPDP/GDPR-style); no PII in logs |
| Accessibility | WCAG 2.2 AA, keyboard-complete, screen-reader tested per release |
| Localisation | `en` + `bn-BD` at launch, RTL-ready layout, per-tenant currency/date/timezone/number formats |
| Offline | Ward PWA queues vitals/notes for ≤ 4 h and reconciles without data loss |
| Print | A4/A5/thermal templates with per-module headers, QR/barcode, preview before print |
| Browser support | Current + previous Chrome/Edge/Firefox; Safari on iPad; no IE |

## 5. Repository and environment layout

The current repo becomes the home of the new system; the legacy app lives beside it untouched.

```
/apps/web                 Next.js application (new UI)
/apps/api                 API service (domain modules)
/apps/worker              outbox consumer, schedulers, report jobs
/packages/ui              design system components
/packages/tokens          design tokens (source) + generated CSS/TS
/packages/contracts       OpenAPI spec + generated clients/types
/services/adapters/*      lab, pacs, messaging, payment adapters
/legacy/smart-hospital    the CodeCanyon source (private fork, vendor-update branch)
/infra                    Docker Compose (pilot), Terraform/K8s (scale), backup scripts
/tools                    capture, docs and plan generators (already here)
/docs                     this plan + product documentation + help library
```

| Environment | Purpose | Data |
|---|---|---|
| `local` | Developer machines, docker compose, seeded synthetic data | synthetic |
| `ci` | Build, tests, migrations dry-run | synthetic |
| `preview` | One per pull request (ephemeral) | anonymised subset |
| `staging` | UAT, clinical validation, migration rehearsals, training | refreshed anonymised production copy |
| `pilot` | One department live on new modules | production + legacy |
| `production` | Hospital | production |

## 6. Architecture decision records

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-modernization-strategy.md) | Strangler-fig, module-by-module replacement instead of rewrite | Accepted |
| [0002](adr/0002-frontend-stack.md) | Next.js + TypeScript + Tailwind + Radix/shadcn + TanStack | Proposed (D3) |
| [0003](adr/0003-api-and-auth.md) | OpenAPI-first REST API; Keycloak OIDC with mandatory MFA | Proposed (D2/D4) |
| [0004](adr/0004-database-engine.md) | Keep MySQL 8 as system of record; PostgreSQL only for the analytics warehouse | Accepted |
| [0005](adr/0005-licensing-and-vendor-updates.md) | Private fork; vendor updates merged through a controlled branch | Accepted |

## 7. What this buys the hospital

1. **Screens that load instantly and survive bad Wi-Fi** (PWA + server-side paging).
2. **Fewer clicks and fewer errors**: patient context always visible, allergy alerts, scanner-first inputs.
3. **Safe money and safe medicine**: idempotent billing writes, batch/expiry guards, reconciliation reports.
4. **A real API** so kiosks, the patient app, labs and payers can integrate without screen scraping.
5. **Evidence for quality**: audit ledger, automated tests, restore drills, accessibility conformance.
