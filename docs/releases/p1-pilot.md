# P1 pilot pack — P0-407

**Status: DRAFT — not clinically reviewed, not printed, and not authorized for live patient care.**

This pack prepares the proposed first P1 wave for the reception / appointment desk. The exact branch, module scope, cutover date, release build, and named owners have **not** been approved. The branch-selection worksheet is blank, and the module ownership matrix still marks P1 as planned rather than recording an active `N` owner. Do not treat this draft, the synthetic fixtures, or a preview build as a pilot authorization.

## Pack contents

- [Reception and appointment quick guide — English](p1-pilot/cheat-sheet-en.md)
- [রিসেপশন ও অ্যাপয়েন্টমেন্ট দ্রুত নির্দেশিকা — বাংলা](p1-pilot/cheat-sheet-bn.md)
- [30-minute role-based training facilitator guide](p1-pilot/training-30min.md)
- [Pilot rollback runbook](../runbooks/p1-pilot-rollback.md)
- [Two-week hypercare rota and handoff template](p1-pilot/hypercare-rota.md)

## Release identity — complete before clinical review

| Field | Current value |
|---|---|
| Pilot branch / site | **TBD** — `docs/research/branches.md` has no selection |
| Pilot module(s) and exclusions | **TBD** — agree with the clinical owner |
| Current owner per module | **TBD** — the planned `P1` cells in `docs/migration/ownership.md` are not a cutover decision |
| Cutover window / timezone | **TBD** |
| Candidate release tag / build SHA | **TBD** |
| Clinical owner / delegate | **TBD** |
| Branch lead / role champions | **TBD** |
| Support channel and secure contact list | **TBD** — maintain contact details outside this repository |
| Training environment and approved test accounts | **TBD** — synthetic data only |

## Authorization and safe-use gate

- Until an approved, branch-specific release notice says otherwise, use the hospital's currently authorized system for patient care. This pack is **training-only** while its status is DRAFT.
- At cutover, use the new platform for a module only after the approved branch/module ownership registry says `N`. `L` means legacy owns the writes; `P`, blank, missing, or unclear means **stop and ask the supervisor**. Never write the same transaction into both systems.
- The static ownership worksheet is not itself a live control. Before a pilot, staff need an approved, accessible ownership notice and a tested way for authorized operators to change ownership.
- Train in an isolated, approved environment with synthetic records. Never use real patient information in this pack, attendance notes, issue trackers, or screenshots.
- Staff may report a safety concern or stop an affected task. Only the designated clinical owner and incident lead may authorize a module rollback; only the authorized operations/IT role may apply the ownership change.

## Before issuing to staff

- [ ] Sponsor and clinical owner have selected the branch, module scope, exclusions, cutover window, and named decision authority.
- [ ] Per-branch ownership is reviewed and published; the actual owner, write path, and approved fallback are verified for every in-scope module.
- [ ] Release build, role permissions, supported network states, and user-visible status messages have been exercised in the approved environment.
- [ ] Data-access, migration/reconciliation, backup, incident, and rollback prerequisites for this scope are approved. A written runbook is not evidence that an outage, restore, or rollback rehearsal has been run.
- [ ] Rollback is rehearsed on staging, including preservation and reconciliation of records created under new ownership; the designated legacy fallback is reachable.
- [ ] The clinical lead reviews both language versions, local clinical terminology, safety steps, scope, and escalation route. Bangla wording is checked by a fluent reviewer familiar with the pilot site.
- [ ] The 30-minute session is tailored to each role; sandbox, trainer, champion, test accounts, attendance process, and accessible support route are ready.
- [ ] Hypercare coverage is named for every actual operating shift for two weeks, including after-hours escalation and backups.
- [ ] Both cheat sheets are printed on the site printer and proofed on A4 paper. Confirm Bangla glyphs render, the page is legible, no text is clipped, version/date are visible, and the correct contact route is printed.
- [ ] Controlled copies are delivered to agreed staff locations; obsolete copies have a removal/replacement plan.

## Clinical review and print evidence

Do not record staff personal phone numbers or patient details here. Keep signed attendance and any controlled contact list in the approved internal location.

| Evidence | Status / reference |
|---|---|
| Clinical lead review (reviewer role, date, approved version) | **PENDING** |
| Bangla language review (reviewer role, date, approved version) | **PENDING** |
| Branch/module owner and scope approval | **PENDING** |
| English print proof (printer, A4, legibility/clipping check, version) | **PENDING** |
| Bangla print proof (Bangla font/glyph check, A4, legibility/clipping check, version) | **PENDING** |
| Printed copy count and controlled distribution locations | **PENDING** |
| Training completion record / secure location | **PENDING** |
| Rollback rehearsal evidence / linked run ID | **PENDING** |

**P0-407 acceptance is not met yet.** The acceptance test requires clinical-lead review and printed copies ready. This repository contains draft source material only; no review, physical print proof, training session, pilot, rollback rehearsal, or hypercare coverage is claimed.

## Related readiness evidence

- [Pilot branch selection worksheet](../research/branches.md) — not completed.
- [Module ownership matrix](../migration/ownership.md) — branch ownership/cutover dates not filled in.
- [Usability test #1 instrument](../research/usability-01.md) — no pilot session run.
- [Nightly reconciliation runbook](../runbooks/nightly-reconciliation.md) — harness prepared; no live nightly run.
- [Outage drill #1](../runbooks/outage-drill-01.md) — prepared; not run on edge hardware.
- [Node rebuild-from-backup rehearsal](../runbooks/node-rebuild-from-backup-01.md) — prepared; physical rehearsal not run.
