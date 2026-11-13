import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { focusMainIfLost } from '../../components/focus';
import { Loading } from '../../components/Loading';
import { Mascot } from '../../components/Mascot';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { loginWithNext } from '../auth/next';
import { clearSession } from '../auth/useLogout';
import { useMe } from '../auth/useMe';
import { ApiError } from '../listings/api';
import { cardTitle } from '../listings/cardTitle';
import { useInvitePreview, useJoinFlat } from './api';
import { clearInviteToken, isInviteToken, readInviteToken, stashInviteToken } from './inviteToken';

const JOIN_PATH = '/flatmates/join';
const section = 'flex flex-col gap-4';
const card = 'flex flex-col gap-4';
const message = 'text-body font-semibold';
/** The card's row of links out; rendered only when it has one. */
const actions = 'flex flex-wrap gap-2';

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

/** Where a final message leads (0009f); a rate limit has no link, the person retries later. A
 * flat is a room's, so every way out is the market's (spec 0010a). */
const WAY_OUT = {
  own: { to: '/market/mine', label: 'flatmates.join.toMyListings' },
  applied: { to: '/market/mine?tab=applications', label: 'flatmates.join.toApplications' },
  declined: { to: '/market', label: 'flatmates.join.toSearch' },
  full: { to: '/market', label: 'flatmates.join.toSearch' },
  invalid: { to: '/market', label: 'flatmates.join.toSearch' },
} as const;

/** The link out of a final message, in the card's actions row. Never inside the `role="alert"`
 * element. */
function WayOut({ failure }: { failure: Exclude<Failure, 'other'> }) {
  const { t } = useTranslation();
  if (failure === 'rateLimited') return null;
  const { to, label } = WAY_OUT[failure];
  return (
    <div className={actions}>
      <Button variant="secondary" to={to}>
        {t(label)}
      </Button>
    </div>
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

/** Every state of the page, with its one `<h1>` (which also names the tab). */
function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  usePageTitle(t('flatmates.join.title'));
  return (
    <PageContainer as="section" width="narrow" className={section}>
      <PageHeader title={t('flatmates.join.title')} />
      {children}
    </PageContainer>
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
        <Loading>
          <Skeleton />
        </Loading>
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
  // Decision 17 (0010f): shown on the room's page only by the person's own choice, default off.
  const [shown, setShown] = useState(false);
  const showHintId = useId();

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

  // A final answer removes the join button (`spent`): its failure line takes focus, or `#main`
  // when the answer has no line (an unknown 409, spec 0009t).
  const failureRef = useRef<HTMLParagraphElement>(null);
  const spent = join.isError && isFinal(join.error);
  useEffect(() => {
    if (!spent) return;
    if (failureRef.current !== null) failureRef.current.focus();
    else focusMainIfLost();
  }, [spent]);

  function onJoin() {
    if (token === null || inFlight.current) return;
    inFlight.current = true;
    join.mutate(
      { token, shown },
      {
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
      },
    );
  }

  // No token at all: nothing to log in for.
  if (token === null) {
    return (
      <Frame>
        <Card padding="lg" className={card}>
          <p role="alert" className={message}>
            {t('flatmates.join.invalid')}
          </p>
          <WayOut failure="invalid" />
        </Card>
      </Frame>
    );
  }
  if (me.isPending) {
    return (
      <Frame>
        <Loading>
          <Skeleton />
        </Loading>
      </Frame>
    );
  }
  if (me.data === undefined) {
    return (
      <Frame>
        <ErrorState onRetry={() => me.refetch()} />
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
          <Loading>
            <Skeleton />
          </Loading>
        </Frame>
      );
    }
    const failure = failureOf(preview.error);
    return (
      <Frame>
        {failure === 'other' ? (
          <ErrorState onRetry={() => preview.refetch()} />
        ) : (
          <Card padding="lg" className={card}>
            <p role="alert" className={message}>
              {t(COPY[failure])}
            </p>
            <WayOut failure={failure} />
          </Card>
        )}
      </Frame>
    );
  }

  const { listing, owner_name: owner, member } = preview.data;
  const title = (
    <div className="flex flex-col gap-1">
      <p className="text-h3">{cardTitle(t, listing)}</p>
      <p dir="auto" className="text-body text-ink-muted">
        {t('flatmates.join.invitedBy', { owner })}
      </p>
    </div>
  );

  if (member) {
    return (
      <Frame>
        <Card padding="lg" className={card}>
          <Mascot pose="celebrate" width={96} className="self-center" />
          {title}
          <p className={message}>{t('flatmates.join.member')}</p>
          <div className={actions}>
            <Button variant="secondary" to="/chat">
              {t('flatmates.join.toChats')}
            </Button>
          </div>
        </Card>
      </Frame>
    );
  }

  const failure = join.isError && !expired ? failureOf(join.error) : null;
  // A final answer ends the flow (`spent`): no button to press again.
  return (
    <Frame>
      <Card padding="lg" className={card}>
        <Mascot pose="hello" width={96} className="self-center" />
        {title}
        {!spent && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="rounded-md border border-border">
                <Switch
                  label={t('flatmates.join.show')}
                  checked={shown}
                  onChange={setShown}
                  describedBy={showHintId}
                  disabled={join.isPending}
                />
              </div>
              <p id={showHintId} className="text-body-sm text-ink-muted">
                {t('flatmates.join.showHint')}
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onJoin}
              disabled={join.isPending}
              aria-busy={join.isPending}
            >
              {t('flatmates.join.cta')}
            </Button>
          </>
        )}
        {failure !== null && failure !== 'other' && (
          <>
            <p
              ref={failureRef}
              tabIndex={-1}
              role="alert"
              className={`${message} text-danger focus:outline-none`}
            >
              {t(COPY[failure])}
            </p>
            <WayOut failure={failure} />
          </>
        )}
      </Card>
      {failure === 'other' && <ErrorState onRetry={onJoin} />}
    </Frame>
  );
}
