# Keycloak — the hospital's own sign-in service (P0-205 / #24)

Identity is the one thing this project does not build. Staff sign in at a Keycloak realm, the app receives tokens, and
the API verifies them; nothing in this repository hashes a password, and nothing here can be talked into issuing a
token. This directory is that realm: its configuration, the words on its pages, and the script that creates staff
accounts in it.

The realm lives **on the edge node** (ADR 0003), so a ward with the uplink down still signs people in, and the cloud
Keycloak — for the patient portal and remote staff — is federated from it one way. What is in here is the edge realm.

## What is here

| File | What it is | How it is held to its word |
|---|---|---|
| `realm-dizihospital.json` | The realm as a Keycloak import: ten roles, three clients, the token mappers, the forced enrolment, the password policy and the lockout, the Bangla sign-in theme | `packages/contracts/check.mjs` reads it: every role in the contract's `x-dizi-roles` must be a realm role, and the realm must carry the client ids, the required action and the mapper the contract's `implementedBy` evidence names. A rename in one and not the other fails the build, not the sign-in |
| `themes/dizi/login/` | The Bangla sign-in page: `theme.properties` plus `messages/messages_bn.properties` | `check.mjs` checks that the theme the realm names exists, offers `bn`, and defines the strings a person reads — including the two-factor ones. Every key is one Keycloak itself defines, because an unknown key renders as nothing at all, which is worse than falling back to English |
| `provision.mjs` | Creates staff accounts from HR's CSV, one row at a time | `--check` compares the realm with the contract's role table and prints all 17 findings; `--dry-run` prints every command it would run |
| `staff.example.csv` | The shape of that CSV: `staffId,name,email,role,branch,node` | Nine rows, one per legacy role, boring on purpose — the shape of an export, not an invitation to invent people |

The role names are **not** kept in this directory. `provision.mjs` reads them out of the contract's `x-dizi-roles` at
run time, because nine role names typed into a provisioning script are nine names that go stale the day a role is
renamed, and the failure is a person who cannot sign in with nothing in the script worth looking at. The realm file is
authored and `check.mjs` holds it to the contract; the script reads the contract directly.

## The realm in one page

* **Realm** `dizihospital`, display name DiziHospital, `sslRequired: external`.
* **Roles** `super-admin`, `admin`, `doctor`, `nurse`, `pharmacist`, `pathologist`, `radiologist`, `accountant`,
  `receptionist` — the nine legacy roles, with the abilities and the legacy reach recorded in the contract's
  `x-dizi-roles` — plus `auditor`, which is not a legacy role at all: an inspection reads and changes nothing, and it
  is a role rather than an exception in code.
* **Clients** `dizi-web` (public, Authorization Code **with PKCE S256**, standard flow only, no direct grants — a
  browser cannot keep a secret, and a password grant is a password in a program), `dizi-api` (**bearer-only**: it
  issues nothing and only ever verifies), and `dizi-account` (the account console the enrolment links go to).
* **Mappers** on `dizi-web`: `roles` (the realm roles into `realm_access.roles`, multivalued), `branch`, `node`,
  `staff-id`, and `dizi-api-audience`, which puts `dizi-api` in the token's audience so the API can insist on it.
  `dizi-api` carries the roles mapper too, so a token minted for another client is refused by audience rather than by
  luck.
* **Access tokens** ten minutes, `revokeRefreshToken: true`, `refreshTokenMaxReuse: 0` — single-use rotating refresh,
  so a stolen refresh token is worth one attempt and the theft is visible.
* **Password policy** twelve characters, upper, lower, digit, special, not the username, not the email, five remembered
  passwords. **Lockout** five failures, then a wait that grows to fifteen minutes; permanent lockout is deliberately
  off, because a locked-out receptionist on a Monday morning is a queue at the door and the desk can reset them.
* **MFA** TOTP, six digits, thirty seconds, not reusable inside the window (`otpPolicyCodeReusable: false`).
  `CONFIGURE_TOTP` is enabled in the realm, alongside `CONFIGURE_RECOVERY_AUTHN_CODES`; accounts are created with
  both pending as required actions, so **a person who has not enrolled cannot be issued a token at all** rather than
  being issued one and asked politely by a screen. WebAuthn is enabled for the admin roles — the recipe lives in the
  Keycloak admin console, not in this repository yet.
* **Bangla** `internationalizationEnabled`, `defaultLocale: bn`, `supportedLocales: [bn, en]`. Bengali is the default
  because the desk is Bengali-first; the switcher on the page is how a consultant who prefers English gets English,
  and Keycloak remembers it per person. Keycloak ships 65 login bundles and Bangla is not one of them, which is why
  the theme is ours.
