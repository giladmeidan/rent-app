import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import type { ButtonSize, ButtonVariant } from '../components/Button.classes';
import { Card } from '../components/Card';
import { useConfirm } from '../components/Dialog';
import { Field } from '../components/Field';
import { Logo } from '../components/Logo';
import { Mascot, type MascotPose } from '../components/Mascot';
import { PageContainer, type PageWidth } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { TabPanel, Tabs } from '../components/Tabs';
import { Tag } from '../components/Tag';
import { Textarea } from '../components/Textarea';
import { TextInput } from '../components/TextInput';

/** A 20px outline icon in the brand's line: 2px stroke, round caps, `currentColor`. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const plusIcon = (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
const filterIcon = (
  <Icon>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);
const checkIcon = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12l5 5 9-10" />
  </svg>
);

// `inverse` is for an ink fill: it has its own strip below, not this white row.
const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'soft', 'ghost', 'danger'];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];
const POSES: readonly MascotPose[] = ['default', 'hello', 'search', 'celebrate', 'sleep'];
const WIDTHS: readonly PageWidth[] = ['narrow', 'default', 'wide'];
const FILTERS = ['all', 'new', 'shortlisted', 'declined'] as const;
const VIEWS = ['list', 'map'] as const;

type Filter = (typeof FILTERS)[number];
type View = (typeof VIEWS)[number];

/**
 * The dev-only kit gallery at `/dev/kit` (spec 0009d): every kit component in every variant, size
 * and state, outside the app shell and with no API call. Not in the production build.
 */
