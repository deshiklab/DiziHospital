#!/usr/bin/env node
/**
 * Does the sign-in page hand off to the realm when one is configured? (P0-205)
 *
 * The other harnesses prove the *client* (`npm run test:auth` drives `lib/auth.ts` against a stand-in provider) and
 * that every route hydrates (`npm run test:runtime`). Neither of them sails past the trap this exists for:
 * `NEXT_PUBLIC_OIDC_ISSUER` is inlined by the bundler at build time, so a read written as anything other than
 * `process.env.NEXT_PUBLIC_OIDC_ISSUER` comes back undefined, the page quietly keeps showing the preview — and a
 * realm that is configured, provisioned and running is never reached. That failure shipped once and this found it.
 *
 * What it needs: a server built or started **with the variable set**, because that is the whole point. The repository
 * preview on :3000 has no realm, deliberately. The full proof, from this repository:
 *
 *     cd apps/web && NEXT_DIST_DIR=.next-build NEXT_PUBLIC_OIDC_ISSUER=http://localhost:8080/realms/dizihospital npx next build
 *     NEXT_DIST_DIR=.next-build npx next start -H 0.0.0.0 -p 3101 &
 *     node tools/test/oidc-page.mjs http://127.0.0.1:3101/login
 *
 * It checks four things: the button is the hand-off button rather than the preview's, the copy says the password is
 * not seen by this app, the account-console link is present, and — after a real click — the attempt (verifier, state,
 * nonce, and where to come back to) is in this tab's `sessionStorage` and the browser tries to leave for the realm.
 * jsdom cannot follow that navigation, so the last line of evidence is jsdom's own "navigation to another Document".
 *
 * Needs the harness dependencies: `npm i --no-save jsdom`.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = await import('jsdom');

const url = process.argv[2];
if (!url) {
  console.error('\nWhich server? Pass the /login URL of one built with NEXT_PUBLIC_OIDC_ISSUER set:\n\n    node tools/test/oidc-page.mjs http://127.0.0.1:3101/login\n');
  process.exit(2);
}
const console_ = new VirtualConsole();
const errors = [];
console_.on('jsdomError', (e) => errors.push(String(e.detail?.message ?? e.message)));
console_.on('error', (...a) => errors.push(String(a[0])));

const dom = await JSDOM.fromURL(url, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: console_,
  beforeParse(window) {
    window.matchMedia = (q) => ({ matches: false, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    window.scrollTo = () => {};
    const { TextEncoder, TextDecoder } = require('node:util');
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    try { window.ReadableStream = require('node:stream/web').ReadableStream; } catch {}
    try { window.MessageChannel = require('node:worker_threads').MessageChannel; } catch {}
    // jsdom ships no SubtleCrypto, and the PKCE challenge is a SHA-256 digest. Node's own is the real thing.
    const { webcrypto } = require('node:crypto');
    if (!window.crypto.subtle) {
      Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
    }
    window.queueMicrotask = queueMicrotask;
    window.structuredClone = structuredClone;
    window.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);
    window.cancelIdleCallback = (id) => clearTimeout(id);
  },
});

const started = Date.now();
while (!dom.window.document.documentElement.dataset.shell && Date.now() - started < 45_000) {
  await new Promise((r) => setTimeout(r, 100));
}

const doc = dom.window.document;
const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
const buttons = [...doc.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
console.log('shell:', doc.documentElement.dataset.shell);
console.log('buttons:', JSON.stringify(buttons));
console.log('mentions the realm host:', /127\.0\.0\.1:9\d{3}|localhost:9\d{3}/.test(text) || text.includes('sign-in service'));
console.log('says the password is not seen here:', /never seen by this app/.test(text));
console.log('keeps the preview banner:', /Preview sign-in/.test(text));
console.log('account console link:', [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h && h.includes('/account')).length);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');

/* Press it: does the page actually start a flow? The verifier, the state and the nonce have to land in
   sessionStorage before the browser leaves, and the redirect target has to be the realm's authorization endpoint. */
const captured = [];
try {
  Object.defineProperty(dom.window.location, 'assign', { configurable: true, value: (url) => captured.push(url) });
} catch (error) {
  console.log('could not intercept assign:', String(error).slice(0, 80));
}
const sso = [...doc.querySelectorAll('button')].find((b) => /Continue with your hospital account/.test(b.textContent ?? ''));
sso?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 1500));

const attempt = dom.window.sessionStorage.getItem('dizi.auth.attempt');
const parsed = attempt ? JSON.parse(attempt) : null;
console.log('attempt stored:', parsed ? Object.keys(parsed).sort().join(',') : 'none', '| verifier length:', parsed?.verifier?.length);
console.log('next:', JSON.stringify(parsed?.next));
console.log('redirect target:', captured.length ? captured[0] : '(interception did not take — jsdom cannot navigate)');
console.log('errors after the click:', errors.slice(-2));
if (captured[0]) {
  const u = new URL(captured[0]);
  console.log('  authorization endpoint:', u.pathname);
  console.log('  response_type / method:', u.searchParams.get('response_type'), '/', u.searchParams.get('code_challenge_method'));
  console.log('  state matches the attempt:', u.searchParams.get('state') === parsed?.state);
  console.log('  nonce is in the URL:', u.searchParams.get('nonce') === parsed?.nonce);
  console.log('  challenge is not the verifier:', u.searchParams.get('code_challenge') !== parsed?.verifier && (u.searchParams.get('code_challenge') ?? '').length > 20);
}
process.exit(0);
