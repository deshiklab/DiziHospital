'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, SafetyBanner, Segmented, Tooltip, cx, useToast } from '@dizi/ui';
import { DOCTORS } from '@/lib/appointments';
import { roleLabels, t } from '@/lib/nav';
import { useShell, type Role } from '@/lib/shell';

/* Sign-in (P0-205 preview).
 *
 * Two steps, because the real system has two: password, then a six-digit code from an authenticator app —
 * mandatory for every role that can see clinical or financial records (ADR 0003).
 *
 * Honest about its own state: this screen validates nothing. The credential check, MFA verification, lockout,
 * session cookies and device trust arrive with Keycloak; what is real here is the flow, the copy, the Bangla
 * toggle, the branch selector and the accessibility (labels, autocomplete hints, one-time-code input).
 */
export default function LoginPage() {
  const { locale, setLocale, role, setRole, siteMode } = useShell();
  const { push } = useToast();

  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [staffId, setStaffId] = useState('reception.uttara');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('Main Campus');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · DiziHospital';
  }, []);

  const submitCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setStep('mfa');
      push({ title: 'Password accepted — enter your 6-digit code', tone: 'info' });
    }, 400);
  };

  const submitMfa = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      window.location.href = '/';
    }, 400);
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left: the pitch and the identity of the installation */}
      <section className="flex flex-col justify-between bg-gradient-to-br from-brand-700 to-brand-900 p-8 text-text-inverse lg:p-12">
        <div>
          <span className="inline-grid size-11 place-items-center rounded-lg bg-white/15 text-lg font-bold">D</span>
          <h1 className="mt-6 text-3xl font-semibold leading-tight">DiziHospital</h1>
          <p className="mt-2 max-w-md text-base opacity-90">{t('shell.hospital', locale)}</p>
          <ul className="mt-8 flex max-w-md flex-col gap-3 text-sm">
            {[
              ['Works when the internet does not', 'Registration, prescribing, dispensing and billing run on the hospital server.'],
              ['One record per patient', 'Duplicate detection on every registration, across all branches.'],
              ['Nothing is lost', 'Queued work is listed until it reaches the server — never a silent "saved".'],
              ['Audited by design', 'Every clinical and financial change is written to an append-only ledger.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="mt-0.5">✓</span>
                <span>
                  <strong className="block">{title}</strong>
                  <span className="opacity-85">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 font-numeric text-xs opacity-75">
          Version 0.1.0 · Phase 0 shell · site mode: {siteMode}
        </p>
      </section>

      {/* Right: the form */}
      <section className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{step === 'credentials' ? 'Sign in' : 'Two-factor code'}</h2>
            <button
              type="button"
              onClick={() => setLocale(locale === 'en' ? 'bn' : 'en')}
              className="h-8 rounded-md border border-border-default bg-surface-default px-2 text-sm"
            >
              {locale === 'en' ? 'বাংলা' : 'English'}
            </button>
          </div>

          <SafetyBanner severity="info" title="Preview sign-in">
            The credential check and MFA verification are stubbed in this shell; they move to Keycloak in P0-205.
            Any value works. What is real: the flow, the MFA requirement, the language and the layout.
          </SafetyBanner>

          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="branch" className="text-sm font-medium text-text-secondary">Branch</label>
                <select
                  id="branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-2 text-base"
                >
                  {['Main Campus', 'Uttara Branch', 'Mirpur Branch'].map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="staff" className="text-sm font-medium text-text-secondary">Staff ID or mobile</label>
                <input
                  id="staff"
                  name="username"
                  autoComplete="username"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-3 text-base"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="password" className="text-sm font-medium text-text-secondary">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-[var(--dizi-density-field-height)] rounded-md border border-border-default bg-surface-default px-3 text-base"
                  required
                />
                <p className="text-xs text-text-tertiary">
                  Locked out after five failed attempts; the counter supervisor can unlock and the attempt is logged.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Trust this device for 30 days
                </label>
                <button type="button" className="text-sm text-brand-600 hover:underline" onClick={() => push({ title: 'Password reset is handled by the hospital IT desk', tone: 'info' })}>
                  Forgot password
                </button>
              </div>

              <Button type="submit" variant="primary" busy={busy} className="mt-1 w-full">
                Continue
              </Button>

              <div className="mt-2 border-t border-border-subtle pt-3">
                <p className="mb-2 text-xs text-text-tertiary">Demo roles (this sets the shell's permissions preview):</p>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(roleLabels) as Role[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={cx(
                        'rounded-full border px-3 py-1 text-xs',
                        role === r ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border-subtle text-text-secondary hover:bg-surface-sunken',
                      )}
                    >
                      {roleLabels[r][locale]}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={submitMfa} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="code" className="text-sm font-medium text-text-secondary">Six-digit code</label>
                <input
                  id="code"
                  name="one-time-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="h-12 rounded-md border border-border-default bg-surface-default px-3 text-center font-numeric text-2xl tracking-[0.4em]"
                  autoFocus
                  required
                />
                <p className="text-xs text-text-tertiary">
                  From the authenticator app on your phone. Required for every clinical and financial role.
                </p>
              </div>

              <details className="rounded-md border border-border-subtle p-3 text-sm">
                <summary className="cursor-pointer font-medium">Lost your phone?</summary>
                <ul className="mt-2 list-disc pl-5 text-text-secondary">
                  <li>Use one of the recovery codes issued when you enrolled.</li>
                  <li>Otherwise the hospital IT desk verifies you in person and re-enrols the device — that action is audited.</li>
                </ul>
              </details>

              <Button type="submit" variant="primary" busy={busy} className="w-full" disabled={code.length !== 6}>
                Sign in
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep('credentials')} className="w-full">
                Back
              </Button>
            </form>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
            <span>Doctors: {DOCTORS.slice(0, 3).map((d) => d.name).join(' · ')} and more</span>
            <Link href="/help" className="text-brand-600 hover:underline">Need help signing in?</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
