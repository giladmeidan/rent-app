import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import {
  LIFESTYLE_KEYS,
  type LifestyleAnswer,
  type LifestyleAnswers,
  type LifestyleKey,
} from './keys';

type Props = {
  value: LifestyleAnswers;
  /** Always a new object holding only the answered keys. */
  onChange: (next: LifestyleAnswers) => void;
  /** Whose answers: the seeker's own ("אני…") or the flat's ("בדירה…"). */
  perspective: 'seeker' | 'flat';
  /** The section heading's level: 3 by default, 4 inside a section that has its own `<h3>`. */
  headingLevel?: 3 | 4;
};

const ANSWERS: readonly LifestyleAnswer[] = [1, 2, 3];

/** `answers` with `key` set to `answer` (or removed when `undefined`), as a new object of
 * answered keys only, in `LIFESTYLE_KEYS` order. */
function withAnswer(
  answers: LifestyleAnswers,
  key: LifestyleKey,
  answer: LifestyleAnswer | undefined,
): LifestyleAnswers {
  const next: LifestyleAnswers = {};
  for (const k of LIFESTYLE_KEYS) {
    const a = k === key ? answer : answers[k];
    if (a !== undefined) next[k] = a;
  }
  return next;
}

/**
 * The seven optional questionnaire groups, one `ChoiceGroup` each. A question with an answer has a
 * "ניקוי" button that makes it unanswered again (`ChoiceGroup` itself has no clear). The button's row is
 * always rendered, so answering or clearing a question moves nothing below it.
 */
export function LifestyleFields({ value, onChange, perspective, headingLevel = 3 }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const Heading = headingLevel === 4 ? 'h4' : 'h3';

  function clear(key: LifestyleKey) {
    onChange(withAnswer(value, key, undefined));
    // The button unmounts with the answer; the group's first radio keeps the focus in place.
    rootRef.current?.querySelector<HTMLInputElement>(`input[name="lifestyle-${key}"]`)?.focus();
  }

  return (
    <section ref={rootRef} aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading id={headingId} className="text-h3">
          {t(`lifestyle.title.${perspective}`)}
        </Heading>
        <p className="text-body-sm text-ink-muted">{t('lifestyle.nudge')}</p>
      </div>
      <div className="flex flex-col gap-2">
        {LIFESTYLE_KEYS.map((key) => {
          const question = t(`lifestyle.${key}.question.${perspective}`);
          const options: ChoiceOption<LifestyleAnswer>[] = ANSWERS.map((n) => ({
            value: n,
            label: t(`lifestyle.${key}.answer.${String(n)}`),
          }));
          const answer = value[key];
          return (
            <div key={key} className="flex flex-col">
              <ChoiceGroup
                legend={question}
                name={`lifestyle-${key}`}
                options={options}
                value={answer ?? null}
                onChange={(n) => onChange(withAnswer(value, key, n))}
              />
              <div data-testid="lifestyle-clear-row" className="flex min-h-tap items-center">
                {answer !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => clear(key)}
                    aria-label={t('lifestyle.clearAria', { question })}
                  >
                    {t('lifestyle.clear')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
