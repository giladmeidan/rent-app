import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router';

import {
  buttonClasses,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from './Button.classes';
import { cx } from './cx';

export { buttonClasses };
export type { ButtonShape, ButtonSize, ButtonVariant };

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** A leading node, hidden from assistive tech. */
  icon?: ReactNode;
  /** A trailing node (a chevron), hidden from assistive tech; the label then sits at the start
   * and the node at the end (`justify-between`). */
  end?: ReactNode;
  /** Layout only (margins, placement, width); never colour, size or padding. */
  className?: string;
};

/** Without children, the button is icon-only and must be named by `aria-label`. */
type Labelled =
  { children: ReactNode; 'aria-label'?: string } | { children?: undefined; 'aria-label': string };

export type ButtonAsButton = CommonProps &
  Labelled &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'className'> & {
    to?: undefined;
    /** Busy: `aria-busy` + `aria-disabled`, still focusable; clicks (and so submits) are blocked. */
    busy?: boolean;
  };

export type ButtonAsLink = CommonProps &
  Labelled &
  Omit<LinkProps, 'children' | 'aria-label' | 'className'> & {
    to: LinkProps['to'];
    busy?: never;
    disabled?: never;
    type?: never;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const present = (node: ReactNode) => node !== undefined && node !== null;

function content(icon: ReactNode, children: ReactNode, end: ReactNode) {
  const lead = (
    <>
      {present(icon) && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {children}
    </>
  );
  if (!present(end)) return lead;
  return (
    <>
      <span className="inline-flex items-center gap-2">{lead}</span>
      <span aria-hidden="true" className="inline-flex shrink-0">
        {end}
      </span>
    </>
  );
}

/**
 * The kit's button: a native `<button type="button">`, or a router `Link` when given `to`.
 * Variants `primary` (ink), `secondary`, `soft`, `ghost`, `danger`; sizes `sm` / `md` (44px) /
 * `lg` (52px); every variant carries the accent focus ring.
 */
export const Button = forwardRef(function Button(
  props: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement | HTMLAnchorElement>,
) {
  if (props.to !== undefined) {
    const { variant, size, shape, fullWidth, icon, end, className, children, ...rest } = props;
    const classes = buttonClasses({
      variant,
      size,
      shape,
      fullWidth,
      iconOnly: children == null,
      between: present(end),
    });
    return (
      <Link
        ref={ref as ForwardedRef<HTMLAnchorElement>}
        {...rest}
        className={cx(classes, className)}
      >
        {content(icon, children, end)}
      </Link>
    );
  }
  const {
    variant,
    size,
    shape,
    fullWidth,
    icon,
    end,
    className,
    children,
    busy = false,
    type = 'button',
    onClick,
    ...rest
  } = props;
  const classes = buttonClasses({
    variant,
    size,
    shape,
    fullWidth,
    iconOnly: children == null,
    between: present(end),
  });
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      // Stays enabled and focusable (focus is never dropped), but neither clicks nor submits.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      ref={ref as ForwardedRef<HTMLButtonElement>}
      type={type}
      {...rest}
      aria-busy={busy ? true : rest['aria-busy']}
      aria-disabled={busy ? true : rest['aria-disabled']}
      onClick={handleClick}
      className={cx(classes, className)}
    >
      {content(icon, children, end)}
    </button>
  );
});
