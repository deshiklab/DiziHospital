# 09 — Execution Backlog: Phase 0 (weeks 0–4)

The P0 work, broken into **issue-ready tickets**. Each ticket has an owner role, an estimate in engineer-days,
a dependency and an acceptance test — enough to paste into GitHub Issues, Jira or a kanban board without
rewriting anything.

**Assumptions:** 5–6 engineers, 1 designer, 1 QA/SDET and part-time clinical/ops support from week 2. Estimates
are engineer-days and deliberately small; the day-30 review decides what slips into P1. DoR/DoD, CI gates and the
clean-room rule are in [`05-ENGINEERING-PROCESS.md`](05-ENGINEERING-PROCESS.md).

**Labels:** `area:platform` `area:web` `area:api` `area:design` `area:data` `area:sync` `area:ops` `area:docs`
`type:spike` `type:risk` `blocked:vendor`

**Start today (the five that unblock everything):** `P0-002` vendor data access · `P0-003` edge node order ·
`P0-101` shadowing · `P0-104` pilot branch selection · `P0-108` dev environment.

---

## Sprint 0 — before the clock starts (week 0, ~6 d)

| ID | Ticket | Area | Owner | Est | Acceptance |
|---|---|---|---|---|---|
| P0-001 | Plan walkthrough with sponsor and clinical leads; decisions D1–D5 and answers O1–O4 minuted | docs | tech lead | 0.5 | Sign-off recorded in `docs/plan/README.md` |
| P0-002 | **Send the vendor data-access request and draft the addendum** (nightly encrypted dump per branch to our storage; scope, cadence, checksums, 14-day change notice, credential custody, exit clause) | ops | sponsor + legal | 1 | Request sent and logged; addendum template attached; escalation path named |
| P0-003 | **Edge node hardware standard agreed and ordered for branch A** (CPU/RAM/NVMe RAID1/redundant PSU/UPS/IPMI) | ops | tech lead + IT | 1 | `docs/research/edge-node-spec.md` + purchase order number |
| P0-004 | Order reference hardware: thermal receipt, A4 laser, label printer, barcode scanner, 2 tablets | ops | hospital IT | 0.5 | Inventory in `docs/research/hardware.md` |
| P0-005 | Team formed, roles named, access granted (repo, vendor demo, hospital network, printer room) | ops | tech lead | 0.5 | `docs/plan/team.md`; every named person can log in |
| P0-006 | Clean-room position confirmed with legal (no fork; our work is ours) | docs | sponsor + legal | 0.5 | Note added to ADR 0005; PR checklist wording agreed |
| P0-007 | Risk register seeded from `04` §5 and `07` risk tables, with owners and review cadence | docs | tech lead | 0.5 | `docs/risks.md` created; first review scheduled |

---

## Sprint 1 — discovery and ground truth (week 1, ~25 d)

| ID | Ticket | Area | Owner | Est | Acceptance |
|---|---|---|---|---|---|
| P0-101 | Shadow shifts in reception, OPD, pharmacy, lab and billing; record tasks, timings, workarounds | design | designer + BA | 4 | `docs/research/shadowing.md` with ≥ 40 observations and photos where permitted |
| P0-102 | Baseline timings for 25 critical tasks on the legacy system (the number the new UI must beat) | design | designer | 2 | `docs/research/baseline-tasks.md` with median/range per task |
| P0-103 | **Infrastructure survey**: uplink quality and outage history, power/UPS, LAN, ward Wi-Fi, printers, lab analysers, PACS, biometric devices, existing backup routine | platform | platform + IT | 3 | `docs/research/infrastructure.md` per branch, with the gap list that becomes tickets |
| P0-104 | **Branch inventory and pilot branch selection (O6)** | docs | sponsor + clinical lead | 2 | `docs/research/branches.md`: sites, headcount, systems, internet quality, chosen pilot branch and why |
| P0-105 | Vendor request list published and sent (bulk-delete confirmation, currency config, mojibake headers, contradictory KPIs, record-view audit log, dispense allergy warning) | docs | tech lead + clinical lead | 2 | `docs/vendor/requests.md` with evidence per item; sent with ticket references |
| P0-106 | Data profiling first cut (counts, growth, duplicates incl. cross-branch, orphan records, identifier audit) — as soon as any access exists | data | data engineer | 3 | `docs/migration/01-profile.md` v1 with the duplicate list |
| P0-107 | Monorepo scaffolding (`apps/*`, `packages/*`, `services/*`, `infra`, `tools`) + CODEOWNERS + branch rules | platform | platform | 2 | PR merged; no `legacy/` directory; protections on `main` |
| P0-108 | **Dev environment in one command**: PostgreSQL 18, Redis, Keycloak, MinIO, MailHog, seeded synthetic data | platform | platform | 3 | `make up` from a clean clone on macOS/Ubuntu, documented in `infra/README.md` |
| P0-109 | CI pipeline: lint, typecheck, unit, build, preview deploy, **clean-room scan**, link/image checks | platform | platform | 3 | All gates green on a dummy PR; a deliberately planted violation fails the build |
| P0-110 | **Ownership matrix v0** (module × branch, current owner, planned phase) | docs | tech lead + BA | 2 | `docs/migration/ownership.md` reviewed with the clinical lead |
| P0-111 | ADRs 0001–0007 accepted and linked from `docs/plan/01` | docs | tech lead | 1 | ADR index shows all Accepted/Superseded correctly |

