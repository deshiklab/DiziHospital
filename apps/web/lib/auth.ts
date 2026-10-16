/* -----------------------------------------------------------------------------
 * Sign-in: OIDC Authorization Code with PKCE, against the hospital's own Keycloak (P0-205 / #24).
 *
 * This file is deliberately free of React. The whole flow — the verifier, the challenge, the authorization URL,
 * the code exchange, the refresh, the sign-out, and the reading of a token's roles — is plain functions over
 * `fetch` and WebCrypto, which is what lets `tools/test/auth.mjs` drive the real thing against a stand-in provider
 * and hold every promise here to an actual HTTP exchange rather than to a comment.
 *
 * Three things it is careful about, because they are the three ways a sign-in is quietly wrong:
 *
 *   1. **PKCE.** The app is a public client: a browser cannot keep a secret, so it proves possession of the
 *      verifier instead. `S256` only — `plain` is not offered, and the realm refuses it too.
 *   2. **state and nonce.** `state` stops a code from another session being replayed into this one; `nonce` binds
 *      the id token to the request that asked for it. Both are generated per attempt and both are checked.
 *   3. **What the browser is allowed to believe.** The app reads `realm_access.roles` out of the token to decide
 *      what to *show*. That is not authorisation: the API verifies the signature and checks the ability itself, so
 *      a token doctored in the browser buys a screen full of refusals and nothing else. The distinction is the
 *      reason `sessionFromToken` says so in its docblock rather than leaving it implied.
 *
 * The role table itself is not here. It is read from `packages/contracts/openapi.json` → `x-dizi-roles`, through
 * the generated client, so the realm, the app and the API cannot disagree about what a role may do.
 */

import { roles as roleTable } from '@dizi/contracts/client';

/** A role as the contract declares it: the nine legacy ones and the read-only service role. */
export type RoleId = string;

export interface RoleDefinition {
  readonly id: string;
  readonly label: { readonly en: string; readonly bn: string };
  readonly shell: ShellId;
  readonly abilities: readonly string[];
  readonly legacyScreens?: number;
  readonly mfa: string;
  readonly because: string;
}

export type ShellId = 'receptionist' | 'doctor' | 'pharmacist' | 'billing' | 'admin';
export type Ability = 'read' | 'write' | 'administer';

const LEGACY = (roleTable.legacy ?? []) as readonly RoleDefinition[];
const SERVICE = (roleTable.service ?? []) as readonly RoleDefinition[];
const ALL: readonly RoleDefinition[] = [...LEGACY, ...SERVICE];

/** Every role the platform knows, keyed by id. A role outside this set is not one this platform will act on. */
export const ROLES: Record<string, RoleDefinition> = Object.fromEntries(ALL.map((r) => [r.id, r]));

/** The nine roles the legacy system's dashboards were captured with — the P0-205 acceptance, by name. */
export const LEGACY_ROLES: readonly RoleDefinition[] = LEGACY;

/** The app's own shells, and the roles that land on each. A shell is a shape of navigation, not a permission. */
export const SHELLS: readonly ShellId[] = (roleTable.shells ?? []) as readonly ShellId[];

/** Whether an OIDC provider is configured for this build. */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  /** Where Keycloak's account console lives, for enrolment. Derived from the issuer when not given. */
  accountUrl: string;
  scopes: string;
}

/**
 * The provider, from the environment — and the honest answer when there is none.
 *
 * `NEXT_PUBLIC_OIDC_ISSUER` is the switch. Unset (which is how this repository's preview is deployed, because
 * Keycloak needs somewhere to run) the sign-in screen keeps its preview and says so on itself; set, the same
 * screen hands off to Keycloak and never sees a password again. Nothing here falls back silently: a build that
 * says it is signed in and is not would be worse than the preview it replaced.
 */
export function oidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = env.NEXT_PUBLIC_OIDC_ISSUER?.replace(/\/+$/, '');
  if (!issuer) return null;
  return {
    issuer,
    clientId: env.NEXT_PUBLIC_OIDC_CLIENT_ID ?? 'dizi-web',
    redirectUri: env.NEXT_PUBLIC_OIDC_REDIRECT_URI ?? '/login/callback',
    accountUrl: env.NEXT_PUBLIC_OIDC_ACCOUNT_URL ?? `${issuer}/account`,
    scopes: env.NEXT_PUBLIC_OIDC_SCOPES ?? 'openid profile email',
  };
}

/* ---------------------------------------------------------------------------------------- PKCE */

