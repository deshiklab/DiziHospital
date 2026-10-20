# ADR 0007 — Hybrid hub-and-edge topology with log-based sync

* Status: **Accepted** — decision **D4 = hybrid (PWA + hospital LAN + cloud)**
* Date: 2026-10-14
* Deciders: sponsor, tech lead, ops, clinical owner

## Context
The hospital must keep working when the internet uplink fails — registration, OPD, IPD, pharmacy, lab and
billing are all safety-relevant. Staff also need to reach the system from outside the hospital (remote
doctors, administrators, patients through a portal), and the hospital wants off-site backup and management
reporting. Ward tablets lose Wi-Fi intermittently even when the LAN is fine.

## Decision
1. **Two tiers.**
   * **Edge node (hospital LAN)** — runs the complete product (Laravel 13 API, Next.js UI, PostgreSQL 18,
     Redis, MinIO, Keycloak, adapters, local backup). It is the **system of record for clinical work** and is
     fully functional with the WAN uplink down. Packaging: a reproducible container bundle on a single appliance,
     optionally a 2-node HA pair (application + database with streaming replication) for larger sites.
   * **Cloud tier** — patient portal, public website, remote staff read/write for cloud-owned entities,
     analytics warehouse, monitoring and alerting, signed package distribution, off-site backups.
2. **Store-and-forward sync, log-based.** Every change is appended to a `sync_changes` table with a monotonic
   per-node sequence; batches are pushed and pulled over mTLS with resumable cursors, content hashes and batch
   signatures. Replay is harmless because record ids are client-generated **ULIDs** and applied changes are
   recorded in an `applied_changes` ledger.
3. **Pre-allocated number blocks per node** for invoice, receipt, sample, accession and admission numbers, so
   offline creation never mints a duplicate number at another node. MRNs of existing patients stay as they are;
   new patients draw from a block agreed with the hospital.
4. **Conflict policy per entity class** (`01` §5.2): union-merge for append-only clinical events; field-level
   last-writer-wins with a human review queue for demographics; origin-authoritative for appointments and
   issued money documents; per-location ledgers for inventory; cloud-authoritative for master data.
   No clinical or financial record is ever auto-merged from two writers.
5. **Explicit site modes.** Each site is either `edge-authoritative` (normal) or `cloud-direct` (uplink down or
   edge node under repair). The switch is an admin action recorded in the audit ledger and displayed in the UI.
6. **Offline in the browser too.** The PWA holds a queue of up to 4 hours of writes for ward workflows, shows
   every queued item with its state, and never reports "saved" for a record that is only on the device.
7. **Disaster recovery.** Edge node failure: restore from local backup within RTO 1 h, or switch the site to
   `cloud-direct` while the node is rebuilt. Cloud failure: edges continue unaffected. Split brain is prevented
   by single-writer-per-entity plus node IDs; it is detected by sync-lag and conflict metrics and resolved by
   the site-mode switch, never by an automatic merge.
8. **Security across the boundary.** Per-node mTLS certificates, encrypted storage on the edge, encrypted
   backups on both tiers, batch signatures verified in both directions, and no PII in sync logs.

## Consequences
* **Positive:** the hospital keeps working through internet outages; staff get one experience inside and outside
  the building; the cloud gives off-site backup, analytics and remote access without being a single point of
  failure for clinical care; ward tablets survive Wi-Fi gaps.
* **Negative:** two tiers to operate, patch and monitor; sync engineering, conflict handling and number-block
  allocation are non-trivial (~45 engineer-days of platform work plus test/hardening effort); a physical node
  must be specified, procured and maintained at the hospital (procurement lead time is a Phase 0 risk).
* **Mitigations:** edge node specified in Phase 0 and bought against a written hardware standard; edge
  packaging installed and upgraded by script, tested in `edge-lab`; quarterly outage drills (pull the uplink)
  and a documented node-rebuild runbook; sync metrics on the same dashboard as uptime.
* **Explicitly rejected:** cloud-only (fails the internet-outage requirement) and LAN-only (no remote access,
  portal or off-site backup).

## Revision 2026-10-14 — multi-site (O3 = 2–3 branch hospitals)

The decision above stands; the topology is repeated **per branch** rather than assumed single-site.

* **Every branch runs its own edge node** and is authoritative for that branch's clinical work, so a branch
  keeps operating when the cloud or another branch is unreachable (its own WAN included).
* **The cloud is the master-data and identity authority** for the whole hospital: patient master, charge
  catalogue, users/roles, branches and cross-branch reporting. Master data is distributed to branches as signed
  read-only packages; master-data writes are cloud-authoritative (as already decided for master data).
* **Numbering is per branch** (invoice, receipt, sample, accession, admission), so offline creation at two
  branches can never collide.
* **Cross-branch reads are replica reads** and are labelled with their age; a cross-branch write is never a
  silent local edit — it goes through the owning branch's node or the cloud, whichever owns the entity.
* **Branch-scoped access** is enforced in the API and backed by Postgres row-level security; cross-branch access
  needs an explicit role and a stated reason, and is audited.
* **Rollout is per branch** (staggered 2–4 weeks), which also means the sync and conflict rules must tolerate
  branches running *different application versions* during a rollout window — hence the change-feed version gate
  already required above.
* **Provisioning is code**: bootstrap, certificates, registration, master-data pull, printer/hardware config and
  smoke tests are one documented, rehearsed runbook (`05` §6), because with three branches a manual install is
  three different installations.
