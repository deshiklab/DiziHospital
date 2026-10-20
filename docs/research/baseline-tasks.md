# Baseline task timings (P0-102)

The legacy numbers the new UI must beat. Plan `04` §1 requires **≤ legacy − 30 %** for the pilot tasks before a
module is declared migrated, so these rows are the acceptance evidence, not a nice-to-have.

**Measured by:** _name_ · **Branch:** ______ · **Method:** stopwatch over ≥ 3 repetitions per task, same user,
normal load (not during the 11:00 rush and not at 08:00 opening).

| # | Task | Role | Legacy steps | Legacy median | Target (≤ −30 %) | Measured on | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Register a new patient (no prior record) | Reception | | | | | |
| 2 | Register a patient who already exists (find, don't duplicate) | Reception | | | | | |
| 3 | Book an OPD appointment (walk-in) | Reception | | | | | |
| 4 | Book an appointment by phone (find patient, choose slot) | Reception | | | | | |
| 5 | Reschedule an appointment | Reception | | | | | |
| 6 | Find a patient by phone number only | Any | | | | | |
| 7 | Start an OPD consultation and record vitals | Doctor / Nurse | | | | | |
| 8 | Write and sign a prescription (3 drugs, 1 new) | Doctor | | | | | |
| 9 | Order a lab panel (fever profile) | Doctor | | | | | |
| 10 | View a patient's last 3 results | Doctor | | | | | |
| 11 | Admit a patient from OPD to a ward + assign bed | Doctor / Ward | | | | | |
| 12 | Record a nursing note | Nurse | | | | | |
| 13 | Administer medication (MAR) on the ward | Nurse | | | | | |
| 14 | Dispense a prescription (3 items, 1 out of stock) | Pharmacist | | | | | |
| 15 | Receive a purchase and update stock | Pharmacist | | | | | |
| 16 | Run a physical stock count for 20 items | Pharmacist | | | | | |
| 17 | Register a lab specimen and print its label | Lab tech | | | | | |
| 18 | Enter a lab result and release it | Lab tech | | | | | |
| 19 | Raise an invoice for an OPD visit with a procedure | Billing | | | | | |
| 20 | Take a part payment and print a receipt | Billing | | | | | |
| 21 | Refund / cancel an invoice line | Billing | | | | | |
| 22 | Prepare a TPA/insurance claim | Billing | | | | | |
| 23 | Discharge a patient and close the bill | Ward / Billing | | | | | |
| 24 | Print today's collection summary | Billing / Finance | | | | | |
| 25 | Find why a number on the dashboard is wrong | Admin | | | | | |

## Notes to keep with the numbers

| Question | Answer |
|---|---|
| What makes a task slower at peak? | |
| Which tasks are done by more than one person (handoff cost)? | |
| Which tasks are done on paper first, then typed later? | |
| Which tasks fail often enough that staff expect them to fail? | |

## How these numbers are used

1. They are the baseline in the pilot exit criteria for P1–P5.
2. They are re-measured **in the same conditions** in the new UI, with the same users where possible.
3. A task that is slower after migration is a defect, not a training problem — unless the new flow is
   deliberately different, in which case the difference is written down here with a reason.
