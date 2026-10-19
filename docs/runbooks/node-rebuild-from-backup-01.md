# Node rebuild from backup — timed edge restore rehearsal 01 (P0-405)

**Status: PREPARED — NOT RUN**

**Execution readiness: NOT VERIFIED.** The repository does not yet contain the edge deployment or backup routine described in the plan. Do not start the timed rehearsal until the real `edge-lab`, a replacement node, and a verified restore set are available.

**Owners:** ops lead (drill lead), backup/database operator, edge-lab operator, QA recorder

**Acceptance:** measure and record RTO (target: ≤ 1 hour) and RPO (target: ≤ 15 minutes); validate the restored synthetic workload; open a tracked issue for each gap, with owner and evidence.

> This is a procedure and evidence template, not a restore result. The system-level targets come from [the recovery plan](../plan/06-DATA-MIGRATION-AND-ROLLOUT.md), [ADR 0006](../plan/adr/0006-primary-database.md), and [ADR 0007](../plan/adr/0007-hybrid-topology-and-sync.md). The ADR names pgBackRest or an equivalent as the backup mechanism; this runbook deliberately does not invent commands for tooling that is not deployed. `infra/README.md` currently says the Compose environment and `edge/` deployment are not written. The mirrored vendor [Backup / Restore article](../help-library/system-settings/backup-restore.md) describes the legacy product UI, not this platform's recovery procedure.

## Safety and scope

- Run only in an isolated `edge-lab` with synthetic records and test accounts. Never restore over production or use real patient, financial, identity, or staff data in this exercise.
- Use a replacement appliance or VM that represents the documented edge-node target. Restore from a backup copy independent of the failed node; a copy stored only on the failed node does not prove recoverability.
- Fence and isolate the failed node before the replacement can accept writes. Keep it preserved and offline until the drill lead confirms the replacement is authoritative; never let two nodes write as the same branch.
- Do not place backup files, encryption keys, credentials, certificates, patient data, or unredacted logs in Git or the evidence record. Retrieve secrets through the approved secret manager and record only secret/key identifiers.
- Do not force a restore if the backup manifest, checksum/signature, WAL chain, decryption key, or component inventory is incomplete. Record the blocker, preserve evidence, and raise a ticket.
- This rehearsal measures a node rebuilt from backup. It does **not** by itself prove the separate cloud-replica promotion and `cloud-direct` site-mode scenario in the quarterly DR plan.

## Readiness gates

All gates must be green before T0. If any gate is missing, mark the attempt **BLOCKED / NOT RUN**; do not start the RTO clock or claim a measured result.

1. **Lab and authority:** named drill lead, backup operator, replacement-node operator and QA recorder; written approval to run; isolated synthetic-data lab; no route to production.
2. **Build and target:** documented node hardware/VM profile, deployment bundle and build SHA, operating-system/container versions, branch/node identity, and enough capacity for the test restore. State whether the target is cold hardware or a prepared spare; the measured scenario must be clear.
3. **Restorable backup set:** record the source and location, backup ID, creation time, manifest, integrity/signature result, encryption-key ID, and the recoverable database/WAL point. The selected source must survive loss of the failed node.
4. **Component recovery map:** for each persistent component, name the restore or re-provision procedure and its version. At minimum account for PostgreSQL plus WAL, MinIO/object files, identity state or approved identity re-provisioning, audit history, sync/outbox/cursors, mTLS/node registration, and branch configuration. Define the approved certificate/key re-issue and old-node revocation process; never clone a live node's private identity onto its replacement. State which caches or queues are ephemeral and how they are safely rebuilt; do not assume a database backup includes them.
5. **Data and service baseline:** synthetic fixture version, expected record counts/checksums, object manifest, identity test accounts, sync state, and a known-good health check. Enable a timestamped synthetic canary write at least once per minute before the failure so the 15-minute RPO can be measured. Verify the full-backup and WAL chain reaches the selected restore point, or record the approved equivalent and any deviation.
6. **Evidence and timing:** synchronised UTC clocks with seconds, a shared event log, monitoring/log export, and a ticket location. No restore work that would ordinarily happen after failure may be done before T0; list any pre-staged items so the result is comparable and honest.

## Timing definitions

- **T0 / RTO start:** T0 is the exact time the drill lead declares the edge node failed; start the clock at that declaration, before fencing begins. Record the fence time separately. RTO includes replacement provisioning, install, data restore, integrity checks, and the smoke test that allows the replacement to resume the agreed local synthetic workflow.
- **RTO stop:** the replacement is the sole authorised edge node, required services are healthy, and QA has passed the synthetic read/write and recovery checks. Merely copying files or starting containers is not service recovery.
- **RPO:** compare T0 with the timestamp of the newest acknowledged synthetic canary recovered on the replacement. `RPO = T0 − latest recovered acknowledged canary`. Enumerate every acknowledged canary that is absent: absent canaries after the latest recovered one are the lost tail and must be disclosed; any missing canary older than that point or any non-contiguous gap is a data-integrity failure. The tail is within target only when the measured RPO is ≤ 15 minutes; do not describe an allowed tail as zero data loss.
- Record all timestamps in UTC. Continue recording the actual completion time if the one-hour target is missed; do not stop the clock at the target or report the target as the measured RTO.

