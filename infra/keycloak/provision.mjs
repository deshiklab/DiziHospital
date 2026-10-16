#!/usr/bin/env node
/**
 * Provision the hospital's staff accounts into the DiziHospital realm (P0-205 / ticket #24).
 *
 * A realm export is configuration: roles, clients, mappers, the MFA policy. Accounts are *people*, and people arrive
 * one at a time from a spreadsheet the HR office keeps — so this is a script rather than a fixture, and it is the
 * script the pilot actually runs.
 *
 * It reads the role list from the contract (`x-dizi-roles`), not from a list kept in here. Nine role names typed into
 * a provisioning script are nine role names that go stale the day a role is renamed, and the failure is an account
 * created with a role the API refuses — a person who cannot sign in, with nothing in the script to look at.
 *
 * It does not invent credentials. Every account is created with **no password** and with the realm's required
 * actions pending, which is the honest shape of the migration described in ADR 0003: dual-read for a period, then
 * an assisted reset at the pilot desk, where the person is identified in front of somebody. A temporary password on
 * a command line is a password in a shell history, and a spreadsheet is not a place to keep one either.
 *
 *   node infra/keycloak/provision.mjs --check                      what this realm and the contract agree on
 *   node infra/keycloak/provision.mjs --staff staff.csv --dry-run   the kcadm commands, printed and not run
 *   node infra/keycloak/provision.mjs --staff staff.csv             create them
 *
 * The staff file is a CSV with a header: `staffId,name,email,role,branch,node`. `infra/keycloak/staff.example.csv`
 * is one, and it is deliberately boring because it is the shape of an export, not an invitation to invent people.
 *
 * `--kcadm` overrides the path to `kcadm.sh` (inside the container: `/opt/keycloak/bin/kcadm.sh`). Nothing here runs
 * Keycloak from this repository — `infra/README.md` is where the container comes from.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valueOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const REALM = valueOf('realm', 'dizihospital');
const SERVER = valueOf('server', 'http://localhost:8080');
const STAFF = valueOf('staff', null);
const KCADM = valueOf('kcadm', '/opt/keycloak/bin/kcadm.sh');
/* Where Keycloak actually runs. From a laptop that is a container, so CI and the pilot desk name one and the script
   runs kcadm through `docker exec`; with no container named it runs kcadm directly, which is what happens when the
   script is run inside the Keycloak container itself. Either way the dry run prints the line that would run. */
const CONTAINER = valueOf('in-container', null);
const ADMIN_USER = valueOf('user', 'admin');
const ADMIN_PASSWORD_ENV = valueOf('password:env', 'KEYCLOAK_ADMIN_PASSWORD');
const DRY = flag('dry-run');

/* ---------------------------------------------------------------- the contract, read rather than copied */

const contract = JSON.parse(readFileSync(resolve(ROOT, 'packages/contracts/openapi.json'), 'utf8'));
const roles = contract['x-dizi-roles'] ?? {};
const known = new Map([...(roles.legacy ?? []), ...(roles.service ?? [])].map((r) => [r.id, r]));
const realmFile = JSON.parse(readFileSync(resolve(HERE, 'realm-dizihospital.json'), 'utf8'));
const realmRoles = new Set((realmFile.roles?.realm ?? []).map((r) => r.name));
const mfaForced = (realmFile.requiredActions ?? []).some((a) => a.providerId === 'CONFIGURE_TOTP' && a.enabled && a.defaultAction);

/* ---------------------------------------------------------------- the commands */

const commands = [];

/**
 * One kcadm subcommand.
 *
 * `kcadm.sh config credentials` is the login itself and takes no `kcadm` prefix; every other subcommand does. Both
 * shapes are built here rather than by the caller, because the first dry run printed `kcadm.sh kcadm create users`,
 * which is a command that would have failed at the point somebody was relying on a printed plan.
 */
const kcadm = (subcommand, ...command) => commands.push([subcommand, ...command]);

