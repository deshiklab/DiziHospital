# Usability test #1 — the booking desk

**Study status: NOT RUN — this is a protocol and results template only. No participants, timings, deltas, or findings have been collected.**

**Role coverage:** the prepared task set below covers reception / appointment-desk work. P0-408 requires five participants for each role in the approved pilot scope; five receptionists alone do not cover any other role. Add and approve role-specific tasks before recruiting any additional role.

**Ticket:** P0-408 (`docs/plan/09-EXECUTION-BACKLOG-P0.md:101`) · **Acceptance evidence for:** P0-402
("Appointment screens: day calendar, queue board, online-request inbox — usability test with 5 receptionists completed")
**Designs under test:** `/appointments` (calendar, queue board, request inbox, full list, booking sheet) and
`/appointments/queue` (the queue) · **Target role for this task set:** receptionist · **Branch / build / observer / date:** TBD

---

## Status and run prerequisites

**No session has been run.** The pilot branch has not been selected, the approved role/module scope is not recorded, and
`docs/research/baseline-tasks.md` contains no measured legacy timings. There is no accepted comparison build or
approved, isolated test environment documented here. Do not run sessions or report task-time deltas until these gaps
are closed. A developer reviewing the screen is not a participant usability test.

This file is the **instrument**, not the result. It defines tasks, controlled starting states, success/error criteria,
consent and privacy requirements, measurement, and result tables. Blank cells are intentionally blank; do not estimate
or backfill results.

| Required before recruiting / testing | Current status |
|---|---|
| Pilot branch, approved module scope, and ownership for the test window | **TBD** — `docs/research/branches.md` and `docs/migration/ownership.md` are unfilled for an active pilot. |
| Five participants for every in-scope role; role-specific task list | **TBD** — current prepared tasks cover reception only. |
| Legacy baseline measured for each comparable task under matched conditions | **NOT MEASURED** — `docs/research/baseline-tasks.md` is blank. |
| Candidate build, branch/API source, role permissions, and source labels | **TBD** — verify and record build SHA before the session. |
| Isolated environment, synthetic fixtures, consent/privacy approval, and safe observer setup | **TBD** — production patient records and live appointment slots are out of scope. |
| Clinical owner approval of task outcomes, blocking criteria, and participant materials | **PENDING** |

**What is left for people, in one sentence:** whether a receptionist who has never seen this screen can book, reschedule
and answer a taken slot without being told what to do — and, when the slot is refused, can read the refusal and act on
it. That is exactly what a machine cannot check.

### What a machine has already checked (so the session does not have to spend people on it)

`npm run test:appointments` (`tools/test/appointments.mjs`) drives the **shipping** booking sheet and the API-facing
source under jsdom, and holds these lines:

| Proved by machine | Not proved by machine |
|---|---|
| the call is the contract's own operation, with the two filters the inbox and the board send | that anything is reachable in the pilot branch's network |
| a `409 dizi.slot-taken` arrives as a refusal carrying the service's sentence and its alternatives | that the sentence is understood by a person at 09:00 with a queue at the desk |
| choosing an offered time books *that* time, with the patient and doctor kept | that a person finds the offered times without help |
| the branch's zone, not the browser's, turns instants into minutes of a day (midnight included) | that the day is the day the desk expected |
| a closed day is drawn as the reason it is closed, not as twenty grey buttons | that a desk reads the reason rather than tapping a closed day again |
| the preview refuses a double booking exactly as the service does | that the preview banner is noticed at all (**this is what T8 measures**) |
| the moves the sheet offers are the contract's table — published as `x-dizi-scheduling.queueMoves`, enforced by the service and drawn by the screens — and a move the state does not allow is refused in the service's own sentence, in the preview as well as against the API | that a nurse reaches for the right move when the room is busy (T6) |
| the grid marks every minute of a sitting's claim as taken, not just the first | — |

