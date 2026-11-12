import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import i18n from '../../app/i18n';
import he from '../../locales/he.json';
import { NavIcon, NavTab } from '../NavTab';

const sentence = (count: number) => i18n.t('header.chatNew', { count });

function renderTab(path: string, count?: number) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavTab
        to="/chat"
        icon={
          <NavIcon>
            <path data-testid="icon-path" d="M3 3h18" />
          </NavIcon>
        }
        label={he.header.chat}
        count={count}
        countLabel={count === undefined ? undefined : sentence(count)}
      />
    </MemoryRouter>,
  );
}

describe('NavTab', () => {
  it('ac7_tab_name_and_badge', () => {
    // A count: the number is hidden from assistive tech, the sentence completes the name after a
    // separate space, so the name is exactly "צ'אט <sentence>". The count tone is the kit's.
    let view = renderTab('/search', 2);
    const tab = screen.getByRole('link');
    expect(tab).toHaveAttribute('href', '/chat');
    expect(tab).toHaveAccessibleName(`${he.header.chat} ${sentence(2)}`);
    const number = within(tab).getByText('2');
    expect(number).toHaveAttribute('aria-hidden', 'true');
    expect(within(tab).getByText(sentence(2))).toHaveClass('sr-only');
    expect(number.parentElement).toHaveClass('bg-accent', 'text-on-ink');
    // The icon is decorative and does not name the tab; not the current page.
    const icon = screen.getByTestId('icon-path').closest('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    expect(icon?.parentElement).toHaveClass('lg:hidden');
    expect(tab).not.toHaveAttribute('aria-current');
    expect(tab).toHaveClass('text-ink-muted', 'min-h-tap', 'max-lg:flex-1', 'max-lg:text-caption');
    view.unmount();

    // No count (0 or none): the label alone, no badge.
    for (const count of [0, undefined]) {
      view = renderTab('/search', count);
      const plain = screen.getByRole('link');
      expect(plain).toHaveAccessibleName(he.header.chat);
      expect(within(plain).queryByText(/\d/)).toBeNull();
      view.unmount();
    }

    // The current page, nested paths included: aria-current, accent and weight 500.
    for (const path of ['/chat', '/chat/C']) {
      view = renderTab(path);
      const current = screen.getByRole('link', { name: he.header.chat });
      expect(current).toHaveAttribute('aria-current', 'page');
      expect(current).toHaveClass(
        'aria-[current=page]:text-accent',
        'aria-[current=page]:font-medium',
        'lg:aria-[current=page]:border-accent',
      );
      view.unmount();
    }
  });
});
