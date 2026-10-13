# 05 — Engineering Process

How work flows from idea to production in a hospital where mistakes reach patients and money.

## 1. Team topology

| Stream | Owns | Typical size |
|---|---|---|
| **Platform & Design System** | AppShell, tokens, component library, auth, API framework, events, audit, observability, CI/CD, environments | 1 lead + 2 engineers |
| **Clinical Core** | Patients, appointments, OPD, IPD, orders, results | 2–3 engineers + clinical lead |
| **Revenue Cycle** | Billing, pharmacy, inventory, finance, insurance | 2–3 engineers |
| **Experience** | UX research, design, content, portal & website, accessibility | 1–2 designers |
| **Quality** | Test strategy, E2E/visual/performance suites, release verification, UAT coordination | 1 QA/SDET (+ shared) |

Dedicated roles regardless of size: **product owner**, **clinical owner** (a practising clinician with decision
authority), **security & privacy owner**, **hospital IT liaison**.

## 2. Work intake

```
Idea / bug / backlog item
   │  triage weekly (PO + clinical owner + tech lead)
   ▼
Spec (one page: problem, users, task times, acceptance criteria, data touched, safety impact)
   │  if it changes architecture → ADR (docs/plan/adr/)
   ▼
Design (Figma, states + a11y + print + i18n)  ──►  Design review checklist
   ▼
Implementation tickets (≤ 2 days each) — vertical slices, not layers
   ▼
PR → CI gates → review → merge → deploy to preview → staging → pilot wave
```

Rules: no ticket without acceptance criteria; no architecture change without an ADR; no clinical behaviour
change without the clinical owner's sign-off recorded in the ticket; no screen without design review.

## 3. Delivery flow

* **Trunk-based development** — short-lived branches (≤ 2 days), small PRs (≤ 400 changed lines), squash merges, conventional commits, semantic versioning per app.
* **Feature flags** (self-hosted Unleash) for every user-visible change; flags declared and retired in the same PR series; no flag lives longer than one phase.
* **Environments** — local → CI → preview (per PR) → staging (anonymised prod data) → pilot → production.
* **Migrations** are forward-only, one concern each, with a tested down-script and a dry-run against a restored production snapshot in CI.
* **Definition of Ready** — user and task identified; acceptance criteria; design ready (all states); data and API contract agreed; safety/privacy impact noted; test approach agreed.
* **Definition of Done** — merged to trunk behind a flag; unit + integration + contract tests green; E2E journey added or extended; a11y (axe 0 critical) and visual regression clean; performance budget met; docs updated (`docs/`, in-app help); audit events emitted; print output verified where applicable; telemetry in place; demoed to the clinical owner; flag rollout plan written.

## 4. Quality gates in CI (fail the build)

| Gate | Threshold |
|---|---|
| Lint + typecheck | zero errors |
| Unit tests | ≥ 80 % on changed lines (new code), no drop in module coverage |
| API contract | OpenAPI diff must be backwards-compatible or version-bumped |
| Integration tests | all green against a real PostgreSQL 18 + Redis |
| E2E (Playwright) | golden journeys green in **three network states**: connected, LAN-only (uplink blocked) and offline-queued with forced reconnect |
| Accessibility | axe 0 critical/serious on changed pages; keyboard-only journey test passes |
| Visual regression | Chromatic/Storybook snapshots: no unreviewed diffs |
| Performance | k6 smoke: p95 API < 300 ms; Lighthouse LCP < 2 s on the LAN profile |
| Security | dependency scan (high/critical blocked), SAST, secret scan, container scan; ZAP baseline on staging |
| Migration | dry-run applied to a production-sized snapshot without error |
| Bridge contract tests | every legacy source table and every bridge flow matches its expected shape; a vendor schema or UI change fails the build |
| Sync tests | change-feed push/pull, replay idempotency, number-block allocation, and one test per conflict policy class |
| Clean-room scan | no vendor source, asset, font, CSS or template markers in the repository; PR checklist answered |
| Docs | ADR/spec/help updated when behaviour changes (`docs` diff required for user-visible change) |

## 5. Testing strategy (risk-weighted)

