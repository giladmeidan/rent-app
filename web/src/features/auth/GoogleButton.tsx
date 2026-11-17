import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api, type Role, type UserOut } from '../../api/client';
import type { components } from '../../api/schema';
import { capture } from '../../app/analytics';
import { CONTACT_EMAIL_INLINE } from '../../app/contact';
import { Button } from '../../components/Button';
import { parseRetryAfter, retryAfterText } from '../../components/retryAfter';
import { useOnline } from '../../components/useOnline';
import { errorText, hasDetail, type TooMany } from './OtpForm';
import { askRoleFor, ConsentLine, nameIsValid, ProfileFields } from './ProfileFields';
import { signedIn } from './signedIn';

type GoogleLoginIn = components['schemas']['GoogleLoginIn'];

// Google Identity Services, only what this file calls (spec 0016b; One Tap is not used).
type GsiConfig = {
  client_id: string;
  callback: (response: { credential: string }) => void;
  context: 'signin' | 'signup';
};
type GsiButton = {
  type: 'standard';
  theme: 'outline';
  size: 'large';
  text: 'continue_with';
  locale: string;
  width: number;
};
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: GsiConfig) => void;
          renderButton: (parent: HTMLElement, options: GsiButton) => void;
        };
      };
    };
  }
}

export const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** GIS's widest button. */
const MAX_WIDTH = 400;

let gisLoad: Promise<void> | null = null;

/** Google's script, appended once; a failed load is forgotten, so a later mount tries again. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      gisLoad = null;
      script.remove();
      reject(new Error('gis'));
    });
    document.head.appendChild(script);
  });
  return gisLoad;
}

/** The `name` claim of a Google ID token (a JWT), trimmed and cut to 40 code points; '' for
 * anything else. Only a pre-fill: the API never reads it. */
