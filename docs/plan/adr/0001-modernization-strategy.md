# ADR 0001 — Phased replacement from the outside (revised)

* Status: **Accepted** — revises the original strangler-fig decision after **D1 = no vendor source code**
* Date: 2026-10-14 (revised same day; original wording assumed a private fork)
* Deciders: sponsor, tech lead, clinical owner, product owner

## Context
The running product (Smart Hospital, PHP/CodeIgniter + MySQL, server-rendered views) is functionally rich
(76 screens, 9 roles, complete revenue cycle, 14-tab IPD case) but architecturally dated: full page reloads per
action, up to 34 pre-rendered forms per page, no API, no automated tests, no observability, and demonstrable
data-integrity bugs (contradicting KPIs, hard-coded currency, unsafe bulk delete).

The hospital cannot stop to adopt a new system, and clinicians depend on existing workflows. Critically, **we
hold no licence to the vendor's source code**, so we cannot patch the application, add hooks, share its tables,
or merge vendor releases. The original version of this ADR assumed a private fork — that assumption is void.

## Options
1. **Ask the vendor to improve** the existing product (bug list from the capture). Cheap and worth doing, but we
   control neither the roadmap nor the outcome.
2. **Big-bang replacement** — build everything, switch on one date. Clean end state, 13–16 months of parallel
   cost, maximum cutover risk, no user feedback until the end.
3. **Phased replacement from the outside** — a standalone new platform beside the legacy system; a one-way read
   bridge for history; **ownership of one business module at a time**, each with a cutover date, a reconciliation
   report and a rehearsed rollback; a laddered write bridge only where a new module must feed a legacy one.

## Decision
Adopt option 3, and run option 1 in parallel as a low-cost risk reducer for safety-critical fixes.

Specifically:
1. The new platform (Laravel 13 API + Next.js UI + PostgreSQL 18) is **self-sufficient** and never depends on
   the legacy runtime being up; it never reads vendor tables at request time.
2. **`docs/migration/ownership.md` is the boundary.** Every module has an owning system (`legacy` or `new`),
   a cutover date and, where needed, a documented write-back flow. The registry — not URL routing — is what
   makes the replacement incremental.
3. **The read bridge** (`08` §3) extracts, validates and replicates legacy data into our schema with provenance.
4. **The write bridge is a ladder** (`08` §4): avoid → vendor interface → validated append-only DB writes →
   UI replay → bounded manual dual entry. Each rung has preconditions, guardrails and a kill switch.
5. **One writer per entity, always.** No shared tables, no dual writes to the same table.
6. The new UI may **display legacy-owned modules read-only** (with an "open in the legacy system to edit"
   affordance) so staff can search and view everything in one place while ownership migrates module by module.
7. A **legacy launcher** intranet page shows each module's current owner and deep-links to the right system.

## Consequences
* **Positive:** value every 4–6 weeks; real user feedback from week 9; per-module, reversible cutovers; the
  hospital never freezes; no code-level entanglement with a vendor we cannot control; the new platform is
  architected purely for the future (API-first, offline-first, test-first) and built clean-room.
* **Negative:** two systems and two logins coexist for months; the bridge and reconciliation are real,
  non-optional engineering (~115 days); duplicated support effort during transition; some write-backs are
  manual until the module owning the data has cut over.
* **Mitigations:** module ownership registry reviewed weekly; read-only projections in the new UI; legacy
  launcher page; training and cheat sheets per module at cutover; dual-support rota until P9.

## Follow-ups
* ADR 0005 (no-fork policy), 0006 (PostgreSQL primary), 0007 (hybrid topology + sync).
* Track dual-system cost as a metric; if it exceeds 20 % of capacity for two consecutive sprints, re-sequence
  phases so that the modules sharing the most data cut over together.
