import { forwardRef, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from './cx';
import { useField } from './Field';
import { focusRing } from './focusRing';
import { TextInput, type TextInputProps } from './TextInput';

export type PasswordInputProps = Omit<TextInputProps, 'type' | 'end' | 'dir'>;

/**
 * A `TextInput` for a password (spec 0016a), always LTR, with a text button at its inline end that
 * shows or hides it. The button's name says what it will do, so it changes with the state.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ id, ...rest }, ref) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);
    const own = useId();
    const inputId = useField()?.id ?? id ?? own;
    return (
      <TextInput
        ref={ref}
        {...rest}
        id={inputId}
        type={shown ? 'text' : 'password'}
        dir="ltr"
        end={
          <button
            type="button"
            aria-controls={inputId}
            onClick={() => setShown((value) => !value)}
            className={cx(
              'inline-flex min-h-tap min-w-tap items-center justify-center rounded-sm px-1 font-medium text-accent hover:text-accent-strong',
              focusRing,
            )}
          >
            {shown ? t('auth.password.hide') : t('auth.password.show')}
          </button>
        }
      />
    );
  },
);
