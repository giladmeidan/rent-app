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
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pointerDownOnDialog = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

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
    }
  }, [open, initialFocusRef]);

  const handleClose = () => {
    const target = opener.current;
    opener.current = null;
    if (target !== null && target.isConnected) target.focus();
    // Closed by something other than the parent (e.g. the browser's forced Esc close).
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
    if (fromBackdrop) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descriptionId : undefined}
      onClose={handleClose}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className="w-full max-w-dialog p-0 rounded-lg border border-border bg-surface text-ink backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-h3">
          {title}
        </h2>
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
