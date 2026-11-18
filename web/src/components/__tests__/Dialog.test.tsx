import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { Dialog, useConfirm, type ConfirmFn, type ConfirmOptions } from '../Dialog';
import { GHOST_CLICK_MS, GHOST_CLICK_RADIUS_PX } from '../ghostClick';

const TITLE = he.flatmates.mine.leaveConfirm;
const BODY = he.listings.edit.expiredBody;

afterEach(() => {
  vi.restoreAllMocks();
});

/** An opener button that toggles a Dialog, as a page would. */
function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {he.flatmates.mine.leave}
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title={TITLE}
        description={BODY}
        actions={<button type="button">{he.common.cancel}</button>}
      >
        <input aria-label={he.listings.fields.city} />
      </Dialog>
    </>
  );
}

const confirms: ConfirmFn[] = [];

function ConfirmHarness({ options }: { options: ConfirmOptions }) {
  const [confirm, dialog] = useConfirm();
  const [, force] = useState(0);
  confirms.push(confirm);
  return (
    <>
      <button type="button" onClick={() => force((n) => n + 1)}>
        {he.common.retry}
      </button>
      <button
        type="button"
        onClick={() => {
          void confirm(options).then((value) => results.push(value));
        }}
      >
        {he.flatmates.mine.leave}
      </button>
      {dialog}
    </>
  );
}

let results: boolean[] = [];

const dialogEl = () => document.querySelector('dialog') as HTMLDialogElement;
const opener = () => screen.getByRole('button', { name: he.flatmates.mine.leave });
const flush = () => act(async () => {});
/** Focuses the opener (a click alone does not in jsdom), then clicks it. */
const open = () => {
  opener().focus();
  fireEvent.click(opener());
};

