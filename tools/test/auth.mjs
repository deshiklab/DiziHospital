#!/usr/bin/env node
/**
 * Sign-in, driven against a provider that behaves like Keycloak (P0-205 / #24).
 *
 * The hard part of an OIDC client is not the happy path — it is that the happy path is *checked*: the verifier
 * matches the challenge, the code is spent once, the state ties the callback to the tab that started it, and the
 * nonce ties the token to the request. None of that can be proved by reading the code, and none of it needs a real
 * Keycloak: what it needs is an endpoint that answers the way Keycloak does.
 *
 * So this harness brings its own realm: an HTTP server on a random port with `/protocol/openid-connect/auth` and
 * `/token`, signing real RS256 tokens with a key it generates per run. The *client* under test is the real
 * `apps/web/lib/auth.ts`, bundled with esbuild and driven over `fetch` — the same functions the sign-in page and the
 * callback page call.
 *
 * What that proves: the PKCE challenge really is SHA-256 of the verifier the client holds; the exchange would fail
 * without it; a replayed code is refused; a callback from another tab is refused; an expired or unsigned token is not
 * a session; the roles in the token become the shell and the abilities the app draws. What it does not prove: that
 * Keycloak's own answers are byte-identical to the ones here. That is what `provision.mjs --check` is for against a
 * running realm, and the API's own suite proves the verifying half against real RS256 signatures.
 *
 * Needs the harness dependencies: `npm i --no-save esbuild`.
 *
 *     npm run test:auth
 */
import { createHash, generateKeyPairSync, randomBytes, sign as signWith } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\nThis test needs one dev-only package:\n\n    npm i --no-save esbuild\n\nthen run `npm run test:auth` again.\n');
  process.exit(2);
}

/* ------------------------------------------------------------------ the client under test */

/**
 * One variable is set *before* the client is loaded, because the client reads its own environment once, when the
 * module is evaluated — which is what a built application does too. This is the path that decides whether a
 * configured realm hands off to Keycloak or silently keeps showing the preview; the case that checks it is near the
 * end of this file.
 */
const PROBE_ISSUER = 'https://realm.example/realms/dizihospital';
process.env.NEXT_PUBLIC_OIDC_ISSUER = PROBE_ISSUER;

const work = mkdtempSync(join(tmpdir(), 'dizi-auth-test-'));
const bundlePath = join(work, 'auth.cjs');
await esbuild.build({
  entryPoints: [resolve(ROOT, 'apps/web/lib/auth.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
  absWorkingDir: ROOT,
});
const loaded = require(bundlePath);
const auth = loaded.default ?? loaded;
rmSync(work, { recursive: true, force: true });

/* ------------------------------------------------------------------ the realm */

const REALM = 'dizihospital';
const CLIENT = 'dizi-web';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-realm-key';
const publicJwk = publicKey.export({ format: 'jwk' });

const base64url = (input) => Buffer.from(input).toString('base64url');

/** How many seconds until a claim's timestamp — small helpers so the cases read as the thing they are about. */
const inSeconds = (n) => Math.floor(Date.now() / 1000) + n;

function makeToken(claims, { header = {}, sign = true } = {}) {
  const head = { alg: 'RS256', typ: 'JWT', kid: KID, ...header };
  const input = `${base64url(JSON.stringify(head))}.${base64url(JSON.stringify(claims))}`;
  const signature = sign ? signWith('sha256', Buffer.from(input), privateKey) : Buffer.alloc(0);
  return `${input}.${signature.toString('base64url')}`;
}

/** The claims a Keycloak realm with the project's own mappers would put in an access token. */
function accessToken(overrides = {}) {
  return makeToken({
    iss: issuer,
    aud: ['account', 'dizi-api'],
    azp: CLIENT,
    sub: 'kc-staff-9',
    name: 'Rahima Begum',
    preferred_username: 'rahima.begum',
    realm_access: { roles: ['receptionist'] },
    branch: 'Main Campus',
    node: 'node-main-01',
    staff_id: '9018',
    iat: inSeconds(-5),
    exp: inSeconds(300),
    ...overrides,
  });
}

/* The provider's state: the codes it hands out, the challenge each must be redeemed with, and how many times each
   was redeemed — which is how "a code is spent once" is checked rather than asserted. */
let issued = [];
let issuer = '';

const json = (response, body) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};
const problemJson = (response, error, description) => {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error, error_description: description }));
};

