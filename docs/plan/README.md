# DiziHospital — Development Plan & Process

A complete plan to rebuild **DiziHospital** (the Smart Hospital HMS) with a modern UI/UX, delivered
incrementally without taking the hospital offline.

> **Grounding:** every number and screen reference in this plan comes from the capture in `capture/`
> (76 application screens, 96 dialogs, 33 sub-screens, 9 roles, 6 record views) and the mirrored vendor
> documentation in `docs/help-library/`. Nothing here is guesswork about what the product does.

## How to use this plan

| # | Document | Read it when you need to… |
|---|---|---|
| 0 | **README.md** (this file) | orient yourself, see the decisions still open |
| 1 | [`01-STRATEGY-AND-ARCHITECTURE.md`](01-STRATEGY-AND-ARCHITECTURE.md) | agree on *how* we modernize (strangler vs rewrite) and the target architecture |
| 2 | [`02-DESIGN-SYSTEM-UX.md`](02-DESIGN-SYSTEM-UX.md) | build the new UI: principles, IA, tokens, components, accessibility, print, i18n |
| 3 | [`03-SCREEN-MAP.md`](03-SCREEN-MAP.md) | see every legacy screen mapped to a phase, a size and the components it needs |
| 4 | [`04-ROADMAP.md`](04-ROADMAP.md) | plan the quarters: phases, exit criteria, pilot waves, parity tracking |
| 5 | [`05-ENGINEERING-PROCESS.md`](05-ENGINEERING-PROCESS.md) | run delivery: team, ceremonies, CI/CD, quality gates, DoR/DoD, releases |
| 6 | [`06-DATA-MIGRATION-AND-ROLLOUT.md`](06-DATA-MIGRATION-AND-ROLLOUT.md) | migrate data, cut over module by module, roll back safely |
| 7 | [`07-FIRST-30-DAYS.md`](07-FIRST-30-DAYS.md) | start tomorrow: week-by-week kickoff with concrete tickets |
| 8 | [`adr/`](adr/) | see the accepted architecture decision records |
| 9 | [`design-tokens.json`](design-tokens.json) | wire the design tokens into code generation |

## The plan in one page

**Strategy — strangler fig, module by module.** Keep the existing PHP/CodeIgniter application as the
system of record. Put a new web application and a thin API layer in front, replace one module at a time,
and retire the legacy screen only after parity is proven with real hospital data. No big-bang cutover,
no year-long freeze on improvements.

**Target shape.**

```
 Staff / patients
        │
        ▼
 ┌──────────────────────────┐        ┌──────────────────────────┐
 │  DiziHospital Web (new)  │        │  Legacy Smart Hospital   │
 │  Next.js · TS · design   │        │  (CodeIgniter) — shrinks │
 │  system · PWA            │        │  module by module        │
 └────────────┬─────────────┘        └────────────┬─────────────┘
              │  /api/v1 (OpenAPI)                │
              ▼                                   │
 ┌────────────────────────────────────────────────▼──────────────┐
 │  DiziHospital API (new)  ·  auth (OIDC+MFA) · domain modules  │
 │  events & notifications · audit ledger · document service     │
 └───────┬───────────────┬───────────────┬───────────────────────┘
         │               │               │
     MySQL 8         Redis          Object storage        Integrations
   (existing)   cache/queues/flags   (scans, PDFs)   lab · PACS · payments
                                                      WhatsApp · SMS · Zoom
```

**Sequencing.** P0 foundations (2 weeks) → P1 identity/patients/appointments (4) → P2 billing + OPD (5)
→ P3 pharmacy/inventory (4) → P4 lab/imaging/blood bank/ambulance (6) → P5 IPD/ward/OT (5) →
P6 finance/insurance/reports (5) → P7 people/front office/admin (5) → P8 content/portal/website (4) →
decommission (3). **≈ 575 engineer-days of screen work** per the generated screen map, ≈ 890 engineer-days
with platform, design and testing overhead — about **8–11 months with two delivery streams**.

**First visible value.** By the end of week 6 the new UI is live for **patient registration, search and
appointments** in one pilot OPD desk, with SSO, MFA and the new design system — while every other module
keeps running untouched on the legacy app.

## Decisions still open (please confirm)

These change details, not the shape of the plan. Defaults are already assumed throughout the documents so
work can start immediately.

| # | Decision | Assumed default | Impact if different |
|---|---|---|---|
| D1 | **Where is the product source code?** CodeCanyon purchase (we own a copy) vs vendor-hosted | We hold the CodeCanyon source and may fork it privately | If vendor-hosted only, Phase 0 must build an API-only facade and the DB stays vendor-managed |
| D2 | **Backend for the new API** | **Laravel 11** (PHP continuity, queues/events/Eloquent, easy for a PHP team) — alternative: NestJS/TypeScript | Changes language of new services only; frontend and architecture unchanged |
| D3 | **Frontend stack** | **Next.js + TypeScript + Tailwind + Radix/shadcn + TanStack** | Vue/Nuxt alternative — design tokens and IA survive, component code is rewritten |
| D4 | **Hosting** | Hospital LAN / on-prem with an offline-tolerant PWA, reproducible Docker deployment | Cloud-first shifts observability and DR plans, lowers ops effort |
| D5 | **Team size & start date** | 1 designer + 1 tech lead + 4–6 engineers + 1 QA/SDET + part-time clinical lead | Scales the calendar below, not the sequence |

⚠️ **Legal note that affects the whole delivery model:** a CodeCanyon *regular licence* permits modifying
and running the software for **one end product**, but not redistributing the source. Our fork must stay
private, and vendor updates must be treated as a merge source (freeze a vendor-update branch, cherry-pick
security fixes) rather than a straight upgrade. If DiziHospital is intended to be sold or hosted for other
hospitals, an extended/extended-SaaS licence must be confirmed **before** Phase 0 ends.

## Success metrics for the whole programme

| Dimension | Today (observed) | Target after Phase 4 | How it is measured |
|---|---|---|---|
| Register a new patient | 19-field modal, no MR/phone search | ≤ 45 s, duplicate warning, scanner-ready | instrumented task timing |
| Book an appointment | 3 tabs, manual slot typing | ≤ 30 s, slot availability enforced | instrumented task timing |
| Prescription writing | free-text, no interaction check | structured, allergy-aware, ≤ 2 min | clinical audit + timing |
| Page load (LAN) | full page reload per action | p95 < 1.2 s, LCP < 2 s | RUM + k6 |
| Accessibility | not assessed, mojibake and unlabelled controls | WCAG 2.2 AA, 0 critical axe findings | axe + manual audit |
| Data errors per shift (billing) | reconciliation by hand | < 1, automated daily reconciliation | finance report diff |
| Uptime | unknown | 99.5 % business hours, RTO 1 h, RPO 15 min | monitoring + DR drills |
| Staff satisfaction | not measured | ≥ 4.2/5 in quarterly survey | in-app survey |
