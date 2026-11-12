import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRoutes } from '../../features/auth/__tests__/harness';
import he from '../../locales/he.json';
import { AppRoutes } from '../routes';

describe('/dev/kit', () => {
  it('ac9_dev_kit_route', async () => {
    const { container } = renderRoutes('/dev/kit', <AppRoutes />);

    // The lazy gallery renders its PageHeader <h1>, outside the app shell.
    const h1 = await screen.findByRole('heading', { level: 1, name: he.app.title });
    expect(h1).toHaveClass('font-display');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    // No app header: no banner landmark and no auth menu.
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByText(he.header.login)).toBeNull();

    // A tablist, the danger confirm opener, and the five mascot poses.
    const tablist = screen.getByRole('tablist', { name: he.applicants.filter.label });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('button', { name: he.flatmates.mine.leave })).toBeInTheDocument();
    const mascots = [...container.querySelectorAll('img')].filter((img) =>
      (img.getAttribute('src') ?? '').includes('homie-turtle'),
    );
    expect(mascots).toHaveLength(5);
    expect(document.querySelector("[data-testid='location']")).toHaveTextContent('/dev/kit');
  });
});