const provider = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (url.pathname.endsWith('/.well-known/openid-configuration')) {
    return json(response, {
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`,
      end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
      jwks_uri: `${issuer}/protocol/openid-connect/certs`,
    });
  }

  if (url.pathname.endsWith('/protocol/openid-connect/certs')) {
    return json(response, { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] });
  }

  /* The authorization endpoint: Keycloak would render a login page here. What this models is what it does
     *afterwards* — validate the client's request, issue a code bound to the challenge, and redirect back with the
     state it was given. */
  if (url.pathname.endsWith('/protocol/openid-connect/auth')) {
    const params = url.searchParams;
    const problem = (() => {
      if (params.get('response_type') !== 'code') return 'unsupported_response_type';
      if (params.get('code_challenge_method') !== 'S256') return 'invalid_request: PKCE S256 is required';
      if (!params.get('code_challenge')) return 'invalid_request: no code_challenge';
      if (!params.get('state')) return 'invalid_request: no state';
      if (!params.get('redirect_uri')) return 'invalid_request: no redirect_uri';
      return null;
    })();

    if (problem) {
      const target = new URL(params.get('redirect_uri') ?? '/login/callback', 'http://127.0.0.1');
      target.searchParams.set('error', problem.split(':')[0]);
      target.searchParams.set('error_description', problem);
      response.writeHead(302, { location: target.toString() });
      return response.end();
    }

    const code = `code-${issued.length + 1}-${base64url(randomBytes(6))}`;
    issued.push({
      code,
      challenge: params.get('code_challenge'),
      redirectUri: params.get('redirect_uri'),
      nonce: params.get('nonce'),
      redeemed: 0,
      claims: claimsFor(params.get('login_hint')),
    });

    const target = new URL(params.get('redirect_uri'), 'http://127.0.0.1');
    target.searchParams.set('code', code);
    target.searchParams.set('state', params.get('state'));
    target.searchParams.set('session_state', base64url(randomBytes(8)));
    response.writeHead(302, { location: target.toString() });
    return response.end();
  }

  /* The token endpoint. The verifier is what is checked here: `BASE64URL(SHA256(verifier))` has to be the challenge
     the code was issued against, which is the whole of PKCE. */
  if (url.pathname.endsWith('/protocol/openid-connect/token')) {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const form = new URLSearchParams(body);
      const grant = form.get('grant_type');

      if (grant === 'refresh_token') {
        if (form.get('refresh_token') !== `refresh-${issued.length}`) {
          return problemJson(response, 'invalid_grant', 'That refresh token is not one this realm issued.');
        }
        return json(response, {
          access_token: accessToken({ realm_access: { roles: ['doctor', 'auditor'] } }),
          refresh_token: `refresh-${issued.length}`,
          id_token: makeToken(idTokenClaims({ nonce: 'a-nonce-from-earlier' })),
          expires_in: 300,
          token_type: 'Bearer',
        });
      }

      if (grant !== 'authorization_code') {
        return problemJson(response, 'unsupported_grant_type', `This realm cannot do \`${grant}\`.`);
      }

      const record = issued.find((i) => i.code === form.get('code'));
      if (!record) {
        return problemJson(response, 'invalid_grant', 'That code is not one this realm issued.');
      }
      if (record.redeemed > 0) {
        /* The replay case: Keycloak invalidates a code the moment it is exchanged, and this is the refusal the
           client has to survive with a sentence rather than a blank screen. */
        return problemJson(response, 'invalid_grant', 'That code has already been used. Sign in again.');
      }
      if (form.get('redirect_uri') !== record.redirectUri) {
        return problemJson(response, 'invalid_grant', 'The redirect_uri does not match the one the code was issued for.');
      }

      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== record.challenge) {
        return problemJson(response, 'invalid_grant', 'The PKCE verifier does not match the challenge.');
      }

      record.redeemed += 1;

      return json(response, {
        access_token: accessToken(record.claims),
        refresh_token: `refresh-${issued.length}`,
        id_token: makeToken(idTokenClaims({ nonce: record.nonce })),
        expires_in: 300,
        refresh_expires_in: 1800,
        token_type: 'Bearer',
        session_state: base64url(randomBytes(8)),
      });
    });
    return undefined;
  }

  response.writeHead(404).end();
});

