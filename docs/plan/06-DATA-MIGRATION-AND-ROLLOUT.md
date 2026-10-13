# 06 — Data Migration & Rollout

The migration strategy is **per-module, reversible and reconcilable**. No module cuts over until its data
provably matches, and no module is ever irreversibly switched.

## 1. Principles

1. **There is no shared database.** We hold no vendor source (D1), so the legacy schema is not ours to write
   into or to read at request time. Legacy data reaches the new platform through the **one-way bridge** described
   in `08` — extract, validate, transform, apply — and lives in our own PostgreSQL 18 schema.
2. **One writer per entity.** A record type is writable by exactly one system at a time, recorded in
   `docs/migration/ownership.md`. This replaces the shared-table safety of a code-level strangler and is the
   single most important rule in this document.
3. **Nothing is deleted.** Records are archived with a reason; the audit ledger records every state change, and
   deletions detected at source become a human-confirmed report, never a silent drop.
4. **Every cutover is reversible** with a documented, rehearsed rollback: ownership reverts to `legacy`, the
   module is hidden or read-only in the new UI, and any records created in the new system during the window are
   reconciled back through a pre-written path (`08` §4).
5. **Reconciliation is automated and evidenced** — numbers, not opinions — across two live systems, nightly.
6. **Freeze windows are short and scheduled** (typically 60–90 minutes at night, announced a week ahead) and are
   enforced **operationally**, because we cannot set a vendor-hosted module read-only at the database level:
   staff instructions, a supervisor at the desk, and a post-window delta sweep that catches stragglers.
7. **The first question is always access.** What the vendor will actually give us (replica, exports, API, or
   nothing) determines the extraction method, so the data-access addendum is a Phase 0 exit criterion.

## 2. Data profiling (weeks 1–3, before any migration)

| Activity | Output |
|---|---|
| **Access level confirmed in writing** (O1): replica, exports, API or none — with cadence, scope and change notice | signed data-access addendum (`08` §2) |
| Row counts, growth rates and per-table quality profile for the whole schema | `docs/migration/01-profile.md` |
| Duplicate patient analysis (same name + phone + DOB, blank MRNs, merged records) | duplicate list + merge plan |
| Referential integrity audit (orphan visits, bills without cases, results without orders) | fix plan for the hospital to run in legacy |
| Free-text field audit (`known_allergies`, symptoms, notes) → structuring plan | mapping of free text to coded values |
| Identifier audit — MRN numbering, invoice numbers, sample IDs, receipt numbers | rule book for continuity (numbers must never be reused) |
| PII inventory (national ID, insurance, contact details) → encryption scope | data-flow diagram approved by privacy owner |
| Volume test — restore a production copy and run the new queries against it | performance baseline and index list |

## 3. Entity-by-entity mapping

`docs/migration/02-mapping/<entity>.md` for each of: patients, guardians/contacts, insurers/TPAs, referrals,
appointments, visits (OPD), admissions (IPD), beds/wards, encounters/notes, prescriptions, medicines,
stock/batches, lab tests/parameters/results, imaging studies, blood bank units/donors, ambulance calls,
charge master, invoices/receipts/payments, expenses, staff/roles/attendance, branches, documents/files.

Every mapping documents: source table → target table, field-by-field transform, defaulting rules, coding
tables (ICD-10, units, payment modes), and the validation query that proves it. Mappings are written from the
capture and the vendor's published documentation — never from vendor source code (clean-room rule, `05` §11).

## 4. Migration mechanics

* **Extraction depends on the access level** (`08` §2): a read-only replica or dump (preferred), scheduled
  exports (default), a vendor API (if offered), or UI-driven extraction for backfill only. The extract layer is
  written against an interface so a better access level can be plugged in without touching the mappings.
* **Provenance columns** on every mirrored record: `legacy_id`, `legacy_table`, `legacy_hash`, `extracted_at`,
  `extract_run_id` — every number we report must be traceable to a source row.
* **Tooling**: SQL scripts for sets, a small idempotent ETL app (in `apps/worker` style) for volumes, checksum
  verification for files. All scripts versioned in `tools/migration/` and runnable repeatedly (upsert by natural key).
* **Order**: reference data (charge master, catalogues, roles, branches) → patients → clinical → money → documents.
* **File migration**: `uploads/` → object storage with checksum comparison and a manifest; legacy paths remain resolvable until the module retires.
* **Reconciliation report** (generated per run, stored in the repo):
  * row counts per entity vs legacy
  * control totals (sum of invoice amounts, payments, stock quantity, visit counts by month)
  * per-status breakdowns and monthly distributions (catches shifted dates/statuses)
  * 100-record field-by-field sample diff, plus a full diff on high-risk fields (allergies, amounts, dosage)
* **Sign-off**: the module's clinical/finance owner signs the reconciliation report before a cutover is scheduled.

