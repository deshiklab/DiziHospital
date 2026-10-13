# 01 — Strategy & Target Architecture

## 1. Where we are today

Observed from the live capture (`capture/`), not from documentation claims:

| Dimension | Reality |
|---|---|
| Stack | PHP CodeIgniter (server-rendered views), MySQL, Bootstrap + jQuery + DataTables, Chart.js — **supplied and maintained by the vendor; we hold no source code** |
| UI | Full page reload per action; 76 screens; 96 add/edit dialogs pre-rendered in the DOM (one page renders 34 forms); 597 grids, 441 tabs, 978 filter controls |
| Forms | 9,568 rendered field instances across 389 distinct field names; text 52 %, select 23 %, textarea 11 % |
| Navigation | 5 sections → 30 menu items → 76 screens; no command palette; patient search matches name only |
| Users | 9 staff roles + patient portal; hospital LAN desktops, some tablets, counter keyboards/scanners |
| Quality gaps | KPIs contradict themselves (56 % vs 30/54), currency hard-coded `$`, mojibake in clinical headers, destructive bulk delete without confirmation, no allergy checking at dispense, no API, no automated tests, no observability, backups only manual |
| Strengths to preserve | Genuine clinical depth (14-tab IPD case, vitals, obstetric history, ICD-10), true RBAC, complete revenue cycle, multi-branch, fast vendor cadence (v7.0 shipped theme, WhatsApp, surveys, ICD-10) |

## 2. The constraint that shapes everything (D1)

**We do not have the vendor's source code, so the legacy application cannot be changed by us.** No fork, no
patch, no hook, no vendor merge, no routing change inside it, no fix of the bugs the capture found. This is not
a detail — it removes the assumptions most modernization plans are built on.

| What this removes | What replaces it |
|---|---|
| Forking the app and merging vendor updates | A **vendor relationship policy** (ADR 0005): request, don't patch; keep the subscription valid; exit deliberately |
| Strangling at the code level (shared tables, in-app route switches) | A **module ownership registry** + phased, dated cutovers (`08` §5) |
| Fixing the legacy UX bugs ourselves | A ranked **vendor request list** — the vendor ships often, and ten concrete, well-evidenced requests have a real chance of landing in a release |
| Reading their code to learn the data model | Our **capture** (76 screens, 9,568 field instances, every dialog) plus the mirrored vendor documentation — our black-box specification |
| Deriving our new code from theirs | **Clean-room discipline** (`05`): the new platform is written from observed behaviour and documented requirements only |

The upside: we are free of code-level entanglement, and the new platform can be architected purely for the
future — offline-first, API-first, test-first — instead of inheriting the old design.

## 3. Constraints and drivers

1. **The hospital cannot stop.** No freeze longer than a weekend; no module without a rehearsed rollback.
2. **Clinicians' muscle memory is an asset.** The new UI must be faster at the same tasks, not merely prettier.
3. **Data is the crown jewel, and it is not fully under our control.** Extraction depends on vendor access
   (question O1) — so access is a week-1 contractual item, not a Phase-4 surprise.
4. **The internet is not reliable.** Clinical work must continue on the hospital LAN with the uplink down
   (decision D4). This is an architectural requirement, not a feature.
5. **Hardware is real.** Barcode scanners as keyboard wedges, label/receipt printers, A4 reports, ward tablets.
6. **Small team.** One language on the front end, one on the back end, few moving parts per phase, boring
   technology where possible.
7. **Legal cleanliness.** No vendor code or assets in our repository, and no redistribution of vendor work —
   which also means we are free to license and sell *our* platform later (ADR 0005).

## 4. Options considered

| Option | What it means | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Ask the vendor to improve** | Stay where we are; file the backlog items (currency, KPI, delete safety, encoding) as vendor requests; wait | Near-zero effort; vendor ships frequently | We control neither the roadmap nor the outcome; architecture, performance, accessibility and testability stay as they are | **Not a strategy — a parallel track.** Worth doing for safety-critical items |
| **B. Big-bang replacement** | Build the whole system, switch on one date, cancel the vendor | Single clean cutover; one system at the end | 13–16 months of parallel cost with no user feedback; the biggest possible cutover risk; scope growth is the norm in hospital ERP | Rejected |
| **C. Phased replacement from the outside** | Standalone new platform; one-way read bridge; module ownership moves one business module at a time; write-bridge only where unavoidable | Value every 4–6 weeks; reversible; pilotable per department; works with a black-box legacy system; the LAN keeps running when the internet dies | Two systems live for months; two logins; data must be reconciled; bridge engineering is real work (~115 days) | **Chosen** |

