# 30-minute pilot training — facilitator guide

**Status: DRAFT — not clinically reviewed or delivered.**<br>
**Template audience:** one role at a time; first proposed session is reception / appointments. Adapt only after branch, module scope, release build, and ownership are approved. This is a learning plan, not a competency sign-off or authorization to use the system for patient care.

## Learning outcomes

By the end of the session, each learner can:

1. Identify which system owns the module for their branch from the approved notice.
2. Demonstrate the in-scope task in the approved training environment using synthetic data, then verify the result.
3. Explain what to do if the result is pending, the network is unavailable, or a conflict appears—without duplicate entry or an unsafe system switch.
4. Stop and escalate a patient-safety or data-integrity concern, and name who can authorize rollback.

## Facilitator preflight — complete before inviting staff

- [ ] Clinical owner approves this role's tasks, safety language, and the English and Bangla quick guides.
- [ ] Branch, module, exclusions, release/build, owner system, feature flag, and training window are recorded in the approved pilot notice.
- [ ] The environment is isolated from production; use synthetic patient and appointment records only. Confirm that no live notifications or live write paths are enabled.
- [ ] Each learner has an individual least-privilege training account. Never share credentials or use patient/staff accounts as demos.
- [ ] The actual build and role permissions have been smoke-tested. Do not teach a control or workflow that has not been verified in that build.
- [ ] The posted ownership notice, downtime procedure, support route, and rollback escalation are available in the training room.
- [ ] Have a projector or accessible display, printed draft/proof copies, and a private way to record attendance outside this repository.

If any item is missing, reschedule. Do not substitute the developer's local preview for the approved training environment.

## Run of show — exactly 30 minutes

| Time | Facilitator | Learner activity / evidence |
|---|---|---|
| 00–03 | Welcome; state the training-only scope, branch/module, build, and patient-safety rule. Ask participants' preferred language and accessibility needs. | Learners repeat which environment is being used and confirm it is not live patient care. |
| 03–07 | Show the approved branch/module ownership notice and explain `N`, `L`, `P`/blank. Explain personal accounts and why staff must never dual-write. | Each learner points to the current owner for the training module and says what to do if the notice is unclear. |
| 07–17 | Demonstrate one approved, role-specific flow on the verified build (proposed example: find a synthetic patient and book an appointment). Narrate identity check, branch, requested date/time, confirmation, and result verification. | Learners follow along on their own training accounts; no real patient data. Record observed blockers, not patient information. |
| 17–22 | Run a short hands-on practice with a second synthetic case. Include one deliberately ambiguous/pending result only if that state is supported by the training build. | Learner checks the existing record/status before any retry and avoids creating a duplicate. If the build cannot safely simulate this, discuss the approved response instead. |
| 22–26 | Walk through an offline/pending/conflict scenario and the site downtime/support route. Explain stop conditions and the rollback runbook; staff do not switch ownership. | Learner states who to contact and what non-identifying reference/time to record. |
| 26–29 | Teach-back: use the five questions below. Correct misunderstandings; do not coach through an unsafe answer. | Each learner answers verbally or by accessible alternative. Record completion and required follow-up securely. |
| 29–30 | Invite one concern, repeat support route, state next shift's support coverage. | Learners know where to get help; facilitator captures non-PHI feedback for triage. |

## Teach-back questions

1. Where do you check which system currently owns this module at this branch?
2. What do you do if the module is marked `P`, blank, or the success result is uncertain?
3. Why must you not enter the same booking in both systems or submit a second booking “just in case”?
4. What do you do first if the wrong patient or an unexplained data/sync problem appears?
5. Who may authorize rollback, and who applies the ownership change?

Any unsafe or incorrect answer is a **follow-up required**, not a pass. Arrange one-to-one practice before the learner is assigned the new workflow; do not lower the safety bar to finish the class on time.

## Record and refresh

Keep attendance, role, completion, and follow-up in the hospital-approved staff/training record system; do not commit names, signatures, phone numbers, patient data, or screenshots to Git. Track aggregate completion by role in the release record. Repeat the session for each distinct role/workflow, after a material workflow or ownership change, and for staff who miss the training.

**Training evidence:** session ID/date, branch, role, build SHA, facilitator role, learner count, language(s), completion/follow-up reference, and approved record location. All are currently **TBD**; no session has been delivered.
