# 08 — Legacy Integration & the Bridge

How we get data out of a system we cannot modify, keep the two systems consistent while both are live, and
retire the old one without losing a record.

This document exists because of decision **D1 = no vendor source code**. There is no fork, no patch, no hook
and no merge. The legacy Smart Hospital instance is a **third-party service**: we can use it, observe it, read
its database *if the vendor grants access*, and nothing more.

## 1. What we can and cannot do

| Capability | Available? | Consequence for the plan |
|---|---|---|
| Modify legacy code, add hooks, refactor | **No** | No code-level strangler. Replacement happens at the boundary: module ownership + cutover dates |
| Route inside the legacy app | **No** (unless it is on our own server and we add an edge proxy — a convenience, not a dependency) | Security holds: we work with bookmarks and a **module ownership registry**, not URL tricks |
| Read the legacy database | **Only if the vendor grants it** — the O1 question | Determines the quality of migration; a contractual item from week 1 |
| Ask the vendor for an API or import tool | **Maybe** — a commercial request | Cheapest possible write bridge if granted; ask early, ask in writing |
| Observe the legacy UI and its data model | **Yes** — we already did | The capture (`capture/`, 76 screens, 9,568 field instances) is our specification of the black box |
| Copy vendor code, CSS, images, fonts into our repo | **No** | Clean-room rule (`05`): we rebuild from observed behaviour and documented requirements, not from their source |
| Keep the legacy licence/subscription running | **Required** | The vendor instance stays licensed and supported while any module is still legacy-owned |

**Plan consequence in one sentence:** the bridge replaces the fork. Everything that a code-level strangler
would have done through shared tables is done here through **extraction, one-way replication and a written
ownership registry**.

## 2. Access model — what to ask the vendor for, in priority order

| Rank | Access level | Latency / fidelity | Effort to use | Risk |
|---|---|---|---|---|
| **A1** | Read-only MySQL replica, or a nightly logical dump delivered to a location we control | Minutes–hours, full fidelity | Lowest — ETL reads a real schema | Needs a written addendum; credentials custody |
| **A2** | Scheduled exports (CSV/SQL per table or per module) to our SFTP/S3 bucket | Daily, good fidelity, some type loss (dates, decimals, NULL vs empty) | Low–medium — per-export parsers and drift detection | Export shapes change without notice |
| **A3** | Read-only API offered by the vendor | Near-real-time, contract-bound | Medium — but the schema we need may not be exposed | Vendor roadmap dependency |
| **A4** | Report exports and UI-driven extraction (we already know every screen and field from the capture) | Slow, manual or automated, lossy | High — build scrapers per module; brittle | Highest; only for backfill of a few entities |

**A1 is the goal; A2 is the realistic default; A4 is a backfill tool, never a live feed.**

**Vendor-cloud reality (O2 answered).** The instance is hosted by the vendor, so a "read replica" is not ours to
configure. The request therefore asks for the practical form of A1:
a **nightly logical dump** (`mysqldump --single-transaction --routines --triggers`, gzipped and encrypted) pushed
to storage we control, with a **tunnelled read-only replica** as the preferred option if the vendor will support
it. If each branch runs its own instance or its own tenant, the same mechanism is requested **per branch** and the
extraction layer treats branch as a first-class dimension. Scheduled exports (A2) remain the fallback and the
extract interface is written so the level can improve without touching a single mapping.

### Data-access addendum — the checklist to settle in week 1 (written, signed)

1. **What**: exact tables/views/objects, and whether history (archived years) is included.
2. **How**: transport (dump, replica, export bucket), cadence, format, compression, encryption in transit.
3. **When**: delivery time window; notice of any change to schema, format or cadence (target: 14 days).
4. **Who**: named custodians on both sides; credentials stored in our secret manager, rotated quarterly.
5. **Quality**: row counts and checksums per delivery so we can prove completeness, not just receipt.
6. **Legal**: the hospital's right to its own data in machine-readable form; retention and deletion
   obligations; what happens to the data when the subscription ends (exit clause).
7. **Support**: an escalation path when a delivery is late, partial or malformed.

> If O1 comes back as "no access at all", the programme is not impossible — but it changes shape: the new
> system becomes authoritative from its own go-live date, history is imported only where a report export
> exists, and the legacy instance is kept read-only for historical lookup for the legal retention period.
> That decision must be made explicitly by the sponsor, in writing, before Phase 0 exits.

