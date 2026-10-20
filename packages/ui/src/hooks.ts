'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** True on devices with a real pointer (mouse/trackpad). Tooltips are disabled everywhere else. */
export function useIsPointerFine(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return fine;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Persisted state. Reads lazily on the client so SSR markup still matches the first render. */
export function usePersistentState<T extends string | number | boolean | string[]>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable (private mode) — fall back to the initial value */
    }
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  return [value, update];
}

export function useOnClickOutside<T extends HTMLElement>(onOutside: () => void, active = true) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [onOutside, active]);
  return ref;
}

/** Global keyboard shortcuts. Ignores keystrokes typed into inputs unless `allowInInputs`. */
export function useHotkeys(
  bindings: Array<{ combo: string; handler: (e: KeyboardEvent) => void; allowInInputs?: boolean }>,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      for (const b of bindings) {
        const parts = b.combo.toLowerCase().split('+');
        const key = parts.at(-1)!;
        const needCtrl = parts.includes('ctrl') || parts.includes('mod');
        const needAlt = parts.includes('alt');
        const needShift = parts.includes('shift');
        const ctrlOk = needCtrl ? e.ctrlKey || e.metaKey : !(e.ctrlKey || e.metaKey);
        const altOk = needAlt === e.altKey;
        const shiftOk = needShift === e.shiftKey;
        const keyOk = e.key.toLowerCase() === key || e.code.toLowerCase() === `key${key}`;
        if (keyOk && ctrlOk && altOk && shiftOk && (!typing || b.allowInInputs)) {
          e.preventDefault();
          b.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings]);
}