| Layer | Scope | Tooling | Cadence |
|---|---|---|---|
| Unit | domain rules: dose maths, billing arithmetic, slot rules, stock expiry | Vitest/Jest, Pest/PHPUnit | every commit |
| Integration | API + PostgreSQL 18 + Redis, transactions, idempotency | testcontainers, real DB | every commit |
| Contract | consumer/provider between web ↔ API ↔ adapters | OpenAPI validation + Pact for adapters | every commit |
| E2E | the 12 golden journeys, all 9 roles, Bangla & English | Playwright (reuse the capture suite) | every PR + nightly full |
| Clinical safety | allergy/interaction alerts, critical values, duplicate patients, unsigned results | scripted scenarios + clinician review | per phase |
| Data | migration reconciliation: counts, sums, per-status, sampled field-by-field | SQL harness + reconciliation report | per migration + nightly during transition |
| Accessibility | automated + manual (NVDA/VoiceOver), keyboard-only | axe, manual scripts | per phase |
| Performance | k6 load on registration/billing/grids; Lighthouse; DB query budgets | k6, Lighthouse CI, EXPLAIN checks | weekly + before each wave |
| Security | threat model per module, SAST/DAST, dependency scanning, annual external pen test | CodeQL, ZAP, Snyk/Trivy | continuous + annual |
| Offline & sync | queued writes drain with no loss, conflict per entity class resolved or escalated, offline printing, forced reconnects, node restart mid-sync | Playwright offline mode + a two-node `edge-lab` harness | weekly + before each wave |
| Bridge | extraction completeness (counts/checksums), idempotent re-runs, deletion-report sweep, rung-3/rung-4 write flows replayed against a sandbox | SQL harness + sandbox replay with before/after evidence | per migration + nightly during transition |
| Disaster recovery | restore from local backup, cloud-replica promotion, site-mode switch, archive read drill | scripted drill with evidence stored in repo | quarterly |

Test data: synthetic generator for volume; anonymised production copy for staging (documented anonymisation
script, reviewed by the privacy owner).

## 6. Release management

* **Weekly release train** to production (Tuesday), hotfixes any day.
* **Edge nodes are released, not deployed**: signed bundles published to the cloud tier, nodes pull and stage them, then apply in a maintenance window they choose (or on operator approval). A canary node in `edge-lab` takes every release first, and a node can roll back to the previous bundle on its own.
* **Branches are provisioned, not installed by hand.** One scripted runbook covers node bootstrap, certificate issuance, node registration, master-data pull, printer/scanner configuration and smoke tests; it is rehearsed in `edge-lab` before every new branch and timed ("new branch in a day" is the goal). A branch rollout follows the same wave discipline as a module rollout, canary branch first.
* **Schema and sync changes carry a version gate** so branches on different application versions during a staggered rollout still converge (`01` §5.2).
* Standard flow: flag off in production → enable for internal → pilot wave → department → hospital-wide.
* **Blue-green for the API**, rolling for the web. **Module rollback is an ownership action, not a routing trick**: the ownership registry row reverts to `legacy`, the module is hidden or shown read-only in the new UI, and staff are redirected (training cheat sheet includes this as "what to do if we go back").
* **Freeze windows**: never during month-end billing close, audit periods, or major festivals without hospital approval.
* **Rollback rules**: clinical data error, ledger mismatch, > 15 min downtime, any wrong-medicine/wrong-patient incident, or a sync conflict that cannot be explained → immediate revert to legacy ownership for that module; the legacy module is still there until decommission.
* Every release note (in `docs/releases/`) lists: what changed, who signed off, how to roll back, reconciliation result.

## 7. Observability & operations

* Dashboards: API latency/error rate, DB slow queries, queue depth, notification delivery (e-mail/SMS/WhatsApp/push) with failure alerting, backup freshness, certificate expiry, disk/DB growth.
* Alerts page the on-call engineer for: API 5xx > 1 % for 5 min, queue dead-letters > 10, backup older than 26 h, replication lag > 5 min, disk > 85 %.
* **On-call**: rotating weekly among engineers, documented in a rota; hospital IT is first-line for usage questions, engineering for defects.
* Incident process: severity levels (S1 clinical safety/outage → S4 cosmetic), 15-min response for S1, blameless postmortem within 3 days, action items tracked to closure.
* Runbooks per service in `docs/runbooks/` (deploy, rollback, restore, rotate secrets, requeue notifications, reconcile payments).

