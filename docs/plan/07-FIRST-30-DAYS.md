# 07 — First 30 Days (kickoff plan)

Concrete and startable. Every item has an owner role and an artefact. By day 30 the team has a running walking
skeleton, design system v0, an agreed architecture, **the data-access question settled with extraction running**,
an edge node proven in `edge-lab`, and the first pilot desk waiting.

Two things start in week 1 because they cannot be fixed later by working harder: **vendor data access** (O1) and
**edge node hardware** (procurement lead time).

## Week 0 (2–3 days, before the clock starts)

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Confirm decisions D1–D5 and the four open questions O1–O4 | sponsor + tech lead | updated `docs/plan/README.md` |
| 2 | **Send the vendor data-access request** (scope, transport, cadence, checksums, change notice, exit clause) — for a vendor-hosted instance this asks for a nightly encrypted dump per branch to storage we control | sponsor | draft addendum per `08` §2 |
| 3 | **Agree the edge node hardware standard** and place the order (CPU, RAM, NVMe RAID1, redundant PSU, UPS, NICs, IPMI) | tech lead + hospital IT | `docs/research/edge-node-spec.md` + purchase order |
| 4 | Team formed, roles named, access granted (repo, vendor demo, hospital network, printer room) | tech lead | `docs/plan/team.md` |
| 5 | Buy reference hardware: 1 thermal receipt printer, 1 A4 laser, 1 label printer, 1 barcode scanner, 2 tablets | hospital IT | inventory in `docs/research/hardware.md` |
| 6 | Confirm the clean-room position with legal (no fork, our work is ours) | sponsor + legal | note in ADR 0005 |

## Week 1 — Discovery, access and ground truth

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Shadow shifts in reception, OPD, pharmacy, lab, billing; record tasks, times, workarounds | designer + BA | `docs/research/shadowing.md` |
| 2 | Task inventory + legacy timings for 25 critical tasks (the baseline we must beat) | designer | `docs/research/baseline-tasks.md` |
| 3 | **Infrastructure survey**: uplink quality and outage history, power/UPS, LAN topology, Wi-Fi coverage on wards, printers, lab analysers, PACS, biometric devices, existing backup routine | platform + hospital IT | `docs/research/infrastructure.md` |
| 4 | **Vendor request list published** — the safety-critical defects from the capture, ranked, with evidence | tech lead + clinical lead | `docs/vendor/requests.md` |
| 5 | **Data profiling begins** as soon as any access exists (counts, duplicates, integrity, identifiers) | data engineer | `docs/migration/01-profile.md` (first cut) |
| 6 | Monorepo scaffolding: `apps/web`, `apps/api`, `apps/worker`, `apps/edge`, `packages/{ui,tokens,contracts}`, `services/{sync,bridge,adapters}`, `infra`, `tools` — **no `legacy/` directory** | platform | PR merged |
| 7 | Docker Compose dev environment (PostgreSQL 18, Redis, Keycloak, MinIO, MailHog) with one-command `make up` | platform | `infra/README.md` |
| 8 | CI pipeline: lint, typecheck, test, build, preview deployment, clean-room scan, link and image checks | platform | green CI badge |
| 9 | **Branch inventory and pilot branch selection** (O6): sites, headcount, systems in use, internet quality per site, which branch pilots first and why | sponsor + clinical lead | `docs/research/branches.md` |
| 10 | **Ownership matrix v0** — module × branch, current owner and planned phase per cell | tech lead + BA | `docs/migration/ownership.md` |

**Day-7 demo:** `make up` boots the whole stack; a preview URL shows an empty AppShell deployed automatically;
the vendor access request is sent and the edge node is on order.

## Week 2 — Foundations, sync spike and the extraction proof

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Design tokens authored and generated (CSS vars + Tailwind + Figma variables), including the `sync.*` states | designer + platform | `packages/tokens` + drift check in CI |
| 2 | AppShell v0: sidebar, header, patient search stub, command palette stub, theme/density/language toggles, **connectivity + sync indicator** | web | Storybook + preview |
| 3 | Form kit v0 (8 primitives) + DataGrid v0 (server-side paging, saved views, CSV) | web | Storybook stories with all states |
| 4 | Identity: Keycloak realm, OIDC login, **MFA enrolment**, role claims for the 9 legacy roles; decide the password-migration path | platform | login works against migrated users |
| 5 | API skeleton: health, auth middleware, error format, OpenAPI pipeline, **audit ledger writes**, offline-capability metadata per endpoint | api | OpenAPI published in `packages/contracts` |
| 6 | Observability: traces, metrics, logs, error tracking wired end-to-end | platform | dashboard screenshot in PR |
| 7 | **Sync spike**: two nodes exchange change-feed batches — replay idempotency, resumable cursor, number blocks, one test per conflict class | platform | `docs/architecture/sync-spike.md` + tests |
| 8 | **Extraction POC**: patients and appointments flowing from the best available source into staging, on a schedule, with counts and checksums | data engineer | first reconciliation report committed |
| 9 | ADRs 0001–0007 accepted (revised for D1/D4) | tech lead | `docs/plan/adr/` |

**Day-14 demo:** log in with MFA, switch to Bangla and compact density, see an audited API call in the trace,
watch two nodes sync a change and resolve an injected conflict, and see a nightly extraction report.

