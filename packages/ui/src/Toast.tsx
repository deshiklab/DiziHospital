'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from './cx';

/* ----------------------------------------------------------------------------- Toasts
 * Feedback for actions that do not deserve a dialog (saved, printed, copied, exported). Tone is carried by
 * an icon and a text prefix as well as colour, and the live region is polite so screen readers are not shouted at.
 */
type Tone = 'success' | 'info' | 'warning' | 'critical';

interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: Tone;
  action?: { label: string; onSelect: () => void };
}

interface ToastContextValue {
  push: (t: Omit<Toast, 'id'> & { id?: string }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<Tone, React.ReactNode> = {
  success: <CircleCheck className="size-4 text-safety-success" aria-hidden />,
  info: <Info className="size-4 text-safety-info" aria-hidden />,
  warning: <TriangleAlert className="size-4 text-safety-warning" aria-hidden />,
  critical: <CircleAlert className="size-4 text-safety-critical" aria-hidden />,
};

const toneStyle: Record<Tone, string> = {
  success: 'border-l-safety-success',
  info: 'border-l-safety-info',
  warning: 'border-l-safety-warning',
  critical: 'border-l-safety-critical',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (t: Omit<Toast, 'id'> & { id?: string }) => {
      const id = t.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((list) => [...list.filter((x) => x.id !== id), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === 'critical' ? 12000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="no-print pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto flex items-start gap-2 rounded-md border border-border-subtle border-l-4 bg-surface-raised p-3 shadow-lg',
              toneStyle[t.tone],
            )}
          >
            <span className="mt-0.5">{toneIcon[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{t.title}</p>
              {t.description && <p className="text-xs text-text-secondary">{t.description}</p>}
              {t.action && (
                <button type="button" onClick={t.action.onSelect} className="mt-1 text-xs font-medium text-brand-600 hover:underline">
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="grid size-6 shrink-0 place-items-center rounded-sm text-text-tertiary hover:bg-surface-sunken"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