* **Registration and self-service reset are off.** Accounts come from HR's spreadsheet and enrolment is assisted at
  the pilot desk (ADR 0003). A self-service reset is the flow that lets somebody with a stolen email address become a
  pharmacist.
* **Events on**, admin events on: sign-in, enrolment and every realm change are recorded.

## Running it

The one-command development environment is **P0-108 (ticket #16)** and not in this repository yet. This is the command
that ticket will wrap, and what a machine with docker runs today:

```bash
docker run --rm --name dizi-keycloak -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=change-me-in-a-real-deployment \
  -v "$PWD/infra/keycloak/realm-dizihospital.json:/opt/keycloak/data/import/realm.json:ro" \
  -v "$PWD/infra/keycloak/themes/dizi:/opt/keycloak/themes/dizi:ro" \
  quay.io/keycloak/keycloak:26.8.1 start-dev --import-realm
```

Then, with the realm answering on `http://localhost:8080/realms/dizihospital`:

```bash
# the app: which realm to send people to. Unset — the default — and the sign-in page stays the honest preview.
NEXT_PUBLIC_OIDC_ISSUER=http://localhost:8080/realms/dizihospital npm run dev --workspace @dizi/web

# the API: which realm to trust. These two together, never one of them.
DIZI_AUTH_DRIVER=keycloak
OIDC_ISSUER=http://localhost:8080/realms/dizihospital
OIDC_AUDIENCE=dizi-api
```

The realm's redirect URIs already cover the two ports this repository serves on (`3000` for the dev server, `3100`
for the production build) on `localhost`, `127.0.0.1` and the `*.e2b.app` preview host, so a preview behind a proxy
signs in without a second realm.

## Provisioning staff

```bash
node infra/keycloak/provision.mjs --check                                    # what the realm and the contract agree on
node infra/keycloak/provision.mjs --staff staff.csv --dry-run --in-container dizi-keycloak
node infra/keycloak/provision.mjs --staff staff.csv --in-container dizi-keycloak
```

Accounts are created **with no password**, with `UPDATE_PASSWORD` and `CONFIGURE_TOTP` pending. A temporary password
on a command line is a password in a shell history, and a spreadsheet is not a place to keep one either. The assisted
reset at the pilot desk is where a person is identified in front of somebody, which is the only reset that is also an
identity check — so the admin credential is read from an environment variable (`--password:env`, default
`KEYCLOAK_ADMIN_PASSWORD`) and never printed.

The first account has to be created with `kcadm` (or the admin console) and given a password by hand; every account
after that signs in by enrolling. Delete the bootstrap account when the pilot desk has its own.

## What has been run, and what has not

Stated plainly, because "OIDC is wired" is not the same claim as "somebody signed in":

* **A real login has not been exercised from this repository's development environment.** There is no docker here, so
  Keycloak has not been started, the realm has not been imported, and no password, one-time code or recovery code has
  been typed into a real sign-in page. What has been run is `provision.mjs --check` (17 checks, against the realm file
  and the contract) and `--dry-run` (9 accounts, printed and not created).
* **The client flow is proved against a provider that behaves like Keycloak.** `npm run test:auth` stands up an HTTP
  server that speaks the discovery, authorization, token, JWKS and logout endpoints, signs real RS256 tokens with a key
  generated per run, and drives the app's own `lib/auth.ts` through it: PKCE S256, the code exchange, a replayed code,
  a callback from another tab, the nonce, a refresh, and the role claims becoming a session. It proves the client; it
  does not prove that Keycloak's own bytes are identical.
* **The verifying half is proved against real signatures, in CI.** `services/api/tests/Unit/KeycloakTokenVerifierTest.php`
  signs tokens with a real RSA key and checks the driver's refusals: another realm, another audience, an expired token,
  a tampered signature, an unknown key id, an unreachable key set. It runs in `ci-api`, not here — there is no PHP in
  this development environment.
* **The theme is checked as a file, not as a page.** Every Bangla key is one Keycloak defines, and the theme is where
  the realm says it is. Nobody has looked at the rendered page in Bangla.
* **WebAuthn and the cloud federation are configuration, not tests.** Both are in ADR 0003 as decisions; neither has
  been exercised.

The first thing the next person with docker should do is import the realm, run `--check` against the running instance,
create one account with `--dry-run` off, sign in, and then delete that account — because the person it creates is not
a real member of staff.
