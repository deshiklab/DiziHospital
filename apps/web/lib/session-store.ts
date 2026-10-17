/* -----------------------------------------------------------------------------
 * What a sign-in attempt and a signed-in session are kept in (P0-205 / #24).
 *
 * Two records, both per tab, and the choice of storage is the interesting part.
 *
 * **`sessionStorage`, not `localStorage`.** These desks are shared: a receptionist hands the keyboard to the next
 * shift, and a session that outlives the tab is a session the next person inherits. Closing the tab ends it, and a
 * shared browser has no “remember me” to get wrong. It is also the honest limitation — a person who opens a second
 * tab is not signed in there, which is a smaller surprise than a shared account that follows somebody home.
 *
 * **The attempt is one-use.** `takeAttempt()` removes what it reads. A callback can only be redeemed once, and a
 * second visit to the callback URL — a refresh, a back button — says "this did not start in this tab" rather than
 * spending a code that Keycloak has already retired.
 *
 * Nothing here is a security boundary, and the docblock in `./auth` says so: the session this stores is the
 * browser's own copy of a token, used to decide which navigation to draw. Every write still goes to the API, which
 * verifies the signature itself.
 */

import type { Session } from './auth';

/** The attempt, between leaving for Keycloak and coming back. */
export const ATTEMPT_KEY = 'dizi.auth.attempt';

/** The session, for as long as the tab is open. */
export const SESSION_KEY = 'dizi.auth.session';

/** Fired on `window` whenever the session is written or cleared, so the shell redraws without a page load. */
export const SESSION_CHANGED = 'dizi:session-changed';

export interface Attempt {
  /** The PKCE verifier. Never leaves this tab except as the exchange that proves it. */
  verifier: string;
  state: string;
  nonce: string;
  /** Where to go once signed in — already through `safeNext()`. */
  next: string;
  /** When it started, so a stale attempt can be told apart from a slow one. */
  startedAt: number;
}

/**
 * `sessionStorage`, or nothing at all.
 *
 * Private mode and an embedded frame both make storage throw on access rather than return null; a sign-in page that
 * throws while rendering is worse than one that cannot remember, so every path here degrades to "no session" and
 * the page says what to do about it.
 */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remember the attempt this tab is making. Called immediately before the browser leaves for Keycloak. */
export function saveAttempt(attempt: Omit<Attempt, 'startedAt'> & { startedAt?: number }): boolean {
  return write(ATTEMPT_KEY, { ...attempt, startedAt: attempt.startedAt ?? Date.now() });
}

/**
 * Read the attempt and forget it, in one step.
 *
 * One step on purpose: a caller that read the attempt and then forgot it would have two places to make a mistake,
 * and the mistake — redeeming a callback twice — is exactly what the state check is here to prevent.
 */
export function takeAttempt(): Attempt | null {
  const attempt = read<Attempt>(ATTEMPT_KEY);
  const store = storage();
  try {
    store?.removeItem(ATTEMPT_KEY);
  } catch {
    // Nothing to do: the attempt is out of reach either way, and the caller treats "no attempt" as a refusal.
  }
  return attempt && typeof attempt.verifier === 'string' && typeof attempt.state === 'string' ? attempt : null;
}

/** Keep the session, and tell the shell it changed. */
export function saveSession(session: Session): boolean {
  const kept = write(SESSION_KEY, session);
  if (kept) announce();
  return kept;
}

/**
 * The session in this tab, or null.
 *
 * An expired session is dropped and reported as none: `sessionFromToken` already refuses one, and a stored session
 * outliving its token is a header that shows a name next to screens that will refuse to load.
 */
export function loadSession(now: number = Date.now()): Session | null {
  const session = read<Session>(SESSION_KEY);
  if (!session || !session.accessToken || !session.expiresAt) return null;
  if (session.expiresAt <= now) {
    clearSession();
    return null;
  }
  return session;
}

/** Drop the session and tell the shell. Sign-out calls this before it calls Keycloak. */
export function clearSession(): void {
  const store = storage();
  try {
    store?.removeItem(SESSION_KEY);
  } catch {
    // An unreadable store has no session in it to clear.
  }
  announce();
}

/**
 * Where to land after signing in.
 *
 * `next` comes out of an address bar, which means it is attacker-controlled: an unvalidated one turns the sign-in
 * page into an open redirect — `?next=https://somewhere-else.example` and the hospital's own sign-in hands a person
 * to somebody else's page with the trust it has just earned. Only a path on this origin is accepted.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  try {
    // A second opinion, because `//host` is not the only spelling a URL parser reads as another origin.
    const url = new URL(value, 'http://localhost');
    if (url.origin !== 'http://localhost') return '/';
  } catch {
    return '/';
  }
  return value;
}

/** Tell whoever is listening that the session changed. Silence if there is no window yet (a server render). */
function announce(): void {
  try {
    window.dispatchEvent(new Event(SESSION_CHANGED));
  } catch {
    // No window: nothing is listening, and nothing is drawn yet.
  }
}
