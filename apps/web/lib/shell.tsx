'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SyncState } from '@dizi/ui';
import { usePersistentState } from '@dizi/ui';
import {
  DrillClock,
  OUTBOX_STORAGE_KEY,
  SimulatedCloud,
  capabilityOf,
  drain,
  enqueue,
  enqueueContractOperation,
  initialOutbox,
  rehydrateOutbox,
  requeueRefused,
  resolveConflict,
  serialiseOutbox,
  syncSummary,
  type Conflict,
  type Operation,
  type OutboxState,
  type QueueOutcome,
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
  /**
   * Queue a write named by its operation in the platform API contract (P0-306).
   *
   * The answer is synchronous and comes from the contract, not from the queue: an operation the contract marks
   * `online-only` is refused here and now, with the sentence the desk is shown, so a screen can grey the action
   * out before anyone taps it. `enqueue` above stays for the screens that have not been moved over.
   */
  queueOperation: (
    operationId: string,
    write: { at: string; recordId: string; label: string; fields?: Record<string, string | number | null>; actor: string; node: string },
  ) => QueueOutcome;
  /** What the contract says about an operation, for a screen that is about to offer it. */
  capabilityOf: typeof capabilityOf;
  /** Set when the saved queue could not be read back exactly (P0-306) — the console shows it rather than hiding it. */
  storageNote: string | null;
  /** Drain the queue and report what happened. */
  drainNow: () => ReturnType<typeof syncSummary>;
  resolve: (conflictId: string, choice: NonNullable<Conflict['resolution']>) => void;
  setUplink: (reachable: boolean) => void;
  /** Send a refused write again, as a new operation. Returns why not when the contract says it cannot be queued. */
  retry: (refusedId: string) => { requeued: boolean; because?: string };
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
  /**
   * Record a desk action in the outbox.
   *
   * Every queued write names the contract operation it replays as, because a write with no operation is a write a
   * drain cannot send. `byOperation` names a real domain write — an invoice raised, a payment taken, a dose signed
   * — and when it is left out the write is recorded as what it is: an audit entry (`appendAuditEntry`), which the
   * contract declares queueable and audited. If the contract refuses the named operation the desk is told, in the
   * contract's words, and the action still lands in the ledger rather than vanishing.
   */
  queueWrite: (
    label: string,
    byOperation?: { id: string; recordId: string; fields?: Record<string, string | number | null> },
  ) => QueueOutcome;
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
  const [storageNote, setStorageNote] = useState<string | null>(null);
  /**
   * P0-306: the outbox is read back from the device before anything is written to it. The ref matters — without
   * it the persist effect below would run on the first paint with the empty initial state and wipe the saved
   * queue before the rehydrate effect had a chance to read it, which is the bug that makes a queue look like it
   * survived and then quietly not.
   */
  const rehydratedRef = useRef(false);

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

  /* ---- the queue survives a reload (P0-306) ----------------------------------------------------
   * Two effects, in this order: read the device's saved queue once, then keep the device's copy in step with it.
   * `localStorage` is read inside an effect rather than during render because the server has no storage — reading
   * it while rendering is how a page that renders on the server and hydrates in the browser ends up with two
   * different first paints. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    } catch {
      // A browser with storage disabled (private mode, an embedded frame): the console works, it just forgets.
      setStorageNote('This browser will not let the app save the queue, so a reload will lose anything still waiting to sync.');
      rehydratedRef.current = true;
      return;
    }
    const { state, note } = rehydrateOutbox(raw, 'edge-a');
    rehydratedRef.current = true;
    if (note) setStorageNote(note);
    if (raw) {
      setOutbox(state);
      setQueued(state.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
      setSync(state.pending.length > 0 ? 'queued' : 'live');
    }
  }, []);

  useEffect(() => {
    if (!rehydratedRef.current || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(OUTBOX_STORAGE_KEY, serialiseOutbox(outbox));
    } catch {
      // Storage full or refused: the queue in memory is still the truth for this session.
    }
  }, [outbox]);

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

  /**
   * P0-306's entry point: the contract answers first, and only then does anything reach the queue. Nothing is
   * written into a screen's own idea of the rules — `capabilityOf` is the same metadata the API service is built
   * from, so a screen that greys out an action and the API that later refuses it are reading one list.
   */
  const queueOperation = useCallback<SyncEngineHandle['queueOperation']>(
    (operationId, write) => {
      const capability = capabilityOf(operationId);
      if (!capability) {
        return {
          queued: false,
          operationId,
          because: `${operationId} is not an operation in the platform API contract, so there is nothing for a replay to send. The write was not queued.`,
        };
      }
      if (capability.needsNetwork) {
        return {
          queued: false,
          operationId,
          because: capability.because ?? `${operationId} has to reach the cloud tier, so it cannot be queued offline.`,
        };
      }
      // The clock is read here, outside the state updater: an updater may be called twice by React, and a
      // simulation clock that ticks twice for one write is a subtle lie about when the ward wrote it.
      const at = clockRef.current.tick(1);
      let outcome: QueueOutcome = { queued: false, operationId, because: 'The write was not queued.' };
      setOutbox((current) => {
        const result = enqueueContractOperation(current, operationId, { ...write, at });
        outcome = result.outcome;
        if (!result.outcome.queued) return current;
        setQueued(result.state.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
        setSync(cloud.reachable ? 'syncing' : 'queued');
        return result.state;
      });
      return outcome;
    },
    [cloud],
  );

  /**
   * The call every screen already makes, now operation-aware.
   *
   * A screen that names `byOperation` is asking the contract about a real domain write; a screen that does not is
   * recording a desk action, and the honest name for that is an audit entry. Either way the write leaves with a
   * contract operation attached, so the queue never contains something a drain cannot send.
   */
  const queueWrite = useCallback<ShellState['queueWrite']>(
    (label, byOperation) => {
      if (byOperation) {
        const outcome = queueOperation(byOperation.id, {
          at: clockRef.current.tick(1),
          recordId: byOperation.recordId,
          label,
          ...(byOperation.fields ? { fields: byOperation.fields } : {}),
          actor: 'Signed on this device',
          node: 'Main Campus',
        });
        if (outcome.queued) return outcome;
        // The contract would not take the named write. Say so, and still record what the desk did — as a ledger
        // entry, which is what it is once the domain write has not happened.
        const ledger = queueOperation('appendAuditEntry', {
          at: clockRef.current.tick(1),
          recordId: byOperation.recordId,
          label: `${label} — the platform API could not be asked to ${byOperation.id}: ${outcome.because}`,
          fields: { note: label, refusedOperation: byOperation.id },
          actor: 'Signed on this device',
          node: 'Main Campus',
        });
        return ledger.queued ? ledger : outcome;
      }
      return queueOperation('appendAuditEntry', {
        at: clockRef.current.tick(1),
        recordId: `audit-${label.slice(0, 12)}`,
        label,
        fields: { note: label },
        actor: 'Signed on this device',
        node: 'Main Campus',
      });
    },
    [queueOperation],
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

  const retryRefusedOperation = useCallback<SyncEngineHandle['retry']>(
    (refusedId) => {
      let answer: { requeued: boolean; because?: string } = { requeued: false, because: 'That refusal is no longer in the history.' };
      setOutbox((current) => {
        const result = requeueRefused(current, refusedId);
        if (!result.operation) {
          answer = { requeued: false, ...(result.because ? { because: result.because } : {}) };
          return current;
        }
        answer = { requeued: true };
        setQueued(result.state.pending.map((op) => ({ id: op.id, label: op.label, at: op.at.slice(11) })));
        setSync(cloud.reachable ? 'syncing' : 'queued');
        return result.state;
      });
      return answer;
    },
    [cloud],
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
      queueOperation,
      capabilityOf,
      storageNote,
      drainNow,
      resolve: resolveSyncConflict,
      setUplink,
      retry: retryRefusedOperation,
      reset: resetEngine,
    }),
    [outbox, cloud, enqueueOperation, queueOperation, queueWrite, storageNote, retryRefusedOperation, drainNow, resolveSyncConflict, setUplink, resetEngine],
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
