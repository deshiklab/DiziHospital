'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, SafetyBanner } from '@dizi/ui';
import {
  checkCallback,
  exchangeCode,
  nonceMatches,
  oidcConfig,
  sessionFromToken,
} from '@/lib/auth';
import { saveSession, safeNext, takeAttempt } from '@/lib/session-store';

/* The OIDC redirect lands here (P0-205).
 *
 * Deliberately outside the staff shell: this is a waypoint, not a screen. It has no navigation, nothing to read and
 * nothing to press except the button that gets you out of it if it fails — because everything it does is decide
 * whether the callback is the one this browser started.
 *
 * The order is the order that matters:
 *
 *   1. `state` against the attempt this tab stored — before the code is spent, so a callback from another session
 *      cannot consume it.
 *   2. the code is exchanged with the verifier that proves this browser started the attempt.
 *   3. the `nonce` in the id token against the attempt — the last check that the identity is the one asked for.
 *
 * Any failure ends in a sentence a person can act on and a way back to the sign-in page. It never half-signs somebody
 * in: a session written from a callback that failed one of these three checks is the failure mode the checks exist
 * to prevent.
 */
export default function CallbackPage() {
  const [state, setState] = useState<'busy' | 'failed' | 'done'>('busy');
  const [message, setMessage] = useState('');

  /* This page has no shell, and the shell is what marks a page as hydrated. It says so itself, in the same place the
     three shells do, so a harness (and a person with the console open) can tell a page whose JavaScript ran from one
     that only arrived. */
  useEffect(() => {
    document.documentElement.dataset.shell = 'auth';
  }, []);

  useEffect(() => {
    const config = oidcConfig();
    const parameters = new URLSearchParams(window.location.search);

    if (!config) {
      setState('failed');
      setMessage('This deployment has no single sign-on configured, so there is nothing to come back from.');
      return;
    }

    const attempt = takeAttempt();
    if (!attempt) {
      setState('failed');
      setMessage('This sign-in did not start in this tab — the attempt it belongs to is gone, or it was already used. Start again from the sign-in page.');
      return;
    }

    const checked = checkCallback(parameters, attempt);
    if (!checked.ok) {
      setState('failed');
      setMessage(checked.reason);
      return;
    }

    let live = true;
    (async () => {
      const exchanged = await exchangeCode(config, checked.code, attempt.verifier);
      if (!live) return;

      if (!exchanged.ok) {
        /* The provider's own words, kept: `invalid_grant` on a replayed code and a 502 from a proxy need different
           responses from the person reading this screen, and only one of them is worth retrying. */
        setState('failed');
        setMessage(`${exchanged.description} (${exchanged.error})`);
        return;
      }

      if (!nonceMatches(exchanged.tokens.id_token, attempt.nonce)) {
        setState('failed');
        setMessage('The identity this token names is not the identity this tab asked for, so it was refused.');
        return;
      }

      const session = sessionFromToken(exchanged.tokens);
      if (!session) {
        setState('failed');
        setMessage('The token came back expired or without a subject, so there is no session to keep. Try again.');
        return;
      }

      saveSession(session);
      setState('done');
      // A full navigation rather than a router push: the shell reads the session once, on mount, and a push would
      // leave the previous page's navigation on screen until something else re-rendered it.
      window.location.replace(safeNext(attempt.next ?? new URLSearchParams(window.location.search).get('next')));
    })().catch((error: unknown) => {
      if (!live) return;
      setState('failed');
      setMessage(`The hospital's sign-in service could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    });

    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">
        {state === 'busy' ? 'Signing you in…' : state === 'done' ? 'Signed in' : 'That sign-in did not finish'}
      </h1>

      {state === 'busy' && (
        <p className="text-sm text-text-secondary" role="status">
          Checking the answer from the hospital&rsquo;s sign-in service. This takes a moment and needs the network.
        </p>
      )}

      {state === 'failed' && (
        <>
          <SafetyBanner severity="warning" title="Nothing was signed in">
            {message}
          </SafetyBanner>
          <p className="text-sm text-text-secondary">
            Your work is not affected: anything already queued on this device is still queued, and signing in again
            does not lose it.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="primary" onClick={() => window.location.assign('/login')}>
              Back to sign in
            </Button>
            <Link href="/help" className="inline-flex h-9 items-center rounded-md border border-border-default px-3 text-sm">
              Help
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
