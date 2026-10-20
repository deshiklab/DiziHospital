# P1 pilot module rollback — operator runbook

**Status: DRAFT — not clinically reviewed or rehearsed. Not an authorization to cut over or roll back.**

This runbook covers a **module-ownership rollback** during a P1 pilot. It is not a node rebuild, database restore, or power/network outage drill. Those have separate procedures: [outage drill #1](outage-drill-01.md) and [node rebuild-from-backup rehearsal](node-rebuild-from-backup-01.md). The [nightly reconciliation harness](nightly-reconciliation.md) is not a live production job.

## Safety rule

Patient safety and data integrity come first. Any staff member may call **STOP** on an unsafe or uncertain workflow. Only the designated clinical owner and incident lead may authorize a module rollback; only the authorized operations/IT role may change the live ownership control. Never switch ownership by editing a document alone. Keep exactly one write owner per module and branch. Do not silently double-write, delete, clear queues, or manually alter records to make the system appear green.

If the site has not verified the current owner, the legacy fallback, the authorized ownership control, and the rehearsed path for records created under new ownership, **do not start the pilot**. If the safe fallback is unavailable during an incident, stop the affected module and escalate; do not improvise a second write path.

## Rollback triggers

Stop the affected workflow and contact the clinical owner / incident lead immediately for any of the following:

- Wrong-patient, wrong-medicine, or other clinical safety error or credible near miss.
- Suspected data loss, duplicate application, missing/corrupt record, or unauthorized access/disclosure.
- Financial ledger or reconciliation mismatch in an in-scope financial module.
- An unexplained or unowned sync conflict, or a write whose state cannot be determined safely.
- More than **15 minutes of unplanned downtime** affecting the in-scope workflow.

These are stop/rollback triggers from the rollout plan, not permission for desk staff to select a different system. For immediate patient danger, follow the hospital's emergency-care process first.

## Authority and responsibilities

| Role | Responsibility |
|---|---|
| Any staff member | Stop the unsafe/uncertain task; alert the supervisor/clinical owner; preserve the safe state. |
| Clinical owner / named delegate | Assess clinical risk; decide whether work can resume; approve or reject module rollback. |
| Incident lead | Declare incident severity, coordinate the decision and timeline, notify the roster, preserve the decision record. |
| Authorized operations / IT owner | Apply the approved ownership-control change; verify one write owner and access path. |
| Engineering on-call | Preserve logs/state; assess app/API/sync; support the approved bridge and reconciliation. |
| Data / finance owner, if relevant | Reconcile counts/records/ledger; approve financial consistency before restart. |

The actual names, backups, secure contact path, and authority delegation are **TBD** for the pilot site and must be published in the restricted incident contact sheet before go-live.

## Preconditions before any pilot

Complete and evidence all items in the approved cutover record:

1. Branch, module, exclusions, window, release/build SHA, current owner, intended new owner, and decision authorities are named.
2. The legacy write path and access are verified for this branch; the module-specific rollback action and staff downtime instruction are approved.
3. The new-to-legacy data bridge for records written during new ownership is defined, tested, and reconciled on staging. If a safe bridge is not available, do not cut over.
4. Backups, logs, monitoring, support roster, and incident communication route are verified. No patient information is put in the Git repository or general issue/chat.
5. The rollback has been rehearsed on staging with the same release/build and ownership path, including queued/pending writes and conflict handling. Record pass/fail; a written procedure alone does not count as a rehearsal.
6. The clinical owner has approved the safe stop, rollback, and resumption criteria. The approved branch/module ownership notice is available to staff.

## Procedure

### 1. Stop the affected workflow

- The first person observing a trigger tells the shift supervisor and clinical owner: **“Stop the [module] workflow; state is uncertain / safety trigger.”** Include the time and a safe, non-identifying reference only.
- Do not continue new writes in the affected module. Do not re-submit uncertain transactions, clear or hand-edit a sync queue, delete records, or ask staff to enter the same work in the other system.
- Continue urgent care only through the site's already-approved emergency/downtime procedure. If there is no safe approved path, keep the affected workflow stopped and escalate.

### 2. Declare and decide

- The incident lead opens the restricted incident record, identifies severity, and contacts the clinical owner, operations/IT, and engineering on-call. Use the approved on-call route; target S1 response follows the repository incident policy.
- The clinical owner assesses patient risk. The incident lead records the decision, scope, time, and authority. On a listed trigger, keep the affected module stopped while rollback is assessed; a service-restoration target never overrides safety.
- Confirm branch, module, current owner, affected window, last known good state, whether any writes are pending, and whether the fallback is available. If any of these are unknown, do not resume writes.

### 3. Preserve state and freeze writes

- Record application/build SHA, node/service health, exact UTC times, queue/conflict counts, relevant audit/event references, and before-state counts/totals where available.
- Preserve logs, snapshots, and backup references in approved restricted storage. Keep identifiers/clinical details out of tickets and the public repository.
- Fence or disable further writes to the new module using the approved operator control. Do not remove or silently resolve pending operations. Preserve the old and new system states for reconciliation.

### 4. Apply the authorized ownership change

- Only the named operations/IT operator applies the pre-approved ownership-control change for this branch and module. Change ownership back to `L` only on the clinical owner / incident lead's decision.
- Disable or hide new-module writes and make its view read-only as specified. Verify that the legacy module is the **only** write owner and that staff-facing instructions now point to the approved fallback.
- Record before/after state, operator, approver, timestamp, control/registry version, and incident reference. Update the maintained ownership record through its controlled process; do not treat a Git edit as the live switch.

### 5. Reconcile writes made during the pilot window

- Use only the tested, approved bridge path to account for every new-system write made after the cutover boundary. Compare source references, counts/statuses, and applicable totals; preserve audit lineage and idempotency keys.
- Apply or replay only after the designated data/clinical owner authorizes the exact procedure. Do not manually re-key or overwrite records to force a match. Keep conflicting or unverified items visibly unresolved with a named owner.
- If the bridge is absent, incomplete, or produces an unexplained difference, keep affected writes stopped, preserve evidence, and escalate to the sponsor/clinical owner. **Do not claim rollback complete or resume the module.**

### 6. Verify, communicate, and hold

- Operations/IT and QA verify one write owner, staff access, read-only behavior on the retired new path, and service health. Use only approved verification records; never create an unapproved test patient in production.
- The data/finance owner reviews required reconciliation; the clinical owner reviews clinical safety and unresolved items. Record results and sign-off in the restricted incident/release record.
- Tell every affected shift which system owns the module, when the change took effect, what to do with pending work, and the support route. Retrieve or mark obsolete any superseded quick-guide copies.
- Keep hypercare active. Do not re-enable the pilot until defects are corrected, tests and reconciliation pass, ownership is approved, staff are briefed, and the clinical owner records a new go decision.

## Incident evidence — complete outside this repository if it contains sensitive details

| Field | Record |
|---|---|
| Incident / change ID | |
| Branch, module, approved scope | |
| Release/build SHA and ownership-control version | |
| Trigger, severity, first observed time (UTC) | |
| Stop time; last known good time; affected window | |
| Clinical owner / incident lead / authorized operator roles | |
| Decision and approval time | |
| Ownership before → after; single-writer check | |
| Queue/conflict counts and safe source references | |
| Bridge/reconciliation result and data/finance review | |
| Staff communication and superseded guide copies | |
| Open items, owners, due dates, next review | |
| Clinical owner / operations / QA acceptance | |

**Current status:** No P1 pilot rollback has been rehearsed. No live site, ownership switch, or rollback result is claimed.