export function nameFromCredential(credential: string): string {
  try {
    const payload = credential.split('.');
    if (payload.length !== 3 || payload[1] === undefined) return '';
    const base64 = payload[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const name =
      typeof claims === 'object' && claims !== null && 'name' in claims ? claims.name : null;
    return typeof name === 'string' ? [...name.trim()].slice(0, 40).join('').trim() : '';
  } catch {
    return '';
  }
}

type GoogleError =
  | TooMany
  | { kind: 'invalid' }
  | { kind: 'conflict' }
  | { kind: 'suspended' }
  | { kind: 'signupBlocked' }
  | { kind: 'failed' };
type GoogleResult = { kind: 'ok'; user: UserOut } | { kind: 'profileRequired' } | GoogleError;

async function signInWithGoogle(body: GoogleLoginIn): Promise<GoogleResult> {
  try {
    const { data, error, response } = await api.POST('/auth/google', { body });
    if (data !== undefined && (response.status === 200 || response.status === 201)) {
      return { kind: 'ok', user: data };
    }
    if (response.status === 401) return { kind: 'invalid' };
    if (response.status === 409) return { kind: 'conflict' };
    if (response.status === 403 && hasDetail(error, 'account_suspended')) {
      return { kind: 'suspended' };
    }
    if (response.status === 403 && hasDetail(error, 'signup_blocked')) {
      return { kind: 'signupBlocked' };
    }
    if (response.status === 422 && hasDetail(error, 'profile_required')) {
      return { kind: 'profileRequired' };
    }
    if (response.status === 429) {
      return { kind: 'tooMany', retryAfter: parseRetryAfter(response.headers) };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // network error
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), iframe';

type Props = {
  /** `?role=` on /signup: presets the panel's role question. */
  initialRole?: Role | null;
  /** Where a sign-in goes: a path already checked by `safeNext`. */
  next: string;
  /** GIS's wording for the page. */
  context: 'signin' | 'signup';
  /** The page's own form, under the button and the "או" divider. */
  children: ReactNode;
};

/**
 * "Continue with Google" above the page's form (spec 0016b), or just the form when this build has
 * no `VITE_GOOGLE_CLIENT_ID`. A 422 `profile_required` replaces the button, divider and form with
 * the "one more step" panel. The credential lives in this component's state only.
 */
export function GoogleButton(props: Props) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID; // read at render: tests stub it
  if (!clientId) return <>{props.children}</>;
  return <GoogleSignIn clientId={clientId} {...props} />;
}

function GoogleSignIn({
  clientId,
  initialRole = null,
  next,
  context,
  children,
}: Props & { clientId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const online = useOnline();

  const askRole = askRoleFor(initialRole, next);
  const [script, setScript] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState<GoogleError | null>(null);
  // Set while the "one more step" panel is open: the credential that answered `profile_required`.
  const [step, setStep] = useState<{ credential: string } | null>(null);
  const [role, setRole] = useState<Role | null>(askRole ? initialRole : 'seeker');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);

  const buttonRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  // A second callback while one is in flight is ignored; a ref, so two in one tick are caught.
  const pending = useRef(false);
  const mutation = useMutation({ mutationFn: signInWithGoogle, gcTime: 0 });
  const panelOpen = step !== null;

  function submit(body: GoogleLoginIn) {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    mutation.mutate(body, {
      onSettled: () => {
        pending.current = false;
      },
      onSuccess: (result) => {
        if (result.kind === 'ok') {
          signedIn(queryClient, navigate, result.user, next);
        } else if (result.kind === 'profileRequired') {
          setName(nameFromCredential(body.credential));
          setNameError(false);
          setStep({ credential: body.credential });
        } else {
          // A 401 in the panel (the credential expired meanwhile): back to the button.
          if (result.kind === 'invalid') setStep(null);
          setError(result);
        }
      },
    });
  }
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  // Render Google's button whenever the button area is shown (again after the panel closes).
  useEffect(() => {
    if (panelOpen) return;
    let live = true;
    loadGis().then(
      () => {
        const gsi = window.google?.accounts?.id;
        const el = buttonRef.current;
        if (!live) return;
        if (!gsi || !el) {
          setScript('failed');
          return;
        }
        gsi.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            if (context === 'signup') capture('signup_started', { method: 'google' });
            submitRef.current({ credential });
          },
          context,
        });
        gsi.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          locale: 'he',
          width: Math.min(el.clientWidth, MAX_WIDTH),
        });
        setScript('ready');
      },
      () => {
        if (live) setScript('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [clientId, context, panelOpen]);

  // Focus: on open, the first role radio (or the name); on cancel, the card's first focusable.
  useEffect(() => {
    if (panelOpen) {
      cardRef.current = panelRef.current?.parentElement ?? null;
      if (askRole) panelRef.current?.querySelector<HTMLInputElement>('input[name="role"]')?.focus();
      else nameRef.current?.focus();
    } else if (cardRef.current) {
      cardRef.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      cardRef.current = null;
    }
  }, [panelOpen, askRole]);

  function onPanelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === null || mutation.isPending || role === null) return;
    if (!nameIsValid(name)) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    submit({ credential: step.credential, profile: { display_name: name.trim(), role } });
  }

  function onCancel() {
    setStep(null);
    setError(null);
  }

  function errorMessage(e: GoogleError): string {
    switch (e.kind) {
      case 'tooMany':
        return e.retryAfter === null
          ? t('auth.errors.tooMany')
          : t('auth.errors.tooManyIn', { when: retryAfterText(t, e.retryAfter) });
      case 'invalid':
        return t('auth.google.errors.invalid');
      case 'conflict':
        return t('auth.google.errors.conflict');
      case 'suspended':
        return t('auth.errors.suspended');
      case 'signupBlocked':
        return t('auth.errors.signupBlocked', { email: CONTACT_EMAIL_INLINE });
      default:
        return online ? t('common.error') : t('common.offline');
    }
  }
  const alert = (className: string) =>
    error !== null && (
      <p role="alert" className={className}>
        {errorMessage(error)}
      </p>
    );

  if (panelOpen) {
    const hintId = `${id}-submit-hint`;
    const hint = !mutation.isPending && role === null ? t('auth.hint.chooseRole') : null;
    return (
      <form ref={panelRef} noValidate onSubmit={onPanelSubmit} className="flex flex-col gap-6">
        <h2 className="font-display text-h3">{t('auth.google.step.title')}</h2>
        <ProfileFields
          id={id}
          askRole={askRole}
          role={role}
          onRoleChange={setRole}
          name={name}
          onNameChange={(value) => {
            setName(value);
            setNameError(false);
          }}
          nameError={nameError}
          nameRef={nameRef}
        />
        {alert(errorText)}
        <div className="flex flex-col gap-1.5">
          <ConsentLine />
          <Button
            variant="primary"
            size="lg"
            fullWidth
            type="submit"
            disabled={mutation.isPending || role === null}
            aria-busy={mutation.isPending}
            aria-describedby={hint !== null ? hintId : undefined}
          >
            {t('auth.google.step.submit')}
          </Button>
          {hint !== null && (
            <p id={hintId} className="text-sm text-ink-muted">
              {hint}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          {t('auth.google.step.cancel')}
        </Button>
      </form>
    );
  }

  // `children` keeps its position whether or not the area shows: a failed script must not remount
  // the page's form (and lose what was typed).
  return (
    <>
      {script !== 'failed' && (
        <>
          <div className="flex flex-col items-center gap-2">
            {/* The 44 px placeholder while the script loads, then Google's own (unstyled) button. */}
            <div
              ref={buttonRef}
              data-testid="google-button"
              className="flex min-h-11 w-full justify-center"
            />
            <p role="status" className="text-body-sm text-ink-muted empty:hidden">
              {mutation.isPending ? t('auth.google.pending') : ''}
            </p>
            {alert(`${errorText} text-center`)}
          </div>
          <div className="flex items-center gap-3 text-body-sm text-ink-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            {t('auth.google.or')}
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      {children}
    </>
  );
}
