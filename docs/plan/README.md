# DiziHospital — Development Plan & Process

A complete plan to rebuild **DiziHospital** (the Smart Hospital HMS) with a modern UI/UX, delivered as a
**phased replacement from the outside**: we do not own the legacy source code, so the old system is treated as a
black-box service that we replace **module by module**, with both systems running side by side until each
module's parity is proven and the module is signed off as migrated.

> **Grounding:** every number and screen reference in this plan comes from the capture in `capture/`
> (76 application screens, 96 dialogs, 33 sub-screens, 9 roles, 6 record views) and the mirrored vendor
> documentation in `docs/help-library/`. Nothing here is guesswork about what the product does.

> **Decisions confirmed 2026-10-14 —** **D1** no vendor source code · **D2** Laravel 13 on PHP 8.4 ·
> **D3** Next.js + TypeScript stack · **D4** hybrid PWA + hospital LAN + cloud · **D5** team shape agreed.
> See [What your answers changed](#what-your-answers-changed) for the consequence of each.

## How to use this plan

| # | Document | Read it when you need to… |
|---|---|---|
| 0 | **README.md** (this file) | orient yourself, see the decisions and what is still open |
| 1 | [`01-STRATEGY-AND-ARCHITECTURE.md`](01-STRATEGY-AND-ARCHITECTURE.md) | agree on *how* we replace the product and the target architecture, including the hybrid hub-and-edge topology |
| 2 | [`02-DESIGN-SYSTEM-UX.md`](02-DESIGN-SYSTEM-UX.md) | build the new UI: principles, IA, tokens, components, accessibility, print, i18n, **offline and degraded-network patterns** |
| 3 | [`03-SCREEN-MAP.md`](03-SCREEN-MAP.md) | see every legacy screen mapped to a phase, a size and the components it needs |
| 4 | [`04-ROADMAP.md`](04-ROADMAP.md) | plan the calendar: phases, exit criteria, pilot waves, parity tracking, budget |
| 5 | [`05-ENGINEERING-PROCESS.md`](05-ENGINEERING-PROCESS.md) | run delivery: team, ceremonies, CI/CD, quality gates, DoR/DoD, releases, **clean-room rule** |
| 6 | [`06-DATA-MIGRATION-AND-ROLLOUT.md`](06-DATA-MIGRATION-AND-ROLLOUT.md) | migrate data, cut over module by module, roll back safely |
| 7 | [`07-FIRST-30-DAYS.md`](07-FIRST-30-DAYS.md) | start tomorrow: week-by-week kickoff with concrete tickets |
| 8 | [`08-LEGACY-INTEGRATION-AND-BRIDGE.md`](08-LEGACY-INTEGRATION-AND-BRIDGE.md) | get data out of a system we cannot modify: access options, read/write bridges, single-writer rule, archival and vendor exit |
| 9 | [`adr/`](adr/) | see the architecture decision records (0001, 0005, 0006 and 0007 revised for D1/D4) |
| 10 | [`09-EXECUTION-BACKLOG-P0.md`](09-EXECUTION-BACKLOG-P0.md) | start work today: P0 broken into issue-ready tickets with owners, estimates and acceptance tests |
| 11 | [`design-tokens.json`](design-tokens.json) | wire the design tokens into code generation |

## The plan in one page

**The constraint that shapes everything: we cannot change the legacy application.** With no source code there
is no fork, no vendor merge, no in-app hook and no routing change *inside* the old system. What we can do is
build a **self-sufficient new platform** beside it, pull the data out through the best access the vendor will
grant, and move **ownership of one business module at a time** — patients, then billing, then pharmacy, and so
on — each with a named cutover date, a reconciliation report and a rehearsed rollback.

**Strategy — phased replacement from the outside.**

1. **New platform is standalone.** Laravel 13 API + Next.js UI + its own PostgreSQL 18 schema. It never depends
   on the legacy runtime being up, and it never reads legacy tables live through the network.
2. **One-way read bridge first.** Legacy data is extracted on a schedule into our own schema (staging →
   validate → upsert with provenance), so the new system has full history from day one.
3. **Single writer per entity.** At any moment exactly one system may create or change a given record type.
   That is the safety property that replaces "refactor the old app".
4. **Write-back is a last resort and always laddered** — avoid it by sequencing, else use a vendor interface,
   else validated database writes, else UI replay, else bounded manual dual entry (see `08`).
5. **Module ownership registry drives everything** — communications, training, support, and which system a
   clerk is told to open. Routing convenience is a bonus, never a dependency.

**Target shape — hub and edge (D4).**

```
        CLOUD TIER (remote access, long-term record, off-site backup, analytics)
        ┌──────────────────────────────────────────────────────────────────┐
        │ dizi-api (read/write)  ·  patient portal  ·  analytics warehouse │
        │ monitoring  ·  package & patch distribution  ·  nightly backups  │
        └───────────────▲─────────────────────────────────┬────────────────┘
                        │  mTLS, change-feed sync          │
        ┌───────────────┴─────────────────────────────────▼────────────────┐
        │ HOSPITAL LAN — EDGE NODE (authoritative for clinical work)       │
        │ dizi-api + dizi-web + PostgreSQL 18 + Redis + MinIO              │
        │ printers · label/receipt · barcode scanners · lab & PACS adapters│
        └───────────────▲──────────────────────────────────────────────────┘
                        │  local HTTPS (works with the internet down)
        ┌───────────────┴──────────────────────────────────────────────────┐
        │ Staff desktops · ward tablets · PWA offline write queue (≤ 4 h)   │
        └──────────────────────────────────────────────────────────────────┘
                        Legacy Smart Hospital instance — shrinks module by module
```

**Sequencing.** P0 foundations + access & bridge (weeks 0–4) → P1 identity/patients/appointments, incl. the
edge node and sync v1 (5–9) → P2 billing + OPD (10–14) → P3 pharmacy/inventory (12–16) → P4 lab/imaging/blood
bank/ambulance (15–20) → P5 IPD/ward/OT (17–21) → P6 finance/insurance/reports (22–26) → P7 people/front
office/admin (27–31) → P8 communication/portal/website (32–35) → P9 decommission & archival (36–40).

**≈ 575 engineer-days** of screen work (generated screen map) and **≈ 1,185 engineer-days** for the whole
programme including the hybrid platform, bridge and hardening — about **9–12 months** with two delivery
streams, 13–16 months with one.

**First visible value.** End of week 9: one OPD desk registers, searches, imports and books patients in the
new UI, **on the hospital LAN, with the internet unplugged**, while every other module keeps running on the
legacy system.

## What your answers changed

| Decision | Your answer | What it changed in the plan |
|---|---|---|
| **D1** CodeCanyon source? | **No** — no vendor source | The code-level strangler is impossible. Strategy becomes **phased replacement from the outside** with a module-ownership registry, a one-way read bridge and a laddered write bridge (`08`). A **clean-room rule** is added to the engineering process: no vendor code or assets in our repository, and anyone who reads vendor source is walled off from writing our platform. Legacy "upgrade" policy is replaced by a vendor-relationship and exit policy (ADR 0005). ADR 0001 rewritten. |
| **D2** Backend | **Laravel (latest)** → **Laravel 13 / PHP 8.4** (13 supports 8.3–8.5, security-supported to March 2028) | ADR 0003 accepted. Laravel 13 + Octane/FrankenPHP, Horizon queues, Sanctum/Passport tokens, Pulse/Telescope, Reverb for live updates. |
| **D3** Frontend | **Ok** | ADR 0002 accepted: Next.js App Router + TypeScript + Tailwind + Radix/shadcn + TanStack, RHF + Zod, Playwright, Storybook. |
| **D4** Hosting | **Hybrid: PWA + hospital LAN + cloud** | New hub-and-edge topology, a **sync engine** with per-entity conflict policy, pre-allocated ID blocks so offline numbers never collide, LAN-authoritative clinical operation, cloud for remote access/portal/analytics/off-site backup. New ADR 0007. Postgres becomes the primary OLTP engine because the sync and reporting paths need it (ADR 0006 supersedes ADR 0004). Budget and calendar revised. |
| **D5** Team shape | **Ok** | Team topology confirmed in `05`; start date still open (see O4). |

## Confirmed with the sponsor (2026-10-14)

| # | Question | Answer | What it changed |
|---|---|---|---|
| **O1** | Data access on the legacy instance | **Read-only replica or dump requested** | The bridge is designed for full-fidelity extraction. Because the legacy instance is vendor-hosted (O2), the request specifies the practical form of A1: a **nightly logical dump delivered to storage we control**, with a tunnelled read-only replica as the better alternative if the vendor offers it |
| **O2** | Where the legacy system runs | **Vendor-hosted cloud** | We cannot lock their database, so cutover freezes are **operational and supervised** (`06` §6); the legacy instance's availability is outside our control, so our own archive copy and the contractual exit clause carry more weight (`08` §7) |
| **O3** | Locations and load | **2–3 branch hospitals** | The platform is designed multi-site from day one: cloud tier holds master data and cross-branch visibility, **each branch gets its own edge node** (authoritative for that branch's clinical work), number blocks are per branch, access is branch-scoped with audited cross-branch reads, and the ownership registry becomes a **module × branch matrix**. Rollout goes **branch by branch** — our best de-risking lever. Budget and calendar revised (`04` §6) |
| **O4** | Start date | **Immediately** | The 30-day kickoff in `07` starts at week 0, and the P0 work is broken into issue-ready tickets in [`09-EXECUTION-BACKLOG-P0.md`](09-EXECUTION-BACKLOG-P0.md) |

### Still open (smaller, none of them block week 1)

| # | Question | Owner | Default |
|---|---|---|---|
| **O5** | Delivery mechanism and first date for the extract (dump location, cadence, encryption, credentials) | sponsor + vendor | nightly dump to our S3-compatible bucket, 02:00 hospital time |
| **O6** | Exact number of branches and which one pilots first | sponsor + clinical owner | smallest branch with an enthusiastic team, week 2 |
| **O7** | Per-branch vendor inventory: lab analysers, PACS, payment providers, printers, biometric devices | hospital IT survey | assume the branch pilot needs the same list as the main site |

## The rule that keeps this safe

**One writer per entity, always.** A record type (patient, appointment, invoice, prescription, stock batch,
result) is writable by exactly one system at a time, and that ownership is written down in the module ownership
registry ([`08` §5](08-LEGACY-INTEGRATION-AND-BRIDGE.md#5-module-ownership-registry)) with a date. The other system either reads
a replica of it or does not see it at all. No shared tables, no dual writes into the same table, and every
bridge operation is idempotent, evidenced and reversible to the extent the data model allows.

## Success metrics for the whole programme

| Dimension | Today (observed) | Target after Phase 4 | How it is measured |
|---|---|---|---|
| Register a new patient | 19-field modal, no MR/phone search | ≤ 45 s, duplicate warning, scanner-ready | instrumented task timing |
| Book an appointment | 3 tabs, manual slot typing | ≤ 30 s, slot availability enforced | instrumented task timing |
| Prescription writing | free-text, no interaction check | structured, allergy-aware, ≤ 2 min | clinical audit + timing |
| Page load (LAN) | full page reload per action | p95 < 1.2 s, LCP < 2 s | RUM + k6 |
| Works with the internet down | whole system stops | clinical work continues on the LAN; queue drains automatically | quarterly outage drill |
| Sync correctness | n/a | zero unreconciled records; 100 % of queued writes applied or escalated | sync reconciliation report |
| Accessibility | not assessed, mojibake and unlabelled controls | WCAG 2.2 AA, 0 critical axe findings | axe + manual audit |
| Data errors per shift (billing) | reconciliation by hand | < 1, automated daily reconciliation | finance report diff |
| Uptime | unknown | 99.5 % business hours, RTO 1 h, RPO 15 min | monitoring + DR drills |
| Staff satisfaction | not measured | ≥ 4.2/5 in quarterly survey | in-app survey |