---

## Sprint 2 — foundations, sync spike, extraction proof (week 2, ~38 d)

| ID | Ticket | Area | Owner | Est | Acceptance |
|---|---|---|---|---|---|
| P0-201 | Design tokens v1 (incl. `sync.*` states) generating CSS variables + Tailwind theme; drift check in CI | design | designer + platform | 3 | `packages/tokens` builds; a token change fails CI unless regenerated; contrast checks pass |
| P0-202 | AppShell v0: sidebar, header, patient search stub, command palette stub, theme/density/language toggles, **connectivity + sync indicator** | web | web | 4 | Storybook stories for all states; keyboard-complete |
| P0-203 | Form kit v0 (8 primitives) with validation and error announcement | web | web | 3 | Storybook + axe clean; used by the patient form in S3 |
| P0-204 | DataGrid v0: server-side paging, saved views, CSV export, column chooser | web | web | 4 | Renders 100 k rows with < 1 s first page in the perf harness |
| P0-205 | Keycloak realm, OIDC login in `apps/web`, **MFA enrolment**, 9 roles mapped from legacy roles | platform | platform | 4 | Login with MFA against migrated users; role claims visible in the token |
| P0-206 | Password-migration decision and prototype (dual-read then assisted reset vs forced reset) | platform | platform + security | 1 | Decision recorded in ADR 0003 consequences; prototype demoed |
| P0-207 | API skeleton: health, auth middleware, RFC 9457 errors, OpenAPI pipeline, **offline-capability metadata per endpoint** | api | api | 3 | OpenAPI published to `packages/contracts`; generated TS client builds |
| P0-208 | Audit ledger: append-only, hash-chained, queryable; tests for tamper detection | api | api | 3 | Ledger writes on every write endpoint; tamper test fails as expected |
| P0-209 | Observability end-to-end: traces, metrics, logs, error tracking, first dashboards and alerts | platform | platform | 3 | One request traceable end-to-end; alert fires in a drill |
| P0-210 | **Sync spike A**: change feed, resumable cursors, batch signatures, replay idempotency, per-branch number blocks | sync | sync | 4 | Two nodes exchange 10 k changes; replay changes nothing; number blocks never collide |
| P0-211 | **Sync spike B**: one test per conflict class (append-only, demographics, appointment, stock ledger, issued invoice, master data) | sync | sync | 3 | `docs/architecture/sync-spike.md` + green tests; behaviour matches `01` §5.2 |
| P0-212 | **Extraction POC**: patients + appointments into staging on a schedule, with counts, checksums and provenance columns | data | data engineer | 4 | First reconciliation report committed; re-run is idempotent |
| P0-213 | `edge-lab` virtual node from the same bundle that will ship | ops | ops | 2 | Compose bundle boots; health endpoint green; upgrade path documented |
| P0-214 | Clean-room CI scan implemented (vendor asset/font/template markers) | platform | platform | 1 | Planted violation fails the build |

---

## Sprint 3 — first vertical slice with the offline path built in (week 3, ~34 d)

