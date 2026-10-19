# Nightly two-system reconciliation (P0-406)

**Status: HARNESS PREPARED — NO LIVE NIGHTLY RUN**

**Owner:** data engineer; module owner triages each report; finance owner signs money reconciliation

**Purpose:** compare control totals for the same approved branch, module and period in the legacy system and the new platform. This process is read-only. It does not select an owner, repair a record, or make an expected difference disappear.

> The [reconciliation comparator](../../tools/migration/README.md) currently accepts normalized snapshot manifests and has synthetic tests. The legacy access profile is blank and no legacy/new snapshot adapters or nightly scheduler are present in the repository. Do not treat the fixtures or CI test as evidence that the two live systems reconcile.

## Before enabling a nightly schedule

1. Complete the data-access addendum and record the actual legacy access method in `docs/migration/01-profile.md`.
2. Fill the relevant branch/module ownership cells in `docs/migration/ownership.md`; agree which records are expected to be comparable, their effective dates, mapping version and explicit exceptions. Version an approved control plan that lists every expected entity, category and total measure. Never compare unrelated ownership periods as if they should be identical.
3. Implement read-only source adapters that export the v1 summary shape in `tools/migration/README.md`. Each source must use the same branch, period and entity list; provide row counts, status counts, and money/quantity totals. Keep real credentials and snapshots outside Git.
4. Configure protected report storage and `DIZI_RECONCILIATION_ALERT_URL` (plus the optional bearer token) in the deployment secret store. The job must also alert on adapter failures and any non-zero exit; a missing/failed webhook is not a green run.
5. Schedule after both source snapshots are complete and verified. The comparator flags capture-time skew over 30 minutes and will not claim a parity comparison for stale/misaligned inputs.

## Nightly execution

The scheduler should create both snapshots from the same approved scope, then run:

```bash
node tools/migration/reconcile.mjs \
  --plan /secure/reconciliation/controls.json \
  --legacy /secure/reconciliation/legacy.snapshot.json \
  --new /secure/reconciliation/new.snapshot.json \
  --report /secure/reconciliation/reports/<run-id>.json \
  --run-id <branch-and-date>
```

Retain the aggregate report in access-controlled storage under the approved retention policy. Never commit production snapshots or reports, and never include patient names, phones, MRNs, note text or other direct identifiers in the snapshots or alert. Do not auto-correct either system from a report.

| Result | Operator action |
|---|---|
| Exit 0 / clean | Record the run ID and report location; continue the nightly cadence. |
| Drift alert, priority `P1` | Any monetary total difference or a count/status difference in a financial entity: notify the finance owner and on-call immediately, preserve both source snapshots, and open a tracked incident/ticket. |
| Drift alert, priority `REVIEW` | Route to the module owner for triage. Classify as mapping defect, documented expected difference, or data corruption; ticket the discrepancy and never mark it “probably fine.” |
| Exit 1 or 3 | Treat as a failed reconciliation run: investigate malformed/missing snapshots or undelivered alert, notify the on-call, and rerun only after preserving the failed inputs and evidence. |

The nightly v1 compares counts, per-status counts and aggregate totals. The plan's weekly 25-record field-by-field review, monthly signed money reconciliation, and per-cutover full comparison remain separate controls; do not infer that nightly totals replace them.

## Evidence for P0-406

For a real run, retain the run ID, branch/module scope, mapping version, source snapshot IDs/times, capture skew, report location, alert receipt, triage owner and linked tickets. Acceptance is not met until the scheduled run compares real, authorized snapshots and an injected mismatch in the deployed alert path is acknowledged. `npm run test:reconciliation` proves the comparator's alert path against a local test receiver only.
