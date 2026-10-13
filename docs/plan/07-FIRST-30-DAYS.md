# 07 — First 30 Days (kickoff plan)

Concrete, startable. Every item has an owner role and an artefact. By day 30 the team has a running
walking skeleton, a shipped design system v0, an agreed architecture, and the first pilot desk waiting.

## Week 0 (2–3 days, before the clock starts)

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Confirm decisions D1–D5 from the plan README | sponsor + tech lead | updated `docs/plan/README.md` |
| 2 | Confirm licensing position for the fork (private, no redistribution) | sponsor + legal | note in ADR-0005 |
| 3 | Team formed, roles named, access granted (repo, demo, server, printer room) | tech lead | `docs/plan/team.md` |
| 4 | Buy reference hardware: 1 thermal receipt printer, 1 A4 laser, 1 label printer, 1 barcode scanner, 2 tablets | hospital IT | inventory in `docs/research/hardware.md` |

## Week 1 — Discovery and scaffolding

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Shadow shifts in reception, OPD, pharmacy, lab, billing; record tasks, times, workarounds | designer + BA | `docs/research/shadowing.md` |
| 2 | Task inventory + legacy timings for 25 critical tasks | designer | `docs/research/baseline-tasks.md` |
| 3 | Monorepo scaffolding: `apps/web`, `apps/api`, `apps/worker`, `packages/ui`, `packages/tokens`, `packages/contracts`, `infra`, `legacy/` | platform | PR merged |
| 4 | Docker Compose dev environment (MySQL restore from dump, Redis, Keycloak, MinIO, MailHog) with one-command `make up` | platform | `infra/README.md` |
| 5 | CI pipeline: lint, typecheck, test, build, preview deployment | platform | green CI badge |
| 6 | Legacy app running locally against a restored production copy (or latest demo dump) | platform | runbook |
| 7 | Data profiling started: row counts, duplicates, integrity audit | data engineer | `docs/migration/01-profile.md` (first cut) |

**Day-7 demo:** `make up` boots the whole stack; a preview URL shows an empty AppShell deployed automatically.

## Week 2 — Foundations

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Design tokens authored and generated (CSS vars + Tailwind + Figma variables) | designer + platform | `packages/tokens` + drift check in CI |
| 2 | AppShell v0: sidebar, header, patient search stub, command palette stub, theme + density + language toggles | web | Storybook + preview |
| 3 | Form kit v0 (8 primitives) + DataGrid v0 (server-side paging, saved views, CSV) | web | Storybook stories with all states |
| 4 | Identity: Keycloak realm, OIDC login in `apps/web`, MFA enrolment, role claims mapped from the 9 legacy roles | platform | login works against the restored legacy user table |
| 5 | API skeleton: `/api/v1/health`, auth middleware, error format, OpenAPI pipeline, audit ledger writes | api | OpenAPI published in `packages/contracts` |
| 6 | Observability: traces, metrics, logs, error tracking wired end-to-end for the skeleton | platform | dashboard screenshot in PR |
| 7 | ADRs 0001–0005 written and accepted | tech lead | `docs/plan/adr/` |

**Day-14 demo:** log in with MFA on the new shell, switch to Bangla and compact density, see an audited API call in the trace.

## Week 3 — First vertical slice (patients)

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | `POST/GET /patients` API with validation, duplicate detection (name+phone+DOB fuzzy), audit events | api | contract tests |
| 2 | Patient register screen: full-page form, autosave, duplicate warning, scanner-ready ID fields | web | E2E test |
| 3 | Patient list: server-side grid over the **restored production data** (100 k+ rows), saved views, export | web | performance evidence (< 1 s first page) |
| 4 | Patient profile: header banner with allergies/alerts + tabs (visits, orders, invoices) reading through legacy views | web | design review passed |
| 5 | Legacy SSO bridge so a user can jump between new and legacy without re-login | platform | runbook |
| 6 | Print: patient registration slip + ID-card preview | web | printed on the reference A4 + thermal |
| 7 | Accessibility pass on the above (axe 0 critical, keyboard-only journey) | QA | report in PR |

**Day-21 demo:** register a real patient (in staging) in under 45 seconds, find them by phone, see the legacy visit history in the new profile.

## Week 4 — Pilot readiness (appointments)

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Appointment API: slots, availability rules, booking/cancel/reschedule, idempotency | api | contract + unit tests |
| 2 | Appointment screens: calendar day view, queue board, online-request inbox | web | usability test with 5 receptionists |
| 3 | Notifications v1: appointment confirmation over e-mail + WhatsApp (Meta Cloud API sandbox) using the event outbox | platform | delivery log + failure alerting |
| 4 | Edge router in staging routes `/` to new app, `/legacy/**` to CodeIgniter, `/api/**` to API | platform | routing doc |
| 5 | Reconciliation harness: nightly counts/sums diff for patients + appointments | data | first reconciliation report committed |
| 6 | Pilot pack: cheat sheet (bn/en), 30-min training, rollback runbook, hypercare rota | BA + designer | `docs/releases/p1-pilot.md` |
| 7 | Usability test #1 (5 users/role) vs baseline; publish findings | designer | `docs/research/usability-01.md` |

**Day-30 demo:** receptionist books an appointment end-to-end on the new UI in staging, patient gets a WhatsApp confirmation, reconciliation report is clean, pilot date agreed.

## Deliverables checklist at day 30

- [ ] Working stack: `make up` + CI + preview environments + staging with real (anonymised) data
- [ ] Design system v0 in Storybook with tokens, 8 form primitives, DataGrid, AppShell
- [ ] Identity with MFA and all 9 roles mapped
- [ ] Patients and appointments working end-to-end with audit events and notification delivery
- [ ] Reconciliation harness producing nightly evidence
- [ ] Accessibility and performance baselines measured and published
- [ ] ADRs accepted; specs for P2 (billing/OPD) drafted
- [ ] Pilot plan signed by the clinical owner, with a rollback rehearsal completed

## Tracked risks at kickoff

| Risk | Checkpoint |
|---|---|
| Production data will not restore cleanly | Day 7 — restore completed and documented |
| Legacy views are not enough for the patient profile | Day 18 — profile reads real data or an adapter is added |
| No clinician available for sign-off | Day 3 — clinical owner named and calendared weekly |
| Hardware arrives late | Day 14 — at least the scanner and thermal printer in hand |
| Keycloak vs legacy password hashes | Day 11 — migration path decided (dual-read then force reset) |
