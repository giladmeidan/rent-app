import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { readDraft, writeDraft } from '../../app/drafts';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Textarea } from '../../components/Textarea';
import { hasStatus } from '../applications/api';
import { ApiError } from '../listings/api';
import type { MessageOut } from './api';
import { useSendMessage } from './useSendMessage';

const MAX_LENGTH = 2000; // the API's limit (0005a)
const SHOW_REMAINING_BELOW = 200;

/** No alert: the thread is refetched (`chat_closed`, 404) or the session is gone (401). */
function handledByPage(error: unknown): boolean {
  return (
    hasStatus(error, 401) ||
    hasStatus(error, 404) ||
    (error instanceof ApiError && error.status === 409 && error.detail === 'chat_closed')
  );
}

type Props = {
  conversationId: string;
  /** The signed-in person, whose draft this is (spec 0009g). */
  userId: string | undefined;
  /** After a message of the caller's own was sent (the page scrolls to it). */
  onSent: (message: MessageOut) => void;
  /** The "offer a viewing" chip: listing chats only, not a roommate-market match. */
  viewing: boolean;
};

/**
 * The message form under an open thread. Enter inserts a newline; only the button sends. The text
 * is kept on every error, and as `userId`'s draft in this tab (spec 0009g): a remount (a trip
 * through login, the chat reopening) starts with it.
 */
export function Composer({ conversationId, userId, onSent, viewing }: Props) {
  const { t } = useTranslation();
  const send = useSendMessage(conversationId);
  const [text, setText] = useState(() => readDraft('chat', conversationId, userId));
  // On every change of the text, typed or inserted by the viewing chip; an empty text removes it.
  // The first run is skipped: with nothing restored it would remove an entry that is not ours.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    writeDraft('chat', conversationId, userId, text);
  }, [conversationId, userId, text]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Same-tick guard: a double click sends one message.
  const inFlight = useRef(false);
  const id = useId();
  const blank = text.trim() === '';
  const remaining = MAX_LENGTH - text.length;
  let alert: string | null = null;
  if (send.isError && !handledByPage(send.error)) {
    if (hasStatus(send.error, 422)) alert = t('chat.errors.invalid');
    else if (hasStatus(send.error, 429)) alert = t('chat.errors.rateLimited');
    else alert = t('common.error');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || blank) return;
    inFlight.current = true;
    send.mutate(text.trim(), {
      onSuccess: (message) => {
        setText('');
        // The click moved focus to the button; the next message starts in the textarea.
        textareaRef.current?.focus();
        onSent(message);
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  function onViewing() {
    const template = t('chat.composer.viewingTemplate');
    setText((current) => {
      if (current.trim() === '') return template;
      const separator = current.endsWith('\n') ? '' : '\n';
      return `${current}${separator}${template}`.slice(0, MAX_LENGTH);
    });
    textareaRef.current?.focus();
  }

  return (
    // At lg it sticks to the viewport's bottom while the thread scrolls (a desktop has no bottom
    // bar); below lg it stays in the flow.
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 lg:sticky lg:bottom-0 lg:z-10 lg:bg-surface lg:pb-4 lg:pt-2"
    >
      {alert !== null && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {alert}
        </p>
      )}
      <Card padding="sm" className="flex flex-col gap-2">
        <label htmlFor={`${id}-body`} className="sr-only">
          {t('chat.composer.label')}
        </label>
        <Textarea
          ref={textareaRef}
          id={`${id}-body`}
          dir="auto"
          rows={2}
          maxLength={MAX_LENGTH}
          value={text}
          // Read-only while sending, so nothing typed meanwhile is lost when the sent text clears.
          readOnly={send.isPending}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={remaining < SHOW_REMAINING_BELOW ? `${id}-remaining` : undefined}
        />
        {remaining < SHOW_REMAINING_BELOW && (
          <p id={`${id}-remaining`} className="text-body-sm text-ink-muted">
            {t('chat.composer.remaining', { count: remaining })}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          {viewing ? (
            <Button variant="soft" size="sm" shape="pill" onClick={onViewing}>
              {t('chat.composer.viewing')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={blank || send.isPending}
            aria-busy={send.isPending}
          >
            {send.isPending ? t('chat.composer.sending') : t('chat.composer.send')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