| ID | Ticket | Area | Owner | Est | Acceptance |
|---|---|---|---|---|---|
| P0-301 | Patients API: create/read/update, duplicate detection (name + phone + DOB fuzzy), idempotency keys, audit events | api | api | 4 | Contract tests green; duplicate rules documented and tunable |
| P0-302 | Patient register screen in **three network states**, autosave, scanner-ready ID fields | web | web | 4 | E2E passes connected, LAN-only and offline-queued |
| P0-303 | Patient list over mirrored legacy data **plus** new records (100 k+ rows), saved views, export | web | web | 3 | Performance evidence attached; no full-table scan in `EXPLAIN` |
| P0-304 | Patient profile with allergies/alerts banner and **read-only projection of legacy-owned modules** ("edit in the legacy system") | web | web | 3 | Design review passed; disabled write actions are labelled, not hidden |
| P0-305 | Cross-branch duplicate detection and merge-review queue | api | api + data | 3 | Same person registered at two branches is flagged with evidence |
| P0-306 | Offline write queue v1 driven by API metadata, with the "what is waiting to sync" list | web | web | 3 | Queue survives reload; rejected write explains why; retry works |
| P0-307 | Print: registration slip + ID card on A4 and thermal, **offline**, with QR | web | web | 2 | Printed samples photographed; works with the uplink down |
| P0-308 | Branch-aware launcher page showing only this branch's ownership state | web | web | 1 | Verified with a branch-B test user (must not see branch-A new modules) |
| P0-309 | Edge node install from the bundle + health checks + registration with the cloud tier | ops | ops + platform | 3 | `docs/runbooks/edge-install.md` executed start to finish on the real box |
| P0-310 | Accessibility pass on everything above (axe 0 critical, keyboard-only journey) | design | QA | 2 | Report in the PR; defects ticketed |
| P0-311 | Nightly patient reconciliation job (counts, per-status, monthly distribution, sampled fields) | data | data engineer | 3 | Report committed; a seeded difference is detected |

---

## Sprint 4 — pilot readiness and the first outage drill (week 4, ~36 d)

| ID | Ticket | Area | Owner | Est | Acceptance |
|---|---|---|---|---|---|
| P0-401 | Appointments API: slots, availability rules, book/cancel/reschedule, idempotency, origin-authoritative conflicts | api | api | 4 | Contract + unit tests; conflict prompt verified |
| P0-402 | Appointment screens: day calendar, queue board, online-request inbox | web | web | 4 | Usability test with 5 receptionists completed |
| P0-403 | Notifications v1 from the outbox: e-mail + WhatsApp (Meta Cloud API sandbox) | platform | platform | 3 | Delivery log with failure alerting; template per event |
| P0-404 | **Outage drill #1**: pull the branch uplink for one hour during `edge-lab` operation; prove no loss, queue drains, conflicts clear | ops | platform + QA | 2 | `docs/runbooks/outage-drill-01.md` with timings and evidence |
| P0-405 | Node rebuild-from-backup rehearsal, timed | ops | ops | 1 | RTO measured and recorded; gaps ticketed |
| P0-406 | Reconciliation harness for both systems, nightly, with drift alerts | data | data engineer | 3 | Alert fires on an injected mismatch |
| P0-407 | Pilot pack: cheat sheet (bn/en), 30-minute training, rollback runbook, hypercare rota | docs | BA + designer | 3 | Reviewed by the clinical lead; printed copies ready |
| P0-408 | Usability test #1 in the pilot branch (5 users per role) vs baseline | design | designer | 3 | `docs/research/usability-01.md` with task-time deltas |
| P0-409 | **P1 pilot go/no-go** with the clinical owner: scope, date, rollback, support | docs | sponsor + clinical | 1 | Decision minuted; P1 wave 1 scheduled |
| P0-410 | P2 specs (billing + OPD consultation) drafted, including the parallel-run plan | docs | product + api | 3 | Specs reviewed; reconciliation approach agreed with finance |
| P0-411 | Performance baseline on the real edge hardware with realistic volumes | platform | platform + QA | 3 | p95 API and grid timings recorded against the NFR budgets |

---

## Phase 0 exit criteria (from `04` §1, restated as a checklist)

- [ ] Environments green everywhere, including `edge-lab` from the shipping bundle
- [ ] Tokens → CSS/Tailwind with drift check; AppShell, form kit, DataGrid in Storyboard
- [ ] Auth with mandatory MFA and 9 roles; password-migration path decided
- [ ] API conventions, OpenAPI pipeline, audit ledger, observability live
- [ ] **Data-access addendum signed and the first extract delivered**; extraction POC with counts and checksums
- [ ] **Sync spike proven**: replay, cursors, number blocks, one test per conflict class
- [ ] First branch's edge node installed; install, upgrade and rebuild runbooks written
- [ ] CI gates enforced, including the clean-room scan
- [ ] ADRs 0001–0007 accepted; ownership matrix (module × branch) v1 published
- [ ] Outage drill #1 passed; pilot pack ready; P1 pilot date agreed with the clinical owner

Anything not closed here moves into P1 explicitly — nothing is silently dropped.