The API's own behaviour is proved in CI (`services/api`, PHPUnit: 26 appointment cases) — **PHPUnit cannot run in this
repository's development environment**, so that suite has only ever run on the runner. No patient has been booked
outside SQLite, and the appointment screens have never spoken to a running `services/api` process; the seam has been
exercised against the harness's own stub and against the preview source.

---

## 1. Participants and role coverage

Recruit **five distinct users for every staff role that performs an in-scope pilot task**, as confirmed by the clinical
owner and the branch/module ownership notice. The current tasks below cover receptionist workflows only. Do not infer
that a receptionist sample represents nurses, clinicians, or any other role. If another role is in scope, add its task
script, starting state, expected outcome, safety stop, and baseline mapping before testing.

| In-scope role | Role-specific task set | Required | Recruited | Completed |
|---|---|---:|---:|---:|
| Receptionist | T1–T8 (prepared here; confirm scope) | 5 | 0 | 0 |
| Add each other approved role | Add role-specific tasks before recruiting | 5 per role | 0 | 0 |

Duplicate this participant profile once per participant, using a study code such as `REC-01`; do not write names, initials,
contact details, MRNs, or consent-form identifiers into this file. Keep any code-to-identity key and consent records in
the hospital-approved restricted location.

| Participant code | Role | Shift | Years in role (band) | Used a hospital system before? | Consent recorded securely? |
|---|---|---|---|---|---|
| REC-01 | Receptionist | | | yes / no | yes / no |
| REC-02 | Receptionist | | | yes / no | yes / no |
| REC-03 | Receptionist | | | yes / no | yes / no |
| REC-04 | Receptionist | | | yes / no | yes / no |
| REC-05 | Receptionist | | | yes / no | yes / no |

* Include a mix of shifts and experience; where feasible, include someone new to hospital software and someone from a
  relief/night shift. Do not let one experienced champion stand in for the target users.
* Participation is voluntary. Do not recruit in front of a line manager or imply that a task result affects employment.
  Use the hospital-approved consent process; explain what will be observed, how notes are protected, how long they are
  kept, and that participants may stop at any time.
* **No patient-identifiable data.** Use an isolated approved test environment with synthetic patient and appointment
  records only. Do not use a live patient MRN block, real phone number, production slot, or real patient transaction.
  Do not store audio/video/screenshots unless separately approved and consented; redact all evidence before it leaves the
  restricted study location.

## 2. Conditions of the run

The comparison against `baseline-tasks.md` is meaningful only when the task, role, system state, and observation
conditions match. Confirm and record these before testing; do not run against production or active patient work.

| Condition | Value for this run |
|---|---|
| Branch and desk | approved pilot branch and designated test desk — **TBD** |
| Environment and data | isolated approved staging / test tenant; synthetic records only; no production writes, live slot conflicts, or direct database seeding |
| Time of day | not 08:00 opening, not the 11:00 rush — the baseline's own rule |
| Repetitions | ≥ 3 per task, per participant; the **median** is the number recorded |
| Stopwatch | one observer, stopwatch, timing from the participant's first movement to the task being *finished* (not "looks finished") |
| Machine and printer | the pilot desk's own machine, the desk's own receipt/day-list printer |
| Screens shown first | the tested candidate build with source/environment label visible; no developer console, no hidden banner, and no coaching |
| What is withheld | nobody explains a step, points at a button, or answers "what now?". Help is only given if the participant is stuck for 60 seconds, is asked for it, or the task has become impossible — and every use of help is counted in §7 |

## 3. Task set — the booking desk

Each task states the **starting state** (what the machine shows before the participant begins), what **success** is, and
the **baseline row** it is compared against, where one exists. Tasks 1–3 are the three reception rows the legacy baseline
already names; tasks 4–8 are what P0-402 added to the desk.

### T1 — Book a walk-in appointment (baseline task 3)