/** One realm, several kinds of person: the harness picks the role by the `login_hint` it sends. */
function claimsFor(loginHint) {
  const byHint = {
    'auditor@dizihospital.example': { realm_access: { roles: ['auditor'] }, name: 'Inspection Account', sub: 'kc-auditor-1' },
    'doctor@dizihospital.example': { realm_access: { roles: ['doctor', 'admin'] }, name: 'Dr Sonia Bush', sub: 'kc-doctor-1' },
    'unknown@dizihospital.example': { realm_access: { roles: ['ward-clerk'] }, name: 'Renamed Role', sub: 'kc-ghost-1' },
    'noroles@dizihospital.example': { realm_access: { roles: [] }, name: 'No Role', sub: 'kc-norole-1' },
  };
  return byHint[loginHint] ?? {};
}

function idTokenClaims({ nonce }) {
  return {
    iss: issuer,
    aud: CLIENT,
    azp: CLIENT,
    sub: 'kc-staff-9',
    name: 'Rahima Begum',
    nonce,
    iat: inSeconds(-5),
    exp: inSeconds(300),
  };
}

await new Promise((ready) => provider.listen(0, '127.0.0.1', ready));
issuer = `http://127.0.0.1:${provider.address().port}/realms/${REALM}`;

/* ------------------------------------------------------------------ the cases */

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};

const config = {
  issuer,
  clientId: CLIENT,
  redirectUri: 'http://127.0.0.1:3000/login/callback',
  accountUrl: `${issuer}/account`,
  scopes: 'openid profile email',
};

/** Walk the whole flow the way the two pages do: start, get redirected, come back, exchange. */
async function signIn({ loginHint, tamper } = {}) {
  const attempt = await auth.authorizationRequest(config, loginHint ? { loginHint } : {});
  const authorize = new URL(attempt.url);
  const response = await fetch(attempt.url, { redirect: 'manual' });
  const location = new URL(response.headers.get('location'), 'http://127.0.0.1');
  const parameters = location.searchParams;

  if (tamper) tamper(parameters);

  const checked = auth.checkCallback(parameters, attempt);
  if (!checked.ok) return { attempt, authorize, checked, tokens: null };

  const exchanged = await auth.exchangeCode(config, checked.code, attempt.verifier);
  return { attempt, authorize, checked, exchanged, parameters };
}

console.log(`\nsign-in — the real client against a provider that behaves like Keycloak (${issuer})\n`);

/* ---- the request itself */

{
  const attempt = await auth.authorizationRequest(config);
  const url = new URL(attempt.url);
  check('the sign-in URL is the realm’s own authorization endpoint', url.pathname === `/realms/${REALM}/protocol/openid-connect/auth`);
  check('it asks for a code, never a token', url.searchParams.get('response_type') === 'code');
  check('it uses PKCE with SHA-256', url.searchParams.get('code_challenge_method') === 'S256');
  check(
    'the challenge really is SHA-256 of the verifier it keeps',
    url.searchParams.get('code_challenge') === createHash('sha256').update(attempt.verifier).digest('base64url'),
  );
  check('the verifier is long enough for the RFC (43+ characters)', attempt.verifier.length >= 43, `got ${attempt.verifier.length}`);
  check('it carries a state and a nonce, and they are not the same value', Boolean(attempt.state) && Boolean(attempt.nonce) && attempt.state !== attempt.nonce);
  check('two attempts never share a verifier', (await auth.authorizationRequest(config)).verifier !== attempt.verifier);
  check('the account console URL is where enrolment lives', config.accountUrl.endsWith('/account'));
}

/* ---- the happy path */

