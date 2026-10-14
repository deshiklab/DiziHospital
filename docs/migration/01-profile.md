# Data profile — legacy source (P0-106)

First cut of the profiling described in `docs/plan/06` §2. **Nothing is migrated before this file is complete**,
because the profile tells us what the data actually is rather than what the schema claims.

* **Access level in use:** ☐ A1 dump/replica · ☐ A2 scheduled exports · ☐ A3 vendor API · ☐ A4 UI/report extraction
* **Profile run:** _YYYY-MM-DD_ · **Source snapshot:** _dump file / timestamp_ · **Run by:** ______
* **Branches covered:** ______

## 1. Size and growth

| Table | Rows | Size (MB) | Growth / month | Oldest record | Branch-specific? | Notes |
|---|---|---|---|---|---|---|
| patients | | | | | | |
| visits / encounters | | | | | | |
| admissions | | | | | | |
| invoices / payments | | | | | | |
| prescriptions / dispense | | | | | | |
| lab orders / results | | | | | | |
| stock / batches | | | | | | |
| audit / logs | | | | | | |

## 2. Identity and continuity (the part that must be right)

| Check | Result | Consequence |
|---|---|---|
| MRN format(s) in use, and whether they are unique | | Numbering rule for new registrations |
| Highest MRN per branch | | Where the reserved block starts |
| Invoice / receipt number formats and gaps | | Numbering must never repeat; gaps documented |
| Sample / accession number formats | | Same rule as invoices |
| Patients registered at more than one branch (count) | | Cross-branch duplicate queue |
| Records with no MRN / blank identifiers | | Remediation before P1 migration |

## 3. Quality findings

| Finding | Count | Example (redacted) | Decision |
|---|---|---|---|
| Duplicate patients (name+phone+DOB) | | | merge queue, reviewed by front office |
| Orphan records (visit without patient, bill without case, result without order) | | | hospital fixes in legacy, or we define a rule |
| Dates in the future / before 1990 | | | rule or manual correction |
| Money totals that disagree with the printed reports | | | reconciliation owner nominated |
| Free-text used where a code was expected (allergies, diagnoses, units) | | | structuring plan for `03-mapping/` |
| Encoding problems (mojibake) in clinical text | | | decode rule + what stays as-is |
| Deleted-looking records (soft delete flags, `is_deleted`, missing rows) | | | confirm behaviour with the vendor |

## 4. PII and access

| Item | Where | Encrypt at rest? | Who may see it | Notes |
|---|---|---|---|---|
| National ID | | yes (field-level) | | |
| Insurance / TPA data | | yes | | |
| Contact details | | | | |
| Documents / scans | | | | |

## 5. Volume and performance test

| Test | Target | Result |
|---|---|---|
| Restore a production copy into staging without errors | 100 % | |
| New-platform queries over a 500 k-patient copy | p95 < 300 ms | |
| Index list derived from the real query shapes | documented | |
| Storage estimate for edge node (DB + documents + growth) | sized with headroom | |

## 6. Conclusions

1. **What the bridge can rely on:** ______
2. **What must be fixed in the legacy system first:** ______
3. **What we will not migrate and why:** ______
4. **Risks to the migration plan (`06` §2):** ______