## Week 3 — First vertical slice (patients) with the offline path built in

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | `POST/GET /patients` with validation, duplicate detection (name + phone + DOB fuzzy), audit events, idempotency keys | api | contract tests |
| 2 | Patient register + list + profile screens, **each in three network states** (connected, LAN-only, offline-queued) | web | E2E tests in all three states |
| 3 | Patient list over **mirrored legacy data + new records** (100 k+ rows), saved views, export | web | performance evidence (< 1 s first page) |
| 4 | **Read-only projection of legacy-owned modules** in the patient profile (visits, invoices) with "edit in the legacy system" affordances | web | design review passed |
| 5 | Legacy launcher page driven by the ownership registry, so staff always know which system to open | web | deployed in staging |
| 6 | Print: registration slip + ID card, tested on the reference A4 and thermal printers, **including offline printing** | web | printed samples photographed |
| 6b | Branch-aware launcher page: each staff member sees only their branch's current ownership state | web | deployed in staging |
| 7 | Edge node arrives → install the bundle, run the health checks, register it in the cloud tier | platform + ops | `docs/runbooks/edge-install.md` |
| 8 | Accessibility pass on the above (axe 0 critical, keyboard-only journey) | QA | report in PR |

**Day-21 demo:** register a patient in under 45 seconds, find them by phone, see their legacy visit history in
the new profile — then unplug the network and do it again with the writes queuing.

## Week 4 — Pilot readiness (appointments + the outage drill)

| # | Task | Owner | Artefact |
|---|---|---|---|
| 1 | Appointment API: slots, availability rules, booking/cancel/reschedule, idempotency, origin-authoritative conflict rule | api | contract + unit tests |
| 2 | Appointment screens: calendar day view, queue board, online-request inbox | web | usability test with 5 receptionists |
| 3 | Notifications v1: appointment confirmation over e-mail + WhatsApp (Meta Cloud API sandbox) from the outbox | platform | delivery log + failure alerting |
| 4 | **Outage drill #1** in `edge-lab`: pull the uplink for one hour, confirm nothing is lost, queue drains, conflicts clear, then rehearse a node rebuild from backup | platform + QA | `docs/runbooks/outage-drill-01.md` |
| 5 | Reconciliation harness: nightly counts, sums, per-status diffs across both systems | data engineer | first nightly report |
| 6 | Pilot pack: cheat sheet (bn/en), 30-minute training, rollback runbook, hypercare rota, ownership registry published to staff | BA + designer | `docs/releases/p1-pilot.md` |
| 7 | Usability test #1 (5 users per role, in the pilot branch) against the baseline; publish findings | designer | `docs/research/usability-01.md` |

**Day-30 demo:** a receptionist books an appointment end-to-end, the patient gets a WhatsApp confirmation, the
nightly reconciliation is clean, the outage drill passed, and the pilot date for P1 is agreed with the clinical
owner.

## Deliverables checklist at day 30

- [ ] Working stack: `make up`, CI with all gates (including clean-room and sync tests), preview environments, staging with anonymised real data
- [ ] Design system v0 in Storybook: tokens (incl. sync states), AppShell, 8 form primitives, DataGrid
- [ ] Identity with MFA and all 9 roles mapped; password-migration path decided
- [ ] Patients and appointments working end-to-end with audit events and notification delivery, in all three network states
- [ ] **Sync spike proven** (replay, cursors, number blocks, one per conflict class) and **outage drill #1 passed**
- [ ] **Edge node installed in `edge-lab`**, install and rebuild runbooks written
- [ ] Data access: addendum signed or formally refused with a written fallback decision; extraction running for at least two entities with nightly reconciliation
- [ ] Legacy launcher page live; module ownership registry v1 published
- [ ] Vendor request list sent; ADRs 0001–0007 accepted; specs for P2 (billing/OPD) drafted
- [ ] Pilot plan signed by the clinical owner, with a rollback rehearsal completed

## Tracked risks at kickoff

| Risk | Checkpoint | If it fails |
|---|---|---|
| **Vendor will not grant usable data access** | Week 1 — written answer or escalation path agreed | Escalate to the sponsor; fall back to exports/UI extraction for key entities; make an explicit written decision on going forward without full history before P0 exits |
| **Edge node hardware lead time** | Week 3 — first branch's node on site | Continue on the virtual edge in `edge-lab`; pilot on a temporary server with the same bundle; do not start P1 without a real node |
| Second/third branch diverge in process or hardware | Week 4 — branch inventory complete (O6) | Treat branch differences as configuration, not code; if a branch needs a genuinely different workflow, it becomes a documented requirement in that branch's wave |
| Legacy data does not restore or export cleanly | Week 2 — extraction POC green | Narrow the initial scope to master data + patients; document the gap; agree the archive approach with legal |
| No clinician available for sign-off | Day 3 — clinical owner named and calendared weekly | Escalate to the sponsor for a named deputy; block P1 pilot date until resolved |
| Keycloak vs legacy password hashes | Day 11 — migration path decided | Default: dual-read for 30 days then assisted reset at the pilot desk |
| Team has little PostgreSQL or offline-sync experience | Week 2 — internal workshop held | Bring in a short external review; keep the sync design deliberately small and tested per entity class |
| Printer/analyser hardware differs from expectations | Week 1 survey | Buy one of each as reference devices; treat the difference as a per-machine configuration, not a code change |