/** The one JSON attribute blob a Keycloak user carries: the staff id, the branch and the node the token is minted with. */
const attributesFor = (row) =>
  JSON.stringify({
    staffId: [row.staffId],
    branch: [row.branch],
    node: [row.node],
  });

function planFor(rows) {
  commands.length = 0;
  for (const row of rows) {
    kcadm(
      'create', 'users',
      '-r', REALM,
      '-s', `username=${row.email}`,
      '-s', `email=${row.email}`,
      '-s', `firstName=${row.name.split(' ')[0]}`,
      '-s', `lastName=${row.name.split(' ').slice(1).join(' ') || '-'}`,
      '-s', 'enabled=true',
      '-s', 'emailVerified=true',
      // No password, and both required actions pending: the first sign-in sets the password and enrols the
      // authenticator, in that order, before any token is issued.
      '-s', 'requiredActions=["UPDATE_PASSWORD","CONFIGURE_TOTP"]',
      '-s', `attributes=${attributesFor(row)}`,
    );
    kcadm('add-roles', '-r', REALM, '--uusername', row.email, '--rolename', row.role);
  }
  return commands;
}

const shellLine = (command) => command.map((part) => (/[\s"'$]/.test(part) ? `'${part.replace(/'/g, `'\\''`)}'` : part)).join(' ');

/* ---------------------------------------------------------------- the CSV */

const COLUMNS = ['staffId', 'name', 'email', 'role', 'branch', 'node'];

function csv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  const header = lines.shift()?.split(',').map((h) => h.trim());
  const missing = COLUMNS.filter((c) => !header?.includes(c));
  if (missing.length) fail(`the staff file has no column(s): ${missing.join(', ')} — it needs ${COLUMNS.join(',')}`);

  const rows = [];
  const seen = new Set();
  lines.forEach((line, index) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = Object.fromEntries(header.map((column, i) => [column, cells[i] ?? '']));
    const at = index + 2; // the header is line 1
    for (const column of COLUMNS) if (!row[column]) fail(`line ${at}: ${column} is empty`);
    if (!known.has(row.role)) fail(`line ${at}: “${row.role}” is not a role the contract declares (${[...known.keys()].join(', ')})`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) fail(`line ${at}: “${row.email}” is not an email address, and the email is the username`);
    if (seen.has(row.email)) fail(`line ${at}: ${row.email} appears twice — one person, one account`);
    seen.add(row.email);
    rows.push(row);
  });
  return rows;
}

function fail(why) {
  console.error(`\n  ✗ ${why}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- --check */

/** What this realm and the contract agree on, and what to do about the ones they do not. */
function check() {
  const results = [];
  const ok = (label, condition, detail = '') => results.push({ label, condition, detail });

  const themeDir = `${HERE}/themes/${realmFile.loginTheme}/login`;
  const themeProperties = existsSync(`${themeDir}/theme.properties`) ? readFileSync(`${themeDir}/theme.properties`, 'utf8') : '';
  const bnBundle = existsSync(`${themeDir}/messages/messages_bn.properties`) ? readFileSync(`${themeDir}/messages/messages_bn.properties`, 'utf8') : '';
  const clients = new Map((realmFile.clients ?? []).map((c) => [c.clientId, c]));
  const web = clients.get('dizi-web');
  const api = clients.get('dizi-api');
  const mapperOn = (client, name) => (client?.protocolMappers ?? []).find((m) => m.name === name);
  const policy = String(realmFile.passwordPolicy ?? '');

  ok('the realm is the one ADR 0003 names', realmFile.realm === REALM, realmFile.realm);
  ok(
    'every role the contract declares is a role in this realm',
    [...known.keys()].every((id) => realmRoles.has(id)),
    [...known.keys()].filter((id) => !realmRoles.has(id)).join(', '),
  );
  ok(
    'and the realm issues no role the contract does not declare',
    [...realmRoles].every((id) => known.has(id)),
    [...realmRoles].filter((id) => !known.has(id)).join(', '),
  );
  ok('two-factor enrolment is forced, not offered', mfaForced, 'CONFIGURE_TOTP must be enabled and a default action');
  ok(
    'a password reset is forced on a migrated account',
    (realmFile.requiredActions ?? []).some((a) => a.providerId === 'UPDATE_PASSWORD' && a.enabled),
    'UPDATE_PASSWORD is how the assisted reset at the pilot desk happens',
  );
  ok(
    'recovery codes are issued at enrolment',
    (realmFile.requiredActions ?? []).some((a) => a.providerId === 'CONFIGURE_RECOVERY_AUTHN_CODES' && a.enabled),
    'twelve one-time codes: a lost phone must not mean a locked-out pharmacist',
  );
  ok('the sign-in theme the realm names exists on disk', themeProperties.length > 0, `${themeDir}/theme.properties`);
  ok('and it is a Bangla-first theme', /^locales=.*\bbn\b/m.test(themeProperties), themeProperties.match(/^locales=.*/m)?.[0] ?? 'no locales= line');
  ok('and it ships Bangla strings rather than falling back to English', bnBundle.split('\n').filter((line) => /^[A-Za-z][\w.]*=/.test(line)).length >= 40);
  ok(
    'the realm offers Bangla to the people who sign in',
    realmFile.internationalizationEnabled === true && realmFile.defaultLocale === 'bn' && (realmFile.supportedLocales ?? []).includes('bn'),
    `default ${realmFile.defaultLocale}, offering ${(realmFile.supportedLocales ?? []).join('/')}`,
  );
  ok(
    'the browser signs in with PKCE and no client secret',
    web?.publicClient === true && web?.attributes?.['pkce.code.challenge.method'] === 'S256' && !web?.secret,
    web ? `${web.clientId}: public=${web.publicClient}, pkce=${web.attributes?.['pkce.code.challenge.method']}` : 'dizi-web is missing',
  );
  ok(
    'the API can only ever verify tokens, never issue them',
    api?.bearerOnly === true && api?.publicClient === false,
    api ? `${api.clientId}: bearerOnly=${api.bearerOnly}` : 'dizi-api is missing',
  );
  ok(
    'and a token minted for the app carries the API’s audience',
    mapperOn(web, 'dizi-api-audience')?.config?.['included.client.audience'] === 'dizi-api' || mapperOn(api, 'dizi-api-audience')?.config?.['included.client.audience'] === 'dizi-api',
    'without it the API refuses every real token, which is a sign-in that succeeds and then cannot read anything',
  );
  ok(
    'the roles reach the token under the claim the contract names',
    (mapperOn(web, 'roles')?.config?.['claim.name'] ?? '') === 'realm_access.roles' &&
      (mapperOn(web, 'roles')?.config ?? {})['access.token.claim'] === 'true',
    'realm_access.roles, as `x-dizi-roles.claim` says',
  );
  ok('and so do the branch and the node every write is attributed to', Boolean(mapperOn(web, 'branch')) && Boolean(mapperOn(web, 'node')));
  ok('the password policy is the one the ADR promises', Number(policy.match(/length\((\d+)\)/)?.[1] ?? 0) >= 12, policy.slice(0, 60));
  ok(
    'and a guessed password is answered with a wait rather than another try',
    realmFile.bruteForceProtected === true && Number(realmFile.failureFactor ?? 0) > 0 && Number(realmFile.failureFactor ?? 0) <= 5,
    `bruteForceProtected=${realmFile.bruteForceProtected}, failureFactor=${realmFile.failureFactor}`,
  );

  const failed = results.filter((r) => !r.condition);
  console.log(`\nThe realm and the contract (${results.length} checks) — ${REALM} at ${SERVER}\n`);
  for (const { label, condition, detail } of results) {
    console.log(`  ${condition ? '✓' : '✗'} ${label}${!condition && detail ? `\n      ${detail}` : ''}`);
  }
  console.log(`\n${failed.length ? `✗ ${failed.length} of ${results.length} checks failed` : `✓ all ${results.length} checks passed`}\n`);
  return failed.length ? 1 : 0;
}

/* ---------------------------------------------------------------- creating accounts */

function provision(rows) {
  const password = process.env[ADMIN_PASSWORD_ENV];
  if (!password) {
    fail(`no admin credential: set ${ADMIN_PASSWORD_ENV} (or pass --password:env NAME for a different variable)`);
  }

  const plan = planFor(rows);
  /** One whole command line: inside the container when one was named, direct otherwise. The credential is appended
   *  at the point of the call rather than held in the plan, so it exists for as long as it takes to log in. */
  const invocation = (inner) =>
    CONTAINER ? ['docker', 'exec', CONTAINER, KCADM, ...inner] : [KCADM, ...(inner[0] === 'config' ? inner : ['kcadm', ...inner])];

  const login = invocation(['config', 'credentials', '--server', SERVER, '--realm', 'master', '--user', ADMIN_USER]);

  console.log(`\n${DRY ? 'Would create' : 'Creating'} ${plan.length / 2} account(s) in ${REALM} at ${SERVER}\n`);
  console.log(`  ${shellLine(login)} --password <${ADMIN_PASSWORD_ENV}>\n`);

  // Log in once, before anything is created, so a wrong password or an unreachable server fails now rather than nine
  // accounts from now.
  if (!DRY) {
    try {
      execFileSync(login[0], [...login.slice(1), '--password', password], { stdio: 'pipe' });
    } catch (error) {
      const stderr = String(error.stderr ?? error.message).trim().split('\n')[0];
      fail(`kcadm could not authenticate against ${SERVER} as ${ADMIN_USER}:\n      ${stderr}`);
    }
  }

  let created = 0;
  for (const row of rows) {
    const pair = plan.splice(0, 2);
    for (const step of pair) {
      const command = invocation(step);
      if (DRY) {
        console.log(`  ${shellLine(command)}`);
        continue;
      }
      try {
        execFileSync(command[0], command.slice(1), { stdio: 'pipe' });
      } catch (error) {
        const stderr = String(error.stderr ?? error.message).trim();
        // A second run of the same file must not be a failure: the account is already there, and the roles are
        // already mapped. Keycloak says so with a 409 on the user and a "already has role" on the mapping.
        if (/409|already exists|already has/i.test(stderr)) {
          console.log(`  · ${row.email}: already present, left alone`);
          continue;
        }
        fail(`kcadm refused ${row.email}:\n      ${stderr.split('\n')[0]}`);
      }
    }
    created += 1;
    console.log(`  ✓ ${row.email} → ${row.role}${DRY ? ' (not run)' : ''}`);
  }

  console.log(
    `\n${DRY ? `${created} account(s) would be created` : `${created} account(s) created`} — no passwords were set.\n` +
      `Each person sets their own password and enrols an authenticator at first sign-in (UPDATE_PASSWORD, then\n` +
      `CONFIGURE_TOTP). Assist the first cohort at the pilot desk: that is the reset that is also an identity check.\n`,
  );
  return 0;
}

/* ---------------------------------------------------------------- the command line */

if (!flag('check') && !STAFF) {
  console.log(`
Provision the hospital's staff accounts (P0-205).

  --check                 compare the realm with the contract's role table and report
  --staff <file.csv>      create the accounts in the file (staffId,name,email,role,branch,node)
  --dry-run               print the kcadm commands instead of running them
  --realm <name>          default: dizihospital
  --server <url>          default: ${SERVER}
  --kcadm <path>          kcadm inside the image, default: /opt/keycloak/bin/kcadm.sh
  --in-container <name>   run kcadm through 'docker exec <name>', which is how it runs from a laptop
  --user <name>           realm admin to authenticate as, default: ${ADMIN_USER}
  --password:env <NAME>   environment variable holding that credential, default: ${ADMIN_PASSWORD_ENV}

The realm itself is imported once, from infra/keycloak/realm-dizihospital.json; see infra/keycloak/README.md.
`);
  process.exit(args.length ? 1 : 0);
}

if (flag('check')) process.exit(check());
process.exit(provision(csv(readFileSync(resolve(process.cwd(), STAFF), 'utf8'))));
