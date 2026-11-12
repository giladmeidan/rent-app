import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { BackLink, PageHeader } from '../PageHeader';

describe('PageHeader', () => {
  it('ac5_page_header', () => {
    const titleRef = createRef<HTMLHeadingElement>();
    const onBack = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { container, unmount } = render(
      <MemoryRouter>
        <PageHeader
          title={he.listings.mine.title}
          subtitle={he.app.tagline}
          titleRef={titleRef}
          titleId="page-title"
          back={{ to: '/', label: he.common.back, onClick: onBack }}
          actions={<button type="button">{he.listings.mine.new}</button>}
        />
      </MemoryRouter>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveClass('flex', 'flex-col', 'gap-1');

    // One <h1>, in the display face, focusable by script only.
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    const h1 = headings[0] as HTMLElement;
    expect(h1).toHaveTextContent(he.listings.mine.title);
    expect(h1).toHaveClass('font-display', 'text-h2', 'lg:text-h1', 'break-words');
    expect(h1).toHaveAttribute('tabIndex', '-1');
    expect(h1).toHaveAttribute('id', 'page-title');
    titleRef.current?.focus();
    expect(h1).toHaveFocus();
    expect(screen.getByText(he.app.tagline)).toHaveClass('text-body-sm', 'text-ink-muted');
    expect(screen.getByRole('button', { name: he.listings.mine.new })).toBeInTheDocument();

    // The back link: href, label, a 44px target, the focus ring, and its onClick.
    const back = screen.getByRole('link', { name: he.common.back });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveClass('min-h-tap', 'focus-visible:outline-accent', 'text-ink-muted');
    expect(back.querySelector('svg')).toHaveClass('ltr:rotate-180');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();

    // Without the optional parts: just the title.
    render(
      <MemoryRouter>
        <PageHeader title={he.listings.mine.title} />
        <BackLink to="/me/listings" label={he.listings.edit.backToMine} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.listings.mine.title);
    expect(screen.getByRole('link', { name: he.listings.edit.backToMine })).toHaveAttribute(
      'href',
      '/me/listings',
    );
  });

  it('eyebrow_in_h1', () => {
    render(
      <MemoryRouter>
        <PageHeader eyebrow={he.applicants.titleFor} title="3 חדרים, רחוב הרצל" />
        <PageHeader title="no eyebrow" />
      </MemoryRouter>,
    );
    const heading = screen.getByRole('heading', {
      level: 1,
      name: `${he.applicants.titleFor} 3 חדרים, רחוב הרצל`,
    });
    // Inside the <h1>, before the title, in Rubik (the h1 is Fredoka, never below 24px).
    const eyebrow = within(heading).getByText(he.applicants.titleFor);
    expect(eyebrow).toHaveClass('block', 'font-sans', 'text-caption', 'text-ink-muted');
    expect(heading.firstElementChild).toBe(eyebrow);
    // Without it, the <h1> is the title alone.
    expect(screen.getByRole('heading', { level: 1, name: 'no eyebrow' }).children).toHaveLength(0);
  });

  it('compact_size', () => {
    const titleRef = createRef<HTMLHeadingElement>();
    const { container } = render(
      <MemoryRouter>
        <PageHeader
          size="compact"
          title={he.listings.new.title}
          titleRef={titleRef}
          titleId="compact-title"
          back={{ to: '/me/listings', label: he.listings.edit.backToMine }}
        />
        <PageHeader title="default size" />
      </MemoryRouter>,
    );
    // One <h1> per header: Rubik below lg (Fredoka is never below 24px), the display face at lg.
    const h1 = screen.getByRole('heading', { level: 1, name: he.listings.new.title });
    expect(h1).toHaveClass(
      'font-sans',
      'text-body',
      'font-medium',
      'lg:font-display',
      'lg:text-h1',
    );
    expect(h1).not.toHaveClass('font-display');
    expect(h1).toHaveAttribute('tabIndex', '-1');
    expect(h1).toHaveAttribute('id', 'compact-title');
    titleRef.current?.focus();
    expect(h1).toHaveFocus();
    // The back link shares the title's row below lg.
    const row = container.firstElementChild as HTMLElement;
    const back = screen.getByRole('link', { name: he.listings.edit.backToMine });
    expect(back.parentElement).toBe(row);
    expect(row).toHaveClass('flex', 'items-center', 'gap-2', 'lg:flex-col');
    expect(row).not.toHaveClass('flex-col');
    // The default size is unchanged.
    const other = screen.getByRole('heading', { level: 1, name: 'default size' });
    expect(other).toHaveClass('font-display', 'text-h2', 'lg:text-h1');
    expect(container.lastElementChild).toHaveClass('flex', 'flex-col', 'gap-1');
  });
});
