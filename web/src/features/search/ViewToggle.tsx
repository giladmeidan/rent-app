import { useEffect, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

export type View = 'list' | 'map';

type Props = {
  view: View;
  onChange: (view: View) => void;
  /** The "list" button, which takes focus after the map's "show the list" (spec 0009t). */
  listButtonRef?: Ref<HTMLButtonElement>;
};

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const option = `min-h-[44px] rounded-full px-[14px] text-[13px] ${focusRing}`;
const current = `${option} bg-surface font-bold text-ink shadow-segment`;
const other = `${option} bg-transparent font-semibold text-ink-muted`;

/** Search.dc.html's "list / map" segmented control. */
export function ViewToggle({ view, onChange, listButtonRef }: Props) {
  const { t } = useTranslation();
  // The view last asked for, not the render's `view`: the router applies a navigation in a
  // transition, so a double-click would see the old `view` twice and push two entries.
  const requested = useRef(view);
  useEffect(() => {
    requested.current = view;
  }, [view]);
  const button = (value: View, text: string) => (
    <button
      ref={value === 'list' ? listButtonRef : undefined}
      type="button"
      aria-pressed={view === value}
      onClick={() => {
        if (requested.current === value) return;
        requested.current = value;
        onChange(value);
      }}
      className={view === value ? current : other}
    >
      {text}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={t('search.view.label')}
      className="flex rounded-full bg-surface-subtle p-[3px]"
    >
      {button('list', t('search.view.list'))}
      {button('map', t('search.view.map'))}
    </div>
  );
}
