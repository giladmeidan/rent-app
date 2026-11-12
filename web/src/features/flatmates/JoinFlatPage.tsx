import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { loginWithNext } from '../auth/next';
import { clearSession } from '../auth/useLogout';
import { useMe } from '../auth/useMe';
import { ApiError } from '../listings/api';
import { cardTitle } from '../listings/cardTitle';
import { useInvitePreview, useJoinFlat } from './api';
import { clearInviteToken, isInviteToken, readInviteToken, stashInviteToken } from './inviteToken';

const JOIN_PATH = '/flatmates/join';
const section = 'mx-auto flex w-full max-w-[480px] flex-col gap-4';
const card = 'flex flex-col gap-3 rounded-2xl border border-line bg-white p-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primary = `inline-flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-accent px-5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const message = 'text-start text-[15px] font-semibold';

/** The copy for an answer the page shows as text; `other` is an `ErrorState`. */
type Failure = 'invalid' | 'own' | 'applied' | 'declined' | 'full' | 'rateLimited' | 'other';

const COPY = {
  invalid: 'flatmates.join.invalid',
  own: 'flatmates.join.own',
  applied: 'flatmates.join.applied',
  declined: 'flatmates.join.declined',
  full: 'flatmates.join.full',
  rateLimited: 'flatmates.join.rateLimited',
} as const;

/** Where a final message leads (0009f); a rate limit has no link, the person retries later. */
const WAY_OUT = {
  own: { to: '/me/listings', label: 'flatmates.join.toMyListings' },
  applied: { to: '/me/applications', label: 'flatmates.join.toApplications' },
  declined: { to: '/search', label: 'flatmates.join.toSearch' },
  full: { to: '/search', label: 'flatmates.join.toSearch' },
  invalid: { to: '/search', label: 'flatmates.join.toSearch' },
} as const;

const link = `inline-flex min-h-[44px] items-center self-start rounded-full text-[15px] font-semibold text-accent-text underline ${focusRing}`;

/** The link out of a final message. Never inside the `role="alert"` element. */
function WayOut({ failure }: { failure: Exclude<Failure, 'other'> }) {
  const { t } = useTranslation();
  if (failure === 'rateLimited') return null;
  const { to, label } = WAY_OUT[failure];
  return (
    <Link to={to} className={link}>
      {t(label)}
    </Link>
  );
}

const CONFLICTS: Record<string, Failure> = {
  own_listing: 'own',
  already_applied: 'applied',
  declined: 'declined',
  flatmates_full: 'full',
};

/** One mapping for the preview's and the join's errors (0008d): 404 and 422 are a bad link. */
function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return 'other';
  if (error.status === 404 || error.status === 422) return 'invalid';
  if (error.status === 409) {
    return typeof error.detail === 'string' ? (CONFLICTS[error.detail] ?? 'other') : 'other';
  }
  if (error.status === 429) return 'rateLimited';
  return 'other';
}

/** A final answer about this token (404, 409, 422): retrying cannot change it, so it is cleared.
 * 429, 5xx and network errors keep it for a retry. */
function isFinal(error: unknown): boolean {
  return error instanceof ApiError && [404, 409, 422].includes(error.status);
}

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className={section}>
      <h1 className="text-start text-2xl font-extrabold">{t('flatmates.join.title')}</h1>
      {children}
    </section>
  );
}

function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton />
    </div>
  );
}

/**
 * `/flatmates/join#<token>`, public (0008e A1). The token is taken out of the URL first: stashed
 * (`inviteToken.ts`) and the hash dropped with a history replace, before anything checks the
 * session, so the login redirect (`next=/flatmates/join`) and the tab's history never hold it.
 */
export function JoinFlatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const hashPending = location.hash.length > 1;

  useEffect(() => {
    if (!hashPending) return;
    // Decoded and trimmed as the API trims (`#<token>%20` still works); a malformed escape is not
    // a token.
    let raw = '';
    try {
      raw = decodeURIComponent(location.hash.slice(1)).trim();
    } catch {
      raw = '';
    }
    // A hash wins over a stored token; one that is not a token is dropped and not stored.
    if (isInviteToken(raw)) stashInviteToken(raw);
    else clearInviteToken();
    void navigate(JOIN_PATH, { replace: true });
  }, [hashPending, location.hash, navigate]);

  if (hashPending) {
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  }
  // Mounted once the hash is gone, so it reads the token just stashed.
  return <JoinFlow />;
}