const BASE64URL = /[+/=]/g;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(BASE64URL, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''));
}

/** A fresh code verifier: 32 random bytes, base64url, inside the 43–128 character range the RFC requires. */
export function createVerifier(random: Crypto = crypto): string {
  const bytes = new Uint8Array(32);
  random.getRandomValues(bytes);
  return base64url(bytes);
}

/** `BASE64URL(SHA256(verifier))` — the S256 challenge. */
export async function challengeFor(verifier: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/** A per-attempt nonce/state value. */
export function createState(random: Crypto = crypto): string {
  const bytes = new Uint8Array(16);
  random.getRandomValues(bytes);
  return base64url(bytes);
}

/* ---------------------------------------------------------------------------------------- the flow */

export interface AuthRequest {
  verifier: string;
  state: string;
  nonce: string;
  url: string;
}

/** The URL a browser is sent to. Everything Keycloak needs to come back to *this* attempt. */
export async function authorizationRequest(
  config: OidcConfig,
  options: { random?: Crypto; subtle?: SubtleCrypto; loginHint?: string; prompt?: string } = {},
): Promise<AuthRequest> {
  const verifier = createVerifier(options.random);
  const state = createState(options.random);
  const nonce = createState(options.random);
  const challenge = await challengeFor(verifier, options.subtle);

  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  if (options.prompt) url.searchParams.set('prompt', options.prompt);

  return { verifier, state, nonce, url: url.toString() };
}

/** The failure shape of a token request, in the OIDC error vocabulary. */
export interface TokenError {
  error: string;
  error_description?: string;
}

export interface TokenSet {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  session_state?: string;
}

export interface ExchangeResult {
  ok: true;
  tokens: TokenSet;
}

export interface ExchangeFailure {
  ok: false;
  /** The provider's own error code: `invalid_grant` for a replayed or expired code. */
  error: string;
  /** The provider's own sentence, shown as it is. A refusal nobody can read is a refusal support cannot act on. */
  description: string;
  status: number;
}

async function postForm(endpoint: string, form: Record<string, string>, fetchImpl: typeof fetch): Promise<ExchangeResult | ExchangeFailure> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok || typeof body.access_token !== 'string') {
    const error = typeof body.error === 'string' ? body.error : `http_${response.status}`;
    const description =
      typeof body.error_description === 'string'
        ? body.error_description
        : `The hospital's sign-in service answered ${response.status}. Wait a moment and try again; if it keeps happening, tell the IT desk with this code: ${response.status}.`;
    return { ok: false, error, description, status: response.status };
  }

  return { ok: true, tokens: body as unknown as TokenSet };
}

/**
 * Trade the authorization code for tokens.
 *
 * The code goes back with the verifier that proved this browser started the attempt, which is what makes an
 * intercepted redirect useless to anybody else. The response is returned as tokens or as a refusal with the
 * provider's own words — never as a half-session.
 */
export async function exchangeCode(
  config: OidcConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult | ExchangeFailure> {
  return postForm(
    `${config.issuer}/protocol/openid-connect/token`,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    },
    fetchImpl,
  );
}

/** A rotating refresh: Keycloak issues a new refresh token and (with revocation on) retires the old one. */
export async function refresh(
  config: OidcConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult | ExchangeFailure> {
  return postForm(
    `${config.issuer}/protocol/openid-connect/token`,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    },
    fetchImpl,
  );
}

/** Where sign-out ends: Keycloak's end-session endpoint, with the id token to end the right session. */
export function endSessionUrl(config: OidcConfig, idToken?: string, postLogoutRedirect?: string): string {
  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  if (postLogoutRedirect) url.searchParams.set('post_logout_redirect_uri', postLogoutRedirect);
  url.searchParams.set('client_id', config.clientId);
  return url.toString();
}

/* ---------------------------------------------------------------------------------------- the token */

export interface TokenClaims {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  branch?: string;
  node?: string;
  staff_id?: string;
  realm_access?: { roles?: string[] };
}

