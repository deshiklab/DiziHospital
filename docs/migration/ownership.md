# Module ownership matrix (module × branch)

**This file is the boundary between the legacy system and the new platform** (plan `08` §5, `01` §2). It is
reviewed in every weekly delivery meeting. If a row disagrees with what staff experience, the row is wrong.

Status legend: **L** = legacy owns it (records are created there) · **N** = new platform owns it · **P** = planned
for the phase shown · **—** = not applicable at this branch.

Rules:

1. Exactly one system owns a module at a branch at any time. Never both.
2. A module is only announced to staff as "new" when the cell says **N** *and* that branch's training is done.
3. Cutover dates are set per cell; branches move 2–4 weeks apart on purpose (`04` §1).
4. Master data (charge catalogue, ICD-10, users/roles) is hospital-wide: one row, cloud-authoritative.

**Branches:** A = ______ (pilot) · B = ______ · C = ______ · **Last updated:** ______ by ______

| Module | Branch A | Branch B | Branch C | Write-back needed? | Cutover (A) | Owner | Retirement criteria |
|---|---|---|---|---|---|---|---|
| Patient registration & search | P1 | P1 | P1 | no (one-way read) | | | 5 clean days + duplicate detection live |
| Appointments & queue | P1 | P1 | P1 | no | | | no-shows/queue behaviour verified for 1 week |
| OPD consultation | P2 | P2 | P2 | no | | | ≥ 200 encounters signed off by clinicians |
| Billing & payments | P2 | P2 | P2 | **yes — rung 2/3 until P6** | | | 2-week parallel run, paisa-level reconciliation |
| Pharmacy dispensing | P3 | P3 | P3 | no | | | batch/expiry guard live, pharmacist sign-off |
| Inventory & stock | P3 | P3 | P3 | no | | | per-location ledgers reconcile to physical count |
| Lab | P4 | P4 | P4 | yes — informs legacy billing while it is legacy-owned | | | barcode specimen flow + released results |
| Imaging | P4 | P4 | – | yes — same as lab | | | worklist live, reports readable in the new viewer |
| Blood bank | P4 | – | – | no | | | issue with cross-check verified by the blood-bank owner |
| Ambulance | P4 | P4 | P4 | no | | | dispatch log in daily use |
| IPD / wards | P5 | P5 | P5 | no | | | 2 weeks on one ward, MAR + bed board correct |
| Operation theatre | P5 | – | – | no | | | scheduling + notes live for one list |
| Finance (income/expense) | P6 | P6 | P6 | no | | | monthly close done in the new system once |
| Insurance / TPA | P6 | P6 | P6 | yes — claims still filed in legacy during overlap | | | claim pipeline live for one cycle |
| Reports | P6 | P6 | P6 | no | | | all 17 reports reconciled against legacy numbers |
| HR / attendance / payroll | P7 | P7 | P7 | no | | | one payroll cycle run and signed off |
| Front office & helpdesk | P7 | P7 | P7 | no | | | registers live for 2 weeks |
| Administration & masters | P7 | P7 | P7 | no (cloud-authoritative) | | | masters migrated and locked in legacy |
| Patient portal | P8 | P8 | P8 | no | | | patients using results/bills/appointments |
| Website / CMS | P8 | P8 | P8 | no | | | public site served from the new CMS |
| **Master data (charge catalogue, ICD-10, roles)** | P0 | P0 | P0 | n/a | hospital-wide | | distributed as signed packages to every branch |

## Change log

| Date | Cell changed | From → To | By | Evidence (reconciliation report / ticket) |
|---|---|---|---|---|
| | | | | |
