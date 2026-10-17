# ADR 0006 — PostgreSQL 18 as the primary engine for the new platform

* Status: **Accepted** — supersedes ADR 0004
* Date: 2026-10-14
* Deciders: tech lead, data engineer, DBA, ops

## Context
ADR 0004 assumed the new modules would share the legacy MySQL schema (own tables + read views) inside a
code-level strangler. Decision D1 removes the source code and decision D4 makes the platform a hybrid
hub-and-edge deployment. There is therefore **no shared schema to preserve**: the new platform is standalone
and must serve a LAN-authoritative node, a cloud replica, an analytics warehouse, and log-based sync between
them.

## Decision
1. **PostgreSQL 18** (current stable line; 18.x with quarterly minor updates) is the primary engine for the new
   platform, with:
   * **native partitioning** for the audit ledger, the change feed and other high-volume append-only tables;
   * **JSONB** for configurable clinical forms, template settings and audit payloads — the features the capture
     shows the legacy product implements with 9,568 loose field instances across 389 names;
   * **logical replication** as one supported transport for the cloud replica and the analytics pipeline;
   * **row-level security** available for multi-site or multi-tenant access rules if the hospital grows into
     more branches (question O3).
2. **MySQL becomes a source, not a store.** If the vendor grants access, a read-only connection or a delivered
   dump feeds the bridge. Under no circumstance is MySQL in the request path of the new platform.
3. **One engine, three roles:** OLTP on the edge node, a read-mostly replica in the cloud, and a separate
   analytics warehouse instance fed by logical replication or scheduled extracts. The warehouse is derived and
   rebuildable — never authoritative.
4. **Operations:** managed by the same team with `pgBackRest` (or equivalent WAL archiving): WAL shipped
   continuously to off-site storage, nightly full backups, quarterly restore drills, migration dry-runs against
   a restored snapshot in CI.
5. If the vendor later offers a supported API instead of database access, nothing in this ADR changes — the
   bridge simply consumes the API instead of a replica.

## Consequences
* One database engine to learn, tune, back up and monitor across both tiers.
* Offline/sync work benefits from Postgres tooling (logical replication, `LISTEN/NOTIFY`, robust JSONB
  indexing) instead of hand-rolled equivalents on MySQL.
* The hospital's existing MySQL knowledge stays useful only for reading the legacy source.
* Migration of legacy data becomes an explicit ETL responsibility (`06`, `08`) rather than an implicit
  "same database" assumption — a cost accepted in exchange for a clean, standalone platform.
* Team familiarity with Postgres must be raised deliberately: hiring filter, a one-day internal workshop, and
  an operations runbook reviewed before the first pilot (P1).