## 8. Documentation standards

| Artifact | Location | Rule |
|---|---|---|
| ADR | `docs/plan/adr/NNNN-*.md` | one decision per file, immutable after acceptance, superseded rather than edited |
| Spec | `docs/specs/` | one page per feature, linked from the ticket |
| Runbook | `docs/runbooks/` | written before a service goes to pilot |
| Product docs | `docs/WIKI.md`, `docs/FEATURE-CATALOG.md` | updated in the same PR as the change |
| In-app help | help drawer content | sourced from `docs/help-library/` + new screens |
| Release note | `docs/releases/` | required for every production release |
| Research | `docs/research/` | every usability study and its findings |

## 9. Estimations, metrics and improvement

* Estimates in engineer-days using the S/M/L sizes from the screen map (S 3 / M 7 / L 14) refined per screen during design.
* Track **DORA metrics** (deploy frequency, lead time, change failure rate, MTTR) plus product metrics (task times, defects per screen, adoption, support tickets).
* Retrospective every two weeks (start/stop/continue), with one process experiment per sprint.
* Quality debt register reviewed monthly; anything deferred gets an owner and a trigger date.

## 10. Change management with the hospital

* **Champions programme** — one super-user per department trained before their wave; they coach peers and gather feedback.
* **Training** — 30-minute role-based sessions + 2-minute in-app videos per task + a printable one-page cheat sheet per role (Bangla and English).
* **Communication** — weekly 1-page progress note to department heads; a visible "what changed this week" banner in the app.
* **Feedback loop** — in-app feedback button on every screen (auto-attaches screen name, role, browser), triaged daily; quarterly staff satisfaction survey.
* **Hypercare** — 2 weeks of on-floor support after each wave, with a daily 15-minute stand-up between engineering and the department.

## 11. Clean-room discipline and the vendor relationship

Because we hold no vendor source (D1), our platform must be **demonstrably our own work** — that is what keeps
us legally free to license or sell it later. This is a process rule, not a hope.

| Rule | How it is enforced |
|---|---|
| No vendor code, CSS, images, fonts, icons, SQL or templates in **product directories** (`apps/`, `packages/`, `services/`) | CI clean-room scan (`node tools/ci/clean-room.mjs`) on every PR; PR checklist question; tech-lead review for anything that looks copied |
| Vendor *reference* material stays in `docs/` only — captures, the mirrored public help library, analysis — never shipped in the app and never copied into it | Directory rule in review; the clean-room scan excludes `docs/` by design so the two are never confused |
| Every plan artefact that could be mistaken for vendor work carries attribution | Mirrored help articles keep their source URL; the capture README records how the screenshots were obtained |
| The new platform is written from our own capture, the mirrored public documentation and agreed requirements | Every behaviour in a story links to a capture artefact or a requirement, not to a vendor file |
| The scan itself is tested | A planted violation must fail the build (`packages/tokens` CI job runs the scan on every push) |
| If vendor source is ever purchased, a two-team wall applies | Documented in the ADR 0005 policy; code review checks authorship of anyone who has read vendor source |
| The legacy instance is requested to change, never patched | `docs/vendor/requests.md`: ranked list with evidence (screenshot, reproduction, impact) and status, reviewed monthly with the vendor |
| No vendor upgrade within ±14 days of a module cutover | Calendar check in the release meeting; bridge contract tests run before and after any approved upgrade |
| Data access stays contractual | Data-access addendum reviewed quarterly against what is actually delivered (scope, cadence, checksums, notices) |

**Vendor request list** (first cut, straight from the capture): confirmation dialog on bulk delete; currency
configurable per tenant; fix the mojibake in clinical headers; make the two contradictory KPI definitions
consistent; audit log for record views; allergy/interaction warning at dispense time. Each one is either fixed
by the vendor, replaced by us, or formally accepted as a residual risk with a named owner.
