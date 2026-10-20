# 04 — Roadmap

Sequence, scope, exit criteria and pilot waves. Sizes come from the generated
[`03-SCREEN-MAP.md`](03-SCREEN-MAP.md) (575 engineer-days of screen work across 76 screens and 19 sub-screens).
With platform, design/research/QA, migration and hardening overhead the programme is
**≈ 1,265 engineer-days** (see §6), i.e. **≈ 10–14 months** with the two streams below and a staggered
branch rollout.

**Assumed team** (D5 default): 1 UX designer, 1 tech lead, 4–6 engineers, 1 QA/SDET, part-time clinical lead,
part-time DevOps. Two delivery streams run in parallel from P2, which is why the calendar below (~7.5–9 months)
is shorter than a single-stream sum. A single stream would take 15–18 months with three branches.

## 1. Phase plan

| Phase | Weeks | Theme | Legacy screens replaced | Exit criteria (all must pass) |
|---|---|---|---|---|
| **P0** | 0–4 | Foundations, data access & bridge spike (all branches) | 0 | Environments green (local/CI/preview/staging/edge-lab); tokens generating CSS+Tailwind; AppShell + DataGrid + form kit v0 in Storybook; auth (OIDC + MFA) against migrated users; API conventions + first 3 endpoints; audit ledger writing; observability live; CI gates enforced; **data-access addendum signed and first extract delivered (O1/O5)**; extraction POC running on a schedule for two entities; **sync spike: two nodes exchanging changes, including conflict, replay and per-branch number-block tests**; first branch's edge node ordered; ADRs 1–7 accepted; ownership matrix (module × branch) v1 published |
| **P1** | 5–10 | Identity, patients, appointments — hybrid stack live in **branch A**, then B | 3 screens + 3 sub-screens (`001`, `002`, `004`, import, discharged, queue) | One OPD desk in branch A registers, searches, imports and books on the new UI for 5 consecutive days **on the installed edge node**; duplicate detection live (including cross-branch duplicates); **outage drill passed (branch uplink pulled for 1 h: no lost write, queue drained, conflicts cleared)**; task times ≤ legacy − 30 %; branch B live 2–4 weeks later; legacy still reachable and the launcher lists ownership per branch |
| **P2** | 11–15 | Billing + OPD consultation | 3 screens + 5 sub-screens (`003`, `005`, `057`, billing sub-screens, OPD view) | Bills raised on the new UI reconcile to the legacy ledger to the paisa for 2 weeks per branch; consultation workspace ≥ 200 real encounters with clinician sign-off; receipts print on all three paper formats; payment reconciliation automated |
| **P3** | 13–17 (stream B) | Pharmacy + inventory | 4 screens + 2 sub-screens (`007`, `030`, `062`, `075`, sale search/returns) | Dispensing with batch/expiry guard live; **per-branch, per-location stock ledgers reconcile to a physical count**; inter-branch transfers with in-transit state; no negative stock; pharmacist sign-off |
| **P4** | 16–21 | Lab, imaging, blood bank, ambulance | 11 screens + 7 sub-screens | Lab worklist with barcode specimen flow live; results released to portal; blood bank issue with cross-check; imaging worklist; ambulance dispatch log; cross-branch referral of specimens/studies where the branch lacks the service |
| **P5** | 18–22 (stream B) | IPD, ward, OT | 4 screens (`006`, `058`, `061`, `021`) | Admissions/discharges, bed board, nursing notes, medication administration and OT scheduling live on one ward in branch A for 2 weeks; **ward PWA offline queue proven across a real Wi-Fi gap**; patient transfer between branches recorded |
| **P6** | 23–28 | Finance, insurance, reporting | 23 screens (income/expense, TPA, referral, 17 reports) | All 17 reports rebuilt with reconciliation against legacy, **per branch and consolidated**; TPA claim pipeline live; saved views + scheduled exports; finance sign-off |
| **P7** | 29–33 | People, front office, administration | 16 screens + 2 sub-screens | HR/attendance/payroll live; front-office registers live; multi-branch console live; shared consultants scheduled across branches; masters and settings migrated; print templates authored in the new designer |
| **P8** | 34–37 | Communication, content, portal, website | 12 screens + portal + public site | Patient portal live with results/bills/appointments (patients choose their branch); notice board + surveys + certificates live; Front CMS driving the website; telemedicine booking live |
| **P9** | 38–43 | Decommission, archive & hardening (last branch last) | legacy retired | Every branch's last module migrated; legacy instance frozen read-only for 2 weeks, then archived; **retention agreed with legal and an archive read drill passed**; our own complete export (CSV + Parquet + PDFs + file checksums); vendor access revoked and licences terminated in writing; DR drill passed (RTO 1 h / RPO 15 min); pen test closed; performance budget met at 500 k patients; runbooks + training complete; hypercare handed to the hospital IT team |

