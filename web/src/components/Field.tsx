import { createContext, useContext, useId, type ReactNode } from 'react';

import { cx } from './cx';

export type FieldContextValue = {
  /** The control's id (the label's `for`). */
  id: string;
  /** The rendered hint and error ids, in that order. */
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding `Field`'s wiring, or `null`: for custom controls (e.g. two inputs in one box). */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Resolves a control's id, `invalid` and `aria-describedby` against the surrounding `Field`: the
 * context id wins, `invalid` is either, and the context ids come before the control's own.
 */
export function useFieldControl(own: { id?: string; invalid?: boolean; describedBy?: string }): {
  id: string | undefined;
  invalid: boolean;
  describedBy: string | undefined;
} {
  const field = useField();
  const describedBy = [field?.describedBy, own.describedBy].filter(Boolean).join(' ');
  return {
    id: field?.id ?? own.id,
    invalid: (own.invalid ?? false) || (field?.invalid ?? false),
    describedBy: describedBy === '' ? undefined : describedBy,
  };
}

export type FieldProps = {
  label: string;
  hint?: string;
  /** "What happened. What to do." Its presence makes the control invalid. */
  error?: string;
  /** The control's id; generated when absent. */
  id?: string;
  /** Keeps the label for assistive tech only. */
  labelHidden?: boolean;
  /** Layout only. */
  className?: string;
  /** One control (`TextInput`, `Textarea`, `Select`, or a custom one using `useField()`). */
  children: ReactNode;
};

/** A label, a control, a hint and an error, wired by ids. */
export function Field({
  label,
  hint,
  error,
  id,
  labelHidden = false,
  className,
  children,
}: FieldProps) {
  const base = useId();
  const controlId = id ?? `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const ids = [hint !== undefined && hintId, error !== undefined && errorId].filter(Boolean);
  const value: FieldContextValue = {
    id: controlId,
    describedBy: ids.length > 0 ? ids.join(' ') : undefined,
    invalid: error !== undefined,
  };
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className={labelHidden ? 'sr-only' : 'text-label text-ink'}>
        {label}
      </label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {hint !== undefined && (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
