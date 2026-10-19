# Reconciliation snapshot comparator (P0-406)

`reconcile.mjs` compares one normalized nightly control snapshot from `legacy` with one from `new`. It is read-only: it does not connect to either system, correct records, or infer mappings. Source adapters must emit the same declared branch, period, entity scope and metric definitions after applying the approved mappings in `docs/migration/`. This is distinct from P0-311's per-node hash-chain audit-ledger verification; that integrity check has different inputs and is not implemented here.

A shared, versioned control plan is required in addition to the two snapshots. It names every entity, its category, and every expected total metric. Change `planId` whenever those controls change; both snapshots must carry the same approved ID. This prevents both adapters omitting the same control from appearing clean. The committed plan in `fixtures/controls.synthetic.json` is **test data only**; production plans must be approved for their real branch/module scope.

The snapshot contract is versioned (`schemaVersion: 1`). Each input contains:

- `source`: exactly `legacy` or `new`; the matching `planId`; an opaque `snapshotId`; and timezone-qualified `capturedAt`. `snapshotId` and the CLI `--run-id` must never contain patient, staff or other direct identifiers.
- `scope`: branch, the same `period.from`/`period.to` window, and the explicit list of entities expected in this run.
- One `entities.<name>` summary for every expected entity: `category` (`clinical`, `financial`, `inventory`, `master` or `other`), `count`, `byStatus`, and `totals` (use `{}` when there are no control totals).
- Money totals as `{ "kind": "money", "currency": "BDT", "minorUnits": "12345" }`. Use integer strings in the currency's minor unit; never use floating-point amounts. Quantity totals use `{ "kind": "quantity", "unit": "each", "value": "42.5" }` with an exact decimal string.

The control plan has `{ "schemaVersion": 1, "planId": "...", "entities": { "invoices": { "category": "financial", "totals": { "gross": { "kind": "money", "currency": "BDT" } } } } }`. Each snapshot's `planId` and entity scope must match it exactly. Every planned total must be present, and unplanned entities/totals are drift—even if both snapshots omit the same field.

Status counts must sum to the row count. Every expected entity and every zero-valued control must be explicit; a missing entity or measure is not silently treated as zero. The pair must describe the same scope. A capture-time skew over 30 minutes is reported and suppresses parity comparison, following the extract-lag alert threshold in plan 08 §6. Financial-entity count/status drift and any money-total drift are raised as P1.

## Run

```bash
node tools/migration/reconcile.mjs \
  --plan /secure/reconciliation/controls.json \
  --legacy /secure/reconciliation/legacy.snapshot.json \
  --new /secure/reconciliation/new.snapshot.json \
  --report /secure/reconciliation/reports/run-2026-10-20.json \
  --run-id branch-a-2026-10-20
```

The report is written with mode `0600`; choose a protected directory outside the repository. It contains aggregate totals and issue details, so do not commit real reports or snapshots. The webhook receives only run/plan/scope metadata, affected entity names, issue counts and priority—no totals, record identifiers or record values.

Configure `DIZI_RECONCILIATION_ALERT_URL` with an HTTPS JSON receiver. `DIZI_RECONCILIATION_ALERT_TOKEN` is optional and is sent as a bearer token; keep it in the deployment secret store. HTTP is accepted only for loopback tests. A drift posts `dizihospital.reconciliation.drift`; alert delivery failure is a separate non-zero exit, never a clean result.

| Exit | Meaning |
|---:|---|
| 0 | Snapshots are valid, aligned with the control plan, and their control totals match |
| 1 | Usage, input, control-plan, or snapshot validation error |
| 2 | Drift found and alert delivered |
| 3 | Drift found but no alert receiver is configured or delivery failed |

`node tools/test/reconciliation.mjs` uses a synthetic control plan/snapshots and a local mock webhook. It proves the clean path, rejects a planned financial total omitted by both sources, and verifies that an injected financial mismatch posts the P1 alert. This is a harness test, not a comparison of live hospital systems.

## Not yet wired to production

The legacy-access profile (`docs/migration/01-profile.md`) and branch/module ownership dates are not filled in, and there are no source snapshot adapters or nightly scheduler in this repository. This interface cannot safely choose the entities, branch scope, mappings or actual extraction mechanism on its own. Add the adapter and schedule only after the data-access method and per-branch ownership/parity scope are approved. Until then, the committed fixtures are the only snapshots and no live reconciliation or nightly alert is claimed.
