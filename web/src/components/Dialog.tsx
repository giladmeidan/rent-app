import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { cx } from './cx';
import { swallowGhostClick } from './ghostClick';

export type DialogProps = {
  open: boolean;
  /** Esc, the backdrop, or a `close` from outside while `open`: the parent sets `open` false. */
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** The buttons, aligned to the inline end. */
  actions?: ReactNode;
  /** Focused after opening; otherwise the browser focuses the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `wide` is wider and tall, for a calendar. `sheet` fills the screen, for a phone's long form;
   * a press outside its content does not close it. */
  size?: 'default' | 'wide' | 'sheet';
  /** Names an X button at the title's inline end, first in the tab order. */
  closeLabel?: string;
};

const SIZE = {
  default: 'w-full max-w-dialog rounded-lg border border-border',
  wide: 'w-full max-w-dialog-wide min-h-[min(36rem,calc(100dvh-3rem))] rounded-lg border border-border',
  // Overrides the browser's margin and maximum sizes for a modal.
  sheet:
    'm-0 h-dvh max-h-none w-full max-w-none scroll-pb-[5.5rem] overflow-y-auto overscroll-contain rounded-none border-0',
};

/**
 * A modal on the native `<dialog>` (`showModal()`: top layer, inert page, focus kept inside).
 * Safe under `<StrictMode>`: `open` is never passed to the DOM, and no effect cleanup closes it.
 * Focus returns to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  initialFocusRef,
  size = 'default',
  closeLabel,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pointerDownOnDialog = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  /** Focuses the opener (once) if it is still in the page. */
  const restoreFocus = () => {
    const target = opener.current;
    opener.current = null;
    if (target !== null && target.isConnected) target.focus();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && !dialog.contains(active) ? active : null;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      // Synchronously: the browser fires `close` a task later, after the caller (e.g. an awaited
      // `confirm()`) may already have moved focus on.
      restoreFocus();
      // A sheet covers the whole page, so a double tap's second tap would land on the page.
      if (size === 'sheet') swallowGhostClick();
    }
  }, [open, initialFocusRef, size]);

  const handleClose = () => {
    // Closed by the browser (a forced Esc close) or from outside: return focus only if it is
    // still lost (on body, or inside the closed dialog), never pulling it from where it moved.
    const active = document.activeElement;
    if (active === null || active === document.body || ref.current?.contains(active)) {
      restoreFocus();
    } else {
      opener.current = null;
    }
    if (open) onClose();
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  // The backdrop is the `<dialog>` itself (the panel fills it): close only when the press both
  // started and ended there, so a drag out of a text field never closes it.
  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pointerDownOnDialog.current = event.target === event.currentTarget;
  };
  const handleClick = (event: SyntheticEvent<HTMLDialogElement>) => {
    const fromBackdrop = pointerDownOnDialog.current && event.target === event.currentTarget;
    pointerDownOnDialog.current = false;
    if (fromBackdrop && size !== 'sheet') onClose();
  };

  const heading = (
    <h2 id={titleId} className="text-h3">
      {title}
    </h2>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descriptionId : undefined}
      onClose={handleClose}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`${SIZE[size]} p-0 bg-surface text-ink backdrop:bg-ink/40`}
    >
      <div className={cx('flex flex-col gap-4 p-6', size === 'sheet' && 'min-h-full')}>
        {closeLabel === undefined ? (
          heading
        ) : (
          <div className="flex items-center justify-between gap-2">
            {heading}
            <Button
              variant="secondary"
              size="sm"
              aria-label={closeLabel}
              onClick={onClose}
              className="shrink-0"
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              }
            />
          </div>
        )}
        {description !== undefined && (
          <p id={descriptionId} className="text-body text-ink-muted">
            {description}
          </p>
        )}
        {children}
        {actions !== undefined && actions !== null && (
          <div className="flex flex-wrap justify-end gap-2">{actions}</div>
        )}
      </div>
    </dialog>
  );
}

export type ConfirmOptions = {
  title: string;
  /** The dialog's description. */
  body?: string;
  /** Defaults to `common.confirm`. */
  confirmLabel?: string;
  /** Defaults to `common.cancel`. */
  cancelLabel?: string;
  tone: 'primary' | 'danger';
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/**
 * The drop-in for `window.confirm`: `[confirm, dialog]`; render `dialog` once. `confirm(options)`
 * resolves `true` on confirm and `false` on cancel, Esc, the backdrop, a second `confirm()` or an
 * unmount. It is async: a link guard must `preventDefault()` first and navigate after `true`.
 */
export function useConfirm(): [ConfirmFn, ReactNode] {
  const { t } = useTranslation();
  const [state, setState] = useState<{ open: boolean; options: ConfirmOptions } | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setState((current) => (current === null ? null : { ...current, open: false }));
    resolve?.(value);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setState({ open: true, options });
      }),
    [],
  );

  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const options = state?.options;
  const dialog = (
    <Dialog
      open={state?.open ?? false}
      onClose={() => settle(false)}
      title={options?.title ?? ''}
      description={options?.body}
      initialFocusRef={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>
            {options?.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={options?.tone ?? 'primary'} onClick={() => settle(true)}>
            {options?.confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    />
  );
  return [confirm, dialog];
}