* **Starting state:** a synthetic test participant is at the counter with a card bearing a synthetic identifier. The desk is on today's calendar.
* **Task, as said to the participant:** "This patient is here now and was told to see a doctor today. Book them in."
* **Success:** an appointment exists on today's diary, for a doctor the patient is willing to see, at a time the desk
  considers reasonable — and the token the sheet shows is the token the desk would write on the patient's slip.
* **Defect if:** the participant cannot tell which doctor they booked, or the time they booked; or the booking sheet
  offers a time the service then refuses (a screen-side guess at availability).
* **Baseline:** `baseline-tasks.md` row 3 — legacy steps, legacy median, target ≤ −30 %.

### T2 — Book an appointment by phone (baseline task 4)

* **Starting state:** the desk is on the calendar; the caller is not present.
* **Task:** "A patient is on the phone. Find them by the number they are calling from, and book them for tomorrow
  morning."
* **Success:** the appointment is on tomorrow's diary with the *patient's* record attached, not a new record created for
  the phone call.
* **Defect if:** a duplicate patient is created, or the participant cannot tell which patient they attached.
* **Baseline:** row 4.

### T3 — Reschedule an appointment (baseline task 5)

* **Starting state:** an appointment exists today (the observer's own fixture booking).
* **Task:** "This patient cannot come today after all. Move them to the same time on Friday."
* **Success:** the old time is free again, the new time is taken by the same patient, and the diary says who moved it.
* **Defect if:** the participant cannot find a way to move rather than cancel-and-rebook; or the old slot stays taken.
* **Baseline:** row 5.

### T4 — Answer a slot that was taken first

* **Starting state:** the scripted conflict of §4 — the participant's chosen slot has just been booked by the other desk,
  and the sheet has just refused.
* **Task:** nothing is said. The participant is asked only to "finish the booking".
* **Success:** the appointment ends up at one of the times the refusal offered, without re-entering the patient, the
  doctor or the reason.
* **Defect if:** the participant re-enters the form from scratch (the offered times were not seen as buttons); or books
  a time the sheet never offered; or believes the booking went through when it was refused (**the most dangerous outcome
  of this whole test** — counted as *blocking*, see §8).
* **Machine evidence:** `npm run test:appointments` holds this path end to end; what it cannot hold is whether a person
  *notices* the refusal.

### T5 — Read the diary before answering the patient

* **Starting state:** the synthetic calendar for today, with a pre-agreed queue fixture for Clinician A.
* **Task:** "The next patient asks how many people are still to be seen by Clinician A this morning and what the displayed
  wait estimate is."
* **Success:** the participant gives the fixture's correct count and reads the displayed wait estimate accurately.
* **Defect if:** the participant cannot locate the information, the count/status disagrees with the fixture, or the wait
  estimate is presented without enough context to explain it. Record time and errors; do not impose a speed threshold for
  this task until the clinical owner approves one.

### T6 — Move a patient through the queue board

* **Starting state:** three patients have arrived; the board shows them checked in.
* **Task:** "Two of these patients are waiting. The doctor has called the second one in. The first one left without being
  seen."
* **Success:** the called patient reads *In consultation*; the one who left reads *No show* with a reason recorded; the
  board's own rules refuse a move that never happened (a patient cannot be *Completed* without having been *In
  consultation*, and a *Requested* patient cannot be *Waiting*).
* **Defect if:** the participant cannot find the move; or the screen lets them set a state the patient never reached
  without the service refusing it (**blocking** — it means a state can be written onto a patient who never arrived).
* **Machine evidence:** the transition table lives in `Diary::patch()` and its cases are in CI; this task is about the
  screen offering only what the table allows.

### T7 — Answer the online-request inbox

* **Starting state:** the inbox tab, with the requests the portal took (if the cloud side is serving
  `POST /portal/appointments` — see §5, *"why the inbox may be empty"*).
* **Task:** "These are bookings patients made themselves. Confirm the first one; decline the second, with the reason."
* **Success:** the confirmed request reads *Confirmed* and appears on the day's calendar; the declined one reads
  *Cancelled* or *No show* with a reason that would be defensible to the patient's face.
