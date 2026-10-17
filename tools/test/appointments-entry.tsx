/* Bundle entry for `npm run test:appointments`: the booking sheet, mounted in a window.
 *
 * The harness around this file drives the *real* component — the one the desk uses — with a source the harness
 * controls, so what is proved is the behaviour of the shipping sheet rather than a re-creation of it: that the slots
 * it offers come from the source, that a refused booking shows the service's sentence and the times it offered, and
 * that choosing one of those times completes the booking with the new day and minute.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ToastProvider } from '@dizi/ui';
import { BookingSheet } from '@/components/BookingSheet';
import type { SlotDayView } from '@/lib/appointments-api';
import type { BookingInput } from '@/lib/appointments-source';
import type { Appointment } from '@/lib/appointments';

export interface Handles {
  /** The rendered text, for asserting on sentences and button labels. */
  text: () => string;
  /** Click the first button whose text matches. */
  click: (label: string) => Promise<void>;
  /** What the sheet asked the source for, in order. */
  asked: Array<{ day: string; doctorId: string }>;
  /** What was submitted, in order. */
  submitted: BookingInput[];
  unmount: () => void;
}

export interface Options {
  day: string;
  preset?: { doctorId?: string; start?: number; patientMrn?: string };
  loadSlots: (day: string, doctorId: string) => Promise<SlotDayView>;
  onSubmit: (input: BookingInput) => Promise<Appointment>;
  note?: string;
}

export async function mount({ day, preset, loadSlots, onSubmit, note = 'test' }: Options, host: HTMLElement): Promise<{ handles: Handles; root: Root }> {
  const asked: Handles['asked'] = [];
  const submitted: Handles['submitted'] = [];
  const root = createRoot(host);
  let closed = false;

  /* The sheet is a portal into `document.body`, so the sheet's DOM is not under the host this root renders into:
     the harness reads the page, not the mount point. */
  const page = () => host.ownerDocument.body;
  const tick = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const render = async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <BookingSheet
            open={!closed}
            onClose={() => {
              closed = true;
            }}
            day={day}
            preset={preset}
            loadSlots={(d, doctorId) => {
              asked.push({ day: d, doctorId });
              return loadSlots(d, doctorId);
            }}
            onSubmit={async (input) => {
              submitted.push(input);
              return onSubmit(input);
            }}
            onBooked={() => undefined}
            note={note}
          />
        </ToastProvider>,
      );
    });

  };

  await render();

  const handles: Handles = {
    text: () => page().textContent ?? '',
    click: async (label: string) => {
      const found = Array.from(page().querySelectorAll('button'));
      const target = found.find((button) => (button.textContent ?? '').trim().includes(label));
      if (target === undefined) {
        throw new Error(`no button containing “${label}” — the sheet shows: ${found.map((b) => (b.textContent ?? '').trim()).join(' | ')}`);
      }
      await act(async () => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      /* Let the effect that reads the grid (or writes the booking) settle before the next click. */
      await tick();
    },
    asked,
    submitted,
    unmount: () => act(() => root.unmount()),
  };

  return { handles, root };
}

/** The button texts in render order — a small convenience for the harness's assertions. */
export function buttons(host: HTMLElement): string[] {
  return Array.from(host.ownerDocument.body.querySelectorAll('button')).map((button) => (button.textContent ?? '').trim());
}

/** Whether a button showing this slot label is disabled — how a taken slot must read. */
export function slotDisabled(host: HTMLElement, label: string): boolean {
  const button = Array.from(host.ownerDocument.body.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  return button === undefined ? true : (button as HTMLButtonElement).disabled;
}
