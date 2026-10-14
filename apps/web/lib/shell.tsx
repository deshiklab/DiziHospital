'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SyncState } from '@dizi/ui';
import { usePersistentState } from '@dizi/ui';
import {
  DrillClock,
  SimulatedCloud,
  drain,
  enqueue,
  initialOutbox,
  resolveConflict,
  syncSummary,
  type Conflict,
  type Operation,
  type OutboxState,
} from './sync';

/* -----------------------------------------------------------------------------
 * Shell state: layout preferences (sidebar mode, zoom, text size), identity (role, language, density)
 * and the simulated sync layer.
 *
 * The sync layer stands in for the real engine (P0-210/211) so every state the plan requires (02 §11) can be
 * reviewed in the shell — including the "saved here" versus "saved" distinction, which is the whole reason the
 * queued-write list exists.
 */

export type Density = 'comfortable' | 'compact';
export type Locale = 'en' | 'bn';
export type Role = 'receptionist' | 'doctor' | 'pharmacist' | 'billing' | 'admin';
export type SiteMode = 'edge-authoritative' | 'cloud-direct';
export type SidebarMode = 'full' | 'half' | 'hidden';

export interface QueuedWrite {
  id: string;
  label: string;
  at: string;
}

/** What the sync console and the header pill read: one engine, one queue, one set of conflicts. */
export interface SyncEngineHandle {
  outbox: OutboxState;
  summary: ReturnType<typeof syncSummary>;
  /** The server side of the prototype. The console uses it to make the other branch write while we are dark. */
  cloud: SimulatedCloud;
  /** Queue a write: applied on this device at once, sent when the uplink is there. */
  enqueue: (write: Omit<Operation, 'id' | 'nodeId' | 'seq' | 'queuedAt'>) => void;
  /** Drain the queue and report what happened. */
  drainNow: () => ReturnType<typeof syncSummary>;
  resolve: (conflictId: string, choice: NonNullable<Conflict['resolution']>) => void;
  setUplink: (reachable: boolean) => void;
  /** Start again with an empty queue and full number blocks. */
  reset: () => void;
}

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const TEXT_STEPS = [0.875, 1, 1.125, 1.25] as const;

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
  /** The P0-210/211 prototype: the outbox, the conflict list, the number blocks and the drain. */
  syncEngine: SyncEngineHandle;
  /** Sidebar: full (labels + icons), half (icon rail) or hidden. Persisted. */
  sidebarMode: SidebarMode;
  setSidebarMode: (m: SidebarMode) => void;
  toggleSidebar: () => void;
  /** Mobile drawer state (never remembered between sessions by design). */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  zoom: number;
  setZoom: (z: number) => void;
  textScale: number;
  setTextScale: (s: number) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  version: string;
  buildStamp: string;
}

const ShellContext = createContext<ShellState | null>(null);