## Timed procedure

| Time | Action | Evidence to capture |
|---|---|---|
| T−30 min | Brief the operators; confirm isolation, abort authority, target profile, restore source, keys, component map, monitoring and rollback/stop method. Verify the lab node is healthy and begin the canary stream. | Attendee/role list; lab/change ID; node/build identifiers; preflight checklist; canary IDs and acknowledgement times. |
| T−5 min | Capture baseline counts/checksums for synthetic database records and objects, identity test accounts, audit history, sync/outbox/cursor state, and service health. Verify the selected backup manifest and record its recoverable point without beginning the restore. | Baseline and expected values; backup ID/source/time; manifest/checksum/signature result; WAL range; key identifier. |
| T0 | Drill lead declares the simulated node failure. Operator records the exact time and fences the failed node from accepting writes; do not delete or overwrite its data. | Declaration and fence times; last acknowledged canary; node/network state; incident/run ID. |
| T0 onward | Provision the replacement according to the documented deployment procedure. Restore the database to the selected point and replay the available WAL; restore or re-provision each component in the recovery map. Keep the replacement isolated from production and do not enable branch writes yet. | Start/end time per step; commands/tool and version; restore point; logs; errors/retries; data transferred; operator. |
| After restore | Verify manifests/checksums, record counts, canary sequence, object readability, identity sign-in, audit continuity, sync/outbox/cursors and service health. Register the replacement's approved node identity/certificate and retire or revoke the old identity per procedure. Run the agreed synthetic read/write workflow. Confirm the failed node remains fenced and the replacement is the only writer before enabling the lab workflow. | Per-component results; missing/duplicate canaries; final checksums/counts; smoke-test results; replacement/old-node identity state; authority/site-mode state; exact time QA accepts service. |
| At T+60 min, if not recovered | Record that the RTO target was missed. Continue only if the drill lead judges it safe; preserve the target and logs, and record the eventual recovery time or mark the attempt incomplete. Never shorten the evidence or force a destructive shortcut to pass. | Target-breach time; blocker; decision/owner; eventual completion or stop time; incident and gap-ticket links. |
| End of run | Reconcile the replacement against the expected synthetic baseline; review evidence with ops and QA. Keep the failed node fenced until the drill lead confirms the lab's final state and a safe reset plan. | RTO/RPO calculation; pass/fail/incomplete result; sign-offs; gap tickets with owners, severity and evidence. |

## Pass criteria

All criteria are required for a pass:

- Measured RTO is **≤ 60 minutes** from T0 to the QA-accepted local synthetic workflow on the replacement node.
- Measured RPO is **≤ 15 minutes**. All canaries before the newest recovered canary are present; any absent canaries form a disclosed tail within the RPO window. There are no non-contiguous gaps, duplicate applications, or integrity/checksum failures. Do not report zero data loss if a tail is missing.
- Every persistent component in the approved recovery map is restored or re-provisioned and verified; synthetic records, objects, identity, audit, and sync state reconcile to the expected baseline.
- The replacement operates as the sole edge writer. There is no split brain, production connection, or real-data write.
- QA and ops sign the evidence record. Every discovered blocker or gap has a tracked ticket with an owner, priority/severity, and evidence. Any failed criterion means the attempt is **FAIL** or **INCOMPLETE**, not PASS.

## Evidence record — complete for each attempt

| Field | Value |
|---|---|
| Run ID / issue | `P0-405` /  |
| Result | `NOT RUN` / `BLOCKED` / `PASS` / `FAIL` / `INCOMPLETE` |
| Date; T0 declaration; old-node fenced; service accepted (UTC) |  |
| Drill lead; backup/database operator; node operator; QA recorder |  |
| Lab ID; replacement target profile; cold spare or prepared target |  |
| Edge bundle/build SHA; OS/container/tool versions |  |
| Backup ID/source; creation time; restore point; integrity result; key ID |  |
| Component recovery-map version; restored/re-provisioned components |  |
| Last acknowledged canary before T0; newest recovered canary; missing IDs |  |
| Measured RTO; target met? |  |
| Measured RPO; target met? |  |
| Baseline/final counts and checksums; reconciliation result |  |
| Split-brain/authority check; production-isolation check |  |
| Logs, metrics, screenshots and evidence links (redacted/synthetic only) |  |
| Gap/defect ticket links; owner; severity; due date |  |
| Ops and QA sign-off; date |  |

**Current attempt:** NOT RUN. No RTO or RPO has been measured. The repository has no edge deployment or backup/restore routine to execute yet; ops must verify whether an external, isolated lab and restorable backup set are available before scheduling the physical rehearsal.