describe('Dialog', () => {
  it('ac19_sheet_size', () => {
    const onClose = vi.fn();
    const sheet = render(
      <Dialog open onClose={onClose} title={TITLE} size="sheet" closeLabel={he.search.closeFilters}>
        <input aria-label={he.listings.fields.city} />
      </Dialog>,
    );
    const dialog = dialogEl();
    // It overrides the browser's modal margin and maximum sizes, and scrolls by itself.
    expect(dialog).toHaveClass(
      'm-0',
      'h-dvh',
      'max-h-none',
      'w-full',
      'max-w-none',
      'rounded-none',
      'border-0',
      'overflow-y-auto',
      'overscroll-contain',
      'scroll-pb-[5.5rem]',
    );
    expect(dialog).not.toHaveClass('max-w-dialog');
    expect(dialog).not.toHaveClass('rounded-lg');
    expect(dialog).not.toHaveClass('border');
    expect(dialog.firstElementChild).toHaveClass('min-h-full');

    // The X is named and is the first thing `showModal` can focus.
    const close = screen.getByRole('button', { name: he.search.closeFilters });
    expect(dialog.querySelector('button, input, select, textarea, a[href]')).toBe(close);

    // A backdrop press does nothing; the X closes.
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    sheet.unmount();

    // The other sizes render as before, with no X and a working backdrop.
    for (const [size, width] of [
      ['default', 'max-w-dialog'],
      ['wide', 'max-w-dialog-wide'],
    ] as const) {
      const other = render(<Dialog open onClose={onClose} title={TITLE} size={size} />);
      const element = dialogEl();
      expect(element).toHaveClass(width, 'w-full', 'rounded-lg', 'border', 'border-border', 'p-0');
      expect(element).not.toHaveClass('h-dvh');
      expect(element.firstElementChild).not.toHaveClass('min-h-full');
      expect(element.querySelector('button')).toBeNull();
      onClose.mockClear();
      fireEvent.pointerDown(element);
      fireEvent.click(element);
      expect(onClose).toHaveBeenCalledTimes(1);
      other.unmount();
    }
  });

  describe('ac19_sheet_swallows_the_second_tap', () => {
    const AT = { detail: 1, clientX: 100, clientY: 700 };
    const behind = vi.fn();

    function Page({ size = 'sheet' }: { size?: 'sheet' | 'default' }) {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={behind}>
            {he.common.retry}
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title={TITLE} size={size}>
            <button type="button" onClick={() => setOpen(false)}>
              {he.common.confirm}
            </button>
            <input aria-label={he.listings.fields.city} />
          </Dialog>
        </>
      );
    }
    const page = () => screen.getByRole('button', { name: he.common.retry, hidden: true });
    const inside = () => screen.getByRole('button', { name: he.common.confirm });
    const wait = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      behind.mockClear();
    });
    afterEach(() => {
      wait(GHOST_CLICK_MS);
      vi.useRealTimers();
    });

    it('drops_one_tap_at_the_same_place', () => {
      render(<Page />);
      fireEvent.click(inside(), AT);
      // Near the first tap, not exactly on it.
      fireEvent.click(page(), { ...AT, clientX: AT.clientX + GHOST_CLICK_RADIUS_PX - 1 });
      expect(behind).not.toHaveBeenCalled();
      fireEvent.click(page(), AT);
      expect(behind).toHaveBeenCalledTimes(1);
    });

    it('lets_a_click_elsewhere_through', () => {
      render(<Page />);
      fireEvent.click(inside(), AT);
      fireEvent.click(page(), { ...AT, clientY: AT.clientY - GHOST_CLICK_RADIUS_PX - 1 });
      expect(behind).toHaveBeenCalledTimes(1);
      // It disarmed nothing: the double tap's second tap is still dropped.
      fireEvent.click(page(), AT);
      expect(behind).toHaveBeenCalledTimes(1);
    });

    it('ends_after_the_moment_has_passed', () => {
      render(<Page />);
      fireEvent.click(inside(), AT);
      wait(GHOST_CLICK_MS);
      fireEvent.click(page(), AT);
      expect(behind).toHaveBeenCalledTimes(1);
    });

    it('is_not_armed_by_a_keyboard_press', () => {
      render(<Page />);
      fireEvent.click(inside());
      fireEvent.click(page(), { ...AT, clientX: 0, clientY: 0 });
      expect(behind).toHaveBeenCalledTimes(1);
    });

    it('is_not_armed_by_esc_after_an_earlier_press', () => {
      render(<Page />);
      fireEvent.click(screen.getByRole('textbox'), AT);
      wait(0);
      act(() => {
        dialogEl().dispatchEvent(new Event('cancel', { cancelable: true }));
      });
      expect(dialogEl()).not.toHaveAttribute('open');
      fireEvent.click(page(), AT);
      expect(behind).toHaveBeenCalledTimes(1);
    });

    it('never_guards_other_dialogs', () => {
      render(<Page size="default" />);
      fireEvent.click(inside(), AT);
      fireEvent.click(page(), AT);
      expect(behind).toHaveBeenCalledTimes(1);
    });
  });

  it('ac7_dialog_and_confirm', async () => {
    // ---- Dialog ----
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const onClose = vi.fn();
    const first = render(<DialogHarness onClose={onClose} />);
    const dialog = dialogEl();
    expect(dialog).not.toHaveAttribute('open');
    expect(dialog).toHaveClass('max-w-dialog', 'rounded-lg', 'border', 'border-border', 'p-0');
    expect(dialog.className).not.toMatch(/(^|\s)shadow/);

    // `open` calls showModal; the dialog is named by its title and described by its body.
    open();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute('open');
    const named = screen.getByRole('dialog', { name: TITLE });
    expect(named).toBe(dialog);
    expect(named).toHaveAccessibleDescription(BODY);
    expect(screen.getByRole('heading', { level: 2, name: TITLE })).toHaveClass('text-h3');
    expect(screen.getByRole('button', { name: he.common.cancel }).parentElement).toHaveClass(
      'justify-end',
    );

    // cancel (Esc) is prevented and calls onClose; focus returns to the opener.
    screen.getByRole('textbox').focus();
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveAttribute('open');
    expect(opener()).toHaveFocus();

    // A `close` from outside while `open` is still true calls onClose.
    open();
    act(() => {
      dialog.close();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(opener()).toHaveFocus();

    // pointerdown + click on the dialog (the backdrop) close it.
    open();
    expect(dialog).toHaveAttribute('open');
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(dialog).not.toHaveAttribute('open');

    // A press that starts inside the panel and ends on the dialog does not; nor a click alone.
    open();
    fireEvent.pointerDown(screen.getByRole('textbox'));
    fireEvent.click(dialog);
    fireEvent.click(dialog);
    fireEvent.pointerDown(dialog);
    fireEvent.click(screen.getByRole('textbox'));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(dialog).toHaveAttribute('open');
    first.unmount();

    // StrictMode with `open` already true: showModal once; focus returns on close.
    showModal.mockClear();
    const external = document.createElement('button');
    document.body.append(external);
    external.focus();
    const strictClose = vi.fn();
    const strict = render(
      <StrictMode>
        <Dialog open onClose={strictClose} title={TITLE} />
      </StrictMode>,
    );
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialogEl()).toHaveAttribute('open');
    strict.rerender(
      <StrictMode>
        <Dialog open={false} onClose={strictClose} title={TITLE} />
      </StrictMode>,
    );
    expect(dialogEl()).not.toHaveAttribute('open');
    expect(external).toHaveFocus();
    // The parent closed it, so onClose is not called back.
    expect(strictClose).not.toHaveBeenCalled();
    expect(dialogEl()).not.toHaveAttribute('aria-describedby');
    strict.unmount();
    external.remove();

    // ---- useConfirm ----
    results = [];
    confirms.length = 0;
    const confirmUi = render(
      <ConfirmHarness options={{ title: TITLE, body: BODY, tone: 'primary' }} />,
    );

    // Title, body as the description, cancel focused and first, confirm by default.
    open();
    const box = screen.getByRole('dialog', { name: TITLE });
    expect(box).toHaveAccessibleDescription(BODY);
    const cancelButton = screen.getByRole('button', { name: he.common.cancel });
    const confirmButton = screen.getByRole('button', { name: he.common.confirm });
    expect(cancelButton).toHaveFocus();
    expect(
      cancelButton.compareDocumentPosition(confirmButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cancelButton).toHaveClass('border-border-strong', 'bg-surface');
    expect(confirmButton).toHaveClass('bg-ink', 'text-on-ink');

    // Confirm resolves true, and focus returns to the opener.
    fireEvent.click(confirmButton);
    await flush();
    expect(results).toEqual([true]);
    expect(box).not.toHaveAttribute('open');
    expect(opener()).toHaveFocus();

    // Cancel, Esc and the backdrop resolve false.
    open();
    fireEvent.click(screen.getByRole('button', { name: he.common.cancel }));
    await flush();
    open();
    act(() => {
      dialogEl().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await flush();
    open();
    fireEvent.pointerDown(dialogEl());
    fireEvent.click(dialogEl());
    await flush();
    expect(results).toEqual([true, false, false, false]);
    expect(dialogEl()).not.toHaveAttribute('open');

    // A second confirm() while one is open resolves the first with false.
    open();
    open();
    await flush();
    expect(results).toEqual([true, false, false, false, false]);
    expect(dialogEl()).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: he.common.confirm }));
    await flush();
    expect(results).toEqual([true, false, false, false, false, true]);

    // confirm keeps its identity across renders.
    fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
    expect(confirms.length).toBeGreaterThan(1);
    expect(new Set(confirms).size).toBe(1);

    // Unmounting while open resolves false.
    open();
    confirmUi.unmount();
    await flush();
    expect(results).toEqual([true, false, false, false, false, true, false]);

    // tone danger and custom labels.
    results = [];
    render(
      <ConfirmHarness
        options={{
          title: TITLE,
          confirmLabel: he.flatmates.mine.leave,
          cancelLabel: he.applications.form.cancel,
          tone: 'danger',
        }}
      />,
    );
    open();
    const danger = screen.getAllByRole('button', {
      name: he.flatmates.mine.leave,
    })[1] as HTMLElement;
    expect(dialogEl().contains(danger)).toBe(true);
    expect(danger).toHaveClass('bg-danger', 'text-on-ink');
    expect(dialogEl()).not.toHaveAttribute('aria-describedby');
    fireEvent.click(danger);
    await flush();
    expect(results).toEqual([true]);
  });

  it('ac7_dialog_focus_not_stolen_after_close', async () => {
    // Chrome's timing: close() returns at once and fires `close` a task later.
    const pending: HTMLDialogElement[] = [];
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      pending.push(this);
    });
    const fireLateClose = () =>
      act(() => {
        for (const el of pending.splice(0)) el.dispatchEvent(new Event('close'));
      });

    results = [];
    render(<ConfirmHarness options={{ title: TITLE, tone: 'danger' }} />);
    const other = screen.getByRole('button', { name: he.common.retry });

    // Confirm: focus is back on the opener synchronously, before the late `close`.
    open();
    fireEvent.click(screen.getByRole('button', { name: he.common.confirm }));
    await flush();
    expect(results).toEqual([true]);
    expect(dialogEl()).not.toHaveAttribute('open');
    expect(opener()).toHaveFocus();

    // The caller moves focus on; the late `close` leaves it there.
    other.focus();
    fireLateClose();
    expect(other).toHaveFocus();

    // A browser-initiated close while focus is still inside the dialog does return it.
    open();
    expect(screen.getByRole('button', { name: he.common.cancel })).toHaveFocus();
    act(() => {
      dialogEl().removeAttribute('open');
      dialogEl().dispatchEvent(new Event('close'));
    });
    await flush();
    expect(results).toEqual([true, false]);
    expect(opener()).toHaveFocus();
  });

  it('ac2_wide_size_uses_the_wide_width', () => {
    render(
      <>
        <Dialog open={false} onClose={() => {}} title="a" size="wide" />
        <Dialog open={false} onClose={() => {}} title="b" />
      </>,
    );
    const [wide, plain] = document.querySelectorAll('dialog') as unknown as [
      HTMLElement,
      HTMLElement,
    ];
    expect(wide).toHaveClass('max-w-dialog-wide', 'min-h-[min(36rem,calc(100dvh-3rem))]');
    expect(wide).not.toHaveClass('max-w-dialog');
    expect(plain).toHaveClass('max-w-dialog');
    expect(plain).not.toHaveClass('max-w-dialog-wide');
    expect(plain.className).not.toMatch(/min-h-/);
  });
});
