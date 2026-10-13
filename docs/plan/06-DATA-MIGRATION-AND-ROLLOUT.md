# 06 — Data Migration & Rollout

The migration strategy is **per-module, reversible and reconcilable**. No module cuts over until its data
provably matches, and no module is ever irreversibly switched.

## 1. Principles

1. **The legacy database stays the source of truth until a module is proven.** New modules write to their own tables; reads during transition go through documented, dated views.
2. **Nothing is deleted.** Records are archived with a reason; the audit ledger records every state change.
3. **Every cutover is reversible** with a documented, rehearsed rollback (edge-route flip + data reconciliation).
4. **Reconciliation is automated and evidenced** — numbers, not opinions.
5. **Freeze windows are short and scheduled** (typically 60–90 minutes at night, announced a week ahead).

## 2. Data profiling (weeks 1–3, before any migration)

| Activity | Output |
|---|---|
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
tables (ICD-10, units, payment modes), and the validation query that proves it.

## 4. Migration mechanics

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
| Masters & reference (charges, catalogues) | Dual-write via API + nightly diff for 1 week, then switch reads | none | switch reads back |
| Patients & appointments | New module authoritative for new records; legacy rows imported read-through; nightly dedupe | none | route flip |
| Billing & payments | **Parallel run**: both systems compute for 2 weeks; differences investigated daily; only then new becomes authoritative | 60-min freeze at switch | route flip + ledger restore point |
| Lab / imaging results | New module for orders; results released from new; legacy stays visible read-only | none | route flip |
| Pharmacy stock | Stock snapshot migrated at a night freeze with a physical count the same evening | 90 min | revert to snapshot + legacy |
| IPD / ward | New module per ward; legacy stays for other wards; bed board reads both during transition | none | per-ward flip |
| Reports | Rebuilt on new data; run side-by-side with legacy numbers for a month | none | n/a (read-only) |

## 6. Cutover runbook (template, per module)

```
T-7 days  freeze agreed; communications sent; rollback rehearsed on staging
T-2 days  final dry run on a fresh production copy; reconciliation must be clean
T-1 day   backups verified (legacy DB + files); restore drill evidence attached
T-0 22:00 maintenance window opens; UI banner "planned maintenance"
T-0 22:05 legacy module set read-only (writes blocked at the DB user level)
T-0 22:10 delta migration (rows created since the last sync) + reconciliation
T-0 22:40 smoke tests: register → book → bill → print → result, on real data
T-0 23:00 maintenance window closes; edge router sends the module to the new app
T+1 day   on-floor hypercare; hourly reconciliation; defect triage twice daily
T+7 days  reconciliation clean 7 days running → declare the module migrated, legacy screen hidden
```

**Rollback trigger**: any data loss, ledger mismatch, clinical error, or > 15 minutes unplanned downtime.
Rollback = flip the route back, restore the legacy write path, and reconcile the few records written in the
new system into legacy (script pre-written during the dry run).

## 7. Backup, retention and disaster recovery

| Concern | Decision |
|---|---|
| Backup | Nightly full + continuous binlog shipping; encrypted; 3-2-1 (local, NAS, offsite); automated freshness alert |
| Restore drill | Quarterly, timed, evidence (screenshots + timings) committed to `docs/runbooks/` |
| Retention | Clinical records per local statute (configurable, default 7 years after last visit); billing 10 years; audit ledger 10 years; logs 90 days |
| GDPR/DPDP-style rights | Export and erasure workflow with legal review; erasure is anonymisation where retention law requires keeping the record |
| PII protection | Field-level encryption for national ID/insurance; access to patient records logged and reviewable |
| RTO / RPO | 1 hour / 15 minutes (validated by drill) |
| Decommission | Legacy app runs read-only 2 weeks after the final module, then is archived (image + DB dump) and kept for audit |

## 8. Announcement and training per wave

1. Two weeks before: department heads briefed, champions trained, cheat sheets printed in Bangla and English.
2. One week before: a sandbox with the department's own anonymised data for practice.
3. Cutover day: a coach on the floor for the whole shift, plus a phone line to engineering.
4. First week: daily 15-minute huddle; task-time board updated daily.
5. Two weeks after: satisfaction pulse survey; defects triaged into the next sprint.
