'use client';

import { cx } from './cx';
import { Menu, type MenuItem } from './Menu';

/* ------------------------------------------------------------------------------ Board
 * Swimlane board for queues, bed states and OT lists. Drag-and-drop is deliberately absent (plan 02 §5 #11):
 * moving a patient between states is a clinical action and deserves a labelled, confirmable target — a menu
 * that any keyboard or touch user can operate, not a drag gesture some users cannot perform.
 */
export interface BoardColumn {
  id: string;
  title: string;
  tone?: 'neutral' | 'info' | 'warning' | 'success' | 'critical';
  hint?: string;
}

export interface BoardCard {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string[];
  /** Rendered as a strip on the card, e.g. priority. */
  badge?: { label: string; tone: 'neutral' | 'info' | 'warning' | 'critical' | 'success' };
  /** Columns this card can move to, with the label of the action that moves it. */
  transitions?: Array<{ to: string; label: string; danger?: boolean }>;
  onOpen?: () => void;
}

export interface BoardProps {
  columns: BoardColumn[];
  cards: BoardCard[];
  columnOf: (card: BoardCard) => string;
  onTransition?: (cardId: string, toColumnId: string) => void;
  emptyLabel?: string;
  className?: string;
}

const toneStrip: Record<NonNullable<BoardColumn['tone']>, string> = {
  neutral: 'bg-border-default',
  info: 'bg-safety-info',
  warning: 'bg-safety-warning',
  success: 'bg-safety-success',
  critical: 'bg-safety-critical',
};

const badgeTone: Record<NonNullable<BoardCard['badge']>['tone'], string> = {
  neutral: 'bg-surface-sunken text-text-secondary',
  info: 'bg-safety-info/10 text-safety-info',
  warning: 'bg-safety-warning/10 text-safety-warning',
  critical: 'bg-safety-critical/10 text-safety-critical',
  success: 'bg-safety-success/10 text-safety-success',
};

export function Board({ columns, cards, columnOf, onTransition, emptyLabel = 'Nothing here', className }: BoardProps) {
  return (
    <div className={cx('flex gap-3 overflow-x-auto pb-2', className)} role="list" aria-label="Board">
      {columns.map((col) => {
        const items = cards.filter((c) => columnOf(c) === col.id);
        return (
          <section
            key={col.id}
            role="listitem"
            aria-label={`${col.title} (${items.length})`}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-border-subtle bg-surface-default"
          >
            <header className="border-b border-border-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <span aria-hidden className={cx('size-2.5 rounded-full', toneStrip[col.tone ?? 'neutral'])} />
                <h3 className="text-sm font-semibold text-text-primary">{col.title}</h3>
                <span className="ml-auto rounded-full bg-surface-sunken px-2 font-numeric text-xs text-text-secondary">{items.length}</span>
              </div>
              {col.hint && <p className="mt-0.5 text-xs text-text-tertiary">{col.hint}</p>}
            </header>

            <ul className="flex min-h-24 flex-col gap-2 p-2">
              {items.length === 0 && <li className="px-2 py-6 text-center text-xs text-text-tertiary">{emptyLabel}</li>}
              {items.map((card) => {
                const transitions: MenuItem[] = (card.transitions ?? []).map((t) => ({
                  label: t.label,
                  danger: t.danger,
                  onSelect: () => onTransition?.(card.id, t.to),
                }));
                return (
                  <li key={card.id} className="rounded-md border border-border-subtle bg-surface-raised p-2.5 shadow-sm">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={card.onOpen}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`Open ${card.title}`}
                      >
                        <p className="truncate text-base font-medium text-text-primary">{card.title}</p>
                        {card.subtitle && <p className="truncate text-xs text-text-secondary">{card.subtitle}</p>}
                        {card.meta && card.meta.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-x-2 font-numeric text-[11px] text-text-tertiary">
                            {card.meta.map((m) => (
                              <span key={m}>{m}</span>
                            ))}
                          </p>
                        )}
                        {card.badge && (
                          <span className={cx('mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', badgeTone[card.badge.tone])}>
                            {card.badge.label}
                          </span>
                        )}
                      </button>

                      {transitions.length > 0 && (
                        <Menu
                          label={`Move ${card.title}`}
                          align="right"
                          trigger={({ toggle, ref, open }) => (
                            <button
                              ref={ref}
                              type="button"
                              onClick={toggle}
                              aria-expanded={open}
                              aria-haspopup="menu"
                              aria-label={`Move ${card.title}`}
                              className="inline-grid size-7 place-items-center rounded-md text-text-tertiary hover:bg-surface-sunken"
                            >
                              <span aria-hidden className="text-lg leading-none">⋯</span>
                            </button>
                          )}
                          items={transitions}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