* **Defect if:** the inbox and the calendar disagree; or the reason recorded is a code rather than a sentence.

### T8 — Notice which diary this is

* **Starting state:** an approved, isolated test build with a clearly labelled synthetic-data source. If comparing two
  source labels, use two isolated test configurations prepared in advance; never pull a production uplink, stop a live
  service, or expose real patient records.
* **Task:** "Before you start: tell me what this screen is showing and whether it is approved for real patient work."
* **Success:** the participant correctly identifies the environment/source label and says whether it is test-only or
  approved for the stated pilot scope.
* **Defect if:** the participant cannot distinguish sample data from an approved patient-care source (blocking). If the
  build has no verifiable source/environment label, mark this task blocked before recruiting; do not simulate by
  disrupting a live system.

## 4. The scripted conflict, exactly

Two test desks, one synthetic slot. Run this only in the approved isolated test environment; never reserve or
conflict a real patient's appointment. The observer prepares it before the participant sits down:

1. Desk A (the participant) opens the booking sheet for synthetic Clinician A, tomorrow 09:00, and fills in a synthetic
   patient, appointment type, and reason — but does **not** confirm.
2. Desk B (the observer, in another browser session or another machine) books the same synthetic clinician at 09:00
   with a different synthetic patient and confirms.
3. Desk A confirms. The service refuses (409 `dizi.slot-taken`); the sheet shows the sentence and the offered times.

What the observer watches for, in order: does the participant read the refusal at all; do they see the offered times as
things they can take; do they re-enter anything; do they say the booking went through; do they write the *new* time on
the patient's slip.

**One rehearsal is allowed for the participant before this task** — a booking the observer makes sure succeeds — because
the task is about the refusal, not about first-time nerves. Rehearsals are noted in §7 and their timing is discarded.

## 5. Why the inbox may be empty (and what to say if it is)

The request inbox is a query — `GET /appointments?status=Requested&source=Online portal` — against the branch's own
service. The operation the *portal* writes with, `POST /portal/appointments`, is a cloud-side operation and is **not
served by the branch node in this build**. So in the pilot branch the inbox stays empty until the portal side takes
bookings, and an empty inbox is the honest state, not a defect.

If it is empty, run T7 only if the approved isolated test environment has a supported fixture/seed path that creates
synthetic requests through an approved test mechanism. **Do not insert directly into the database or use a production
portal/live request.** If no safe seed path exists, mark T7 not evaluable and record the blocker; do not improvise.

## 6. Comprehension questions (asked once, after T8, in Bangla first)

Read aloud from the screen, in this order, and record the answer verbatim. The portal is Bangla-first and plain-language
(grade 8) by standing decision, and the same rule applies to any sentence the *desk* has to act on.

| # | What is read to the participant | Answer (verbatim) | Understood? |
|---|---|---|---|
| 1 | the sentence at the top of the desk that says which source is live | | |
| 2 | the refusal sentence from T4 | | |
| 3 | "What happens next — tell me in your own words, as if I were the patient." (after T4) | | |
| 4 | The patient's slip: what will you write on it, and what does the patient do with it? | | |
| 5 | if the screen shows a stub (sign-in preview, telemedicine media, the payment gateway): what do you expect to happen when you press it? | | |

Any sentence that a participant cannot paraphrase is a **copy defect** and is ticketed against the screen, whatever the
timings say.

## 7. Timing and errors

Time from the participant's first action after the prompt until the expected outcome is verified in the approved
test environment. Use three timed attempts per task per participant when safe and appropriate; exclude the practice
rehearsal and keep any failed/abandoned attempt visible. First calculate each participant's median; then report the
role/task median across participants. Use the measured legacy median for the matching baseline row only.

