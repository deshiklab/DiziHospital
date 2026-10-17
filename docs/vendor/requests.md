# Vendor requests and data-access log (P0-002, P0-105)

Two things live here because they are the same conversation with the vendor: **fix what is dangerous** in the
system still in use, and **give us our data** so the replacement can start with full history (O1/O5).

## 1. Data access request (tracking)

| Item | Status | Date | Owner | Notes |
|---|---|---|---|---|
| Written request sent (scope, transport, cadence, checksums, change notice, exit) | ☐ | | sponsor | template in `docs/plan/08` §2 |
| Requested delivery: nightly logical dump (`mysqldump --single-transaction --routines --triggers`), gzipped + encrypted, per branch, to our storage | ☐ | | sponsor | the practical form of a replica for a vendor-hosted instance |
| Alternative offered by vendor: tunnelled read-only replica | ☐ | | sponsor | preferred if available |
| Cadence agreed (target 02:00 hospital time, daily) | ☐ | | | |
| Checksums + row counts included per delivery | ☐ | | | |
| 14-day notice of schema/export changes agreed | ☐ | | | |
| Credential custody agreed (our secret manager, quarterly rotation) | ☐ | | | |
| Exit clause: complete final export in open formats on termination | ☐ | | | |
| First delivery received and validated | ☐ | | data engineer | proves the bridge end-to-end |

**If the answer is no:** the sponsor records a written decision (go forward with limited history / pay for
extraction / stay), and the archive plan in `docs/plan/08` §7 becomes the primary source for old records.

## 2. Safety and correctness requests (ranked, evidence attached)

Each item is either **fixed by the vendor**, **replaced by us** at the phase below, or **accepted as a residual
risk** with a named owner. Nothing drifts without a status.

| # | Request | Evidence (from the capture) | Risk if untouched | Status | Vendor ref | Our phase |
|---|---|---|---|---|---|---|
| 1 | Confirmation step before bulk delete | Destructive bulk delete with no confirmation on list screens | Irreversible data loss by a mis-click | ☐ sent | | P7 (masters) |
| 2 | Allergy / interaction warning at dispense | No allergy check on the pharmacy dispense screen | Wrong-medicine harm | ☐ sent | | P3 |
| 3 | Currency configurable per branch | Hard-coded `$` on bills and reports | Wrong amounts on printed bills | ☐ sent | | P2 |
| 4 | Fix the mojibake in clinical headers | Mixed/garbled encoding in clinical section headings | Misread clinical labels | ☐ sent | | P2 |
| 5 | Reconcile the contradictory dashboard KPIs | Same occupancy shown as 56 % and 30/54 | Management decisions on wrong numbers | ☐ sent | | P6 (reports) |
| 6 | Audit log of who viewed a patient record | No view-level access log | No investigation trail for record access | ☐ sent | | P1 (audit ledger) |
| 7 | Confirm the `patient merge` behaviour | Merge leaves no history of what was merged | Silent loss of one patient's history | ☐ sent | | P1 |

## 3. Change control during the transition (plan `05` §11)

* **No vendor upgrade within ±14 days of a module cutover** without the tech lead's written approval.
* Any approved upgrade is regression-tested against the bridge contract tests **before and after**.
* If the vendor changes the UI, our rung-4 replay flows (if any) are re-verified the same week, or switched off.
* Every vendor interaction is logged here — no verbal agreements about data.

## 4. Log

| Date | Item | Who | Outcome / next step |
|---|---|---|---|
| | | | |
