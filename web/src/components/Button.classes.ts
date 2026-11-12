import { cx } from './cx';
import { focusRing } from './focusRing';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'rounded' | 'pill';

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** No label: the button is square, and that replaces the size's padding. */
  iconOnly?: boolean;
};

const BASE =
  'inline-flex items-center justify-center gap-2 text-center transition-colors motion-reduce:transition-none disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  // Brand: primary buttons are ink.
  primary: 'bg-ink text-on-ink hover:bg-ink/85',
  secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-subtle',
  // A selected or pressed state.
  soft: 'border border-accent bg-accent-soft text-accent-strong',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft hover:text-accent-strong',
  danger: 'bg-danger text-on-ink hover:bg-danger/90',
};

const SIZES: Record<ButtonSize, { box: string; padding: string; square: string }> = {
  sm: { box: 'min-h-tap text-label', padding: 'px-3', square: 'px-0 w-tap' },
  md: { box: 'min-h-tap text-body font-medium', padding: 'px-4', square: 'px-0 w-tap' },
  lg: { box: 'min-h-13 text-body font-medium', padding: 'px-5', square: 'px-0 w-13' },
};

/** The classes a `Button` renders, for a control that must look like one. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  shape = 'rounded',
  fullWidth = false,
  iconOnly = false,
}: ButtonClassOptions = {}): string {
  const s = SIZES[size];
  return cx(
    BASE,
    VARIANTS[variant],
    focusRing,
    s.box,
    iconOnly ? s.square : s.padding,
    shape === 'pill' ? 'rounded-full' : 'rounded-md',
    fullWidth && 'w-full',
  );
}
