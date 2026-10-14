'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { SyncState } from '@dizi/ui';

/* -----------------------------------------------------------------------------
 * Shell state: node, density, language and the simulated sync layer.
 *
 * The sync layer here is a stand-in for the real one (P0-210/P0-211): it exists so the shell can demonstrate
 * every state the plan requires (02 §11) — live, LAN-only, queued, syncing, conflict — without pretending the
 * sync engine is finished. It also carries the queued-write count, which is what makes the "Saved here" versus
 * "Saved" distinction real rather than cosmetic.
 */

export type Density = 'comfortable' | 'compact';
export type Locale = 'en' | 'bn';
export type Role = 'receptionist' | 'doctor' | 'pharmacist' | 'billing' | 'admin';
export type SiteMode = 'edge-authoritative' | 'cloud-direct';

export interface QueuedWrite {
  id: string;
  label: string;
  at: string;
}

interface ShellState {
  density: Density;
  setDensity: (d: Density) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  role: Role;
  setRole: (r: Role) => void;
  sync: SyncState;
  setSync: (s: SyncState) => void;
  siteMode: SiteMode;
  setSiteMode: (m: SiteMode) => void;
  queued: QueuedWrite[];
  queueWrite: (label: string) => void;
  flushQueue: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

const STORAGE_KEYS = { density: 'dizi.density', locale: 'dizi.locale', role: 'dizi.role' };

function readStored<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  return (window.localStorage.getItem(key) as T) || fallback;
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => readStored(STORAGE_KEYS.density, 'comfortable'));
  const [locale, setLocaleState] = useState<Locale>(() => readStored(STORAGE_KEYS.locale, 'en'));
  const [role, setRoleState] = useState<Role>(() => readStored(STORAGE_KEYS.role, 'receptionist'));
  const [sync, setSync] = useState<SyncState>('live');
  const [siteMode, setSiteMode] = useState<SiteMode>('edge-authoritative');
  const [queued, setQueued] = useState<QueuedWrite[]>([]);

  const applyDensity = useCallback((d: Density) => {
    setDensityState(d);
    window.localStorage.setItem(STORAGE_KEYS.density, d);
    document.documentElement.dataset.density = d;
  }, []);

  const applyLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEYS.locale, l);
    document.documentElement.lang = l;
  }, []);

  const applyRole = useCallback((r: Role) => {
    setRoleState(r);
    window.localStorage.setItem(STORAGE_KEYS.role, r);
  }, []);

  /** Queues a write locally — the "Saved here, will sync" path. */
  const queueWrite = useCallback((label: string) => {
    setQueued((q) => [
      ...q,
      { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, at: new Date().toLocaleTimeString() },
    ]);
    setSync('queued');
  }, []);

  /** Drains the queue as the real engine would after the connection returns. */
  const flushQueue = useCallback(() => {
    setQueued([]);
    setSync('live');
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      density,
      setDensity: applyDensity,
      locale,
      setLocale: applyLocale,
      role,
      setRole: applyRole,
      sync,
      setSync,
      siteMode,
      setSiteMode,
      queued,
      queueWrite,
      flushQueue,
    }),
    [density, locale, role, sync, siteMode, queued, applyDensity, applyLocale, applyRole, queueWrite, flushQueue],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside ShellProvider');
  return ctx;
}