/** The session check, then the invite's preview and the join, both POSTs with the token in the
 * body. The token is read once: clearing it after a final answer keeps that answer on screen. */
function JoinFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const [token] = useState(readInviteToken);
  const loggedIn = me.data !== undefined && me.data !== null;
  const preview = useInvitePreview(loggedIn ? token : null);
  const join = useJoinFlat();

  // The preview settles the token when it is final, or when the caller is already a member.
  useEffect(() => {
    if (preview.data?.member === true || (preview.isError && isFinal(preview.error))) {
      clearInviteToken();
    }
  }, [preview.data, preview.isError, preview.error]);

  // A 401 from either call: the session ended. The session is cleared (`/me` turns null) and the
  // page sends the person to the login, the token kept for the way back.
  const expired =
    (preview.error instanceof ApiError && preview.error.status === 401) ||
    (join.error instanceof ApiError && join.error.status === 401);
  useEffect(() => {
    if (expired) clearSession(queryClient, { keepInviteToken: true });
  }, [expired, queryClient]);

  // Same-tick guard: `join.isPending` is render state, so a fast double click would send twice.
  const inFlight = useRef(false);

  function onJoin() {
    if (token === null || inFlight.current) return;
    inFlight.current = true;
    join.mutate(token, {
      onSuccess: () => {
        clearInviteToken();
        // `replace`: Back from the chats does not land on the spent link's "invalid" text.
        void navigate('/chat', { replace: true, state: { joined: true } });
      },
      onError: (error) => {
        if (isFinal(error)) clearInviteToken();
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  // No token at all: nothing to log in for.
  if (token === null) {
    return (
      <Frame>
        <div className={card}>
          <p role="alert" className={message}>
            {t('flatmates.join.invalid')}
          </p>
          <WayOut failure="invalid" />
        </div>
      </Frame>
    );
  }
  if (me.isPending) {
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  }
  if (me.data === undefined) {
    return (
      <Frame>
        <ErrorState onRetry={() => void me.refetch()} />
      </Frame>
    );
  }
  if (me.data === null) {
    return <Navigate to={loginWithNext({ pathname: JOIN_PATH, search: '' })} replace />;
  }

  if (preview.data === undefined) {
    if (!preview.isError || expired) {
      return (
        <Frame>
          <Loading />
        </Frame>
      );
    }
    const failure = failureOf(preview.error);
    return (
      <Frame>
        {failure === 'other' ? (
          <ErrorState onRetry={() => void preview.refetch()} />
        ) : (
          <div className={card}>
            <p role="alert" className={message}>
              {t(COPY[failure])}
            </p>
            <WayOut failure={failure} />
          </div>
        )}
      </Frame>
    );
  }

  const { listing, owner_name: owner, member } = preview.data;
  const title = (
    <div className="flex flex-col gap-1">
      <p className="text-start text-lg font-bold">{cardTitle(t, listing)}</p>
      <p dir="auto" className="text-start text-[15px] text-muted">
        {t('flatmates.join.invitedBy', { owner })}
      </p>
    </div>
  );

  if (member) {
    return (
      <Frame>
        <div className={card}>
          {title}
          <p className={message}>{t('flatmates.join.member')}</p>
          <Link to="/chat" className={link}>
            {t('flatmates.join.toChats')}
          </Link>
        </div>
      </Frame>
    );
  }

  const failure = join.isError && !expired ? failureOf(join.error) : null;
  // A final answer ends the flow: no button to press again.
  const spent = join.isError && isFinal(join.error);
  return (
    <Frame>
      <div className={card}>
        {title}
        {!spent && (
          <button
            type="button"
            onClick={onJoin}
            disabled={join.isPending}
            aria-busy={join.isPending}
            className={primary}
          >
            {t('flatmates.join.cta')}
          </button>
        )}
        {failure !== null && failure !== 'other' && (
          <>
            <p role="alert" className={`${message} text-[#B91C1C]`}>
              {t(COPY[failure])}
            </p>
            <WayOut failure={failure} />
          </>
        )}
      </div>
      {failure === 'other' && <ErrorState onRetry={onJoin} />}
    </Frame>
  );
}
