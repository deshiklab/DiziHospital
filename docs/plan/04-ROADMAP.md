# 04 — Roadmap

Sequence, scope, exit criteria and pilot waves. Sizes come from the generated
[`03-SCREEN-MAP.md`](03-SCREEN-MAP.md) (575 engineer-days of screen work across 76 screens and 19 sub-screens).
With platform, design/research/QA, migration and hardening overhead the programme is
**≈ 1,060 engineer-days** (see §6), i.e. **≈ 8–11 months** with the two streams below.

**Assumed team** (D5 default): 1 UX designer, 1 tech lead, 4–6 engineers, 1 QA/SDET, part-time clinical lead,
part-time DevOps. Two delivery streams run in parallel from P2, which is why the calendar below (~7.5–9 months)
is shorter than a single-stream sum.

## 1. Phase plan

| Phase | Weeks | Theme | Legacy screens replaced | Exit criteria (all must pass) |
|---|---|---|---|---|
| **P0** | 0–2 | Foundations | 0 | Environments (local/CI/preview/staging) green; design tokens generating CSS+Tailwind; AppShell + DataGrid + form kit in Storybook; auth (OIDC + MFA) working against legacy users; API conventions + first 3 endpoints; audit ledger writing; observability dashboards; CI gates enforced; ADRs 1–5 accepted |
| **P1** | 3–6 | Identity, patients, appointments | 3 screens + 3 sub-screens (`001`, `002`, `004`, import, discharged, queue) | One OPD desk registers, searches, imports and books on the new UI for 5 consecutive days; duplicate-patient detection live; task times ≤ legacy − 30 %; zero P1 defects open; legacy screens still reachable |
| **P2** | 7–11 | Billing + OPD consultation | 3 screens + 5 sub-screens (`003`, `005`, `057`, billing sub-screens, OPD view) | Bills raised on the new UI reconcile to the legacy ledger to the paisa for 2 weeks; consultation workspace used for ≥ 200 real encounters with clinician sign-off; receipts print on all three paper formats |
| **P3** | 9–12 (stream B) | Pharmacy + inventory | 4 screens + 2 sub-screens (`007`, `030`, `062`, `075`, sale search/returns) | Dispensing with batch/expiry guard live; daily stock reconciliation automated; no stock negative; pharmacist sign-off |
| **P4** | 13–18 | Lab, imaging, blood bank, ambulance | 11 screens + 7 sub-screens | Lab worklist with barcode specimen flow live; results released to portal; blood bank issue with cross-check; imaging worklist live; ambulance dispatch log live |
| **P5** | 14–18 (stream B) | IPD, ward, OT | 4 screens (`006`, `058`, `061`, `021`) | Admissions/discharges, bed board, nursing notes, medication administration and OT scheduling live on one ward for 2 weeks; ward PWA offline queue proven |
| **P6** | 19–23 | Finance, insurance, reporting | 23 screens (income/expense, TPA, referral, 17 reports) | All 17 reports rebuilt with reconciliation against legacy; TPA claim pipeline live; saved views + scheduled exports; finance sign-off |
| **P7** | 24–28 | People, front office, administration | 16 screens + 2 sub-screens | HR/attendance/payroll live; front-office registers live; multi-branch console live; masters and settings migrated; print templates authored in the new designer |
| **P8** | 29–32 | Communication, content, portal, website | 12 screens + portal + public site | Patient portal live with results/bills/appointments; notice board + surveys + certificates live; Front CMS driving the website; telemedicine booking live |
| **P9** | 33–36 | Decommission & hardening | legacy retired | Legacy app read-only for 2 weeks then archived; DR drill passed (RTO 1 h / RPO 15 min); pen test closed; performance budget met at 500 k patients; runbooks + training complete; support hypercare handed to the hospital IT team |

Dates are relative because the start date depends on D5. A single-stream team (4 engineers) should expect
**12–14 months**; the sequence stays the same.

## 2. Why this order

1. **Foundations first** — without tokens, AppShell and auth, every screen would invent its own patterns and the legacy look would creep back in.
2. **Patients before clinical** — the patient master is the reference every other module joins to; getting identity/search right unlocks everything.
3. **Money early (P2) but after identity** — billing is where correctness matters most and where reconciliation proves the API layer works.
4. **Pharmacy before lab** — pharmacy touches the most users daily (every ward order) and is self-contained.
5. **IPD after OPD/pharmacy/lab** — the in-patient case consumes orders, meds and results, so it lands once those exist.
6. **Reports after the modules they read** — rebuilding reports earlier would mean rebuilding them twice.
7. **Portal and website late but not last** — they depend on stable clinical and billing APIs.
8. **Decommission is a phase with its own budget** — migrations always overrun if this is not planned.

## 3. Pilot waves (how new modules reach real users)

| Wave | Scope | Users | Duration | Rollback trigger |
|---|---|---|---|---|
| 0 | Internal (dev + clinical lead) on synthetic data | 4 | each phase | n/a |
| 1 | One OPD desk + one doctor, one billing counter | 6–10 | 5 working days | any clinical-data error, or task time worse than legacy, or > 2 P1 defects |
| 2 | Whole department (e.g. all OPD desks) | 10–25 | 2 weeks | ledger mismatch > ৳0, or downtime > 15 min |
| 3 | Hospital-wide module rollout, other modules still legacy | all | 1 week per module | edge routing flips the module back to legacy in < 5 min |

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
| Vendor releases v7.1 mid-programme | Vendor-update branch merged on a schedule (monthly) with regression suite; security fixes cherry-picked immediately |
| Key-person dependency (single nurse champion) | Pair champions per department; recorded training sessions |

## 6. Budget shape (engineering effort, not money)

| Bucket | Engineer-days |
|---|---|
| Screen rebuild (generated) | 575 |
| Platform (auth, API layer, events, audit, observability, CI/CD, infra) | ~200 |
| Design system, research, usability testing, design QA | ~115 |
| Data migration, reconciliation, cutover rehearsals | ~80 |
| Testing & hardening (E2E, a11y, performance, security, DR) | ~90 |
| **Total** | **≈ 1,060** |