export default function KitPreview() {
  const { t } = useTranslation();
  const [confirm, dialog] = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('list');

  const variantLabel: Record<ButtonVariant, string> = {
    primary: t('listings.publish'),
    secondary: t('listings.actions.edit'),
    soft: t('applicants.actions.unshortlist'),
    ghost: t('applicants.more'),
    danger: t('applicants.actions.decline'),
    inverse: t('landing.cta.owner'),
  };

  return (
    <main>
      <PageContainer width="wide" className="flex flex-col gap-8 py-8">
        <section>
          <PageHeader
            title={t('app.title')}
            subtitle={t('app.tagline')}
            back={{ to: '/', label: t('common.back') }}
            actions={<Button variant="secondary">{t('listings.actions.edit')}</Button>}
          />
        </section>

        <section className="flex flex-col gap-4">
          {VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {variantLabel[variant]}
                </Button>
              ))}
              <Button variant={variant} shape="pill">
                {variantLabel[variant]}
              </Button>
              <Button variant={variant} icon={plusIcon}>
                {variantLabel[variant]}
              </Button>
              <Button variant={variant} aria-label={t('search.filters')} icon={filterIcon} />
              <Button
                variant={variant}
                size="lg"
                aria-label={t('search.filters')}
                icon={filterIcon}
              />
              <Button variant={variant} busy>
                {t('profile.save')}
              </Button>
              <Button variant={variant} disabled>
                {t('profile.save')}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-ink p-4">
            {SIZES.map((size) => (
              <Button key={size} variant="inverse" size={size}>
                {variantLabel.inverse}
              </Button>
            ))}
            <Button variant="inverse" shape="pill">
              {variantLabel.inverse}
            </Button>
            <Button variant="inverse" disabled>
              {t('profile.save')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button to="/search" variant="secondary">
              {t('header.search')}
            </Button>
            <Button to="/search" variant="ghost" shape="pill">
              {t('applications.mine.search')}
            </Button>
          </div>
          <Button fullWidth size="lg">
            {t('listings.publish')}
          </Button>
        </section>

        <section className="flex flex-col gap-4">
          <ul className="flex flex-wrap items-center gap-2">
            <Tag as="li" tone="neutral">
              {t('listings.card.elevator')}
            </Tag>
            <Tag as="li" tone="accent" icon={checkIcon}>
              {t('match.seeker.area.agree')}
            </Tag>
            <Tag as="li" tone="warning">
              {t('applicants.room.differs')}
            </Tag>
            <Tag as="li" tone="inverse">
              {t('listings.card.room')}
            </Tag>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Tag size="sm" tone="neutral">
              {t('listings.card.pets')}
            </Tag>
            <Tag size="sm" tone="accent">
              {t('match.seeker.pets.agree')}
            </Tag>
            <Tag size="sm" tone="warning">
              {t('match.seeker.smoking.differ')}
            </Tag>
            <Tag size="sm" tone="inverse">
              {t('listings.card.room')}
            </Tag>
          </div>
          {(['sm', 'md'] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              <Badge size={size} tone="accent">
                {t('chat.list.new')}
              </Badge>
              <Badge size={size} tone="neutral">
                {t('listings.status.paused')}
              </Badge>
              <Badge size={size} tone="solid" srLabel={t('chat.list.unread', { count: 3 })}>
                {3}
              </Badge>
              <Badge size={size} tone="solid">
                {t('match.badge', { score: 92 })}
              </Badge>
              <Badge size={size} tone="inverse">
                {t('listings.status.live')}
              </Badge>
              <Badge size={size} tone="warning">
                {t('listings.status.expired')}
              </Badge>
            </div>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card as="article" interactive>
            <h3 className="text-h3">
              <Link
                to="/"
                className="rounded-sm after:absolute after:inset-0 after:content-[''] focus:outline-none"
              >
                {t('listings.type.apartment')}
              </Link>
            </h3>
            <p className="text-body-sm text-ink-muted">{t('listings.card.immediate')}</p>
          </Card>
          <Card variant="selected">
            <p className="text-h3">{t('listings.type.room')}</p>
            <p className="text-body-sm text-ink-muted">{t('listings.card.elevator')}</p>
          </Card>
          <Card variant="muted">
            <p className="text-body-sm text-ink-muted">{t('listings.preview.hint')}</p>
          </Card>
          {(['none', 'md', 'lg'] as const).map((padding) => (
            <Card key={padding} padding={padding}>
              <p className="text-body">{t('listings.room.privacyNote')}</p>
            </Card>
          ))}
          <Card variant="selected" interactive>
            <p className="text-h3">
              <Link
                to="/"
                className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
              >
                {t('listings.card.room')}
              </Link>
            </p>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Field label={t('listings.fields.city')}>
            <TextInput />
          </Field>
          <Field label={t('listings.fields.street')} hint={t('listings.fields.streetHint')}>
            <TextInput />
          </Field>
          <Field label={t('listings.fields.rooms')} error={t('listings.errors.required')}>
            <TextInput inputMode="decimal" />
          </Field>
          <Field label={t('listings.fields.price')}>
            <TextInput size="lg" inputMode="numeric" end={t('listings.units.ils')} />
          </Field>
          <Field label={t('listings.fields.size')} hint={t('listings.fields.optional')}>
            <TextInput inputMode="numeric" end={t('listings.units.sqm')} />
          </Field>
          <Field label={t('listings.fields.arnona')}>
            <TextInput disabled start={t('listings.units.ils')} />
          </Field>
          <Field
            label={t('listings.fields.description')}
            hint={t('listings.fields.charsLeft', { count: 1000 })}
          >
            <Textarea />
          </Field>
          <div className="flex flex-col gap-4">
            <Field label={t('listings.fields.furnished')}>
              <Select defaultValue="">
                <option value="" disabled>
                  {t('listings.fields.choose')}
                </option>
                <option value="none">{t('listings.furnished.none')}</option>
                <option value="partial">{t('listings.furnished.partial')}</option>
                <option value="full">{t('listings.furnished.full')}</option>
              </Select>
            </Field>
            <Field label={t('listings.fields.rooms')} error={t('listings.errors.required')}>
              <Select defaultValue="">
                <option value="" disabled>
                  {t('listings.fields.choose')}
                </option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Tabs
              label={t('applicants.filter.label')}
              items={FILTERS.map((value) => ({
                value,
                label: t(`applicants.filter.${value}`, { count: 0 }),
              }))}
              value={filter}
              onChange={setFilter}
              panelId="kit-filter-panel"
            />
            <TabPanel panelId="kit-filter-panel" value={filter} focusable>
              <p className="text-body text-ink-muted">{t('applicants.emptyFilter')}</p>
            </TabPanel>
          </div>
          <div className="flex flex-col items-start gap-3">
            <Tabs
              label={t('search.view.label')}
              items={VIEWS.map((value) => ({ value, label: t(`search.view.${value}`) }))}
              value={view}
              onChange={setView}
              panelId="kit-view-panel"
              variant="pill"
            />
            <TabPanel panelId="kit-view-panel" value={view} focusable>
              <p className="text-body text-ink-muted">
                {view === 'list' ? t('search.count', { count: 0 }) : t('search.map.empty')}
              </p>
            </TabPanel>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              void confirm({
                title: t('listings.edit.leaveConfirm'),
                body: t('listings.edit.expiredBody'),
                tone: 'primary',
              })
            }
          >
            {t('listings.actions.pause')}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void confirm({
                title: t('flatmates.mine.leaveConfirm'),
                confirmLabel: t('flatmates.mine.leave'),
                tone: 'danger',
              })
            }
          >
            {t('flatmates.mine.leave')}
          </Button>
          {dialog}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-8">
            <Logo className="h-8" />
            <Logo lang="en" className="h-8" />
            <Logo variant="lockup" className="h-10" />
            <Logo variant="lockup" lang="en" className="h-10" />
          </div>
          <div className="flex flex-wrap items-center gap-8 rounded-lg bg-ink p-6">
            <Logo tone="white" className="h-8" />
            <Logo tone="white" lang="en" className="h-8" />
          </div>
        </section>

        <section className="flex flex-wrap items-end gap-6">
          {POSES.map((pose) => (
            <Mascot key={pose} pose={pose} width={120} />
          ))}
        </section>

        {/* Block flow: a PageContainer's auto margins would stop a flex parent from stretching it. */}
        <section className="space-y-3">
          {WIDTHS.map((width) => (
            <PageContainer key={width} width={width}>
              <div className="h-8 rounded-sm bg-accent-soft" />
            </PageContainer>
          ))}
        </section>
      </PageContainer>
    </main>
  );
}