## 5. Cutover patterns per module

| Module type | Pattern | Downtime | Rollback |
|---|---|---|---|
| Masters & reference (charges, catalogues) | Import once, then **cloud/edge-authoritative**; the legacy master becomes read-only data | none | re-enable legacy editing temporarily |
| Patients & appointments | New module authoritative for new records; legacy rows are mirrored read-only from day one so search works across both; nightly dedupe report | none | ownership row reverts to `legacy` for new bookings; existing new records stay visible as a read-only projection in the legacy system |
| Billing & payments | **Parallel run**: both systems compute for 2 weeks, differences investigated daily; then the new system issues documents | 60-min operational freeze at switch | ownership revert + any receipts issued in the window are reconciled through the pre-written rung-2/3 path (`08` §4) |
| Lab / imaging results | New module takes orders and releases results; legacy stays visible read-only; a bridge flow keeps legacy billing informed while it is still legacy-owned | none | ownership revert; released results remain visible in the new UI read-only |
| Pharmacy stock | Stock snapshot migrated at a night freeze **with a physical count the same evening**; per-location ledgers from then on | 90 min | revert to the snapshot; movements since are replayed from the ledger |
| IPD / ward | New module per ward; legacy stays for other wards; the bed board reads both during transition | none | per-ward ownership revert |
| Reports | Rebuilt on new data; run side-by-side with legacy numbers for a month | none | n/a (read-only) |

**Read path for the other system.** While a module's ownership is transitioning, the system that does *not* own
it shows a read-only projection fed by the bridge — so a clerk can always find the patient, the visit or the
invoice, even when the record was created in the other system. Write actions on that projection are disabled and
labelled with where to go instead.

## 6. Cutover runbook (template, per module)

```
T-7 days  freeze agreed; communications sent; rollback rehearsed on staging
T-2 days  final dry run on a fresh production copy; reconciliation must be clean
T-1 day   backups verified (legacy DB + files); restore drill evidence attached
T-0 22:00 maintenance window opens; UI banner "planned maintenance"; supervisors at the desks
T-0 22:05 legacy module instruction broadcast: stop creating records in this module (we cannot lock a
          vendor-hosted module at the database level - the freeze is operational and supervised)
T-0 22:05 final delta extraction runs; extraction completeness proven by row counts + checksums
T-0 22:30 delta apply + reconciliation; any record created after the freeze is captured by a second sweep
T-0 22:45 smoke tests on real data: register → book → bill → print → result → look up a legacy record
T-0 23:00 window closes; ownership registry row flips to `new`; legacy module becomes read-only for staff
T+1 day   on-floor hypercare; hourly reconciliation; defect triage twice daily
T+7 days  reconciliation clean 7 days running → declare the module migrated; legacy module hidden
```

**Rollback trigger**: any data loss, ledger mismatch, clinical error, unexplainable sync conflict, or
> 15 minutes unplanned downtime. Rollback = revert the ownership row, re-enable the legacy write path, hide or
make read-only the new module, and reconcile any records created in the new system during the window through the
pre-written bridge path. The rollback is rehearsed on staging during the T-2 dry run, including the reconciliation
of those records.

## 7. Backup, retention and disaster recovery

| Concern | Decision |
|---|---|
| Backup | Edge: nightly full + continuous WAL shipping to local storage and to the cloud; encrypted at rest and in transit; 3-2-1 (local, hospital NAS, cloud off-site); automated freshness and restore-verification alerts |
| Restore drill | Quarterly, timed, evidence (screenshots + timings) committed to `docs/runbooks/`; includes promoting the cloud replica and switching a site to `cloud-direct` |
| Retention | Clinical records per local statute (configurable, default 7 years after last visit); billing 10 years; audit ledger 10 years; logs 90 days |
| GDPR/DPDP-style rights | Export and erasure workflow with legal review; erasure is anonymisation where retention law requires keeping the record |
| PII protection | Field-level encryption for national ID/insurance; access to patient records logged and reviewable |
| RTO / RPO | 1 hour / 15 minutes (validated by drill) |
| Decommission & archive | Legacy instance frozen read-only for 2 weeks after the final module, then archived for the retention period agreed with legal; our own complete export (CSV + Parquet + PDFs + file checksums) is taken **before** any licence ends, and an annual archive read drill proves it (`08` §7) |

## 8. Announcement and training per wave

1. Two weeks before: department heads briefed, champions trained, cheat sheets printed in Bangla and English.
2. One week before: a sandbox with the department's own anonymised data for practice.
3. Cutover day: a coach on the floor for the whole shift, plus a phone line to engineering.
4. First week: daily 15-minute huddle; task-time board updated daily.
5. Two weeks after: satisfaction pulse survey; defects triaged into the next sprint.
