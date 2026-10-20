# infra — what a deployment needs that is not application code

This directory holds the things that are configuration rather than product: the identity realm, and (later) the
containers, the node definitions and the backup routine. Nothing in here is imported by `apps/` or `services/` — it is
what those two are pointed at.

| Path | What it is | State |
|---|---|---|
| [`keycloak/`](keycloak/README.md) | The staff sign-in realm: roles, clients, mappers, forced MFA enrolment, the Bangla sign-in theme, and the script that creates staff accounts | Written, checked against the contract (`provision.mjs --check`, 17 checks), **not yet imported into a running Keycloak** — there is no docker in this repository's development environment |
| `compose.yml` — PostgreSQL 18, Redis, Keycloak, MinIO, MailHog, seeded synthetic data | The dev environment in one command — **P0-108, ticket #16** | Not written. It is the ticket that turns the realm above into something you can sign in to locally |
| `edge/` | The edge node: what runs on the branch's own box, and the deployment that has to keep working with the uplink down | Not written. P0-103 (the infrastructure survey, ticket #45) is the input it needs |

Two things worth saying out loud about the shape of a deployment here, because they are decisions rather than gaps:

* **The edge node is the unit of deployment, not the branch's building's cloud tenancy.** One node serves a branch and
  keeps working with the uplink down; the cloud tier is what it drains into. A node that has to call the cloud to sign
  a person in is a node whose staff cannot work during an outage — which is when they most need to.
* **Everything in here is a file, not a console.** A change made by clicking in an admin console is a change that
  exists on one machine. The realm, the node's configuration and the backup routine are reviewed like code and
  deployed like code; the scripts in `infra/keycloak/` are the pattern the rest will follow, and
  `packages/contracts/check.mjs` is the reason the realm cannot drift from the role table the app and the API read.
