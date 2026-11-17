import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button } from '../../components/Button';
import { buttonClasses } from '../../components/Button.classes';
import { Dialog, useConfirm } from '../../components/Dialog';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { retryAfterText } from '../../components/retryAfter';
import { Skeleton } from '../../components/Skeleton';
import { TextInput } from '../../components/TextInput';
import { ApiError } from '../listings/api';
import { feedUrls, useTourFeed, useTourFeedMutations } from './feedApi';

function errorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return error.retryAfter === null
      ? t('tours.feed.rateLimited')
      : t('tours.feed.rateLimitedIn', { when: retryAfterText(t, error.retryAfter) });
  }
  return t('common.error');
}

/** The link, shown only right after a create or rotate: copy, Google's add link, `webcal:`.
 * Keyed by the token, so a rotate starts with "copied" off. */
function FeedLink({ token }: { token: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const urls = feedUrls(token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(urls.https);
      setCopied(true);
    } catch {
      // No clipboard (an insecure context, a denied permission): select it for a manual copy.
      setCopied(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Field id={inputId} label={t('tours.feed.linkLabel')} className="min-w-0 sm:flex-1">
          <TextInput
            ref={inputRef}
            type="text"
            readOnly
            dir="ltr"
            value={urls.https}
            onFocus={(event) => event.currentTarget.select()}
            className="text-start"
          />
        </Field>
        <Button variant="secondary" onClick={() => void copy()} className="sm:self-end">
          {t('tours.feed.copy')}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-body-sm font-medium text-success">
        {copied ? t('tours.feed.copied') : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={urls.google}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: 'primary' })}
        >
          {t('tours.feed.addGoogle')}
          <span className="sr-only"> {t('common.newTab')}</span>
        </a>
        <a href={urls.webcal} className={buttonClasses({ variant: 'secondary' })}>
          {t('tours.feed.addOther')}
        </a>
      </div>
      <p className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-body-sm text-ink">
        {t('tours.feed.onceWarning')}
      </p>
    </div>
  );
}

/**
 * "קישור ליומן" in the tours page header (spec 0018d): a dialog to turn the private calendar feed
 * on, rotate it or turn it off. The token lives in this component's state only: it survives
 * closing and reopening the dialog, and is gone after a reload or navigation.
 */
export function CalendarFeedButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const feed = useTourFeed(opened);
  const { create, disable } = useTourFeedMutations();
  const [confirm, confirmDialog] = useConfirm();
  const busy = create.isPending || disable.isPending;
  // Same-tick guard: `busy` is render state, so a fast double click would send two POSTs, and the
  // second would rotate away the link just shown. Re-checked after the confirm's await.
  const inFlight = useRef(false);

  async function onCreate(rotate = false) {
    if (inFlight.current) return;
    if (rotate) {
      const ok = await confirm({
        title: t('tours.feed.rotateConfirm'),
        body: t('tours.feed.rotateBody'),
        confirmLabel: t('tours.feed.rotate'),
        tone: 'primary',
      });
      if (!ok || inFlight.current) return;
    }
    inFlight.current = true;
    setFailure(null);
    create.mutate(undefined, {
      onSuccess: (newToken) => setToken(newToken),
      onError: (error) => setFailure(errorText(t, error)),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  async function onDisable() {
    if (inFlight.current) return;
    const ok = await confirm({
      title: t('tours.feed.disableConfirm'),
      body: t('tours.feed.disableBody'),
      confirmLabel: t('tours.feed.disable'),
      tone: 'danger',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    disable.mutate(undefined, {
      onSuccess: () => setToken(null),
      onError: (error) => setFailure(errorText(t, error)),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  const active = feed.data?.active === true;
  const shown = token !== null;
  let body;
  if (shown) {
    body = <FeedLink key={token} token={token} />;
  } else if (feed.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  } else if (feed.isError) {
    body = <ErrorState onRetry={() => feed.refetch()} />;
  } else if (!active) {
    body = (
      <>
        <p className="text-body">{t('tours.feed.hint')}</p>
        <Button
          variant="primary"
          onClick={() => void onCreate()}
          disabled={busy}
          aria-busy={create.isPending}
          className="self-start"
        >
          {t('tours.feed.create')}
        </Button>
      </>
    );
  } else {
    body = <p className="text-body font-semibold">{t('tours.feed.active')}</p>;
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        {t('tours.feed.title')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('tours.feed.title')}
        actions={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('tours.feed.close')}
          </Button>
        }
      >
        {body}
        {(shown || (active && !feed.isError)) && (
          <>
            <p className="text-body-sm text-ink-muted">{t('tours.feed.delay')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onCreate(true)}
                disabled={busy}
                aria-busy={create.isPending}
              >
                {t('tours.feed.rotate')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onDisable()}
                disabled={busy}
                aria-busy={disable.isPending}
              >
                {t('tours.feed.disable')}
              </Button>
            </div>
          </>
        )}
        {failure !== null && (
          <p role="alert" className="text-body-sm font-semibold text-danger">
            {failure}
          </p>
        )}
      </Dialog>
      {confirmDialog}
    </>
  );
}
