import { useId } from 'react';

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * A native checkbox with `role="switch"` (keyboard and checked state come free) and a visible
 * label that fills the row's height (≥ 44 px tap target), drawn as the 52×32 toggle of
 * CreateListing.dc.html: the thumb sits at the inline start when off and slides to the inline end,
 * on an accent track, when on.
 */
export function Switch({ label, checked, onChange }: Props) {
  const id = useId();
  return (
    <div className="flex items-stretch justify-between gap-3 px-4">
      <label
        htmlFor={id}
        className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center py-[14px] text-[15px] font-semibold"
      >
        {label}
      </label>
      <span className="relative inline-flex h-8 w-[52px] shrink-0 self-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-[#D6D3D1] transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute start-[3px] top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-all peer-checked:start-[23px]"
        />
      </span>
    </div>
  );
}