## 3. The read bridge (legacy → new)

One direction, always. Legacy never reads from us.

```
 legacy source ──▶ [extract] ──▶ staging schema ──▶ [validate] ──▶ transform ──▶ new schema
   (A1/A2/A3)         watermark        (raw, typed)      gates        mapping      provenance cols
                      + tombstones                    (see below)   (06 §3)
```

* **Extraction is watermark-based and idempotent.** Each source table is read by `updated_at` watermark, or by
  auto-increment key where `updated_at` does not exist, or by full re-read for small reference tables.
  Deletes are detected by tombstone tables where available, otherwise by a weekly anti-join sweep
  (present in our copy, absent at source) that produces a **deletion report for human confirmation** — we never
  silently drop clinical or financial history.
* **Provenance columns** on every mirrored row: `legacy_id`, `legacy_table`, `legacy_hash`, `extracted_at`,
  `extract_run_id`. This makes every record traceable back to its source row and every discrepancy explainable.
* **Validation gates** run before any promotion into the serving schema:
  * row counts and per-status counts match the extract;
  * monetary sums match the source report to the paisa;
  * no NULL in fields our schema declares mandatory (mismatch is reported, not defaulted);
  * duplicate detection rules for patients (name + phone + DOB + national ID) produce a review queue.
* **Schema drift is a first-class alert.** The extract layer has a contract test per source table (expected
  columns and types). A vendor change fails the contract test and pages the team instead of silently
  corrupting data.
* **Extraction never blocks clinical work.** It runs on the edge node's second vCPU budget at night; long
  backfills run on a separate worker pool.
* **The new system never queries the legacy database at request time.** All reads are served from our own
  copy — that is what makes the LAN work when the vendor cloud is unreachable.

## 4. The write bridge (new → legacy) — a ladder, not a checkbox

Most modules need no write-back at all if we sequence carefully: a module that is still legacy-owned keeps
being written in the legacy system, and the new system is simply read-only for it until its cutover. Write-back
is needed only where a *new* module produces something a *still-legacy* module must see (for example, a new
lab module issuing a result that legacy billing must charge).

| Rung | Mechanism | Preconditions | Guardrails | Use for |
|---|---|---|---|---|
| **1 — Avoid** | Re-sequence phases so the dependency disappears; or the new module produces the record again in the legacy UI at cutover | none | none | default answer; check this first, every time |
| **2 — Vendor interface** | The vendor's API, import tool or a supported DB procedure | Vendor agrees in writing and supports it | contract test, rate limits, reconciliation report | anything the vendor will support |
| **3 — Validated DB write** | Direct insert/update through an adapter, limited to **append-only, single-table inserts** whose semantics we have confirmed by vendor documentation or by controlled tests with vendor read-back | Written risk acceptance by sponsor + tech lead; rollback script; per-flow volume cap; before/after capture | idempotency key per record; never update or delete legacy rows; monitor for the vendor app rejecting or double-counting; kill switch per flow | low-volume, high-value flows only |
| **4 — UI replay** | A browser automaton (Playwright) replays the legacy form we already know field-by-field from the capture | Flow is small, deterministic and low volume; the legacy UI is the vendor's supported entry point | human confirmation for any money or clinical action; screenshot + payload logged for every replay; never bulk; per-flow kill switch | a handful of flows where rung 2 and 3 are unavailable |
| **5 — Manual dual entry** | Staff enter the record in both systems for a bounded window | The window has an end date and a reconciliation owner | shift checklist, daily reconciliation report, weekly sign-off | short overlaps, emergency fallback |

**Non-negotiables across all rungs**

* **Never two writers on one entity.** Ownership is explicit and dated in the registry below.
* **Never delete** in the legacy system to correct our mistake; corrections are new records or vendor-side
  fixes, with the error documented.
* **Every bridge action is logged** with actor/system, payload hash, target, result and a link to the audit
  ledger — so a discrepancy can always be replayed.
* **Money and clinical data get human confirmation** on rungs 3–5. Always.
* **Kill switches are per flow, not global** — one broken flow must not stop the others.

## 5. Module ownership registry

The single most important operational artefact during the transition. Kept at `docs/migration/ownership.md`
(created in Phase 0), one row per module, reviewed in every weekly delivery meeting:

