import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Tag } from '../../components/Tag';
import { OWNER_SIGNUP, SECTION } from './links';

type Step = { title: string; text: string };

/** One side: its label (a neutral tag naming the list), three numbered steps and its CTA. */
function Side({
  id,
  label,
  steps,
  cta,
}: {
  id: string;
  label: string;
  steps: Step[];
  cta: { to: string; label: string; variant: 'primary' | 'secondary' };
}) {
  const labelId = `landing-how-${id}`;
  return (
    <Card padding="none" data-side={id} className="landing-reveal flex flex-col gap-4 p-5">
      <Tag id={labelId} tone="neutral" className="self-start">
        {label}
      </Tag>
      <ol aria-labelledby={labelId} className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-h3 text-accent-strong"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-h3">{step.title}</h3>
              <p className="text-body-sm text-ink-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Button to={cta.to} variant={cta.variant} size="lg" fullWidth className="mt-auto">
        {cta.label}
      </Button>
    </Card>
  );
}

/** Main.html §4, "איך זה עובד": the seeker's three steps and the owner's, side by side from `lg`. */
export function HowItWorks() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="landing-how" className={SECTION}>
      <h2 id="landing-how" className="font-display text-h2">
        {t('landing.how.title')}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <Side
          id="seeker"
          label={t('landing.how.seeker')}
          steps={[
            { title: t('landing.how.step1.title'), text: t('landing.how.step1.text') },
            { title: t('landing.how.step2.title'), text: t('landing.how.step2.text') },
            { title: t('landing.how.step3.title'), text: t('landing.how.step3.text') },
          ]}
          cta={{ to: '/search', label: t('landing.cta.seeker'), variant: 'secondary' }}
        />
        <Side
          id="owner"
          label={t('landing.how.owner.label')}
          steps={[
            {
              title: t('landing.how.owner.step1.title'),
              text: t('landing.how.owner.step1.text'),
            },
            {
              title: t('landing.how.owner.step2.title'),
              text: t('landing.how.owner.step2.text'),
            },
            {
              title: t('landing.how.owner.step3.title'),
              text: t('landing.how.owner.step3.text'),
            },
          ]}
          cta={{ to: OWNER_SIGNUP, label: t('landing.cta.owner'), variant: 'primary' }}
        />
      </div>
    </section>
  );
}
