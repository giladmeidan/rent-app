import type { ReactNode, Ref } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Role } from '../../api/client';
import { sideOf } from '../../app/side';
import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { Field } from '../../components/Field';
import { focusRing } from '../../components/focusRing';
import { TextInput } from '../../components/TextInput';

/** 2–40 code points after trimming, as Postgres `char_length` counts them. */
export const nameIsValid = (name: string) => {
  const length = [...name.trim()].length;
  return length >= 2 && length <= 40;
};

/** `next`'s path alone (already `safeNext`-ed): its query and hash dropped. */
function nextPath(next: string): string {
  return next.split(/[?#]/, 1)[0] ?? next;
}

/** No roles in the market (spec 0010b): a sign-up headed there is not asked owner or seeker, and is
 * stored as seeker. An explicit role (`?role=`) still shows the question, preset. */
export const askRoleFor = (initialRole: Role | null, next: string) =>
  !(initialRole === null && sideOf(nextPath(next)) === 'market');

type Props = {
  /** Prefix of the fields' ids (the form's `useId()`). */
  id: string;
  askRole: boolean;
  role: Role | null;
  onRoleChange: (role: Role) => void;
  name: string;
  onNameChange: (name: string) => void;
  nameError: boolean;
  nameRef: Ref<HTMLInputElement>;
};

/** A new account's role question (when `askRole`) and display name (code and Google sign-up). */
export function ProfileFields({
  id,
  askRole,
  role,
  onRoleChange,
  name,
  onNameChange,
  nameError,
  nameRef,
}: Props) {
  const { t } = useTranslation();
  const roleOptions: readonly ChoiceOption<Role>[] = [
    // Owner first: it sits at the inline start (the right, in RTL).
    { value: 'owner', label: t('auth.role.owner') },
    { value: 'seeker', label: t('auth.role.seeker') },
  ];
  return (
    <>
      {askRole && (
        <ChoiceGroup
          legend={t('auth.role.label')}
          name="role"
          options={roleOptions}
          value={role}
          onChange={onRoleChange}
        />
      )}
      <Field
        id={`${id}-name`}
        label={t('auth.name.label')}
        error={nameError ? t('auth.errors.nameLength') : undefined}
      >
        <TextInput
          ref={nameRef}
          type="text"
          autoComplete="nickname"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </Field>
    </>
  );
}

/** One of the consent line's two links: a new tab, announced as such to screen readers. */
function ConsentLink({ to, children }: { to: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className={`rounded-sm font-medium text-accent underline underline-offset-4 ${focusRing}`}
    >
      {children}
      <span className="sr-only"> {t('common.newTab')}</span>
    </Link>
  );
}

/** The terms-and-privacy line above the submit that creates an account (spec 0013f). New tabs: the
 * form's state would be lost by a link in this tab. */
export function ConsentLine() {
  return (
    <p className="text-body-sm text-ink-muted">
      <Trans
        i18nKey="auth.signup.consent"
        components={{
          terms: <ConsentLink to="/terms" />,
          privacy: <ConsentLink to="/privacy" />,
        }}
      />
    </p>
  );
}
