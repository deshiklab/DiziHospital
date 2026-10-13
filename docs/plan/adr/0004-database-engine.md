# ADR 0004 — Database engine strategy

* Status: **Accepted**
* Date: 2026-10-14
* Deciders: tech lead, data engineer, DBA

## Context
The existing system runs MySQL (5.5+ supported per vendor docs, MySQL 8 in practice) with a wide, partly
denormalised schema the legacy app writes to directly. Rebuilding the UI while also migrating the engine
would combine two high-risk changes in one programme. Meanwhile the product needs better analytics, JSON-heavy
features (custom fields, dynamic forms) and large-table scaling.

## Decision
1. **MySQL 8 remains the system of record** for all transactional modules during the modernization.
2. New modules own new tables; access to legacy data happens only through **views** owned by documented adapters.
3. **PostgreSQL is adopted for the analytics warehouse** (read replica → ELT → star schema) powering management
   dashboards and long-running reports; reporting queries never run against the transactional database at peak.
4. Re-evaluate a Postgres migration for the OLTP core only when one of these triggers fires: a JSONB-dependent
   feature becomes core (dynamic clinical forms), partitioning/retention requirements exceed MySQL's approach
   for audit tables, or analytics ELT cost exceeds the migration estimate. Any such change needs a new ADR.

## Consequences
* No engine migration risk inside the UI programme; the team learns one database well.
* Two stores require ELT discipline: the warehouse is derived, never authoritative, and is rebuilt from source
  of truth in CI.
* `ONLY_FULL_GROUP_BY`-style mode differences and vendor SQL quirks are documented in `docs/migration/` so new
  code does not inherit them.