export const APP_VERSION = '0.1.0';
export const APP_PHASE = 'Phase 0 · shell';

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = usePersistentState<Density>('dizi.density', 'comfortable');
  const [locale, setLocaleState] = usePersistentState<Locale>('dizi.locale', 'en');
  const [role, setRoleState] = usePersistentState<Role>('dizi.role', 'receptionist');
  const [sidebarMode, setSidebarModeState] = usePersistentState<SidebarMode>('dizi.sidebar', 'full');
  const [zoom, setZoomState] = usePersistentState<number>('dizi.zoom', 1);
  const [textScale, setTextScaleState] = usePersistentState<number>('dizi.textScale', 1);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sync, setSync] = useState<SyncState>('live');
  const [siteMode, setSiteMode] = useState<SiteMode>('edge-authoritative');
  const [buildStamp] = useState(() => new Date().toISOString().slice(0, 10));

  /* ---- the sync engine (P0-210/211) ----------------------------------------------------------
   * One engine for the whole shell: the header pill, the offline behaviour of the other screens and the sync
   * console all read and write this. The cloud and the clock live outside the component because they are not
   * this device: they are the other branch and the passage of time. */
  const cloud = useMemo(() => new SimulatedCloud('edge-b'), []);
  const clockRef = useRef(new DrillClock(9 * 60 + 40));
  const [outbox, setOutbox] = useState<OutboxState>(() => initialOutbox('edge-a'));
  const [queued, setQueued] = useState<QueuedWrite[]>([]);

  /* ---- side effects that touch the document -------------------------------------------------- */
  const applyDensity = useCallback(
    (d: Density) => {
      setDensityState(d);
      document.documentElement.dataset.density = d;
    },
    [setDensityState],
  );

  const applyLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      document.documentElement.lang = l;
    },
    [setLocaleState],
  );

  const applySidebar = useCallback(
    (m: SidebarMode) => {
      setSidebarModeState(m);
      document.documentElement.dataset.sidebar = m;
    },
    [setSidebarModeState],
  );

  /** Text size is a separate control from zoom: it changes type only, not the layout grid (02 §10). */
  const applyTextScale = useCallback(
    (scale: number) => {
      setTextScaleState(scale);
      document.documentElement.style.fontSize = `${14 * scale}px`;
    },
    [setTextScaleState],
  );

  const setZoom = useCallback(
    (z: number) => {
      setZoomState(z);
      document.documentElement.style.setProperty('--dizi-zoom', String(z));
    },
    [setZoomState],
  );

  useEffect(() => {
    document.documentElement.dataset.density = density;
    document.documentElement.dataset.sidebar = sidebarMode;
    document.documentElement.lang = locale;
    document.documentElement.style.fontSize = `${14 * textScale}px`;
    document.documentElement.style.setProperty('--dizi-zoom', String(zoom));
  }, [density, sidebarMode, locale, textScale, zoom]);

  const toggleSidebar = useCallback(() => {
    applySidebar(sidebarMode === 'full' ? 'half' : 'full');
  }, [sidebarMode, applySidebar]);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => setFullscreen(false));
    } else {
      document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => setFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enqueueOperation = useCallback(
    (write: Omit<Operation, 'id' | 'nodeId' | 'seq' | 'queuedAt'>) => {
      setOutbox((current) => {
        const next = enqueue(current, write);
        setQueued(next.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
        setSync(cloud.reachable ? 'syncing' : 'queued');
        return next;
      });
    },
    [cloud],
  );

  const drainNow = useCallback(() => {
    let summary = syncSummary(outbox);
    setOutbox((current) => {
      const next = drain(current, cloud, clockRef.current.tick(1));
      summary = syncSummary(next);
      setQueued(next.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
      setSync(summary.conflictsOpen > 0 ? 'conflict' : next.pending.length > 0 ? 'queued' : 'live');
      return next;
    });
    return summary;
  }, [cloud, outbox]);

  const resolveSyncConflict = useCallback(
    (conflictId: string, choice: NonNullable<Conflict['resolution']>) => {
      setOutbox((current) => {
        const next = resolveConflict(current, conflictId, choice, cloud);
        setQueued(next.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
        setSync(syncSummary(next).conflictsOpen > 0 ? 'conflict' : 'live');
        return next;
      });
    },
    [cloud],
  );

  const setUplink = useCallback(
    (reachable: boolean) => {
      cloud.reachable = reachable;
      setSync(reachable ? 'live' : 'queued');
    },
    [cloud],
  );

  const resetEngine = useCallback(() => {
    clockRef.current = new DrillClock(9 * 60 + 40);
    cloud.reachable = true;
    setOutbox(initialOutbox('edge-a'));
    setQueued([]);
    setSync('live');
  }, [cloud]);

  /** `queueWrite(label)` stays the simple call other screens already make: an audit write in the outbox. */
  const queueWrite = useCallback(
    (label: string) => {
      enqueueOperation({
        at: clockRef.current.tick(1),
        entity: 'audit',
        recordId: `audit-${label.slice(0, 12)}`,
        label,
        op: 'append',
        fields: { note: label },
        actor: 'Signed on this device',
        node: 'Main Campus',
      });
    },
    [enqueueOperation],
  );

  const flushQueue = useCallback(() => {
    drainNow();
  }, [drainNow]);

  const syncEngine = useMemo<SyncEngineHandle>(
    () => ({
      outbox,
      summary: syncSummary(outbox),
      cloud,
      enqueue: enqueueOperation,
      drainNow,
      resolve: resolveSyncConflict,
      setUplink,
      reset: resetEngine,
    }),
    [outbox, cloud, enqueueOperation, drainNow, resolveSyncConflict, setUplink, resetEngine],
  );

  const value = useMemo<ShellState>(
    () => ({
      density,
      setDensity: applyDensity,
      locale,
      setLocale: applyLocale,
      role,
      setRole: setRoleState,
      sync,
      setSync,
      siteMode,
      setSiteMode,
      queued,
      queueWrite,
      flushQueue,
      syncEngine,
      sidebarMode,
      setSidebarMode: applySidebar,
      toggleSidebar,
      mobileNavOpen,
      setMobileNavOpen,
      zoom,
      setZoom,
      textScale,
      setTextScale: applyTextScale,
      fullscreen,
      toggleFullscreen,
      version: APP_VERSION,
      buildStamp,
    }),
    [
      density, applyDensity, locale, applyLocale, role, setRoleState, sync, siteMode, queued, queueWrite, flushQueue,
      sidebarMode, applySidebar, toggleSidebar, mobileNavOpen, zoom, setZoom, textScale, applyTextScale, fullscreen,
      toggleFullscreen, buildStamp, queued, queueWrite, flushQueue, syncEngine,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside ShellProvider');
  return ctx;
}
