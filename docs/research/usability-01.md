# Usability test #1 — the booking desk

**Ticket:** P0-408 (`docs/plan/09-EXECUTION-BACKLOG-P0.md:101`) · **Acceptance evidence for:** P0-402
("Appointment screens: day calendar, queue board, online-request inbox — usability test with 5 receptionists completed")
**Designs under test:** `/appointments` (calendar, queue board, request inbox, full list, booking sheet) and
`/appointments/queue` (the live queue) · **Branch:** ______ · **Observer:** _name_ · **Date/shift:** ______

---

## Status: not run

**No session has been run.** There is no pilot branch, no reception desk and no receptionists in this repository's
development environment, and `docs/research/baseline-tasks.md` is still an empty table — the legacy medians the test is
supposed to beat do not exist yet either. A "usability test" carried out now would be one developer reading his own
screen, and its numbers would be worse than useless: they would be entered in a table and compared *against nothing*.

So this file is the **instrument**, not the result. Everything below is what the pilot branch needs in order to run the
test in one shift: the task set, the machine starting state for each task, what counts as success, what counts as a
defect, the scripted conflict, the comprehension questions, and the tables the observer fills in. The empty cells mean
empty, and they stay empty until a session happens.

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
| the grid marks every minute of a sitting's claim as taken, not just the first | — |

The API's own behaviour is proved in CI (`services/api`, PHPUnit: 26 appointment cases) — **PHPUnit cannot run in this
repository's development environment**, so that suite has only ever run on the runner. No patient has been booked
outside SQLite, and the appointment screens have never spoken to a running `services/api` process; the seam has been
exercised against the harness's own stub and against the preview source.

---

## 1. Participants

Five receptionists (P0-408's "5 users per role"), chosen so that the sample is not five copies of one desk:

| # | Name (or initials, consented) | Shift | Years in the role | Used a hospital system before? | Consented |
|---|---|---|---|---|---|
| 1 | | morning | | yes / no | |
| 2 | | morning | | | |
| 3 | | afternoon | | | |
| 4 | | night / relief | | | |
| 5 | | | | | |

* At least one participant must **never** have used any hospital software — the design claims a new clerk can use the
  desk without training, and that claim is what this person is here to test.
* At least one must be from the relief or night shift: they cover the desk with less context, and they are the ones the
  help screens are written for.
* Nobody is asked to take part by their line manager in the room. Consent is a sentence, not a form: what is recorded,
  what is deleted, and the fact that stopping mid-task is allowed and costs nothing.
* **No patient-identifiable data.** The tasks run against the pilot branch's own test MRN block or against the preview's
  synthetic register. Nothing a participant types into a real record is copied into this file.

## 2. Conditions of the run

The comparison against `baseline-tasks.md` is only meaningful if the conditions match:

| Condition | Value for this run |
|---|---|
| Branch and desk | the pilot branch's reception counter 1 (the one the baseline was taken at) |
| Time of day | not 08:00 opening, not the 11:00 rush — the baseline's own rule |
| Repetitions | ≥ 3 per task, per participant; the **median** is the number recorded |
| Stopwatch | one observer, stopwatch, timing from the participant's first movement to the task being *finished* (not "looks finished") |
| Machine and printer | the pilot desk's own machine, the desk's own receipt/day-list printer |
| Screens shown first | the desk as it ships: no developer console, no dev server, no hidden banner. The screen says which source it is reading, and that sentence is part of the interface being tested |
| What is withheld | nobody explains a step, points at a button, or answers "what now?". Help is only given if the participant is stuck for 60 seconds, is asked for it, or the task has become impossible — and every use of help is counted in §7 |

## 3. Task set — the booking desk

Each task states the **starting state** (what the machine shows before the participant begins), what **success** is, and
the **baseline row** it is compared against, where one exists. Tasks 1–3 are the three reception rows the legacy baseline
already names; tasks 4–8 are what P0-402 added to the desk.

### T1 — Book a walk-in appointment (baseline task 3)

* **Starting state:** a patient is at the counter with a card (test MRN). The desk is on today's calendar.
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

* **Starting state:** the calendar for today, all doctors.
* **Task:** "The next patient asks: how many people are still to be seen by Dr Rahman this morning, and how long is the
  wait?"
* **Success:** the participant reads the count off the board/list without counting with a finger on paper, and answers in
  under 20 seconds.
* **Defect if:** the answer requires scrolling through a list to count, or the count they give is wrong by more than one.

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

* **Starting state:** the desk as it is actually deployed in the session: **either** the live source (the branch's own
  server answering) **or** the preview, decided by the observer pulling the uplink or by the tester stopping the service.
* **Task:** "Before you start: tell me what this screen is showing, and whether you should trust it with a real
  patient."
* **Success:** the participant reads the source sentence at the top of the screen and answers from it.
* **Defect if:** the participant cannot say whether it is the branch's diary or sample data (**blocking** — a desk that
  cannot tell a fixture from a patient's appointment is the exact failure this banner exists to prevent).

## 4. The scripted conflict, exactly

Two desks, one slot. The observer prepares it before the participant sits down:

1. Desk A (the participant) opens the booking sheet for Dr Rahman, tomorrow 09:00, and fills in the patient, the type
   and the reason — but does **not** confirm.
2. Desk B (the observer, in another browser session or another machine) books that same doctor at 09:00 with a different
   patient and confirms.
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

If it is empty on the day of the session, T7 is run against requests seeded into the branch's own service by the
observer (a direct insert), and the observer says so out loud before the task — the participant is testing the *answer*
flow, not the portal.

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

One row per participant per task. `Δ` is against the baseline median where a baseline exists; where none exists, the
number is recorded bare and this file says so.

| Task | Participant | Attempt 1 | Attempt 2 | Attempt 3 | Median | Baseline median | Δ % | Errors | Help used (what was asked) |
|---|---|---|---|---|---|---|---|---|---|
| T1 | | | | | | | | | |
| T2 | | | | | | | | | |
| T3 | | | | | | | | | |
| T4 | | | | | | (no baseline) | — | | |
| T5 | | | | | | (no baseline) | — | | |
| T6 | | | | | | (no baseline) | — | | |
| T7 | | | | | | (no baseline) | — | | |
| T8 | | | | | | (no baseline) | — | | |

Task-level notes (what was slow, what was read aloud, what was missed):

| Task | Observation | Quote worth keeping (no names) |
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
| Sessions run | __ of 5 |
| Tasks met (median) | __ of 8 |
| Blocking findings | |
| Defects filed (ticket ids) | |
| Baseline tasks 3/4/5 beaten by ≥ 30 % | yes / no |
| P0-402 acceptance ("5 receptionists completed") | **not met** / met on ______ |
| Read by (clinical lead) | |
| Outcome feeds | P0-409 go/no-go |

**Until the row above says met, P0-402 is implemented and mechanically tested, not accepted.** The screens ship with
that stated on them and in `apps/web/README.md`.