**Branch waves.** With 2–3 branches the calendar above assumes a staggered rollout: the lead branch starts a
phase, the next branch follows **2–4 weeks behind**, and the third follows the second. This is deliberate — a
defect found in branch A is fixed before branch B ever sees it — and it is the main reason the same programme
that would take 13–16 months single-stream fits a multi-branch hospital without a big-bang switch. A branch may
pause without blocking the others; only P9 requires all branches to be complete.

Dates are relative because the start date depends on D5. A single-stream team (4 engineers) should expect
**13–16 months**; the sequence stays the same.

## 2. Why this order

1. **Foundations first** — without tokens, AppShell and auth, every screen would invent its own patterns and the legacy look would creep back in.
1a. **Data access before anything else** — extraction depends on a vendor agreement we do not control, so it starts in week 1 and the bridge is exercised with two entities in P0. Discovering an access problem in P4 would invalidate three phases of planning.
1b. **Sync before the first pilot, not after** — the edge node and sync engine are proven in P0 as a spike and live in P1, because a hospital LAN platform whose offline path is unproven is a liability, not a feature.
2. **Patients before clinical** — the patient master is the reference every other module joins to; getting identity/search right unlocks everything.
3. **Money early (P2) but after identity** — billing is where correctness matters most and where reconciliation proves the API layer works.
4. **Pharmacy before lab** — pharmacy touches the most users daily (every ward order) and is self-contained.
5. **IPD after OPD/pharmacy/lab** — the in-patient case consumes orders, meds and results, so it lands once those exist.
6. **Reports after the modules they read** — rebuilding reports earlier would mean rebuilding them twice.
7. **Portal and website late but not last** — they depend on stable clinical and billing APIs.
8. **Decommission is a phase with its own budget** — migrations always overrun if this is not planned, and with no vendor source the archive *is* the fallback for history, so it gets real engineering time.
9. **Modules that share data cut over close together** — the fewer write-backs (and manual overlaps) live at once, the safer the transition; the sequence is grouped by data dependency, not by screen count.

## 3. Pilot waves (how new modules reach real users)

| Wave | Scope | Users | Duration | Rollback trigger |
|---|---|---|---|---|
| 0 | Internal (dev + clinical lead) on synthetic data | 4 | each phase | n/a |
| 1 | One OPD desk + one doctor, one billing counter | 6–10 | 5 working days | any clinical-data error, task time worse than legacy, > 2 P1 defects, or an unexplainable sync conflict |
| 2 | Whole department (e.g. all OPD desks) | 10–25 | 2 weeks | ledger mismatch > ৳0, downtime > 15 min, or queue not draining within 15 min of reconnect |
| 3 | Hospital-wide module rollout, other modules still legacy | all | 1 week per module | ownership row reverts to `legacy`, the module is hidden in the new UI and staff are redirected within 15 minutes |

**Every wave must pass an outage drill before it is declared complete**: pull the uplink for one hour during a
live shift, confirm no write is lost, the queue drains automatically afterwards, and the conflict queue is empty
by the end of the shift. The drill result is attached to the release note.

Every wave has a named clinical owner who signs off; sign-off evidence (screenshots, reconciliation reports,
task timings) is attached to the phase's release note in `docs/releases/`.

## 4. Parity tracking (how we prove nothing was lost)

Three independent trackers, all in the repo:

1. **Screen parity** — `docs/plan/03-SCREEN-MAP.md` is the checklist; a screen is done only when its legacy
   fields, filters, actions and print output are reproduced or consciously dropped (with a written reason).
2. **Behaviour parity** — a Playwright suite replays the golden journeys captured in `capture/` (the same
   clicks) against both legacy and new, and diffs the resulting data (created appointment → same fields).
3. **Data parity** — nightly reconciliation jobs compare aggregates between legacy and new for every module
   still in transition (counts, sums, per-status breakdowns) and alert on any drift.

## 5. Dependencies & risks to the calendar

| Risk to schedule | Mitigation |
|---|---|
| Lab analyzer / PACS integration unknown until P4 | Prototype adapters in P0 spikes; contract-test with a simulator; keep manual entry as fallback |
| Printer/label hardware varies by counter | Hardware inventory in week 1; buy one of each printer as reference devices; print templates tested on real hardware in P1 |
| Data quality worse than expected (duplicates, missing MRNs) | Data profiling in week 2; remediation backlog before P1 migration; merge tool shipped in P1 |
| Staff resistance / slower at first | Pilot with enthusiasts, on-floor coaches, task-time dashboards published weekly, rollback always available |
| **Vendor refuses or delays data access (O1)** | Week-1 contractual item with fallbacks prepared (exports → UI extraction); sponsor escalation path; if it fails, an explicit written decision to proceed without history, made before P0 exits |
| **Edge node hardware is late** | Specify in week 1, order against a written standard with a spare disk/NIC, and use a virtual edge node in `edge-lab` so software work never waits for delivery |
| Vendor changes the legacy schema, export shape or UI mid-programme | Contract tests per source table and per replay flow; 14-day change-notice clause; no vendor upgrade within ±14 days of a cutover (`05` §11) |
| Sync conflicts overwhelm the front desk | Conflict policy per entity class (`01` §5.2) keeps clinical events conflict-free; the review queue has a named owner per shift; conflict count is a pilot-wave gate |
| Staff open the wrong system for a module | Legacy launcher page driven by the ownership registry; cheat sheets per wave; the new UI shows legacy-owned modules read-only with a clear "edit in the legacy system" affordance |
| Vendor upgrades or discontinues the product before P9 | Subscription kept paid and documented; offline archive copy refreshed monthly; highest-risk modules sequenced early |
| Branches end up on different systems for months and staff/trainers get confused | Ownership matrix published per branch; branch-aware launcher page; per-branch cheat sheets; training tied to the branch's own wave, never to the hospital-wide calendar |
| One branch refuses or lags behind its wave | Waves are per branch by design — the other branches continue; escalation to the sponsor with the branch's reconciliation evidence; the lagging branch keeps legacy ownership until it is ready |
| Key-person dependency (single nurse champion) | Pair champions per department; recorded training sessions |

## 6. Budget shape (engineering effort, not money)

| Bucket | Engineer-days |
|---|---|
| Screen rebuild (generated) | 575 |
| Platform (auth, API layer, events, audit, observability, CI/CD, infra) | ~200 |
| Hybrid platform (edge node packaging, sync engine, change feed, number blocks, site modes, cloud tier) | ~45 |
| Multi-site platform (per-branch provisioning as code, master-data distribution, branch-scoped security, cross-branch referrals/transfers, consolidated + per-branch reporting) | ~55 |
| Design system, research, usability testing, design QA (incl. offline/degraded-state design and testing) | ~135 |
| Legacy integration (access setup, extract/validate/apply, bridge tooling, per-branch cutover rehearsals, reconciliation) | ~125 |
| Testing & hardening (E2E across three network states, multi-node sync matrix, a11y, performance, security, sync-conflict and chaos drills, DR and archive drills, pen test) | ~130 |
| **Total** | **≈ 1,265** |

Split across two streams this is roughly **10–14 months** of calendar time with contingency and a staggered
branch rollout. The hybrid, multi-site and bridge buckets are the three that did not exist until D1, D4 and O3
were answered — each buys something specific: the LAN keeps working, branches can roll out independently, and
the hospital owns its history after the vendor relationship ends.