### Why C wins here
The risk in this programme is not missing features — the capture shows the product is functionally rich. The
risk is that **we cannot change the system we depend on**, so every change must be additive: build beside it,
prove parity with real data, move ownership once, and never put the hospital's operations in a blind alley. C
is the only option that delivers a modern UI without requiring anyone's permission or a stop-the-world switch.

## 5. Target architecture

### 5.1 Runtime topology — hub and edge (D4)

```
        CLOUD TIER — remote access, long-term record, off-site backup, analytics
        ┌──────────────────────────────────────────────────────────────────────────┐
        │ dizi-api (cloud replica, read-mostly)   patient portal · public website  │
        │ analytics warehouse (PostgreSQL)        monitoring · alerting · uptime   │
        │ package & release distribution          off-site backups (3-2-1)         │
        │ Keycloak (patients, remote staff; federated from the edge)               │
        └───────────────▲──────────────────────────────────────────┬───────────────┘
                        │  mTLS · signed change-feed batches       │  read-only pulls
                        │  (store & forward, resumable)            │
        ┌───────────────┴──────────────────────────────────────────▼───────────────┐
        │ HOSPITAL LAN — EDGE NODE = system of record for clinical work            │
        │  dizi-api (Laravel 13, Octane)   dizi-web (Next.js)   PostgreSQL 18      │
        │  Redis (cache/queues)   MinIO (documents)   Reverb (live updates)        │
        │  Keycloak (staff identity — works with the uplink down)                  │
        │  printers · label/receipt · scanners · lab & PACS adapters · backups     │
        └───────────────▲──────────────────────────────────────────────────────────┘
                        │  local HTTPS (no internet needed)
        ┌───────────────┴──────────────────────────────────────────────────────────┐
        │ Staff desktops · ward tablets · PWA with offline write queue (≤ 4 h)     │
        └──────────────────────────────────────────────────────────────────────────┘

        Legacy Smart Hospital instance (vendor cloud) — read by the bridge, shrinks module by module
```

