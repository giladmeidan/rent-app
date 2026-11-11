import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { hasStatus } from '../applications/api';
import { ApiError } from '../listings/api';
import type { MessageOut } from './api';
import { useSendMessage } from './useSendMessage';

const MAX_LENGTH = 2000; // the API's limit (0005a)
const SHOW_REMAINING_BELOW = 200;

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';

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
  /** After a message of the caller's own was sent (the page scrolls to it). */
  onSent: (message: MessageOut) => void;
};

/**
 * The message form under an open thread. Enter inserts a newline; only the button sends. The text
 * is kept on every error.
 */
export function Composer({ conversationId, onSent }: Props) {
  const { t } = useTranslation();
  const send = useSendMessage(conversationId);
  const [text, setText] = useState('');
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
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {alert !== null && (
        <p role="alert" className={fieldError}>
          {alert}
        </p>
      )}
      <label htmlFor={`${id}-body`} className="sr-only">
        {t('chat.composer.label')}
      </label>
      <textarea
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
        className={`w-full resize-y rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 py-2 text-[15px] leading-relaxed ${focusRing}`}
      />
      {remaining < SHOW_REMAINING_BELOW && (
        <p id={`${id}-remaining`} className="text-start text-sm text-muted">
          {t('chat.composer.remaining', { count: remaining })}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onViewing}
          className={`inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-accent bg-accent-tint px-4 text-[14px] font-bold text-accent-text ${focusRing}`}
        >
          {t('chat.composer.viewing')}
        </button>
        <button
          type="submit"
          disabled={blank || send.isPending}
          aria-busy={send.isPending}
          className={`inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-bold text-white disabled:opacity-60 ${focusRing}`}
        >
          {send.isPending ? t('chat.composer.sending') : t('chat.composer.send')}
        </button>
      </div>
    </form>
  );
}