| Field | Meaning |
|---|---|
| Module × branch | the registry is a matrix: `OPD registration` × `Branch A / B / C`. Shared master data has a single hospital-wide row; everything clinical and financial has one row **per branch** |
| Owning system | `legacy` / `new` (never both) — per matrix cell, so branch A can be on the new system while branch C is still legacy, on purpose |
| Write-back | none / rung 2 / rung 3 / rung 4 / rung 5 — with the flow name |
| Cutover date | the date ownership moved to the new system *for that branch* |
| Branch scope | which branches this cell covers (all branches for master data) |
| Read source for the other side | extract + validation run ID, or "not visible" |
| Retirement criteria | what must be true before the legacy module can be frozen (see `06` §6) |
| Owner | named person accountable for parity and support |

**Staff-facing rule:** a module is only "new" for a branch when that branch's cell says `new` **and** that
branch's training is complete. The launcher page is branch-aware, so a clerk in branch B never sees branch A's
new-module link before their own wave — the fastest way to lose trust is to show people a screen their branch
has not been trained on.

## 6. Reconciliation between two live systems

| Cadence | Check | Triage |
|---|---|---|
| Hourly | extract lag, failed applies, queue depth | on-call alert if lag > 30 min or failures > 0 |
| Nightly | counts, per-status counts and monetary sums per entity, both directions | report to the module owner; any money difference is P1 |
| Weekly | sample of 25 records per active module, field-by-field against source | discrepancies become tickets with the record IDs attached |
| Monthly | signed reconciliation for money entities by the accountant; clinical spot-check by the clinical lead | sign-off recorded in `docs/migration/reconciliation/<month>.md` |
| Per cutover | full pre/post comparison, frozen snapshot of both sides | go/no-go gate for the cutover |

A mismatch is never "probably fine". The three legitimate outcomes are: **bug in our mapping** (fix + re-run),
**expected difference** (documented, with a rule added to the mapping), or **data corruption** (P1 incident,
with the affected records enumerated before anyone reports a number upwards).

## 7. Archival, retention and vendor exit

1. **Retention period** — confirmed with the hospital's legal counsel and regulator *before* P9. Clinical
   records are typically retained for years; the archive, not the licence, is what guarantees access.
2. **Freeze, then read-only** — at P9 the legacy instance stops accepting writes, runs read-only for two
   weeks, then is retained in an archive instance (vendor-hosted or a hospital VM, whichever the licence and
   the contract allow) for the retention period.
3. **Take our own copy regardless of contract** — with a vendor-hosted instance, this is not a precaution but
   the only guarantee of access after the relationship ends. A complete, documented export: relational data as CSV +
   Parquet, documents/scans as original files with checksums, plus a rendered PDF of every printable record
   (bills, reports, certificates) because PDFs remain readable without any vendor software.
4. **Prove the archive works** — an annual restore-and-read drill on a machine with no vendor software
   installed; result recorded in the repo. An archive nobody has tested is not an archive.
5. **Exit checklist** — data-access addendum closed, credentials revoked, licences terminated in writing,
   vendor accounts removed, SBOM and dependency review closed, and a final report stating what was migrated,
   what was archived and what remains only in the archive.
6. **Nothing is deleted at exit** until the retention clock expires and the sponsor signs the deletion record.

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vendor refuses or delays data access | Medium | Critical — blocks migration quality | Raise it in week 1 as a contract item, with A2/A4 fallbacks prepared; sponsor escalation path; if it fails, an explicit written decision to go forward without history |
| Vendor changes schema/export shape silently | Medium | Data loss without alarms | Contract tests per source table; delivery checksums; 14-day change notice clause |
| Vendor discontinues or repriced the product mid-programme | Low–Medium | Loss of the legacy system before the new one is ready | Keep the subscription paid and documented; sequence the highest-risk modules early; keep an offline archive copy current |
| Direct DB writes (rung 3) double-count or violate a hidden rule | Medium | Financial or clinical error | Append-only inserts, volume caps, before/after evidence, daily reconciliation, kill switch |
| UI replay (rung 4) breaks after a vendor UI change | High (if used) | Flow stops silently | Health check per flow per day, screenshot evidence, alert + manual fallback, and a hard review at each vendor upgrade |
| Clean-room accidentally broken (vendor code copied into our repo) | Low | Legal exposure, cannot relicense our own platform | Written rule in `05`, review checklist, licence scan in CI, walled-off team for anyone who reads vendor source |
| Two systems, one patient, two identifiers | Medium | Confusion at the counter | MRN remains the legacy MRN; the new system never re-numbers; identity resolution report daily during overlap |