**Multi-site (O3 = 2–3 branch hospitals).** The topologies above repeat per branch: every branch has its own
edge node (authoritative for that branch's clinical work, working with its own WAN down), and the cloud tier is
the single authority for master data, cross-branch visibility, consolidated reporting and off-site backup. See
§5.7 for the rules that make that safe.

**Which tier owns what**

| Concern | Edge node (LAN) | Cloud |
|---|---|---|
| Clinical work (registration, OPD, IPD, pharmacy, lab, billing) | **Authoritative** | Replica + remote read, analytics |
| Staff identity | **Authoritative** (Keycloak on the edge) | Federated copy for remote staff |
| Patient portal, website, remote consultations | Serves local traffic if reachable | **Authoritative** |
| Documents and scans | Originals + cache | Off-site backup copy |
| Backups | Local WAL/archive + nightly dump | **Off-site** copy, restore drills |
| Updates, patches, monitoring | Pulls signed releases | **Distribution + alerting** |
| Analytics and management dashboards | Light local views | **Authoritative warehouse** |

**Site modes, explicitly switched and audited.** Each site has a mode: `edge-authoritative` (normal) or
`cloud-direct` (uplink down but cloud reachable from staff devices — e.g. a remote clinic, or an edge node
under repair). The switch is an admin action recorded in the audit ledger, and the UI shows the mode at all
times so nobody has to guess which system is authoritative.

### 5.2 The sync engine (the piece that makes hybrid safe)

| Aspect | Decision |
|---|---|
| Model | Store-and-forward, **log-based**: every change lands in a `sync_changes` table (monotonic per-node sequence, ULID record id, entity class, operation, payload hash, logical clock) |
| Transport | Batch push/pull over mTLS with resumable cursors; batches are signed and content-hashed; a lost connection resumes from the last acknowledged cursor |
| Idempotency | Client-generated **ULIDs** as primary keys + an `applied_changes` ledger, so replaying a batch can never duplicate a record |
| Identifier collisions | Each node holds **pre-allocated number blocks** (invoice, receipt, sample, accession, admission numbers). Offline creation takes the next number from its own block, so two nodes can never mint the same number |
| Conflict policy | Per entity class, never global (table below) |
| Authority | One writer per entity (see §5.4). A conflicting write is never silently merged into a clinical or financial record |
| Observability | Sync lag, queue depth, applied/failed counts, conflict count as first-class metrics with alerts; the UI shows the same numbers staff see (a "N records waiting to sync" pill) |
| Security | mTLS with per-node certificates, encrypted storage on the edge, encrypted backups, no PII in sync logs, batch signatures verified both ways |
| Recovery | If the edge node dies: restore from its own backup (RTO 1 h), or promote the cloud replica for `cloud-direct` operation while the node is rebuilt |

**Conflict policy by entity class**

| Entity class | Policy | Rationale |
|---|---|---|
| Append-only clinical events (vitals, nurse notes, IPD observations, results, audit entries) | **Union merge** by ULID — no conflicts possible | Two clinicians documenting the same patient are adding facts, not competing for a field |
| Patient demographics, contacts | **Field-level last-writer-wins** + a conflict-entry review queue when both sides changed the same field | Nobody's edit disappears silently; the review queue makes divergence visible to the front desk |
| Appointments, scheduling, slots | **Origin-authoritative**: the node that created the slot owns it; a cross-node clash raises a staff prompt | Scheduling is a booking, not a merge |
| Pharmacy, inventory, consumables | **Per-location ledgers**, never a single global counter; inter-location movements are explicit transfer records | The only correct model of stock is per-location; global counters are how stock goes missing |
| Billing, invoices, receipts, payments | **Origin-authoritative and immutable after issue**; corrections are new documents (credit note) | Money documents are legal artefacts; they are issued, not edited |
| Master data (charges, catalogues, ICD-10, users, roles) | **Cloud-authoritative**, distributed to edges as signed read-only packages | One definition of a price or a role, everywhere, is worth the wait |

### 5.3 Component responsibilities

| Component | Responsibility | Notes |
|---|---|---|
| **Edge node** | Runs the whole product on the LAN: API, web app, database, storage, identity, queues, integrations, local backup | Packaged as a reproducible bundle (Docker Compose on one appliance, or a 2-node HA pair: app + DB with streaming replication) |
| **dizi-web** | All new UI, PWA, offline queue, print layouts | Talks only to `dizi-api`; server components for read-heavy pages |
| **dizi-api** | Domain logic, validation, authorisation, transactions, audit, sync | Laravel 13 on PHP 8.4, Octane/FrankenPHP for concurrency; OpenAPI-first |
| **Sync service** | Change feed, batches, conflict queue, number-block allocation, lag metrics | Runs on both tiers; the only component that talks across the boundary |
| **Bridge service** | Extract from legacy (watermark + tombstones), validate, transform, upsert with provenance | One-way; contract-tested per source table; **never** a live dependency of a request path (`08`) |
| **Worker** | Outbox consumer: notifications, PDF rendering, report materialisation, nightly reconciliation | Idempotent, retries with backoff, dead-letter queue, visible in Grafana |
| **Scheduler** | Slot generation, reminder ladders, no-show detection, KPI rollups, backup verification, sync drills | Leader-elected cron container |
| **Identity** | Keycloak on the edge (staff, works offline) + cloud Keycloak (patients/remote staff), one-way user federation | MFA mandatory for privileged roles; WebAuthn for admins |
| **Observability** | OpenTelemetry, Prometheus/Grafana, Loki, Sentry, plus an append-only hash-chained audit ledger | Audit ledger is separate from application logs and exportable for inspections |
| **Legacy launcher** | A small intranet page listing each module's current owner with a deep link to the right system | The everyday, low-tech answer to "which system do I open?" |

### 5.4 Data strategy

* **PostgreSQL 18 is the engine for the new platform** (ADR 0006): logical replication for the sync and
  analytics paths, JSONB for configurable clinical forms, native partitioning for the audit and change-feed
  tables, and one engine for OLTP + warehouse (separate instances).
* **MySQL is not our database any more; it is a source.** Where the vendor grants access, a read-only
  connection or delivered dump feeds the bridge. We never write to it except through the laddered write
  bridge in `08` §4.
* **One writer per entity** — the safety property of the whole programme. Written in the ownership registry,
  enforced by which system exposes write endpoints, verified by reconciliation.
* **Provenance everywhere** — every mirrored row carries `legacy_id`, `legacy_hash`, `extracted_at`; every
  synced row carries the node that created it and the change sequence that delivered it.
* **Nothing is deleted.** Clinical and financial records are archived with a reason, and the audit ledger
  records every state change.
* **Migrations** are versioned, forward-only, with tested rollback; production runs them in CI against a
  restored snapshot first. Sync-affecting schema changes ship behind a version gate so an edge node that is
  offline for six hours still converges.
* **Files** live in MinIO on the edge with an off-site copy in the cloud; signed URLs, checksums on ingest,
  and a verification job that re-reads every stored object monthly.

### 5.5 API and integration contracts

| Concern | Decision |
|---|---|
| Style | REST/JSON; action endpoints where a state machine exists (`POST /encounters/{id}:sign`) |
| Spec | OpenAPI 3.1 generated from code, published as the contract; client types generated from it |
| Versioning | `/api/v1`; additive changes inside a version; deprecation headers with two release cycles |
| Auth | OIDC tokens from Keycloak (edge-issued for staff, works offline); 10-minute access tokens + rotating refresh; service tokens for adapters |
| Authorisation | Role + attribute policies checked in the API, never only in the UI; every endpoint tested against all nine roles |
| Errors | RFC 9457 problem+json with a stable `type`, a human message and field-level details |
| Idempotency | `Idempotency-Key` **required** on money, clinical and sync writes; server-generated ULIDs for offline-created records |
| Offline contract | Every write endpoint declares whether it is offline-capable, its conflict class and its queue priority; the PWA queue is generated from that metadata, not hand-maintained |
| Events | Transactional outbox → worker; `patient.registered`, `appointment.booked`, `encounter.signed`, `invoice.paid`, `result.released`, `stock.low`, `sync.conflict.raised` |
| Webhooks | Outbound with HMAC signature, retries, replay endpoint |
| External adapters | Lab analysers (HL7 v2 / ASTM), PACS (DICOMweb), payments (gateway + UPI), messaging (Meta WhatsApp Cloud API, Twilio, SMS gateway, SMTP), Zoom, biometric/QR attendance, e-signature |
| Interoperability roadmap | FHIR R4 façade for Patient/Encounter/Observation/DiagnosticReport/Invoice; ABDM (ABHA) linking where the hospital operates in India |

### 5.7 Multi-site rules (O3 answered: 2–3 branches)

| Concern | Rule |
|---|---|
| **Patient identity** | One hospital-wide patient master, held in the cloud and replicated read-only to every branch. Registration happens locally; the cloud assigns the permanent MRN from the branch's pre-allocated block, and duplicates across branches are detected and queued for merge review (they exist today — profiling must quantify them, `06` §2) |
| **Branch-scoped access** | Staff see their own branch by default. Cross-branch access requires an explicit role and a stated reason, is logged, and is reviewable; Postgres row-level security backs the API policy |
| **Number blocks** | Invoice, receipt, sample, accession and admission numbers are pre-allocated **per branch**, so no two branches can mint the same number while offline |
| **Cross-branch reads** | Search can find a patient, visit or invoice from another branch, with staleness visible ("as of 14:05") because the read comes from a replica, not the branch's live node |
| **Clinical flows across branches** | Referrals, shared consultants (one schedule across branches), inter-branch stock transfers (explicit transfer records with in-transit state) and patient transfers are first-class features, not workarounds |
| **Charge masters** | One hospital-wide catalogue with per-branch overrides — never two divergent price lists that finance has to reconcile by hand |
| **Reporting** | Consolidated across branches in the cloud warehouse, plus per-branch P&L; a branch reports from its own data even when the cloud is unreachable (local view), and the cloud numbers win after sync |
| **Provisioning** | Adding or rebuilding a branch is a scripted process: node bootstrap, certificate issuance, node registration, master-data pull, hardware and printer configuration, smoke tests — documented as a runbook and rehearsed in `edge-lab` (`05` §6) |
| **Rollout order** | Module cutovers run **per branch**: a module is migrated branch A → B → C, 2–4 weeks apart, with its own reconciliation and sign-off. One branch can lag without blocking the others, and the ownership registry tracks each cell (`08` §5) |

### 5.8 Non-functional requirements (enforced in CI or by drill)

| Area | Requirement |
|---|---|
| Performance | p95 API < 300 ms server time on the LAN; LCP < 2 s; grids first page < 1 s for 100 k rows; reports < 5 s (materialised beyond) |
| Availability | 99.5 % during OPD hours; **clinical functions keep working with the WAN uplink down** at every branch |
| Multi-site | A branch keeps operating when the cloud or another branch is unreachable; cross-branch reads are labelled with their age; no cross-branch write ever silently overwrites a local record |
| Offline | Ward PWA queues writes for ≤ 4 h and reconciles without loss; every queued write is visible to the user with its state |
| Sync | Lag p95 < 60 s while online; drained within 15 min of connectivity returning; zero unreconciled records; conflict queue cleared within one shift |
| Durability | RPO 15 min (WAL shipping locally + off-site), RTO 1 h; quarterly restore drill **and** annual archive-readiness drill, evidence stored in the repo |
| Capacity | 500 k patients, 5 M invoices, 20 M audit rows without degradation; server-side pagination everywhere; change-feed retention with archival |
| Security | OWASP ASVS L2; MFA mandatory for privileged roles; per-node mTLS certificates; least-privilege DB accounts; secrets in Vault/SOPS; field-level encryption for national IDs and insurance data; encrypted storage on the edge |
| Privacy | Configurable retention and redaction; access logs for record views; export/erasure workflow for patient requests (DPDP/GDPR-style); no PII in logs or sync payload logs |
| Accessibility | WCAG 2.2 AA, keyboard-complete, screen-reader tested per release |
| Localisation | `en` + `bn-BD` at launch; RTL-ready layout; per-site currency/date/timezone/number formats |
| Print | A4/A5/thermal templates with per-module headers, QR/barcode, preview before print, **works while offline** |
| Browser support | Current + previous Chrome/Edge/Firefox; Safari on iPad; no IE |

## 6. Repository and environment layout

```
/apps/web                 Next.js application (new UI)
/apps/api                 Laravel 13 API (domain modules)
/apps/worker              outbox consumer, schedulers, report jobs
/apps/edge                packaging, install/upgrade scripts, node bootstrap, health checks
/packages/ui              design system components
/packages/tokens          design tokens (source) + generated CSS/TS
/packages/contracts       OpenAPI spec + generated clients/types
/services/sync            change feed, batch transport, conflict handling, number blocks
/services/bridge          legacy extract / validate / transform / apply  (doc 08)
/services/adapters/*      lab, pacs, messaging, payment adapters
/infra                    Docker Compose (edge + cloud), Terraform, backup and drill scripts
/tools                    capture, docs, plan and migration generators
/docs                     this plan + product documentation + help library
```

> There is deliberately **no `legacy/` directory**: we hold no vendor source, and nothing from the legacy
> system is ever copied into this repository (clean-room rule, `05` §7).

| Environment | Purpose | Data |
|---|---|---|
| `local` | Developer machines, docker compose, seeded synthetic data | synthetic |
| `ci` | Build, tests, migrations dry-run, contract tests | synthetic |
| `preview` | One per pull request (ephemeral) | anonymised subset |
| `staging` | UAT, clinical validation, migration rehearsals, training | refreshed anonymised production copy |
| `edge-lab` | A physical or virtual edge node as it will be installed, including the offline and sync drills | staging copy |
| `pilot` | One department live on new modules, on the real edge node | production + legacy |
| `production` | The hospital: edge node + cloud tier | production |

## 7. Architecture decision records

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-modernization-strategy.md) | Phased replacement from the outside: module ownership, read bridge, laddered write bridge (revised after D1) | **Accepted** |
| [0002](adr/0002-frontend-stack.md) | Next.js + TypeScript + Tailwind + Radix/shadcn + TanStack | **Accepted** (D3) |
| [0003](adr/0003-api-and-auth.md) | OpenAPI-first REST API on Laravel 13 / PHP 8.4; Keycloak OIDC with mandatory MFA | **Accepted** (D2) |
| [0004](adr/0004-database-engine.md) | MySQL 8 as system of record; Postgres for analytics | **Superseded by 0006** |
| [0005](adr/0005-licensing-and-vendor-updates.md) | No fork: clean-room rebuild, vendor relationship and exit policy | **Accepted** |
| [0006](adr/0006-primary-database.md) | PostgreSQL 18 as the primary engine for the new platform | **Accepted** |
| [0007](adr/0007-hybrid-topology-and-sync.md) | Hub-and-edge topology: LAN-authoritative clinical work, cloud for remote/portal/analytics/off-site backup, log-based sync with per-entity conflict policy | **Accepted** (D4) |

## 8. What this buys the hospital

1. **It keeps working when the internet does not** — registration, OPD, IPD, pharmacy and billing continue on
   the LAN, with every queued write visible and reconciled.
2. **Screens that load instantly** and a UI designed for the counters and wards the staff actually work in.
3. **Fewer clicks and fewer errors**: persistent patient context, allergy alerts, scanner-first inputs,
   keyboard-complete flows.
4. **Safe money and safe medicine**: idempotent writes, per-location stock ledgers, immutable issued invoices,
   automated daily reconciliation.
5. **A real API** so kiosks, the patient app, labs and payers integrate without screen scraping.
6. **Evidence for quality and for regulators**: audit ledger, contract tests, restore and outage drills,
   accessibility conformance, and a documented data exit from the vendor.
7. **Freedom to sell or license the platform later** — because it was built clean-room, with no vendor code.
