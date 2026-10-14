'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

/* --------------------------------------------------------------------------- AppSlider
 * The big desktop slider: a wide, auto-advancing panel used for announcements, module rollout status and
 * KPI spotlights. On mobile it collapses to a single swipeable card.
 *
 * Behaviour worth keeping honest about:
 *  - autoplay pauses on hover, on focus and when the tab is hidden;
 *  - it never moves for a user who asked for reduced motion (they can still navigate manually);
 *  - arrows, dots, ← / → and swipe all do the same thing, and the region is a labelled carousel.
 */
export interface Slide {
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  tone?: 'brand' | 'info' | 'warning' | 'success';
  action?: { label: string; href: string };
}

const toneStyles: Record<NonNullable<Slide['tone']>, string> = {
  brand: 'from-brand-600 to-brand-900 text-text-inverse',
  info: 'from-[color-mix(in_srgb,var(--dizi-color-safety-info)_88%,black)] to-[color-mix(in_srgb,var(--dizi-color-safety-info)_55%,black)] text-text-inverse',
  warning: 'from-[color-mix(in_srgb,var(--dizi-color-safety-warning)_92%,black)] to-[color-mix(in_srgb,var(--dizi-color-safety-warning)_58%,black)] text-text-inverse',
  success: 'from-[color-mix(in_srgb,var(--dizi-color-safety-success)_90%,black)] to-[color-mix(in_srgb,var(--dizi-color-safety-success)_55%,black)] text-text-inverse',
};

export function AppSlider({
  slides,
  autoplayMs = 7000,
  className,
}: {
  slides: Slide[];
  autoplayMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const touchStart = useRef<number | null>(null);
  const count = slides.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const update = () => setReduced(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (paused || reduced || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), autoplayMs);
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [paused, reduced, count, autoplayMs]);

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Highlights"
      className={cx('relative overflow-hidden rounded-lg border border-border-subtle', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          go(index + 1);
          setPaused(true);
        }
        if (e.key === 'ArrowLeft') {
          go(index - 1);
          setPaused(true);
        }
      }}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStart.current === null) return;
        const delta = e.changedTouches[0].clientX - touchStart.current;
        if (Math.abs(delta) > 48) go(index + (delta < 0 ? 1 : -1));
        touchStart.current = null;
      }}
      tabIndex={0}
    >
      <div className={cx('bg-gradient-to-br px-4 py-5 sm:px-8 sm:py-7', toneStyles[slides[index].tone ?? 'brand'])}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {slides[index].eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{slides[index].eyebrow}</p>
            )}
            <h2 className="mt-1 text-xl font-semibold sm:text-2xl">{slides[index].title}</h2>
            <p className="mt-1 max-w-3xl text-sm opacity-90 sm:text-base">{slides[index].description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {slides[index].action && (
              <a
                href={slides[index].action!.href}
                className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-white/25"
              >
                {slides[index].action!.label}
              </a>
            )}
            <div className="hidden gap-1 sm:flex">
              <button
                type="button"
                aria-label="Previous highlight"
                onClick={() => go(index - 1)}
                className="grid size-9 place-items-center rounded-md bg-white/15 hover:bg-white/25"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next highlight"
                onClick={() => go(index + 1)}
                className="grid size-9 place-items-center rounded-md bg-white/15 hover:bg-white/25"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between bg-surface-raised px-4 py-2">
        <div className="flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Show highlight ${i + 1}: ${s.title}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={cx('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-brand-500' : 'w-2.5 bg-border-default hover:bg-border-subtle')}
            />
          ))}
        </div>
        <p className="font-numeric text-xs text-text-tertiary">
          {index + 1}/{count}
          {reduced && ' · autoplay off (reduced motion)'}
        </p>
      </div>
    </section>
  );
}
