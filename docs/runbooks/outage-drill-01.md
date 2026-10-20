# Outage drill 01 — branch uplink loss (P0-404)

**Status: PREPARED — NOT RUN ON EDGE HARDWARE**

**Owners:** platform lead (drill lead), QA (recorder), edge-lab operator, clinical observer

**Acceptance:** one-hour uplink interruption; no lost eligible writes; queue drains after restore; conflicts are visible and resolved by an authorised person. Record timings and attach the evidence below.

> This is a procedure and evidence template, not a drill result. Do not mark P0-404 complete until the edge-lab run has been performed and reviewed. The `/sync` screen's `runOutageDrill()` uses `SimulatedCloud`; it tests the protocol in code, not a real link, edge node, or transport. The `/sync` runtime test is useful preflight, but is not evidence for this drill.

## Safety and scope

- Run only in the isolated `edge-lab`, using synthetic records and test accounts. Never interrupt a production branch or use real patient or financial records for this exercise.
- Interrupt only the branch's cloud/uplink connection. Keep the edge node powered and the local hospital LAN available; this drill is not a power-loss or LAN-loss test.
- The edge-lab operator and clinical observer must approve the workload and the start time. Name one person with authority to abort.
- Do not clear the outbox, delete operation records, or settle conflicts merely to make the dashboard green. Preserve the original state and evidence if anything fails.
- A mismatch, unexpected refusal, missing operation, duplicate application, loss of local service, or accidental real-data write is a stop condition. Restore the uplink, preserve logs, and reconcile before another attempt.

## Preconditions

1. The candidate edge bundle has a version/build SHA and has been installed on the lab node. A real edge sync transport and durable outbox are available; the simulator alone does not satisfy this precondition.
2. A second lab node or approved conflict injector is available to create remote edits while the primary node is offline.
3. Synthetic fixtures and expected outcomes are agreed before the run. Use unique `DRILL-01` record IDs; record the operation IDs produced by the system. Include:
   - offline-eligible append and field update operations;
   - one operation that the contract forbids offline, which must be refused clearly rather than silently queued;
   - one same-field edit from the second node and one exclusive-resource conflict, so conflict handling is exercised.
4. Confirm the lab is isolated from production, the backup/checkpoint is restorable, system clocks are synchronised, the uplink can be restored immediately, and logs/metrics are being recorded on both nodes and the cloud tier.
5. Capture the starting queue, conflict count, node IDs, current ownership/configuration, build SHA, service health, and baseline record/audit snapshots. If the baseline queue is not empty, stop and reconcile it first.
6. Run the code-level preflight: build the candidate and run `npm run test:runtime` against it. The `/sync` simulated drill must pass. Record this separately as a **simulation preflight**, never as the physical drill result.

## Procedure and timing

Record all times in UTC with seconds and use the same clock source for both nodes.

| Time | Action | Evidence to capture |
|---|---|---|
| T−15 min | Brief the participants; confirm isolation, abort authority, backup, monitoring, and restore method. | Attendee/role list; change or lab-run ID; checklist. |
| T−5 min | Verify both nodes and cloud are healthy; verify the primary queue and conflict count are zero; create and confirm a small set of synthetic baseline writes while online. | Health checks; baseline queue/conflicts; baseline operation IDs and server/audit acknowledgements. |
| T0 | Edge-lab operator disconnects only the primary node's cloud uplink. QA records the exact time and verifies cloud reachability is lost while local LAN access to the edge node remains. | Link state; exact disconnect time; local-service health. |
| T0–T+60 min | Keep the uplink down for a full 60 minutes. Execute the pre-agreed synthetic workload through the normal application path. Confirm each eligible write remains available locally and enters the durable queue; confirm the offline-forbidden operation is refused with a reason. Have the second node make the planned conflicting edits. Do not manually drain or edit the queue. | Timestamped action log; operation IDs; queue depth over time; refusal reason; second-node writes; local-service health. |
| T+60 min | Restore the uplink. Record the exact time and confirm the real transport reconnects. Allow the normal retry/sync process to run; do not clear or hand-edit pending operations. | Link restore time; reconnect/health logs; queue depth and retry events. |
| T+60–75 min | Observe the automatic drain. Verify operation outcomes against the pre-run list and server/audit records. Confirm every eligible queued write is applied once or resolved through the normal authorised conflict workflow, retaining both values and the decision record. Confirm the offline-forbidden operation was refused and never queued or applied. Verify idempotent retries do not apply a write twice. | Per-operation outcome; applied/refused/duplicate counts; conflict records, resolver, reason, and timestamps; time to empty queue. |
| By end of shift | Confirm no pending or unowned conflicts remain; compare final local/server snapshots and audit history; review the evidence with QA and the clinical observer. | Final queue/conflict counts; reconciliation result; sign-offs; incident/ticket links if needed. |

If the queue has not drained within **15 minutes** of uplink restoration, treat that as a failed pilot-wave threshold: do not force-clear it; capture state, keep the lab isolated, and open a defect. If a clinical conflict cannot be resolved during the observation window, leave it explicitly owned and unresolved and record the run as **FAIL / INCOMPLETE**, not PASS.

## Pass criteria

All criteria must be met for this run to pass:

- The uplink remained down for 60 minutes while the edge node and local LAN continued serving the lab workload.
- Every offline-eligible write enters the durable local queue and has exactly one accounted-for outcome: applied once, or resolved through an identified conflict with a recorded authorised decision. No eligible write is missing or silently refused.
- The predeclared offline-forbidden operation is refused with an explicit contract reason and is never queued or applied. No eligible write is unexpectedly refused.
- The restored-link queue drains automatically to zero within 15 minutes; retrying/replaying does not duplicate an applied write.
- Conflicts are visible with both sides preserved, have a named authorised owner and recorded decision, and the conflict queue is empty by the end-of-shift review.
- Final local/server records and audit trail reconcile to the expected synthetic workload; there are no unexplained changes or writes to production.
- QA and the clinical observer sign the evidence record. Any failed criterion means the run is not a pass; fix, reset the lab, and schedule a new run ID.

## Evidence record — complete for each attempt

| Field | Value |
|---|---|
| Run ID / issue | `P0-404` /  |
| Result | `NOT RUN` / `PASS` / `FAIL` / `INCOMPLETE` |
| Date; T0 disconnect; uplink restored; end-of-shift review (UTC) |  |
| Edge bundle version and build SHA |  |
| Primary/secondary node IDs; lab operator; QA recorder; clinical observer |  |
| Synthetic fixture/workload version; expected operation count |  |
| Starting queue / conflicts; peak queue depth |  |
| Eligible writes created / queued / applied / conflict-resolved / missing / duplicate / unexpectedly refused |  |
| Offline-forbidden operations attempted / refused correctly / queued or applied |  |
| Uplink-down duration; local-service interruptions |  |
| Time from restore to queue empty |  |
| Final open conflicts; reconciliation result; unexplained differences |  |
| Logs, screenshots, metrics, audit export, and run artefact links |  |
| Defect/incident references and follow-up owner |  |
| QA and clinical-observer sign-off; date |  |

**Current attempt:** NOT RUN. No physical edge-lab outage or real-transport evidence was collected in this workspace. The existing in-app simulator and its automated assertion are protocol checks only.
