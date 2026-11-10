import { useId, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import type { Role } from '../../api/client';

// Owner first: it sits at the inline start (the right, in RTL).
const ROLES = ['owner', 'seeker'] as const satisfies readonly Role[];

type Props = {
  value: Role | null;
  onChange: (role: Role) => void;
  /** Attached to the first radio (owner), so a parent can move focus into the group. */
  firstRadioRef?: Ref<HTMLInputElement>;
};

/**
 * Native radios in a fieldset, styled as the segmented buttons of CreateListing.dc.html. Arrow keys
 * and the RTL order come from the browser.
 */
export function RoleChoice({ value, onChange, firstRadioRef }: Props) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <fieldset className="flex flex-col">
      <legend className="mb-2 text-sm font-bold">{t('auth.role.label')}</legend>
      <div className="flex gap-2">
        {ROLES.map((role, i) => (
          <div key={role} className="flex flex-1">
            <input
              ref={i === 0 ? firstRadioRef : undefined}
              id={`${id}-${role}`}
              type="radio"
              name="role"
              value={role}
              checked={value === role}
              onChange={() => onChange(role)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${id}-${role}`}
              className="flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-center text-[15px] font-semibold peer-checked:border-accent peer-checked:bg-accent-tint peer-checked:font-bold peer-checked:text-accent-text peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              {role === 'owner' ? t('auth.role.owner') : t('auth.role.seeker')}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