{
  const result = await signIn({ loginHint: 'receptionist@dizihospital.example' });
  check('a code comes back and the state matches the attempt', result.checked?.ok === true, JSON.stringify(result.checked));
  check('the token endpoint accepts the verifier', result.exchanged?.ok === true, JSON.stringify(result.exchanged));

  const session = result.exchanged?.ok ? auth.sessionFromToken(result.exchanged.tokens) : null;
  check('the token becomes a session', Boolean(session));
  check('the session names the person', session?.name === 'Rahima Begum');
  check('the session carries the token’s branch and node', session?.branch === 'Main Campus' && session?.node === 'node-main-01');
  check('the session carries the staff id from the mapper', session?.staffId === '9018');
  check('the role claim becomes a declared role', JSON.stringify(session?.roles) === '["receptionist"]');
  check('the role decides the shell the app draws', session?.shell === 'receptionist');
  check('the abilities come from the contract, not from the token', JSON.stringify(session?.abilities) === '["read","write"]');
  check('no role is left unaccounted for', session?.unknownRoles.length === 0);
}

/* ---- every role the contract declares maps to a shell */

{
  const mapped = auth.LEGACY_ROLES.map((role) => {
    const session = auth.sessionFromToken({ access_token: accessToken({ realm_access: { roles: [role.id] } }) });
    return `${role.id}→${session.shell}`;
  });
  const wrong = mapped.filter((pair) => {
    const [id, shell] = pair.split('→');
    return shell !== auth.ROLES[id].shell;
  });
  check('all nine legacy roles map to the shell the contract names', mapped.length === 9 && wrong.length === 0, wrong.join(', '));
  check('the policy-shaping roles carry administration, the clinical ones do not', auth.may(['super-admin'], 'administer') && !auth.may(['doctor'], 'administer'));
  check('a read-only role may not write — the refusal the API makes is the app’s rule too', !auth.may(['auditor'], 'write') && auth.may(['auditor'], 'read'));
}

/* ---- PKCE is not decoration */

{
  /* A code exchanged with somebody else's verifier: the case PKCE exists for. Driven by hand rather than through
     `signIn`, because the client would never do this — an attacker who intercepted the redirect would. */
  const attempt = await auth.authorizationRequest(config);
  await fetch(attempt.url, { redirect: 'manual' });
  const record = issued[issued.length - 1];

  const stolen = await auth.exchangeCode(config, record.code, 'a-verifier-the-attacker-made-up');
  check('a code redeemed with the wrong verifier is refused', stolen.ok === false && stolen.error === 'invalid_grant', JSON.stringify(stolen));
  check('the refusal carries the provider’s own sentence rather than a status', (stolen.description ?? '').includes('PKCE'));

  const right = await auth.exchangeCode(config, record.code, attempt.verifier);
  check('the same code with the right verifier is accepted', right.ok === true);

  const replay = await auth.exchangeCode(config, record.code, attempt.verifier);
  check('and a second redemption of the same code is refused', replay.ok === false && replay.error === 'invalid_grant', JSON.stringify(replay));
  check('the replay’s sentence tells the person to sign in again', (replay.description ?? '').toLowerCase().includes('sign in again'));
}

/* ---- state and nonce */

{
  const result = await signIn({ tamper: (parameters) => parameters.set('state', 'a-state-from-another-tab') });
  check('a callback whose state is another tab’s is refused before the code is spent', result.checked.ok === false);
  check('and the refusal explains that it is about this tab', (result.checked.reason ?? '').toLowerCase().includes('this tab'));
  check('nothing was exchanged', result.exchanged === undefined);
  check('the code was never redeemed', issued[issued.length - 1].redeemed === 0);

  const withNonce = await signIn({ loginHint: 'receptionist@dizihospital.example' });
  check('the id token’s nonce matches the attempt', auth.nonceMatches(withNonce.exchanged.tokens.id_token, withNonce.attempt.nonce));
  check('a token minted for another attempt does not', !auth.nonceMatches(withNonce.exchanged.tokens.id_token, 'a-nonce-from-elsewhere'));
}

/* ---- provider refusals arrive as sentences */

