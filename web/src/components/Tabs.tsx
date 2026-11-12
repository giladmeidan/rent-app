import { useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { cx } from './cx';
import { focusRing } from './focusRing';

/** The id of the tab for `value` in the tablist that controls `panelId`. */
export function tabId(panelId: string, value: string): string {
  return `${panelId}-tab-${value}`;
}

export type TabItem<T extends string> = { value: T; label: ReactNode };

export type TabsProps<T extends string> = {
  /** The tablist's accessible name. */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The id of the one `TabPanel` the tabs control. */
  panelId: string;
  variant?: 'underline' | 'pill';
  /** The selected tab, e.g. to focus it. */
  tabRef?: Ref<HTMLButtonElement>;
  /** Layout only; goes on the tablist. */
  className?: string;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref !== null && ref !== undefined) (ref as { current: T | null }).current = node;
}

/**
 * ARIA tabs with automatic activation and a roving `tabIndex`. The arrows follow the reading
 * direction (in RTL, `ArrowLeft` is next) and wrap; `Home` / `End` go to the first / last tab.
 * Values are id-safe (`[A-Za-z0-9_-]`).
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  panelId,
  variant = 'underline',
  tabRef,
  className,
}: TabsProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const ltr = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'ltr';
    const count = items.length;
    let target: number;
    switch (event.key) {
      case 'ArrowLeft':
        target = ltr ? index - 1 : index + 1;
        break;
      case 'ArrowRight':
        target = ltr ? index + 1 : index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    target = (target + count) % count;
    const item = items[target];
    if (item === undefined || item.value === value) return;
    onChange(item.value);
    buttons.current[target]?.focus();
  };

  const pill = variant === 'pill';
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        pill
          ? 'inline-flex rounded-full bg-surface-subtle p-0.5'
          : 'flex flex-wrap gap-1 border-b border-border',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              buttons.current[index] = node;
              if (selected) assignRef(tabRef, node);
            }}
            type="button"
            role="tab"
            id={tabId(panelId, item.value)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              focusRing,
              pill
                ? 'min-h-tap rounded-full px-3.5 text-label'
                : 'min-h-tap border-b-2 px-4 text-label',
              pill &&
                (selected ? 'bg-surface text-ink font-semibold shadow-segment' : 'text-ink-muted'),
              !pill &&
                (selected
                  ? 'border-accent text-accent font-semibold'
                  : 'border-transparent text-ink-muted hover:text-ink'),
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export type TabPanelProps = {
  panelId: string;
  /** The selected tab's value; the panel is labelled by that tab. */
  value: string;
  /** Adds `tabIndex={0}`, for a panel with no focusable content. */
  focusable?: boolean;
  /** Layout only. */
  className?: string;
  children?: ReactNode;
};

/** The one panel a `Tabs` controls. */
export function TabPanel({
  panelId,
  value,
  focusable = false,
  className,
  children,
}: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId(panelId, value)}
      tabIndex={focusable ? 0 : undefined}
      className={className}
    >
      {children}
    </div>
  );
}
