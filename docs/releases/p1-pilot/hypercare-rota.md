# P1 pilot hypercare — rota and handoff template

**Status: DRAFT — no pilot date, branch, named coverage, or support channel is confirmed.**

## Coverage model

Plan **two weeks of hypercare after each pilot wave**, with an on-floor coach for the full cutover shift and a daily 15-minute huddle between the department and engineering. Build the schedule around the site's actual operating hours and shifts; do not assume a weekday, daytime-only desk, or one person can cover every shift.

Before the pilot is authorized, name a primary and backup for each applicable shift and confirm the secure contact route. Keep personal phone numbers and the detailed on-call roster in the hospital's approved restricted location, not in this repository.

## Roles

| Role | Hypercare responsibility |
|---|---|
| Clinical owner / delegate | Patient-safety decision; may stop the affected workflow; approves resumption and clinical wording. |
| Department champion / floor coach | First-line task help, observes workflow friction, logs non-PHI issue references, hands off open items each shift. |
| Branch supervisor | Confirms branch/module ownership notice; coordinates staff, approved downtime process, and shift handover. |
| Hospital IT | Workstation, LAN, printer, account, and branch-device triage; preserves relevant logs. |
| Engineering on-call | Application, API, sync, and data-integrity triage; preserves state and coordinates technical recovery. |
| Incident lead | Coordinates severity, decision log, escalation, communications, and rollback execution with authorized operators. |
| Data/finance owner (when relevant) | Reviews reconciliation or ledger discrepancy; signs financial recovery evidence. |

One person may cover multiple roles only if the clinical owner approves the coverage and a backup remains available. Do not use a personal/shared application login as a workaround.

## Rota — fill one row for every actual site shift

Duplicate rows as needed for morning, evening, night, weekend, or other local shifts. The table is a blank template, not a staffed rota.

| Relative day | Date / shift hours / timezone | Floor coach (primary) | Backup | Clinical champion / delegate | IT | Engineering on-call | Secure contact route / handoff reference |
|---|---|---|---|---|---|---|---|
| Cutover (Day 0) | | | | | | | |
| Day 1 | | | | | | | |
| Day 2 | | | | | | | |
| Day 3 | | | | | | | |
| Day 4 | | | | | | | |
| Day 5 | | | | | | | |
| Day 6 | | | | | | | |
| Day 7 | | | | | | | |
| Day 8 | | | | | | | |
| Day 9 | | | | | | | |
| Day 10 | | | | | | | |
| Day 11 | | | | | | | |
| Day 12 | | | | | | | |
| Day 13 | | | | | | | |
| Day 14 | | | | | | | |

## Daily rhythm and escalation

- **Cutover day:** floor coach is physically or operationally available for the full approved shift. Confirm current ownership and escalation contacts at shift start and handoff.
- **Every day:** hold the planned 15-minute huddle with the department, clinical champion, IT, and engineering as appropriate. Review open issues, system/network status, sync or reconciliation exceptions, training needs, and the next shift's coverage. Record decisions and ticket IDs without patient details.
- **Patient safety, wrong-patient/wrong-medicine concern, suspected data loss, ledger mismatch, unowned sync conflict, or >15 minutes of unplanned downtime:** stop the affected module, contact the clinical owner and incident lead immediately, and follow [`p1-pilot-rollback.md`](../../runbooks/p1-pilot-rollback.md). The incident lead pages the on-call route under the approved local incident process.
- **Other blocked work:** contact the shift coach/supervisor and create a restricted support ticket. Do not retry blindly, make duplicate entries, clear queues, or change ownership to make a dashboard green.
- **Shift handoff:** state what is affected, current module owner, incident/ticket reference, last verified state/time, named next owner, and next action. Transfer records only through approved secure channels; no patient details in this repository.

| Huddle / handoff field | Entry (keep non-PHI) |
|---|---|
| Date, shift, timezone | |
| Participants by role | |
| Current branch/module owner and release/build | |
| Open issue / incident references and severity | |
| Sync/reconciliation status and last verified time | |
| Training or access gaps | |
| Decision, owner, due time, next-shift handoff | |

## Hypercare exit / handoff

Close hypercare only after the two-week window is complete, every operating shift has had coverage, there are no unresolved S1 safety/data-integrity incidents or unowned conflicts, required reconciliation is reviewed by its named owner, remaining defects have owners and dates, and the clinical owner accepts the handoff to normal support. If live reconciliation or required evidence is unavailable, record the gap and do not call the pilot reconciled. Record the decision and evidence location in the approved release record.

**Current status:** NOT STAFFED — dates, names, channels, shifts, build, and handoff approver are all pending. No hypercare coverage is claimed.