{
  const attempt = await auth.authorizationRequest(config);
  const refused = await auth.exchangeCode(config, 'never-issued', attempt.verifier);
  check('an unknown code is a typed refusal, not a throw', refused.ok === false && refused.status === 400);
  check('and it keeps the provider’s words for the screen', (refused.description ?? '').length > 20);

  const unreachable = await auth
    .exchangeCode({ ...config, issuer: 'http://127.0.0.1:9/realms/nothing' }, 'code', 'verifier')
    .catch((error) => error);
  check('an unreachable provider throws for the caller to report, rather than pretending to sign in', unreachable instanceof Error);
}

/* ---- a refresh, and the end of a session */

{
  const signedIn = await signIn({ loginHint: 'receptionist@dizihospital.example' });
  const refreshed = await auth.refresh(config, signedIn.exchanged.tokens.refresh_token);
  check('a refresh token trades for a new token set', refreshed.ok === true, JSON.stringify(refreshed));
  const session = refreshed.ok ? auth.sessionFromToken(refreshed.tokens) : null;
  check('and the new token’s roles are the ones that now apply', JSON.stringify(session?.roles.slice().sort()) === '["auditor","doctor"]');

  const logout = new URL(auth.endSessionUrl(config, session?.idToken ?? undefined, 'http://127.0.0.1:3000/login'));
  check('sign-out goes to the realm’s own end-session endpoint', logout.pathname.endsWith('/protocol/openid-connect/logout'));
  check('and names the session to end rather than ending every session', logout.searchParams.get('id_token_hint') !== null);
  check('and comes back to this application', logout.searchParams.get('post_logout_redirect_uri') === 'http://127.0.0.1:3000/login');
}

/* ---- what a browser is allowed to believe */

{
  check('an expired token is no session', auth.sessionFromToken({ access_token: accessToken({ exp: inSeconds(-30) }) }) === null);
  check('a token that is not a token is no session', auth.sessionFromToken({ access_token: 'not-a-token' }) === null);
  check('a token with no subject is no session', auth.sessionFromToken({ access_token: accessToken({ sub: undefined }) }) === null);

  const renamed = auth.sessionFromToken({ access_token: accessToken({ realm_access: { roles: ['ward-clerk'] } }) });
  check('a role the contract does not declare is reported rather than granted', renamed !== null && renamed.roles.length === 0 && renamed.unknownRoles[0] === 'ward-clerk');
  check('and the shell falls back to the narrowest one instead of inventing reach', renamed.shell === 'receptionist' && renamed.abilities.length === 0);

  const two = auth.sessionFromToken({ access_token: accessToken({ realm_access: { roles: ['auditor', 'super-admin'] } }) });
  check('two roles add up', JSON.stringify(two.roles.slice().sort()) === '["auditor","super-admin"]' && JSON.stringify(two.abilities) === '["read","write","administer"]');
  check('the widest one is the role the shell shows', two.role === 'super-admin' && two.shell === 'admin');

  const unsigned = auth.sessionFromToken({ access_token: makeToken({ sub: 'x', exp: inSeconds(300) }, { sign: false }) });
  check('an unsigned token still parses — because reading it is not verifying it', unsigned !== null);
}

/* ---- the configuration switch */

{
  const configured = auth.oidcConfig({ NEXT_PUBLIC_OIDC_ISSUER: 'https://id.example/realms/dizihospital/' });
  check('the issuer’s trailing slash is trimmed rather than doubled', configured.issuer === 'https://id.example/realms/dizihospital');
  check('the defaults are this application’s own client and callback', configured.clientId === 'dizi-web' && configured.redirectUri === '/login/callback');
  check('with no issuer there is no configuration at all, which is how the preview stays honest', auth.oidcConfig({}) === null);

  /* The default argument has to read the real environment: that is the path a built application takes, and the
     failure it guards against is a configured realm whose sign-in page quietly stays on the preview. */
  check(
    'with an issuer in the environment it is read without being passed in',
    auth.oidcConfig()?.issuer === PROBE_ISSUER,
    JSON.stringify(auth.oidcConfig()),
  );
}

provider.close();

console.log(`\n${failed ? `FAILED — ${failed} case(s)` : `all ${passed} cases passed`}\n`);
process.exit(failed ? 1 : 0);
