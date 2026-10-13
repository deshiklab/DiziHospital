# ADR 0001 — Modernize with a strangler fig, module by module

* Status: **Accepted**
* Date: 2026-10-14
* Deciders: sponsor, tech lead, clinical owner, product owner

## Context
The running product (Smart Hospital, PHP/CodeIgniter + MySQL, server-rendered views) is functionally rich
(76 screens, 9 roles, complete revenue cycle, 14-tab IPD case) but architecturally dated: full page reloads per
action, up to 34 pre-rendered forms per page, no API, no automated tests, no observability, and demonstrable
data-integrity bugs (contradicting KPIs, hard-coded currency, unsafe bulk delete). The hospital cannot stop
to adopt a new system, and clinicians depend on existing workflows.

## Options
1. **Harden in place** — restyle the existing views, fix bugs. Cheap, but leaves the architecture, testability,
   performance and accessibility untouched; a "modern UI" would be a skin.
2. **Big-bang rewrite** — a complete replacement launched on a single date. Clean end state, but 12–18 months of
   parallel cost with no user feedback, huge cutover risk, and scope growth typical of hospital ERP rewrites.
3. **Strangler fig** — introduce a new web app and API behind an edge router; replace one module at a time;
   retire legacy screens only after parity is proven with real data.

## Decision
Adopt option 3. Keep the legacy application as the system of record; add the new app and API; route traffic per
path (`/` new, `/legacy/**` old, `/api/**` new API); flip a module back with a one-line routing change.
Legacy data is read by new modules through documented, dated views — never by direct table access.

## Consequences
* **Positive:** value every 3–6 weeks; real user feedback from week 6; per-module, reversible cutovers; the
  hospital never freezes; the bug-fix backlog (KPIs, currency, delete safety) can ship immediately on legacy
  while the new UI is built.
* **Negative:** two UIs coexist for months (needs SSO bridging and consistent navigation); temporary read
  adapters must be inventoried and removed with dates; duplicated QA effort during transition.
* **Mitigations:** explicit adapter inventory with removal dates; feature flags per module; a visual banner in
  the new app indicating "you are in the new experience"; monthly adapter review in the retro.

## Follow-ups
* ADR 0002 (frontend stack), 0003 (API & auth), 0004 (database engine), 0005 (licensing & vendor updates).
* Track dual-UI cost as a metric; if it exceeds 20 % of capacity for two consecutive sprints, re-sequence phases.
