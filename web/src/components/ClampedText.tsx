import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { cx } from './cx';

export type ClampedTextProps = {
  /** How many lines show while collapsed. */
  lines: 2 | 4;
  /** The paragraph's id: the toggle's `aria-controls`. */
  id: string;
  /** The id of the element that names what this text is about (the toggle's description). */
  describedBy?: string;
  /** Goes on the `<p>`: `dir`, `data-testid` and its look. */
  textProps?: HTMLAttributes<HTMLParagraphElement> & { 'data-testid'?: string };
  /** Text only: it is rendered as a React child, never as HTML. */
  children: string;
};

// A literal map, so Tailwind sees both classes.
const CLAMP = { 2: 'line-clamp-2', 4: 'line-clamp-4' } as const;

/**
 * A paragraph clamped to `lines` lines, with a "הצגת עוד" / "הצגת פחות" toggle shown only when the
 * text is cut. The clamp is visual: the whole text is in the DOM, so a screen reader reads all of
 * it either way. The toggle re-measures on layout, when the element resizes and when the text
 * changes; it measures only while clamped (an expanded paragraph never overflows).
 */
export function ClampedText({ lines, id, describedBy, textProps, children }: ClampedTextProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (element === null || expanded) return;
    setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [expanded]);

  useLayoutEffect(measure, [measure, children]);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        {...textProps}
        ref={ref}
        id={id}
        className={cx(textProps?.className, !expanded && CLAMP[lines])}
      >
        {children}
      </p>
      {(overflows || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={id}
          aria-describedby={describedBy}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t('common.showLess') : t('common.showMore')}
        </Button>
      )}
    </div>
  );
}