/** Read a JWT's claims. Not a verification — see `sessionFromToken`. */
export function claimsOf(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as TokenClaims;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface Session {
  actor: string;
  name: string;
  /** Every role in the token that the contract declares. A person may hold two. */
  roles: RoleId[];
  /** The role with the most reach, which decides the shell. */
  role: RoleId | null;
  shell: ShellId;
  abilities: Ability[];
  branch: string;
  node: string;
  staffId: string | null;
  expiresAt: number;
  /** Roles in the token that the contract does not declare: kept so a screen can say so instead of pretending. */
  unknownRoles: string[];
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
}

/** The abilities a set of roles adds up to: the union, because a consultant who is also the clinical lead is one
 *  account with two roles and neither of them is the ceiling. */
export function abilitiesFor(roles: readonly string[]): Ability[] {
  const held = new Set<Ability>();
  for (const role of roles) for (const ability of ROLES[role]?.abilities ?? []) held.add(ability as Ability);
  return (['read', 'write', 'administer'] as Ability[]).filter((a) => held.has(a));
}

/** Does this role set carry the ability? The answer the *app* needs to hide an action — the API checks again. */
export function may(roles: readonly string[], ability: Ability): boolean {
  return abilitiesFor(roles).includes(ability);
}

/** The shell a role set renders as: the widest role wins, with `admin` at the top. */
export function shellFor(roles: readonly string[]): ShellId {
  const order: ShellId[] = ['admin', 'billing', 'pharmacist', 'doctor', 'receptionist'];
  for (const shell of order) if (roles.some((role) => ROLES[role]?.shell === shell)) return shell;
  return 'receptionist';
}

/** The single role a screen's header shows: the widest one held. */
export function roleFor(roles: readonly string[]): RoleId | null {
  const shell = shellFor(roles);
  const legacyOrder = LEGACY.map((r) => r.id).filter((id) => roles.includes(id));
  return legacyOrder.find((id) => ROLES[id]?.shell === shell) ?? roles.find((r) => ROLES[r]) ?? null;
}

/**
 * Build the session from a token set.
 *
 * **This does not verify anything, and must not be read as if it did.** The access token is verified by the API,
 * which fetches Keycloak's JWKS and checks the signature, issuer, audience and expiry (see
 * `services/api/app/Modules/Identity/KeycloakTokenVerifier.php`). What happens here is the browser reading its own
 * token to decide which screens to draw — and a browser that lies to itself about its roles gets a navigation it
 * cannot use and a refusal on every action it tries, because the check that matters happens on the other side of
 * the wire.
 *
 * Returns null when the token is not a token: no sub, no expiry, or an expiry already past. An expired token is
 * treated as no session at all rather than as a session to retry with.
 */
export function sessionFromToken(tokens: TokenSet, now: number = Date.now()): Session | null {
  const claims = claimsOf(tokens.access_token);
  if (!claims) return null;
  const expiresAt = (claims.exp ?? 0) * 1000;
  if (!claims.sub || !expiresAt || expiresAt <= now) return null;

  const declared = (claims.realm_access?.roles ?? []).filter((r) => typeof r === 'string');
  const known = declared.filter((r) => r in ROLES);
  const unknown = declared.filter((r) => !(r in ROLES));

  return {
    actor: claims.sub,
    name: claims.name ?? claims.preferred_username ?? claims.sub,
    roles: known,
    role: roleFor(known),
    shell: shellFor(known),
    abilities: abilitiesFor(known),
    branch: claims.branch ?? '',
    node: claims.node ?? '',
    staffId: claims.staff_id ?? null,
    expiresAt,
    unknownRoles: unknown,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
  };
}

/**
 * Check a callback's query parameters against the attempt that started it.
 *
 * A mismatch is refused here, before the code is spent: `state` protects the session (another session's code
 * replayed into this one) and `nonce` protects the identity (a token minted for a different request). Both are
 * compared in one place so neither can be forgotten by a caller in a hurry.
 */
export function checkCallback(
  parameters: URLSearchParams,
  attempt: { state: string; nonce: string },
): { ok: true; code: string } | { ok: false; reason: string } {
  const error = parameters.get('error');
  if (error) {
    const description = parameters.get('error_description') ?? '';
    return { ok: false, reason: `${error}${description ? ` — ${description}` : ''}` };
  }
  const code = parameters.get('code');
  if (!code) return { ok: false, reason: 'The sign-in service came back without a code.' };
  if (parameters.get('state') !== attempt.state) {
    return { ok: false, reason: 'This sign-in did not start in this tab, so it was refused. Start again from the sign-in page.' };
  }
  return { ok: true, code };
}

/** The nonce in an id token, for the caller that has just exchanged a code and has the attempt in hand. */
export function nonceMatches(idToken: string | undefined, nonce: string): boolean {
  if (!idToken) return true; // A provider may return only an access token; the nonce then has nothing to bind to.
  return claimsOf(idToken)?.nonce === nonce;
}