**Delta formula:** `((new role median − legacy median) / legacy median) × 100`. Negative is faster; the plan's target is
`≤ −30%` (new median no more than 70% of legacy). If the baseline is blank, the task/role does not match, or the
conditions differ, report **N/A — no valid comparison**; do not substitute zero or estimate a legacy value. Timing never
overrides a blocking safety error. With five participants per role, report descriptive medians, counts, errors, and
help rates only; do not claim statistical significance or generalize beyond the tested branch and roles.

| Task | Role | Participant code | Attempt 1 | Attempt 2 | Attempt 3 | Participant median | Legacy median | Δ % | Errors / help / outcome |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Receptionist | REC-01 | | | | | | | |
| T2 | Receptionist | REC-01 | | | | | | | |
| T3 | Receptionist | REC-01 | | | | | | | |
| T4 | Receptionist | REC-01 | | | | | (no baseline) | N/A | |
| T5 | Receptionist | REC-01 | | | | | (no baseline) | N/A | |
| T6 | Receptionist | REC-01 | | | | | (no baseline) | N/A | |
| T7 | Receptionist | REC-01 | | | | | (no baseline) | N/A | |
| T8 | Receptionist | REC-01 | | | | | (no baseline) | N/A | |

Duplicate these rows for every participant and every approved in-scope role. Keep participant-level notes in the
restricted study record; this repository contains only de-identified codes and aggregate results.

| Role | Task | N attempted / successful | Role median (s) | Legacy median (s) | Δ % | Help / errors | Blocking finding? |
|---|---|---|---|---|---|---|---|
| Receptionist | T1 | | | | | | |
| Receptionist | T2 | | | | | | |
| Receptionist | T3 | | | | | | |
| Add each other in-scope role | Add mapped tasks | | | | | | |

Task-level notes (what was slow, what was read aloud, what was missed):

| Task | Observation | De-identified quote (no names or patient/staff details) |
|---|---|---|
| | | |

## 8. What stops the pilot, and what is just a defect

The pilot's bar is not "everyone liked it". These outcomes **stop and go back to the design**, and are reported to
P0-409 as blocking whatever else is going well:

1. **A refusal read as a success.** Any participant who believes a booking went through when the service refused it.
   (This is the failure the conflict prompt exists to prevent; one occurrence is enough.)
2. **A state written onto a patient who never reached it.** A move the screen offers and the service then refuses, in a
   way that leaves the board showing a lie.
3. **A source that cannot be told apart.** A participant who books a real patient into sample data, or who does not know
   which diary they are reading.
4. **A duplicate patient created by a task that was about booking** (T2), because that is the defect that outlives the
   pilot.
5. **A task that gets slower than the legacy baseline it must beat** — the plan's own rule (≤ legacy − 30 %) — unless
   the flow is deliberately different, in which case the difference is written down here with the reason.

Everything else — a word that reads badly, a control that is hard to find, a wait that is one second too long — is a
defect with a ticket, ranked by how many participants hit it.

## 9. Outcome

| Field | Value |
|---|---|
| Approved pilot roles in scope | |
| Roles with five completed participants | __ of __ |
| Receptionist participants completed | __ of 5 |
| Total sessions / task attempts | |
| Task success and help rates by role | |
| Blocking findings | |
| Defects filed (ticket IDs; no PHI) | |
| Valid baseline comparisons meeting ≤ −30 % | __ of __ mapped tasks |
| Tasks without a valid baseline | |
| P0-402 acceptance (5 receptionists completed) | **not met** / met on ______ |
| P0-408 acceptance (5 users per in-scope role; deltas reported) | **not met** / met on ______ |
| Clinical lead review (name/reference kept in approved record) | **PENDING** |
| Outcome feeds | P0-409 go/no-go |

**Current outcome: NOT RUN.** No user session, task-time delta, blocking finding, or clinical review is claimed. An empty
table is not acceptance evidence. P0-408 remains open until the approved role sample is complete and actual, valid
task-time deltas and findings are recorded. P0-402's mechanical CI coverage does not substitute for the human study.
